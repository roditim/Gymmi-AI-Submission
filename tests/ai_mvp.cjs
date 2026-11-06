// Real deployed function + real model. Uses two disposable accounts and two model calls.
const assert=require('node:assert/strict'), crypto=require('node:crypto');
const {chromium}=require('playwright');
const ui=require('./ui_helpers.cjs');
const config=require('node:vm').runInNewContext(require('node:fs').readFileSync('docs/app/config.js','utf8')+';window.GYMMI_CONFIG',{window:{}});
const service=process.env.GYMMI_TEST_SERVICE_KEY;if(!service)throw Error('Provide an operator key in memory for QA fixtures and cleanup.');
const api=config.url, url=process.argv[2]||'http://127.0.0.1:8530/',users=[],checks=[];let browser;
async function call(path,method='GET',body,token=service,key=service){const r=await fetch(api+path,{method,headers:{apikey:key,Authorization:'Bearer '+token,'Content-Type':'application/json',Prefer:'return=representation'},body:body===undefined?undefined:JSON.stringify(body)});const raw=await r.text();return {status:r.status,data:raw?JSON.parse(raw):null};}
(async()=>{try{
 for(let i=0;i<2;i++){const email='gymmi-qa-'+crypto.randomUUID()+'@example.com',password=crypto.randomBytes(24).toString('base64url');const r=await call('/auth/v1/admin/users','POST',{email,password,email_confirm:true});assert.equal(r.status,200);const u={id:r.data.id,email,password};users.push(u);const s=await call('/auth/v1/token?grant_type=password','POST',{email,password},config.publishableKey,config.publishableKey);assert.equal(s.status,200);u.token=s.data.access_token;}
 browser=await chromium.launch({headless:true,...(process.env.GYMMI_BROWSER_PATH?{executablePath:process.env.GYMMI_BROWSER_PATH}:{})});
 const page=await browser.newPage({timezoneId:'Asia/Jerusalem'}),errors=[];page.setDefaultTimeout(45000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.goto(url);assert.equal(await page.locator('#ai-generate').isDisabled(),true);
 const unauth=await call('/functions/v1/ai-week-plan','POST',{},config.publishableKey,config.publishableKey);assert.equal(unauth.status,401);
 checks.push('guest UI and server reject unauthenticated AI access');
 await ui.account(page);await page.locator('#auth-email').fill(users[0].email);await page.locator('#auth-password').fill(users[0].password);await page.locator('#sign-in').click();await page.waitForFunction(()=>document.querySelector('#account-status').textContent.includes('שמירה בענן'));
 const today=await page.locator('#workout-date').inputValue();
 const week=await page.evaluate(day=>{const d=new Date(day+'T12:00:00');d.setDate(d.getDate()+7-((d.getDay()+6)%7));return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');},today);
 const shift=(day,n)=>new Date(Date.parse(day+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
 const workouts=[{id:crypto.randomUUID(),title:'Walk',date:week,minutes:30,exercises:'Private exercise details',status:'planned',resolvedAt:null},{id:crypto.randomUUID(),title:'Mobility',date:shift(week,1),minutes:30,exercises:'Private exercise details',status:'planned',resolvedAt:null},{id:crypto.randomUUID(),title:'Already done',date:today,minutes:30,exercises:'Private history',status:'completed',resolvedAt:new Date().toISOString()}];
 const created=await call('/rest/v1/workout_journals','POST',{user_id:users[0].id,workouts,revision:1},users[0].token,config.publishableKey);assert.equal(created.status,201);
 await ui.account(page);await page.locator('#reload-cloud').click();await page.waitForFunction(()=>document.querySelector('#completed-count').textContent==='1');
 await page.locator('#week-start').fill(week);await page.locator('#week-start').dispatchEvent('change');
 const body={weekStart:week,preferences:'Only Wednesday and Friday. Each workout must be at most 30 minutes.',workoutIds:workouts.slice(0,2).map(w=>w.id)};
 const invalid=await call('/functions/v1/ai-week-plan','POST',{...body,workoutIds:[workouts[2].id]},users[0].token,config.publishableKey);assert.equal(invalid.status,400);
 const foreign=await call('/functions/v1/ai-week-plan','POST',body,users[1].token,config.publishableKey);assert.equal(foreign.status,400);
 const quotaAttack=await call('/rest/v1/rpc/claim_ai_request','POST',{p_user_id:users[0].id},users[0].token,config.publishableKey);assert.equal(quotaAttack.status,403);
 const tableAttack=await call('/rest/v1/ai_demo_budget','GET',undefined,users[0].token,config.publishableKey);assert.equal(tableAttack.status,403);
 checks.push('server rejects foreign/completed workouts; users cannot alter AI quota');
 const snapshot=async()=>(await call('/rest/v1/workout_journals?select=workouts&user_id=eq.'+users[0].id,'GET',undefined,users[0].token,config.publishableKey)).data[0].workouts;
 await page.locator('#open-ai').click();await page.locator('#ai-preferences').fill(body.preferences);
 const response=page.waitForResponse(r=>r.url().includes('/functions/v1/ai-week-plan')&&r.request().method()==='POST');await page.locator('#ai-generate').click();const r=await response,p=await r.json();assert.equal(r.status(),200,JSON.stringify(p));
 await page.locator('#ai-proposal').waitFor({state:'visible'});assert.equal(p.model,'gpt-5.4-mini');assert.equal(p.assignments.length,2);assert.deepEqual(p.assignments.map(x=>x.date).sort(),[shift(week,2),shift(week,4)]);
 if(process.env.GYMMI_QA_DIR){const fs=require('node:fs/promises');await fs.mkdir(process.env.GYMMI_QA_DIR,{recursive:true});await page.locator('#ai-proposal').screenshot({path:process.env.GYMMI_QA_DIR+'/ai-real-proposal.png'});}
 assert.deepEqual(await snapshot(),workouts);checks.push('real OpenAI proposal respects specified days and does not auto-save');
 await page.locator('#ai-apply').click();await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('השיבוץ שאישרת נשמר'));
 const saved=await snapshot();assert.deepEqual(saved.map(w=>w.date).slice(0,2).sort(),[shift(week,2),shift(week,4)]);assert.deepEqual(saved[2],workouts[2]);assert.equal(saved[0].exercises,workouts[0].exercises);
 await page.reload();await page.waitForFunction(()=>document.querySelector('#account-status').textContent.includes('שמירה בענן'));await page.locator('#week-start').fill(week);await page.locator('#week-start').dispatchEvent('change');
 assert.deepEqual(await snapshot(),saved);checks.push('explicit approval persists dates; completed workout and exercise details remain unchanged');
 await page.locator('#open-ai').click();await page.locator('#ai-preferences').fill('פנוי רק ביום רביעי וביום שישי, עד 30 דקות בכל יום.');
 const hebrewResponse=page.waitForResponse(r=>r.url().includes('/functions/v1/ai-week-plan')&&r.request().method()==='POST');
 await page.locator('#ai-generate').click();const h=await hebrewResponse,hp=await h.json();assert.equal(h.status(),200,JSON.stringify(hp));assert.deepEqual(hp.assignments.map(x=>x.date).sort(),[shift(week,2),shift(week,4)]);
 await page.locator('#ai-proposal').waitFor({state:'visible'});await page.locator('#ai-dismiss').click();assert.deepEqual(await snapshot(),saved);checks.push('Hebrew availability works with a second real proposal; cancellation leaves the journal unchanged');
 await page.route(api+'/functions/v1/ai-week-plan',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({summary:'Invalid',assignments:[{workoutId:'foreign',date:week,reason:'bad'}],warnings:[]})}));
 await page.locator('#ai-generate').click();await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('התקבלה הצעה לא תקינה'));assert.equal(await page.locator('#ai-proposal').isVisible(),false);assert.deepEqual(await snapshot(),saved);await page.unroute(api+'/functions/v1/ai-week-plan');checks.push('invalid model-shaped output is blocked in the browser without saving');
 // Reserve the third attempt without another provider call, then exercise the actual server limit.
 const slot=await call('/rest/v1/rpc/claim_ai_request','POST',{p_user_id:users[0].id});assert.ok(slot.status<300);
 await page.locator('#ai-generate').click();await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('מכסת בקשות'));assert.deepEqual(await snapshot(),saved);checks.push('fourth daily attempt is rejected before a model call');
 await page.route(api+'/functions/v1/ai-week-plan',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({summary:'Mock used only to exercise stale-preview handling',assignments:[{workoutId:workouts[0].id,date:shift(week,2),reason:'test'}],warnings:[]})}));
 await page.locator('#ai-generate').click();await page.locator('#ai-proposal').waitFor({state:'visible'});
 await ui.editor(page);await page.locator('#workout-title').fill('Unsaved draft');await ui.closeEditor(page);await page.locator('#ai-apply').click();await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('סיים את עריכת האימון'));assert.deepEqual(await snapshot(),saved);await ui.editor(page);await page.locator('#workout-title').fill('');await ui.closeEditor(page);
 await page.locator('#ai-preferences').fill('A changed availability');assert.equal(await page.locator('#ai-proposal').isVisible(),false);
 await page.locator('#ai-generate').click();await page.locator('#ai-proposal').waitFor({state:'visible'});
 await page.locator('#workout-list article').first().getByRole('button',{name:'ערוך',exact:true}).click();await page.locator('#workout-title').fill('Edited after preview');await page.locator('#save-workout').click();await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('האימון נשמר בתוכנית'));assert.equal(await page.locator('#ai-proposal').isVisible(),false);
 await page.unroute(api+'/functions/v1/ai-week-plan');checks.push('changing preferences or editing the diary invalidates a stale AI preview (mocked response)');
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:checks.length,checks,url,real_model:'gpt-5.4-mini',real_model_calls:2,mail_sent:false},null,2));
 }finally{if(browser)await browser.close();for(const u of users){const r=await call('/auth/v1/admin/users/'+u.id,'DELETE');assert.equal(r.status,200,'QA cleanup failed');}}})().catch(e=>{console.error(e.message);process.exitCode=1;});
