"use strict";
// UI preferences only: this key never contains workouts or account details.
const ONBOARDING_KEY = 'gymmi-onboarding-v1';
let onboardingStep=0;
const onboardingSteps=[
  {title:'מתחילים באימון אחד',text:'לחצו על ״אימון חדש״, בחרו שם, יום ומשך, ושמרו. אפשר להתחיל כאורחים ולשמור בדפדפן, או להיכנס לחשבון כדי לשמור בענן.',action:'פתח טופס אימון',run:openWorkoutEditor},
  {title:'מוצאים זמן עם AI',text:'בחשבון מחובר, ספרו לעוזר ה־AI מתי אתם פנויים. בדקו את השעה שהוא מציע. האימון יופיע ביומן רק אחרי שתאשרו את השיבוץ.',action:'פתח את עוזר ה־AI',run:openAIPlanner},
  {title:'כל אימון שהושלם שווה EXP',text:'סמנו ״הושלם״ אחרי אימון וקבלו 100 EXP. כל 500 EXP עולים רמה. בחשבון מחובר אפשר גם לבחור להצטרף לדירוג השבועי.',action:'לתוכנית שלי',run:()=>{showView('plan');focusCurrentView();}},
  {title:'מוצאים מאמן שמתאים לכם',text:'ענו על שאלון קצר על המטרות שלכם, השוו תחומי התמחות ודירוגים, ופתחו הודעת מייל למאמן שבחרתם.',action:'לאזור המאמנים',run:()=>location.assign('coaches/')}
];
function focusCurrentView() {
  const view=document.querySelector('[data-view][aria-pressed=true]')?.dataset.view;
  const target=byId('view-'+view)?.querySelector('h2');
  if(target){target.tabIndex=-1;target.focus({preventScroll:true});target.scrollIntoView({block:'start'});}
}
function presentWorkoutEditor() {
  byId('editor-feedback').hidden=true;
  byId('workout-editor').open=true;
  if(!byId('workout-dialog').open)byId('workout-dialog').showModal();
  byId('workout-title').focus();
}
function openWorkoutEditor(chosenDate) {
  if(busy||storageProblem) return;
  showView('plan');byId('workout-editor').open=true;
  // Preserve an existing draft rather than silently replacing it.
  if(!byId('editing-id').value&&!byId('workout-title').value.trim()&&!byId('workout-exercises').value.trim()){
    const start=byId('week-start').value,end=shiftDate(start,7);
    byId('workout-date').value=typeof chosenDate==='string'?chosenDate:today()>=start&&today()<end?today():start;
  }
  presentWorkoutEditor();
}
function openAccount() {
  byId('account-panel').open=true;
  byId('account-feedback').hidden=true;
  if(!byId('account-dialog').open)byId('account-dialog').showModal();
  const target=activeUser?byId('reload-cloud'):byId('auth-email');
  target.focus();
}
function openAIPlanner() {
  if(busy||storageProblem) return;
  const dialog=byId('ai-dialog');
  byId('ai-feedback').hidden=true;
  if(!dialog.open)dialog.showModal();
  updateAvailabilityViews();
  const target=activeUser?byId('ai-preferences'):byId('ai-sign-in');
  target.focus({preventScroll:true});
}
function drawOnboarding() {
  const step=onboardingSteps[onboardingStep];
  const scenes=document.querySelectorAll('[data-tour-scene]');
  scenes.forEach((scene,index)=>{scene.hidden=index!==onboardingStep;});
  drawOnboardingPractice(false);
  byId('onboarding-count').textContent='שלב '+(onboardingStep+1)+' מתוך '+onboardingSteps.length;
  byId('onboarding-progress').max=onboardingSteps.length;
  byId('onboarding-progress').value=onboardingStep+1;
  byId('onboarding-title').textContent=step.title;
  byId('onboarding-text').textContent=step.text;
  byId('onboarding-action').textContent=step.action;
  byId('onboarding-back').hidden=onboardingStep===0;
  byId('onboarding-next').textContent=onboardingStep===onboardingSteps.length-1?'סיום ההדרכה ✓':'הבא ←';
  const dialog=byId('onboarding');
  dialog.scrollTop=0;
  byId('onboarding-title').focus({preventScroll:true});
}
function drawOnboardingPractice(completed) {
  const button=byId('onboarding-practice');
  button.setAttribute('aria-pressed',String(completed));
  button.textContent=completed?'הושלם!':'נסה לסמן הושלם';
  button.closest('[data-tour-scene]').classList.toggle('is-complete',completed);
  byId('onboarding-result').textContent=completed?'יפה! צברת 100 EXP בדוגמה.':'אפשר להתנסות כאן בלי לשנות את התוכנית שלך.';
}
function setupOnboarding() {
  const dialog=byId('onboarding');
  let destination;
  function open() {
    if(dialog.open)return;
    onboardingStep=0;
    drawOnboarding();
    dialog.showModal();
    byId('onboarding-action').disabled=busy||storageProblem;
  }
  byId('help-open').addEventListener('click',open);
  byId('onboarding-skip').addEventListener('click',()=>dialog.close());
  byId('onboarding-action').addEventListener('click',()=>{
    destination=onboardingSteps[onboardingStep].run;
    dialog.close();
  });
  dialog.addEventListener('close',()=>{
    try{localStorage.setItem(ONBOARDING_KEY,'done');}
    catch{ /* Dismissal still works when preference storage is unavailable. */ }
    const openFeature=destination;
    destination=null;
    if(openFeature)openFeature();
    else byId('help-open').focus({preventScroll:true});
  });
  byId('onboarding-back').addEventListener('click',()=>{onboardingStep--;drawOnboarding();});
  byId('onboarding-next').addEventListener('click',()=>{
    if(onboardingStep===onboardingSteps.length-1){dialog.close();return;}
    onboardingStep++;
    drawOnboarding();
  });
  byId('onboarding-practice').addEventListener('click',event=>{
    drawOnboardingPractice(event.currentTarget.getAttribute('aria-pressed')!=='true');
  });
  const oauthState=new URLSearchParams(location.search).get('state');
  let seen=true;
  try{seen=localStorage.getItem(ONBOARDING_KEY)==='done';}
  catch{ /* Help can still open the tour manually. */ }
  if(!seen&&!location.hash&&!oauthState?.startsWith('gymmi_'))open();
}
function refreshUX() {
  byId('new-workout').disabled=busy||storageProblem;
  byId('open-ai').disabled=busy||storageProblem;
  byId('ai-sign-in').hidden=!!activeUser;
  byId('account-open').textContent=activeUser?'החשבון שלי':'כניסה / הרשמה';
  byId('saving-mode').textContent=activeUser
    ?(storageProblem?'חשבון מחובר · ממתינים לטעינת היומן':'חשבון מחובר · שמירה בענן')
    :(storageProblem?'לא ניתן לקרוא את היומן המקומי':'מצב אורח · שמירה בדפדפן הזה');
  const start=byId('week-start').value,end=shiftDate(start,7);
  const format=day=>new Intl.DateTimeFormat('he-IL',{day:'numeric',month:'short'}).format(parseDate(day));
  byId('week-range').textContent=format(start)+' – '+format(shiftDate(start,6))+' · השבוע מתחיל ביום שני';
  byId('ai-week-label').textContent='השבוע שנבחר · '+format(start)+' – '+format(shiftDate(start,6));
  const rows=state.workouts.filter(w=>w.date>=start&&w.date<end);
  const next=rows.filter(w=>w.status==='planned'&&w.date>=today()).sort((a,b)=>a.date.localeCompare(b.date))[0];
  byId('focus-title').textContent=next?next.title:rows.length?'בונים את הצעד הבא.':'אימון אחד.\nצעד חדש.';
  byId('focus-meta').textContent=next?format(next.date)+' · '+next.minutes+' דקות · מתוכנן':'תוכנית קטנה שמתאימה לחיים שלך. מתחילים מכאן.';
  byId('focus-workout').hidden=!next;
  byId('focus-workout').disabled=busy;
  byId('progress-percent').textContent=Math.round(rows.length?rows.filter(w=>w.status==='completed').length/rows.length*100:0)+'%';
  byId('progress-ring').style.setProperty('--progress',rows.length?rows.filter(w=>w.status==='completed').length/rows.length:0);
  byId('saving-mode').dataset.state=storageProblem?'error':activeUser?'cloud':'guest';
  const strip=byId('week-strip');strip.replaceChildren();
  for(let i=0;i<7;i++){
    const day=shiftDate(start,i),items=rows.filter(w=>w.date===day),dayButton=action('',()=>{
      const card=[...byId('workout-list').children].find(el=>el.dataset.date===day);
      if(card){card.focus();card.scrollIntoView({block:'center'});}else openWorkoutEditor(day);
    },storageProblem,'week-day');
    dayButton.dataset.date=day;
    dayButton.append(element('span',new Intl.DateTimeFormat('he-IL',{weekday:'short'}).format(parseDate(day))),element('strong',String(Number(day.slice(-2)))));
    const count=element('span',items.length?'●':'·','week-dot');dayButton.append(count);
    dayButton.setAttribute('aria-label',format(day)+' · '+items.length+' אימונים');
    if(day===today())dayButton.setAttribute('aria-current','date');
    if(items.some(w=>w.status==='completed'))dayButton.classList.add('has-completed');
    strip.append(dayButton);
  }
  byId('next-action').textContent=storageProblem?'יש לטפל בטעינת היומן לפני שמוסיפים או עורכים אימונים.'
    :!rows.length?'מתחילים בקטן: הוסף אימון אחד, או בחר תוכנית לדוגמה.'
    :next?'הבא בתוכנית: '+next.title+' · '+format(next.date)+' · '+next.minutes+' דקות'
    :rows.every(w=>w.status==='completed')?'כל אימוני השבוע הושלמו. אפשר לתכנן את השבוע הבא.'
    :'אפשר לעדכן את האימונים שטרם סומנו או לתכנן את השבוע הבא.';
  if(byId('onboarding').open)byId('onboarding-action').disabled=busy||storageProblem;
}
function setupUX() {
  const mobile=matchMedia('(max-width: 740px)').matches;
  byId('account-panel').open=!mobile;
  byId('today-label').textContent=new Intl.DateTimeFormat('he-IL',{weekday:'long',day:'numeric',month:'long'}).format(new Date());
  refreshUX();
  setupOnboarding();
  byId('new-workout').addEventListener('click',openWorkoutEditor);
  byId('open-ai').addEventListener('click',openAIPlanner);
  byId('close-ai').addEventListener('click',()=>byId('ai-dialog').close());
  byId('ai-dialog').addEventListener('close',()=>{
    if(!byId('view-plan').hidden) byId('open-ai').focus({preventScroll:true});
  });
  byId('account-open').addEventListener('click',openAccount);
  byId('close-editor').addEventListener('click',()=>byId('workout-dialog').close());
  byId('close-account').addEventListener('click',()=>byId('account-dialog').close());
  byId('focus-workout').addEventListener('click',()=>{
    showView('plan');
    const row=state.workouts.filter(w=>w.status==='planned'&&w.date>=today()&&w.date>=byId('week-start').value&&w.date<shiftDate(byId('week-start').value,7)).sort((a,b)=>a.date.localeCompare(b.date))[0];
    const card=[...byId('workout-list').children].find(el=>el.dataset.id===row?.id);
    if(card){card.querySelector('.routine-details').open=true;card.focus();card.scrollIntoView({block:'center'});}
  });
  byId('ai-sign-in').addEventListener('click',openAccount);
  const labels={plan:'התוכנית',calendar:'יומן',history:'היסטוריה',backup:'נתונים'};
  const icons={plan:'M4 5h16v15H4z M8 2v6 M16 2v6 M4 10h16',calendar:'M4 5h16v15H4z M8 2v6 M16 2v6 M8 13h2 M14 13h2 M8 17h2',history:'M4 4v6h6 M4 10a8 8 0 1 1 0 5 M12 7v5l3 2',backup:'M5 3h12l3 3v15H4V3z M8 3v6h8V3 M8 21v-7h8v7'};
  for(const tab of document.querySelectorAll('[data-view]')){
    tab.setAttribute('aria-controls','view-'+tab.dataset.view);tab.setAttribute('aria-label',tab.textContent);
    tab.textContent=labels[tab.dataset.view];
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.7');svg.setAttribute('aria-hidden','true');
    const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',icons[tab.dataset.view]);svg.append(path);tab.prepend(svg);
  }
}
