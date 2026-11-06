// Optional integration test. Uses disposable QA accounts in the named project.
// Supply GYMMI_TEST_SERVICE_KEY only in the process environment, never in Git.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const { chromium } = require('playwright');
const ui=require('./ui_helpers.cjs');
const config = require('node:vm').runInNewContext(
  require('node:fs').readFileSync('docs/app/config.js', 'utf8') + '; window.GYMMI_CONFIG', {window:{}});
const api = config.url;
const service = process.env.GYMMI_TEST_SERVICE_KEY;
if (!service) throw new Error('A scoped QA operator must provide a service key in memory.');
const url = process.argv[2] || 'http://127.0.0.1:8530/';
const users = [], contexts = [], checks = [];
let browser;
async function request(path, method='GET', body, token=service, key=service) {
  const r = await fetch(api + path, { method, headers: {apikey:key, Authorization:'Bearer '+token,
    'Content-Type':'application/json', Prefer:'return=representation'},
    body: body === undefined ? undefined : JSON.stringify(body) });
  const raw = await r.text();
  return {status:r.status, data:raw ? JSON.parse(raw) : null};
}
async function login(page, user) {
  await page.goto(url);
  await ui.account(page);
  await page.locator('#auth-email').fill(user.email);
  await page.locator('#auth-password').fill(user.password);
  await page.locator('#sign-in').click();
  await page.waitForFunction(() => document.querySelector('#account-status').textContent.includes('שמירה בענן'));
  await page.waitForFunction(()=>!document.querySelector('#new-workout').disabled);
}
async function add(page, title) {
  await ui.editor(page);
  await page.locator('#workout-title').fill(title);
  await page.locator('#workout-exercises').fill('Disposable QA routine');
  await page.locator('#save-workout').click();
  await page.waitForFunction(() => document.querySelector('#message').textContent.includes('האימון נשמר בתוכנית'));
}
async function snapshot(token) {
  const r=await request('/rest/v1/workout_journals?select=*','GET',undefined,token,config.publishableKey);
  assert.equal(r.status,200); return r.data;
}
(async () => {
  try {
    // Admin-created confirmed accounts avoid sending mail to anybody.
    // This deliberately does NOT claim that public email delivery was tested.
    for (let i=0;i<2;i++) {
      const email='gymmi-qa-'+crypto.randomUUID()+'@example.com', password=crypto.randomBytes(24).toString('base64url');
      const created=await request('/auth/v1/admin/users','POST',{email,password,email_confirm:true});
      assert.equal(created.status,200);
      const user={id:created.data.id,email,password}; users.push(user);
      const signed=await request('/auth/v1/token?grant_type=password','POST',{email,password},config.publishableKey,config.publishableKey);
      assert.equal(signed.status,200); user.token=signed.data.access_token;
    }
    browser=await chromium.launch({headless:true,...(process.env.GYMMI_BROWSER_PATH ? {executablePath:process.env.GYMMI_BROWSER_PATH}:{})});
    for (let i=0;i<3;i++) contexts.push(await browser.newContext({timezoneId:'Asia/Jerusalem'}));
    const [a,b,device]=await Promise.all(contexts.map(c=>c.newPage()));
    for (const p of [a,b,device]) p.on('dialog',d=>d.accept());
    const errors=[]; for(const p of [a,b,device]) p.on('pageerror',e=>errors.push(e.message));
    await a.goto(url); await add(a,'Guest kept locally');
    await login(a,users[0]);
    assert.equal(await a.locator('#planned-count').innerText(),'0');
    assert.equal(await a.evaluate(()=>JSON.parse(localStorage.getItem('gymmi-workouts-v1')).workouts[0].title),'Guest kept locally');
    checks.push('sign-in keeps local guest diary separate; no automatic upload');
    await add(a,'Cloud workout A');
    await a.locator('article').filter({hasText:'Cloud workout A'}).getByRole('button',{name:'סמן הושלם',exact:true}).click();
    await a.waitForFunction(()=>document.querySelector('#completed-count').textContent==='1');
    await a.reload(); await a.waitForFunction(()=>document.querySelector('#completed-count').textContent==='1');
    await login(device,users[0]);
    assert.equal(await device.locator('#completed-count').innerText(),'1');
    checks.push('cloud add/completion persist after reload and on a separate browser device');
    await login(b,users[1]); assert.equal(await b.locator('#planned-count').innerText(),'0');
    await add(b,'Cloud workout B');
    const owned=await snapshot(users[0].token); assert.equal(owned.length,1); assert.equal(owned[0].user_id,users[0].id);
    const attack='/rest/v1/workout_journals?user_id=eq.'+users[0].id;
    assert.deepEqual((await request(attack,'GET',undefined,users[1].token,config.publishableKey)).data,[]);
    assert.deepEqual((await request(attack,'PATCH',{workouts:[]},users[1].token,config.publishableKey)).data,[]);
    const theft=await request('/rest/v1/workout_journals','POST',{user_id:crypto.randomUUID(),workouts:[]},users[1].token,config.publishableKey);
    assert.equal(theft.status,403);
    const reassign=await request('/rest/v1/workout_journals?user_id=eq.'+users[1].id,'PATCH',{user_id:users[0].id},users[1].token,config.publishableKey);
    assert.equal(reassign.status,403);
    const anonymous=await request('/rest/v1/workout_journals','GET',undefined,config.publishableKey,config.publishableKey);
    assert.ok([401,403].includes(anonymous.status));
    assert.equal((await snapshot(users[0].token))[0].workouts.length,1);
    checks.push('real API RLS blocks cross-account read/update/insert/reassignment and anonymous reads');
    await a.locator('article').getByRole('button',{name:'ערוך',exact:true}).click();
    await a.locator('#workout-title').fill('Newest cloud version'); await a.locator('#save-workout').click();
    await a.waitForFunction(()=>document.querySelector('#message').textContent.includes('האימון נשמר בתוכנית'));
    await device.locator('article').getByRole('button',{name:'ערוך',exact:true}).click();
    await device.locator('#workout-title').fill('Must not overwrite'); await device.locator('#save-workout').click();
    await device.waitForFunction(()=>document.querySelector('#message').textContent.includes('ממכשיר אחר'));
    assert.equal((await snapshot(users[0].token))[0].workouts[0].title,'Newest cloud version');
    await ui.closeEditor(device);await ui.account(device);await device.locator('#reload-cloud').click();
    await device.locator('#workout-list article h3').filter({hasText:'Newest cloud version'}).waitFor();
    checks.push('stale device write rejected; explicit reload obtains newest journal');
    await device.route(api+'/rest/v1/**',r=>r.abort());
    await device.locator('article').getByRole('button',{name:'ערוך',exact:true}).click();
    await device.locator('#workout-title').fill('Network failure draft'); await device.locator('#save-workout').click();
    await device.waitForFunction(()=>document.querySelector('#message').textContent.includes('השינוי לא נשמר'));
    assert.equal(await device.locator('#workout-list article h3').innerText(),'Newest cloud version');
    assert.equal(await device.locator('#workout-title').inputValue(),'Network failure draft');
    await device.unroute(api+'/rest/v1/**');
    checks.push('network failure preserves saved state and editable draft without claiming success');
    await device.route(api+'/rest/v1/**',r=>r.abort());
    await ui.closeEditor(device);await ui.account(device);await device.locator('#reload-cloud').click();
    await device.waitForFunction(()=>document.querySelector('#message').textContent.includes('היומן לא נטען'));
    assert.equal(await device.locator('#save-workout').isDisabled(),true);
    assert.equal(await device.locator('#workout-list article').count(),0);
    await device.unroute(api+'/rest/v1/**');
    await ui.account(device);await device.locator('#reload-cloud').click();
    await device.locator('#workout-list article h3').filter({hasText:'Newest cloud version'}).waitFor();
    assert.equal(await device.locator('#save-workout').isDisabled(),false);
    checks.push('failed cloud load blocks editing and successful reload restores it');
    await ui.account(a);await a.locator('#upload-local').click();
    await a.waitForFunction(()=>document.querySelector('#message').textContent.includes('היומן הועבר'));
    assert.equal((await snapshot(users[0].token))[0].workouts[0].title,'Guest kept locally');
    await a.locator('#sign-out').click(); await a.locator('#auth-form').waitFor({state:'visible'});
    await a.waitForFunction(()=>document.querySelector('#account-status').textContent.includes('מצב אורח'));
    assert.equal(await a.locator('#workout-list article h3').innerText(),'Guest kept locally');
    await login(a,users[1]); assert.equal(await a.locator('#workout-list article h3').innerText(),'Cloud workout B');
    checks.push('explicit guest upload, sign-out restores guest data, account switch has no data bleed');
    await a.getByRole('button',{name:'גיבוי ונתונים',exact:true}).click();
    const backup={version:1,workouts:[]};
    await a.locator('#import-data').setInputFiles({name:'empty.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});
    await a.waitForFunction(()=>document.querySelector('#message').textContent.includes('הגיבוי שוחזר'));
    assert.equal((await snapshot(users[1].token))[0].workouts.length,0);
    checks.push('validated backup replacement is a single cloud write');
    // Hold a file read open while the account changes: it must not target the next diary.
    await a.evaluate(() => { File.prototype.text = function () { return new Promise(resolve => { window.finishQAFile = () => resolve('{"version":1,"workouts":[]}'); }); }; });
    await a.locator('#import-data').setInputFiles({name:'delayed.json',mimeType:'application/json',buffer:Buffer.from('{}')});
    await a.waitForFunction(()=>typeof window.finishQAFile==='function');
    await ui.account(a);await a.locator('#sign-out').click();
    await a.waitForFunction(()=>document.querySelector('#account-status').textContent.includes('מצב אורח'));
    await a.evaluate(()=>window.finishQAFile());
    await a.waitForFunction(()=>document.querySelector('#message').textContent.includes('החשבון השתנה'));
    assert.equal(await a.locator('#planned-count').innerText(),'1');
    checks.push('a backup file still being read cannot replace the diary after an account switch');
    assert.deepEqual(errors,[]);
    if(process.env.GYMMI_QA_DIR) {
      await fs.mkdir(process.env.GYMMI_QA_DIR,{recursive:true});
      await a.screenshot({path:process.env.GYMMI_QA_DIR+'/cloud-desktop.png',fullPage:true});
      await a.setViewportSize({width:390,height:844});
      assert.equal(await a.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      await a.screenshot({path:process.env.GYMMI_QA_DIR+'/cloud-mobile.png',fullPage:true});
    }
    checks.push('no browser runtime errors; mobile layout has no horizontal overflow');
    console.log(JSON.stringify({passed:checks.length,checks,url,email_delivery_tested:false},null,2));
  } finally {
    for (const ctx of contexts) await ctx.close(); if(browser) await browser.close();
    for (const user of users) {
      const removed=await request('/auth/v1/admin/users/'+user.id,'DELETE');
      assert.equal(removed.status,200,'QA account cleanup failed');
    }
  }
})().catch(e=>{console.error(e.message);process.exitCode=1;});
