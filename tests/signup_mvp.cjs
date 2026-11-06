// Actual public sign-up; admin access is used only to clean up this QA account.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const {chromium} = require('playwright');
const ui=require('./ui_helpers.cjs');
const config = require('node:vm').runInNewContext(require('node:fs').readFileSync('docs/app/config.js','utf8')+';window.GYMMI_CONFIG',{window:{}});
const service = process.env.GYMMI_TEST_SERVICE_KEY;
if(!service) throw new Error('Provide the cleanup key in the operator process environment only.');
const url=process.argv[2] || 'http://127.0.0.1:8530/';
const email='gymmi-qa-'+crypto.randomUUID()+'@example.com';
const password=crypto.randomBytes(24).toString('base64url');
let browser, userId; const checks=[];
const mobile=process.env.GYMMI_TEST_MOBILE==='1';
async function authForm(page,pw=password) {
  await ui.account(page);
  await page.locator('#auth-email').fill(email);
  await page.locator('#auth-password').fill(pw);
}
async function signedIn(page) {
  await page.waitForFunction(()=>document.querySelector('#account-status').textContent.includes('שמירה בענן'));
}
async function signOut(page) {
  await ui.account(page);
  await page.locator('#sign-out').click();
  await page.waitForFunction(()=>document.querySelector('#account-status').textContent.includes('מצב אורח'));
}
(async()=>{
 try {
  browser=await chromium.launch({headless:true,...(process.env.GYMMI_BROWSER_PATH?{executablePath:process.env.GYMMI_BROWSER_PATH}:{})});
  const options={timezoneId:'Asia/Jerusalem',...(mobile?{viewport:{width:390,height:844}}:{})};
  const first=await browser.newContext(options), second=await browser.newContext(options);
  const page=await first.newPage(), device=await second.newPage(); const errors=[];
  for(const p of [page,device]) p.on('pageerror',e=>errors.push(e.message));
  await page.goto(url); await authForm(page);
  const signup=page.waitForResponse(r=>r.url().startsWith(config.url+'/auth/v1/signup') && r.request().method()==='POST');
  await page.locator('#sign-up').click(); const response=await signup; const payload=await response.json();
  userId=payload.user?.id; // Capture immediately so assertions cannot leave a QA account behind.
  assert.equal(response.status(),200,'Public signup must succeed without admin confirmation');
  assert.ok(userId); assert.ok(payload.access_token,'Signup must return a session without mail');
  await signedIn(page); assert.equal(await page.locator('#planned-count').innerText(),'0');
  checks.push('real browser signup returns a session without email or admin confirmation');
  await ui.editor(page);await page.locator('#workout-title').fill('Public signup QA workout');
  await page.locator('#workout-exercises').fill('Disposable QA routine');
  await page.locator('#save-workout').click();
  await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('האימון נשמר בתוכנית'));
  await page.locator('#workout-list article').getByRole('button',{name:'סמן הושלם',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#completed-count').textContent==='1');
  await page.reload(); await signedIn(page);
  assert.equal(await page.locator('#completed-count').innerText(),'1');
  checks.push('newly registered account saves a workout and completion across reload');
  await signOut(page); assert.equal(await page.locator('#planned-count').innerText(),'0');
  await authForm(page); await page.locator('#sign-in').click(); await signedIn(page);
  assert.equal(await page.locator('#completed-count').innerText(),'1');
  checks.push('sign-out and password sign-in restore the same cloud diary');
  await device.goto(url); await authForm(device); await device.locator('#sign-in').click(); await signedIn(device);
  assert.equal(await device.locator('#completed-count').innerText(),'1');
  checks.push('independent browser device loads the registered account and completion');
  await signOut(device); await authForm(device,'wrong-password-'+crypto.randomUUID());
  await device.locator('#sign-in').click();
  await device.waitForFunction(()=>document.querySelector('#message').textContent.includes('הפעולה לא הושלמה'));
  assert.equal(await device.locator('#account-actions').isVisible(),false);
  assert.equal(await device.locator('#planned-count').innerText(),'0');
  checks.push('wrong password leaves guest mode and cloud data inaccessible');
  await authForm(device);
  const duplicate=device.waitForResponse(r=>r.url().startsWith(config.url+'/auth/v1/signup') && r.request().method()==='POST');
  await device.locator('#sign-up').click();
  assert.equal((await duplicate).status(),422,'Existing account must be rejected');
  await device.waitForFunction(()=>document.querySelector('#message').textContent.includes('הפעולה לא הושלמה'));
  assert.equal(await device.locator('#account-actions').isVisible(),false);
  checks.push('duplicate signup does not create a replacement account or sign in');
  assert.deepEqual(errors,[]);
  if(process.env.GYMMI_QA_DIR) {
    await fs.mkdir(process.env.GYMMI_QA_DIR,{recursive:true});
    await page.screenshot({path:process.env.GYMMI_QA_DIR+'/signup-cloud.png',fullPage:true});
  }
  await signOut(page); // Revoke this test session before deleting the account.
  console.log(JSON.stringify({passed:checks.length,checks,url,viewport:mobile?'390x844':'desktop',public_signup:true,admin_confirmation_used:false,email_delivery_required:false},null,2));
 } finally {
  if(browser) await browser.close();
  if(userId) {
    const removed=await fetch(config.url+'/auth/v1/admin/users/'+userId,{method:'DELETE',headers:{apikey:service,Authorization:'Bearer '+service}});
    assert.equal(removed.status,200,'Disposable public-signup QA account cleanup failed');
  }
 }
})().catch(e=>{console.error(e.message);process.exitCode=1;});
