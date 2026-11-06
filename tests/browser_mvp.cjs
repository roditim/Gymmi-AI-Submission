// Optional browser checks: npm install --no-save playwright
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const ui=require('./ui_helpers.cjs');

(async () => {
  const url = process.argv[2] || 'http://127.0.0.1:8520/';
  const browser = await chromium.launch({ headless: true,
    ...(process.env.GYMMI_BROWSER_PATH ? { executablePath: process.env.GYMMI_BROWSER_PATH } : {}) });
  const context = await browser.newContext({ timezoneId: 'Asia/Jerusalem', acceptDownloads: true });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', async dialog => { try { await dialog.accept(); } catch (error) { if (!page.isClosed()) console.error(error.message); } });
  const checks = [];
  const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('gymmi-workouts-v1') || '{"version":1,"workouts":[]}'));
  const fill = async (title, day) => {
    await ui.editor(page);
    await page.locator('#workout-title').fill(title);
    await page.locator('#workout-date').fill(day);
    await page.locator('#workout-exercises').fill('My chosen routine');
    await page.getByRole('button', { name: 'הוסף אימון', exact: true }).click();
  };
  try {
    await page.goto(url); await page.getByRole('heading', { level: 1 }).waitFor();
    const today = await page.locator('#workout-date').inputValue();
    assert.equal((await state()).workouts.length, 0);
    await fill('Today workout', today);
    let card = page.locator('article').filter({ hasText: 'Today workout' });
    await card.getByRole('button', { name: 'סמן הושלם', exact: true }).click();
    await page.reload();
    assert.equal((await state()).workouts.length, 1);
    assert.equal((await state()).workouts[0].status, 'completed');
    assert.equal(await page.locator('#completed-count').innerText(), '1');
    checks.push('add, complete, progress and persistence after reload');

    card = page.locator('article').filter({ hasText: 'Today workout' });
    await card.getByRole('button', { name: 'ערוך', exact: true }).click();
    await page.locator('#workout-title').fill('Edited workout');
    await page.locator('#workout-minutes').fill('45');
    await page.getByRole('button', { name: 'שמור שינויים', exact: true }).click();
    assert.equal((await state()).workouts[0].minutes, 45);
    assert.equal((await state()).workouts[0].status, 'completed');
    card = page.locator('article').filter({ hasText: 'Edited workout' });
    await ui.menu(card);await card.getByRole('button', { name: 'בטל סימון', exact: true }).click();
    assert.equal((await state()).workouts[0].status, 'planned');
    checks.push('editing preserves completion; undo updates progress');

    const tomorrow = await page.evaluate(day => { const d = new Date(day + 'T12:00:00'); d.setDate(d.getDate() + 1); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }, today);
    await fill('Future workout', tomorrow);
    card = page.locator('article').filter({ hasText: 'Future workout' });
    assert.equal(await card.getByRole('button', { name: 'סמן הושלם', exact: true }).isDisabled(), true);
    await ui.menu(card);assert.equal(await card.getByRole('button', { name: 'דילגתי', exact: true }).isDisabled(), true);
    const before = JSON.stringify(await state());
    await page.getByRole('button', { name: 'הוסף תוכנית לדוגמה', exact: true }).click();
    assert.equal(JSON.stringify(await state()), before);
    checks.push('future outcomes blocked and example plan does not duplicate existing workouts');

    await page.getByRole('button', { name: 'גיבוי ונתונים', exact: true }).click();
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: 'הורד גיבוי JSON', exact: true }).click();
    const download = await downloadEvent;
    const exported = JSON.parse(await fs.readFile(await download.path(), 'utf8'));
    assert.equal(exported.workouts.length, 2);
    await page.locator('#import-data').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{"version":1,"workouts":[{"id":"bad"}]}') });
    await page.waitForFunction(() => document.getElementById('message').textContent.includes('הגיבוי לא שוחזר'));
    assert.equal(JSON.stringify(await state()), before);
    await page.getByRole('button', { name: 'מחק את הנתונים בדפדפן הזה', exact: true }).click();
    assert.equal((await state()).workouts.length, 0);
    await page.locator('#import-data').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported)) });
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('gymmi-workouts-v1') || '{}').workouts?.length === 2);
    await page.reload();
    assert.equal((await state()).workouts.length, 2);
    checks.push('backup round trip, invalid import does not replace data, confirmed reset');

    const other = await browser.newContext({ timezoneId: 'Asia/Jerusalem' });
    const fresh = await other.newPage(); await fresh.goto(url);
    assert.equal(await fresh.locator('#planned-count').innerText(), '0'); await other.close();
    checks.push('separate browser visitors have separate data');

    await page.evaluate(() => localStorage.setItem('gymmi-workouts-v1', '{corrupt'));
    await page.reload(); assert.equal(await page.locator('#storage-error').isVisible(), true);
    assert.equal(await page.locator('#save-workout').isDisabled(), true);
    assert.equal(await page.evaluate(() => localStorage.getItem('gymmi-workouts-v1')), '{corrupt');
    await page.getByRole('button', { name: 'גיבוי ונתונים', exact: true }).click();
    await page.getByRole('button', { name: 'מחק את הנתונים בדפדפן הזה', exact: true }).click();
    await page.getByRole('button', { name: 'התוכנית השבועית', exact: true }).click();
    await page.evaluate(() => { Storage.prototype.setItem = function () { throw new Error('storage denied'); }; });
    await fill('Must not appear saved', today);
    assert.equal((await state()).workouts.length, 0);
    await page.reload();
    checks.push('corrupted data preserved; unavailable storage reports errors without claiming success');

    const literal = '<img src=x onerror=window.pwned=true>';
    await fill(literal, today);
    assert.equal(await page.locator('article h3').innerText(), literal);
    assert.equal(await page.evaluate(() => window.pwned === true), false);
    checks.push('user text stays text, not executable HTML');

    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const output = process.env.GYMMI_QA_DIR || await fs.mkdtemp(path.join(os.tmpdir(), 'gymmi-web-'));
    await fs.mkdir(output, { recursive: true });
    await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1365, height: 900 });
    await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
    await page.addInitScript(() => { Storage.prototype.getItem = function () { throw new Error('read denied'); }; });
    await page.reload();
    assert.equal(await page.locator('#storage-error').isVisible(), true);
    await page.getByRole('button', { name: 'גיבוי ונתונים', exact: true }).click();
    await page.getByRole('button', { name: 'הורד גיבוי JSON', exact: true }).click();
    assert.match(await page.locator('#message').innerText(), /לא ניתן לייצא/);
    assert.deepEqual(errors, []);
    checks.push('mobile fit and no browser runtime errors');
    console.log(JSON.stringify({ passed: checks.length, checks, url, screenshots: output }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
