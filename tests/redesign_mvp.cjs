const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {chromium}=require('playwright');const ui=require('./ui_helpers.cjs');
(async()=>{
 const url=process.argv[2]||'http://127.0.0.1:8530/';
 const browser=await chromium.launch({headless:true,...(process.env.GYMMI_BROWSER_PATH?{executablePath:process.env.GYMMI_BROWSER_PATH}:{})});
 const checks=[],errors=[];try{
  const page=await browser.newPage({viewport:{width:1365,height:900},timezoneId:'Asia/Jerusalem'});page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url); await ui.dismissOnboarding(page);await page.evaluate(()=>document.fonts.ready);
  assert.equal(await page.evaluate(()=>document.fonts.check('16px Heebo')),true);
  assert.equal(await page.locator('#workout-title').isVisible(),false);assert.equal(await page.locator('#auth-email').isVisible(),false);
  assert.equal(await page.locator('.app-nav svg').count(),4);assert.equal(await page.locator('.app-rail').evaluate(e=>getComputedStyle(e).position),'sticky');
  assert.equal(await page.locator('#progress-percent').innerText(),'0%');
  checks.push('dashboard uses the bundled Hebrew font, desktop rail and real zero progress without exposing full forms');

  await ui.editor(page);await page.locator('#workout-title').fill('Draft kept after Escape');
  await page.keyboard.press('Escape');assert.equal(await page.locator('#workout-dialog').isVisible(),false);
  await ui.editor(page);assert.equal(await page.locator('#workout-title').inputValue(),'Draft kept after Escape');
  await page.locator('#workout-title').fill('');await page.locator('#save-workout').click();
  assert.equal(await page.locator('#workout-form').evaluate(e=>e.checkValidity()),false);
  assert.equal(await page.evaluate(()=>localStorage.getItem('gymmi-workouts-v1')),null);
  await ui.closeEditor(page);checks.push('native editor supports Escape, retains drafts and blocks invalid submission without saving');

  await page.locator('#next-week').click();const target=await page.locator('#week-strip button').last().getAttribute('data-date');
  await page.locator('#week-strip button').last().click();assert.equal(await page.locator('#workout-date').inputValue(),target);
  await page.locator('#workout-title').fill('Selected-day workout');await page.locator('#workout-exercises').fill('My own routine');await page.locator('#save-workout').click();
  assert.equal(await page.locator('#workout-dialog').isVisible(),false);assert.equal(await page.locator('#planned-count').innerText(),'1');
  await page.locator('#focus-workout').click();assert.equal(await page.locator('#workout-list .routine-details').getAttribute('open'),'');
  checks.push('week strip opens a workout on the selected date; focus card reveals actual saved routine details');

  const today=await page.locator('#workout-date').inputValue();
  const rows=[{id:'r-1',title:'הליכה',date:today,minutes:30,exercises:'Routine one',status:'planned',resolvedAt:null},{id:'r-2',title:'כוח',date:today,minutes:45,exercises:'Routine two',status:'planned',resolvedAt:null},{id:'r-3',title:'תנועתיות',date:today,minutes:20,exercises:'Routine three',status:'completed',resolvedAt:new Date().toISOString()}];
  await page.evaluate(workouts=>{localStorage.setItem('gymmi-onboarding-v1','done');localStorage.setItem('gymmi-workouts-v1',JSON.stringify({version:1,workouts}));},rows);await page.reload();
  assert.equal(await page.locator('#progress-percent').innerText(),'33%');
  await page.locator('#workout-list article[data-id="r-1"]').getByRole('button',{name:'סמן הושלם',exact:true}).click();
  assert.equal(await page.locator('#progress-percent').innerText(),'67%');
  const card=page.locator('#workout-list article[data-id="r-1"]');await ui.menu(card);await card.getByRole('button',{name:'בטל סימון',exact:true}).click();
  assert.equal(await page.locator('#progress-percent').innerText(),'33%');
  checks.push('progress ring is calculated from the journal and follows completion and undo through the secondary menu');

  await ui.account(page);await page.locator('#auth-email').fill('example@example.com');await page.keyboard.press('Escape');
  assert.equal(await page.locator('#account-dialog').isVisible(),false);await ui.account(page);assert.equal(await page.locator('#auth-email').inputValue(),'example@example.com');await ui.closeAccount(page);
  assert.equal((await page.evaluate(()=>JSON.parse(localStorage.getItem('gymmi-workouts-v1')))).workouts.length,3);
  checks.push('account dialog opens explicitly, closes with Escape and does not change the workout journal');

  const out=process.env.GYMMI_QA_DIR||await fs.mkdtemp(path.join(os.tmpdir(),'gymmi-redesign-'));await fs.mkdir(out,{recursive:true});
  await page.screenshot({path:path.join(out,'desktop.png'),animations:'disabled'});
  for(const width of [320,360,390,768,1365]){
   await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'dashboard overflow '+width);
   await ui.editor(page);const rect=await page.locator('#workout-dialog').boundingBox();assert.ok(rect.width<=width-20);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'editor overflow '+width);
   if(width===390)await page.screenshot({path:path.join(out,'mobile-editor.png'),animations:'disabled'});
   await ui.closeEditor(page);await page.getByRole('button',{name:'יומן חודשי',exact:true}).click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'calendar overflow '+width);
   await page.getByRole('button',{name:'התוכנית השבועית',exact:true}).click();
   if(width===390)await page.screenshot({path:path.join(out,'mobile.png'),animations:'disabled'});
  }
  assert.deepEqual(errors,[]);checks.push('dashboard, dialog and calendar fit five screen widths with no runtime errors');
  console.log(JSON.stringify({passed:checks.length,checks,url,viewports:[320,360,390,768,1365],screenshots:out,real_model_calls:0},null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
