"use strict";
// UI preferences only: this key never contains workouts or account details.
const ONBOARDING_KEY = 'gymmi-onboarding-v1';
let onboardingStep=0;
const onboardingSteps=[
  {title:'מתחילים באימון אחד',text:'הוסף שם, תאריך ופרטים מתוך התוכנית שלך. אפשר להתחיל בלי הרשמה; האימון יישמר בדפדפן הזה.',action:'הוסף אימון ראשון',run:()=>openWorkoutEditor()},
  {title:'מוצאים מקום בשבוע',text:'אחרי שהוספת אימונים, אפשר לראות אותם ביומן החודשי. בחשבון מחובר אפשר גם לבקש מה־AI שיבוץ לפי הזמינות שלך, לבדוק ולאשר.',action:'לראות את היומן',run:()=>{showView('calendar');focusCurrentView();}},
  {title:'כל השלמה היא התקדמות',text:'אחרי אימון של היום או של יום קודם, סמן ״הושלם״. ההתקדמות מתעדכנת, ואפשר תמיד לבטל סימון. חשבון מאפשר לשמור בענן ולהמשיך ממכשיר אחר.',action:'לתוכנית שלי',run:()=>{closeOnboarding();showView('plan');focusCurrentView();}}
];
function focusCurrentView() {
  const view=document.querySelector('[data-view][aria-pressed=true]')?.dataset.view;
  const target=byId('view-'+view)?.querySelector('h2');
  if(target){target.tabIndex=-1;target.focus({preventScroll:true});target.scrollIntoView({block:'start'});}
}
function openWorkoutEditor() {
  if(busy||storageProblem) return;
  showView('plan');byId('workout-editor').open=true;
  // Preserve an existing draft rather than silently replacing it.
  if(!byId('editing-id').value&&!byId('workout-title').value.trim()&&!byId('workout-exercises').value.trim()){
    const start=byId('week-start').value,end=shiftDate(start,7);
    byId('workout-date').value=today()>=start&&today()<end?today():start;
  }
  byId('workout-title').focus();
}
function openAccount() {
  byId('account-panel').open=true;
  const target=activeUser?byId('reload-cloud'):byId('auth-email');
  target.focus({preventScroll:true});byId('account-panel').scrollIntoView({block:'start'});
}
function openAIPlanner() {
  if(busy||storageProblem) return;
  showView('plan');byId('ai-panel').open=true;
  const target=activeUser?byId('ai-preferences'):byId('ai-sign-in');
  target.focus({preventScroll:true});byId('ai-panel').scrollIntoView({block:'start'});
}
function drawOnboarding() {
  const step=onboardingSteps[onboardingStep];
  byId('onboarding-count').textContent='היכרות קצרה · '+(onboardingStep+1)+' מתוך 3';
  byId('onboarding-title').textContent=step.title;byId('onboarding-text').textContent=step.text;
  byId('onboarding-action').textContent=step.action;
  byId('onboarding-back').hidden=onboardingStep===0;
  byId('onboarding-next').textContent=onboardingStep===2?'סיום ההדרכה':'הבא';
}
function closeOnboarding() {
  byId('onboarding').hidden=true;
  try{localStorage.setItem(ONBOARDING_KEY,'done');}
  catch{ /* Optional preference: dismissal still works for this visit. */ }
  // The dismissal still works when preference storage is unavailable.
  byId('help-open').focus({preventScroll:true});
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
  const rows=state.workouts.filter(w=>w.date>=start&&w.date<end);
  const next=rows.filter(w=>w.status==='planned'&&w.date>=today()).sort((a,b)=>a.date.localeCompare(b.date))[0];
  byId('next-action').textContent=storageProblem?'יש לטפל בטעינת היומן לפני שמוסיפים או עורכים אימונים.'
    :!rows.length?'מתחילים בקטן: הוסף אימון אחד, או בחר תוכנית לדוגמה.'
    :next?'הבא בתוכנית: '+next.title+' · '+format(next.date)+' · '+next.minutes+' דקות'
    :rows.every(w=>w.status==='completed')?'כל אימוני השבוע הושלמו. אפשר לתכנן את השבוע הבא.'
    :'אפשר לעדכן את האימונים שטרם סומנו או לתכנן את השבוע הבא.';
  if(!byId('onboarding').hidden)byId('onboarding-action').disabled=busy||storageProblem;
}
function setupUX() {
  const mobile=matchMedia('(max-width: 740px)').matches;
  byId('account-panel').open=!mobile;byId('ai-panel').open=!mobile;
  try{byId('onboarding').hidden=localStorage.getItem(ONBOARDING_KEY)==='done';}
  catch{byId('onboarding').hidden=true;}
  drawOnboarding();refreshUX();
  byId('new-workout').addEventListener('click',openWorkoutEditor);
  byId('open-ai').addEventListener('click',openAIPlanner);
  byId('account-open').addEventListener('click',openAccount);
  byId('ai-sign-in').addEventListener('click',openAccount);
  byId('help-open').addEventListener('click',()=>{
    onboardingStep=0;drawOnboarding();byId('onboarding').hidden=false;refreshUX();
    byId('onboarding-title').focus({preventScroll:true});byId('onboarding').scrollIntoView({block:'start'});
  });
  byId('onboarding-skip').addEventListener('click',closeOnboarding);
  byId('onboarding-action').addEventListener('click',()=>onboardingSteps[onboardingStep].run());
  byId('onboarding-back').addEventListener('click',()=>{onboardingStep=Math.max(0,onboardingStep-1);drawOnboarding();byId('onboarding-title').focus({preventScroll:true});});
  byId('onboarding-next').addEventListener('click',()=>{
    if(onboardingStep===2){closeOnboarding();return;}
    onboardingStep++;drawOnboarding();byId('onboarding-title').focus({preventScroll:true});
  });
  for(const tab of document.querySelectorAll('[data-view]'))tab.setAttribute('aria-controls','view-'+tab.dataset.view);
}
