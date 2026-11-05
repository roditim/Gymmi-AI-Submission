// UI checks use sample guest data. Google opening is intercepted: no real account or event is changed.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {chromium}=require('playwright');
(async()=>{
  const url=process.argv[2]||'http://127.0.0.1:8530/';
  const browser=await chromium.launch({headless:true,...(process.env.GYMMI_BROWSER_PATH?{executablePath:process.env.GYMMI_BROWSER_PATH}:{})});
  const checks=[];
  try {
    const page=await browser.newPage({timezoneId:'Asia/Jerusalem',acceptDownloads:true}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
    await page.goto(url); const today=await page.locator('#workout-date').inputValue(), month=today.slice(0,7);
    const fixture=[{id:'sample-plan',date:today,title:'אימון כוח',minutes:30,exercises:'PRIVATE EXERCISE',status:'planned',resolvedAt:null},
      {id:'sample-done',date:today,title:'הליכה שהושלמה',minutes:30,exercises:'PRIVATE EXERCISE',status:'completed',resolvedAt:new Date().toISOString()},
      {id:'sample-skip',date:today,title:'תנועתיות בדילוג',minutes:30,exercises:'PRIVATE EXERCISE',status:'skipped',resolvedAt:new Date().toISOString()}];
    await page.evaluate(rows=>localStorage.setItem('gymmi-workouts-v1',JSON.stringify({version:1,workouts:rows})),fixture);
    await page.reload(); await page.getByRole('button',{name:'יומן חודשי',exact:true}).click();
    assert.equal(await page.locator('#calendar-days button').count(),42);
    assert.equal(await page.locator('#calendar-days [aria-current=date]').getAttribute('data-date'),today);
    assert.equal(await page.locator('#calendar-day-list article').count(),3);
    assert.match(await page.locator('#calendar-summary').innerText(),/3 אימונים בחודש · 1 הושלמו · 1 מתוכננים/);
    checks.push('monthly grid, selected today and planned/completed/skipped workouts share the real journal');

    await page.locator('#calendar-month').fill('2028-02');await page.locator('#calendar-month').dispatchEvent('change');
    await page.locator('[data-date="2028-02-29"]').click();
    await page.locator('#calendar-add').click(); assert.equal(await page.locator('#workout-date').inputValue(),'2028-02-29');
    await page.locator('#workout-title').fill('Leap day workout');await page.locator('#workout-exercises').fill('Private chosen routine');
    await page.locator('#save-workout').click();
    await page.getByRole('button',{name:'יומן חודשי',exact:true}).click();
    assert.equal(await page.locator('#calendar-day-list h3').innerText(),'Leap day workout');
    await page.locator('#calendar-next').click();assert.equal(await page.locator('#calendar-month').inputValue(),'2028-03');
    await page.locator('#calendar-previous').click();assert.equal(await page.locator('#calendar-month').inputValue(),'2028-02');
    checks.push('leap day selection pre-fills editor; save appears on calendar; month navigation works');

    await page.locator('#calendar-today').click();
    let card=page.locator('#calendar-day-list article').filter({hasText:'אימון כוח'});
    await card.getByRole('button',{name:'ערוך',exact:true}).click();
    assert.equal(await page.locator('#view-plan').isVisible(),true);
    await page.locator('#workout-title').fill('Edited calendar workout');await page.locator('#save-workout').click();
    await page.getByRole('button',{name:'יומן חודשי',exact:true}).click();
    card=page.locator('#calendar-day-list article').filter({hasText:'Edited calendar workout'});
    await card.getByRole('button',{name:'סמן הושלם',exact:true}).click();
    assert.match(await page.locator('#calendar-summary').innerText(),/2 הושלמו/);
    await page.reload();await page.getByRole('button',{name:'יומן חודשי',exact:true}).click();
    card=page.locator('#calendar-day-list article').filter({hasText:'Edited calendar workout'});
    assert.ok((await card.getAttribute('class')).includes('completed'));
    await card.getByRole('button',{name:'בטל סימון',exact:true}).click();
    checks.push('calendar edit returns to editor; completion refreshes calendar and survives reload');

    const view=page.locator('#view-calendar');await view.locator('summary').click();
    const downloadPromise=page.waitForEvent('download');await page.locator('#calendar-export').click();
    const download=await downloadPromise, contents=await fs.readFile(await download.path(),'utf8');
    assert.equal(download.suggestedFilename(),'gymmi-'+month+'.ics');
    assert.equal(contents.split('BEGIN:VEVENT').length-1,1);
    assert.ok(contents.includes('Edited calendar workout'));assert.ok(!contents.includes('PRIVATE EXERCISE'));assert.ok(!contents.includes('Leap day workout'));
    checks.push('actual ICS download contains only current-month planned workouts and excludes exercise details');

    await page.evaluate(()=>{window.calendarDraftUrls=[];window.open=url=>{window.calendarDraftUrls.push(url);return null;};});
    card=page.locator('#calendar-day-list article').filter({hasText:'Edited calendar workout'});
    await card.getByRole('button',{name:'הוסף ל־Google Calendar',exact:true}).click();
    const draft=new URL(await page.evaluate(()=>window.calendarDraftUrls[0]));
    assert.equal(draft.origin,'https://calendar.google.com');assert.equal(draft.searchParams.get('text'),'Edited calendar workout');
    assert.ok(!draft.href.includes('PRIVATE'));assert.ok(draft.searchParams.get('dates').startsWith(today.replace(/-/g,'')+'/'));
    assert.match(await page.locator('#message').innerText(),/לא מאשרת שהאירוע נשמר/);
    checks.push('Google draft request is correctly encoded and labelled manual; opening mocked, no Google event created');

    await page.locator('#calendar-month').fill('2028-02');await page.locator('#calendar-month').dispatchEvent('change');
    await page.locator('[data-date="2028-02-29"]').click();
    card=page.locator('#calendar-day-list article');assert.equal(await card.getByRole('button',{name:'סמן הושלם',exact:true}).isDisabled(),true);
    await card.getByRole('button',{name:'מחק',exact:true}).click();assert.equal(await page.locator('#calendar-day-list article').count(),0);
    assert.equal(await page.locator('#calendar-export').isDisabled(),true);
    checks.push('future completion stays blocked; deletion clears the calendar and empty month export is disabled');

    await page.locator('#calendar-today').click();
    const output=process.env.GYMMI_QA_DIR||await fs.mkdtemp(path.join(os.tmpdir(),'gymmi-calendar-'));await fs.mkdir(output,{recursive:true});
    await page.setViewportSize({width:1365,height:1100});await page.locator('#view-calendar').screenshot({path:path.join(output,'calendar-desktop.png')});
    await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.locator('#view-calendar').screenshot({path:path.join(output,'calendar-mobile.png')});
    await page.getByRole('button',{name:'התוכנית השבועית',exact:true}).click();assert.equal(await page.locator('#calendar-day-list article').count(),0);
    assert.deepEqual(errors,[]);checks.push('desktop/mobile calendar fit with no runtime errors; hidden calendar does not duplicate workout cards');
    console.log(JSON.stringify({passed:checks.length,checks,url,google_account_connected:false,google_event_created:false,google_open_mocked:true,screenshots:output},null,2));
  } finally {await browser.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
