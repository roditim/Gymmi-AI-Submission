const assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {chromium}=require('playwright');
const ui=require('./ui_helpers.cjs');
(async()=>{
 const url=process.argv[2]||'http://127.0.0.1:8530/';
 const browser=await chromium.launch({headless:true,...(process.env.GYMMI_BROWSER_PATH?{executablePath:process.env.GYMMI_BROWSER_PATH}:{})});
 const checks=[],errors=[];try{
  const page=await browser.newPage({viewport:{width:390,height:844},timezoneId:'Asia/Jerusalem'});page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);await page.locator('#onboarding[open]').waitFor();
  assert.equal(await page.locator('#onboarding-title').evaluate(el=>el===document.activeElement),true);
  assert.equal(await page.locator('#account-panel').getAttribute('open'),null);assert.equal(await page.locator('#ai-dialog').getAttribute('open'),null);
  const primary=await page.locator('#new-workout').boundingBox();assert.ok(primary.y+primary.height<600);assert.ok(primary.height>=44);
  assert.equal(await page.locator('.app-nav').evaluate(el=>getComputedStyle(el).position),'fixed');
  checks.push('mobile begins with a visible primary action; account and AI are collapsed; bottom navigation stays available');

  const nextStep=page.locator('#onboarding-next');
  await nextStep.click();assert.match(await page.locator('#onboarding-count').innerText(),/2 מתוך 4/);
  assert.match(await page.locator('#onboarding').getByText('18:30–19:00').innerText(),/18:30–19:00/);
  await page.locator('#onboarding-back').click();assert.match(await page.locator('#onboarding-count').innerText(),/1 מתוך 4/);
  await nextStep.click();await nextStep.click();
  await page.locator('#onboarding-practice').click();
  assert.equal(await page.locator('#onboarding-practice').getAttribute('aria-pressed'),'true');
  assert.match(await page.locator('#onboarding-result').innerText(),/100 EXP/);
  assert.match(await page.locator('#exp-total').textContent(),/^0 EXP$/);
  await nextStep.click();assert.match(await page.locator('#onboarding-title').innerText(),/מאמן/);
  await nextStep.click();
  await page.waitForFunction(()=>localStorage.getItem('gymmi-onboarding-v1')==='done');
  assert.equal(await page.evaluate(()=>localStorage.getItem('gymmi-workouts-v1')),null);
  await page.reload();assert.equal(await page.locator('#onboarding').isVisible(),false);
  await page.locator('#help-open').click();assert.equal(await page.locator('#onboarding').isVisible(),true);
  await page.locator('#onboarding-action').click();await page.locator('#workout-dialog[open]').waitFor();
  await ui.closeEditor(page);
  await page.locator('#help-open').click();await nextStep.click();
  await page.locator('#onboarding-action').click();await page.locator('#ai-dialog[open]').waitFor();
  await page.locator('#close-ai').click();
  checks.push('four-step onboarding, practice EXP, persistence, replay and feature shortcuts leave the real journal untouched');

  const today=await page.locator('#workout-date').inputValue();
  await page.locator('#next-week').click();const week=await page.locator('#week-start').inputValue();
  await page.locator('#new-workout').click();assert.equal(await page.locator('#workout-date').inputValue(),week);
  await page.locator('#workout-title').fill('הליכה בפארק');await page.locator('#workout-exercises').fill('המסלול מהתוכנית שלי');
  await ui.closeEditor(page);await page.locator('#new-workout').click();assert.equal(await page.locator('#workout-title').inputValue(),'הליכה בפארק');
  await page.locator('#workout-date').fill(today);await page.locator('#save-workout').click();
  await page.reload();assert.equal((await page.evaluate(()=>JSON.parse(localStorage.getItem('gymmi-workouts-v1')))).workouts.length,1);
  assert.match(await page.locator('#next-action').innerText(),/הליכה בפארק/);
  checks.push('new-workout shortcut respects the selected week, preserves a draft and saves the first guest workout');

  const ai = page.locator('#open-ai');
  await ai.scrollIntoViewIfNeeded();
  const beforeAI = await page.evaluate(() => scrollY);
  await ai.click();await page.locator('#ai-dialog[open]').waitFor();
  assert.equal(await page.evaluate(() => scrollY),beforeAI);
  await page.locator('#ai-preferences').fill('פנוי ביום שני');
  await page.keyboard.press('Escape');await page.locator('#ai-dialog').waitFor({state:'hidden'});
  assert.equal(await ai.evaluate(el=>el===document.activeElement),true);
  await ai.click();
  assert.equal(await page.locator('#ai-preferences').inputValue(),'פנוי ביום שני');
  assert.equal(await page.locator('#ai-generate').isDisabled(),true);await page.locator('#ai-sign-in').click();
  assert.notEqual(await page.locator('#account-panel').getAttribute('open'),null);assert.equal(await page.locator('#auth-email').evaluate(el=>el===document.activeElement),true);
  assert.equal((await page.evaluate(()=>JSON.parse(localStorage.getItem('gymmi-workouts-v1')))).workouts.length,1);
  checks.push('AI opens without moving the page, preserves input, restores focus, and opens account sign-in without changing the guest journal');
  await ui.closeAccount(page);
  await page.locator('#close-ai').click();

  await page.getByRole('button',{name:'יומן חודשי',exact:true}).click();assert.equal(await page.locator('#view-calendar').isVisible(),true);
  assert.equal(await page.locator('#week-picker').isVisible(),false);
  assert.equal(await page.locator('#calendar-heading').evaluate(el=>el===document.activeElement),true);
  await page.locator('#calendar-day-list article').getByRole('button',{name:'סמן הושלם',exact:true}).click();
  assert.equal(await page.locator('#completed-count').innerText(),'1');
  await page.locator('#exp-celebration').waitFor();
  assert.equal(await page.locator('#exp-gain').innerText(),'+100 EXP');
  assert.equal(await page.locator('#exp-home-progress').getAttribute('aria-valuenow'),'100');
  assert.ok(await page.locator('#exp-confetti i').count());
  await page.locator('#exp-celebration-close').click();
  await page.getByRole('button',{name:'התוכנית השבועית',exact:true}).click();assert.equal(await page.locator('#week-picker').isVisible(),true);
  assert.ok((await page.locator('#workout-list article').getAttribute('class')).includes('completed'));
  checks.push('mobile navigation moves focus to the selected view; calendar completion updates the same weekly journal');

  const dir=process.env.GYMMI_QA_DIR||await fs.mkdtemp(path.join(os.tmpdir(),'gymmi-ux-'));await fs.mkdir(dir,{recursive:true});
  for(const width of [320,360,390,768,1365]){
   const p=await browser.newPage({viewport:{width,height:900},timezoneId:'Asia/Jerusalem'});p.on('pageerror',e=>errors.push(e.message));
   await p.goto(url);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'overflow at '+width);
   await p.screenshot({path:path.join(dir,'first-visit-'+width+'.png'),animations:'disabled'});
   for(let step=1;step<=4;step++){
    const tour=p.locator('#onboarding');
    assert.equal(await tour.evaluate(el=>el.scrollWidth>el.clientWidth),false,'tour overflow at '+width+' step '+step);
    if(width===390&&step>1)await p.screenshot({path:path.join(dir,'tour-step-'+step+'.png'),animations:'disabled'});
    if(step<4)await p.locator('#onboarding-next').click();
   }
   await p.locator('#onboarding-skip').click();
   if(width===768){await ui.editor(p);assert.ok((await p.locator('#workout-date').boundingBox()).width>=110);await ui.closeEditor(p);assert.equal(await p.locator('.app-nav').evaluate(el=>getComputedStyle(el).position),'static');}
   await p.getByRole('button',{name:'יומן חודשי',exact:true}).click();assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'calendar overflow at '+width);
   await p.locator('#view-calendar').screenshot({path:path.join(dir,'calendar-'+width+'.png')});await p.close();
  }
  checks.push('first visit and calendar fit 320, 360, 390, 768 and 1365px screens without horizontal overflow');

  const keyboardPage=await browser.newPage({reducedMotion:'reduce'});await keyboardPage.goto(url);await keyboardPage.keyboard.press('Tab');
  assert.equal(await keyboardPage.evaluate(()=>!!document.activeElement.closest('#onboarding')),true);
  assert.equal(await keyboardPage.locator('#onboarding .tour-pop:visible').evaluate(el=>getComputedStyle(el).animationName),'none');
  await keyboardPage.keyboard.press('Escape');
  await keyboardPage.waitForFunction(()=>document.activeElement.id==='help-open');
  await keyboardPage.close();
  const accountLink=await browser.newPage();
  await accountLink.goto(url+'#account');await accountLink.locator('#account-dialog[open]').waitFor();
  assert.equal(await accountLink.locator('#onboarding').isVisible(),false);
  await accountLink.close();checks.push('keyboard dismissal returns focus, reduced motion disables animation, and account links open directly');

  const limited=await browser.newPage({viewport:{width:390,height:844}});
  await limited.addInitScript(()=>{const set=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='gymmi-onboarding-v1')throw Error('Preference storage blocked');return set.call(this,key,value);};});
  await limited.goto(url);await limited.locator('#onboarding-skip').click();assert.equal(await limited.locator('#onboarding').isVisible(),false);
  await limited.locator('#new-workout').click();assert.equal(await limited.locator('#workout-title').isVisible(),true);await limited.close();
  assert.deepEqual(errors,[]);checks.push('blocked onboarding preference storage still allows dismissal and planner access; no runtime errors');
  console.log(JSON.stringify({passed:checks.length,checks,url,viewports:[320,360,390,768,1365],screenshots:dir,real_model_calls:0},null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
