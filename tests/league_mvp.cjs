const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
const { chromium } = require('playwright');
const ui = require('./ui_helpers.cjs');

const config = vm.runInNewContext(fs.readFileSync('docs/app/config.js', 'utf8') +
  '; window.GYMMI_CONFIG', { window: {} });
const service = process.env.GYMMI_TEST_SERVICE_KEY;
assert.ok(service, 'Supply the QA service key in process memory');
const url = process.argv[2] || 'http://127.0.0.1:8530/';
const users = [];
const checks = [];

async function call(path, method = 'GET', body, token = service, key = service) {
  const result = await fetch(config.url + path, {
    method,
    headers: { apikey: key, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const raw = await result.text();
  return { status: result.status, data: raw ? JSON.parse(raw) : null };
}

async function account() {
  const email = 'gymmi-league-qa-' + crypto.randomUUID() + '@example.com';
  const password = crypto.randomBytes(24).toString('base64url');
  const created = await call('/auth/v1/admin/users', 'POST', { email, password, email_confirm: true });
  assert.equal(created.status, 200);
  const user = { id: created.data.id, email, password };
  users.push(user);
  const session = await call('/auth/v1/token?grant_type=password', 'POST',
    { email, password }, config.publishableKey, config.publishableKey);
  assert.equal(session.status, 200);
  user.token = session.data.access_token;
  return user;
}

async function as(user, path, method = 'GET', body) {
  return call(path, method, body, user.token, config.publishableKey);
}

async function signIn(page, user) {
  await page.goto(url); await ui.dismissOnboarding(page);
  await ui.account(page);
  await page.locator('#auth-email').fill(user.email);
  await page.locator('#auth-password').fill(user.password);
  await page.locator('#sign-in').click();
  await page.waitForFunction(() => !document.querySelector('#account-dialog').open &&
    document.querySelector('#account-status').textContent.includes('שמירה בענן'));
  await page.locator('#league-panel > summary').click();
}

async function join(page, nickname) {
  await page.locator('#league-nickname').fill(nickname);
  await page.locator('#league-join').click();
  await page.getByRole('cell', { name: nickname + ' (אני)', exact: true }).waitFor();
}

async function xp(page, amount) {
  await page.waitForFunction(expected => document.querySelector('#exp-total').textContent === expected, amount + ' EXP');
}

(async () => {
  let browser;
  const members = '/rest/v1/league_members';
  const rpc = '/rest/v1/rpc/weekly_league';
  try {
    const a = await account(), b = await account();
    const tag = crypto.randomBytes(4).toString('hex');
    const nickA = 'QA-A-' + tag, nickB = 'QA-B-' + tag;
    const anonymous = await call(rpc, 'POST', {}, config.publishableKey, config.publishableKey);
    assert.ok(anonymous.status >= 400);
    const dates = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' });
    const today = dates.format(new Date());
    const prior = dates.format(new Date(Date.now() - 8 * 86400000));
    const workouts = Array.from({ length: 5 }, (_, index) => ({
      id: crypto.randomUUID(), title: index ? 'Private old workout ' + index : 'Private current workout',
      date: index ? prior : today, minutes: 30, exercises: 'Private QA exercise',
      status: index ? 'completed' : 'planned', resolvedAt: index ? new Date().toISOString() : null
    }));
    assert.equal((await as(a, '/rest/v1/workout_journals', 'POST', { user_id: a.id, workouts, revision: 1 })).status, 201);

    browser = await chromium.launch({ headless: true,
      ...(process.env.GYMMI_BROWSER_PATH ? { executablePath: process.env.GYMMI_BROWSER_PATH } : {}) });
    const options = { viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Jerusalem' };
    const pa = await browser.newPage(options), pb = await browser.newPage(options);
    const errors = [];
    for (const p of [pa, pb]) p.on('pageerror', error => errors.push(error.message));
    await Promise.all([signIn(pa, a), signIn(pb, b)]);
    await xp(pa, 400);
    const card = pa.locator('#workout-list article').filter({ hasText: 'Private current workout' });
    await pa.locator('#league-calendar').click();
    await pa.locator('#calendar-today').click();
    await pa.locator('#calendar-day-list article').filter({ hasText: 'Private current workout' })
      .getByRole('button', { name: 'סמן הושלם', exact: true }).click();
    await pa.locator('[data-view="plan"]').click();
    await xp(pa, 500);
    assert.equal(await pa.locator('#exp-level').innerText(), 'רמה 2');
    checks.push('Existing journal EXP, calendar completion and level 2');
    assert.ok(!(await as(b, rpc, 'POST', {})).data.some(row => row.nickname === nickA));
    await join(pa, nickA);
    await join(pb, nickB);
    const result = await as(b, rpc, 'POST', {});
    assert.equal(result.status, 200);
    const other = result.data.find(row => row.nickname === nickA);
    assert.deepEqual(Object.keys(other).sort(), ['is_you', 'nickname', 'place', 'weekly_exp']);
    assert.equal(other.weekly_exp, 100);
    assert.equal(other.is_you, false);
    assert.ok(other.place < result.data.find(row => row.nickname === nickB).place);
    assert.ok(!JSON.stringify(result.data).includes(a.id));
    assert.ok(!JSON.stringify(result.data).includes('Private QA exercise'));
    await pb.getByRole('cell', { name: nickA, exact: true }).waitFor();
    assert.equal(await pb.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    if (process.env.GYMMI_QA_DIR) {
      await pa.locator('#league-refresh').click();
      await pa.getByRole('cell', { name: nickB, exact: true }).waitFor();
      await fs.promises.mkdir(process.env.GYMMI_QA_DIR, { recursive: true });
      const toast = pa.locator('#message .notice-close');
      if (await toast.isVisible()) await toast.click();
      await pa.locator('#league-panel').screenshot({ path: process.env.GYMMI_QA_DIR + '/gymmi-league-ui.png' });
    }
    checks.push('Opt-in, two accounts, weekly isolation and mobile layout');

    const forbidden = await as(b, members + '?user_id=eq.' + a.id);
    assert.deepEqual(forbidden.data, []);
    const attempted = await as(b, members + '?user_id=eq.' + a.id, 'PATCH', { nickname: 'Tampered' });
    assert.deepEqual(attempted.data, []);
    assert.ok((await as(b, members, 'POST', { user_id: a.id, nickname: 'Tampered' })).status >= 400);
    assert.ok((await as(b, members + '?user_id=eq.' + b.id, 'PATCH', { nickname: 'qa@example.com' })).status >= 400);
    checks.push('Anonymous access blocked, membership RLS and nickname validation');

    await ui.menu(card);
    await card.getByRole('button', { name: 'בטל סימון' }).click();
    await xp(pa, 400);
    assert.equal(await pa.locator('#exp-level').innerText(), 'רמה 1');
    assert.equal((await as(b, rpc, 'POST', {})).data.find(row => row.nickname === nickA).weekly_exp, 0);
    await pa.locator('#league-leave').click();
    await pa.locator('#league-leave').waitFor({ state: 'hidden' });
    await pb.locator('#league-refresh').click();
    await pb.getByRole('cell', { name: nickA, exact: true }).waitFor({ state: 'hidden' });
    await xp(pa, 400);
    assert.deepEqual(errors, []);
    checks.push('Undo reverses score, leaving removes entry and preserves personal EXP');
  } finally {
    if (browser) await browser.close();
    for (const user of users) {
      assert.equal((await call('/auth/v1/admin/users/' + user.id, 'DELETE')).status, 200);
    }
  }
  console.log(JSON.stringify({ url, passed: checks.length, checks, qa_accounts_removed: true }, null, 2));
})().catch(error => { console.error(error.stack); process.exitCode = 1; });

