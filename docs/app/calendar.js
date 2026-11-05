"use strict";
let calendarMonth=new Date().getFullYear()+'-'+String(new Date().getMonth()+1).padStart(2,'0');
let calendarDay=null;

function showView(name) {
  for (const tab of document.querySelectorAll('[data-view]')) {
    const active=tab.dataset.view===name;
    tab.setAttribute('aria-pressed',String(active)); byId('view-'+tab.dataset.view).hidden=!active;
  }
  renderCalendar();
}
function renderCalendar() {
  const list=byId('calendar-day-list'); list.replaceChildren();
  if (byId('view-calendar').hidden) return;
  if (!calendarDay) calendarDay=today();
  byId('calendar-month').value=calendarMonth;
  byId('calendar-heading').textContent=new Intl.DateTimeFormat('he-IL',{month:'long',year:'numeric'}).format(parseDate(calendarMonth+'-01'));
  const rows=state.workouts.filter(w=>w.date.slice(0,7)===calendarMonth);
  const pending=GymmiCalendar.planned(state.workouts,calendarMonth);
  byId('calendar-summary').textContent=rows.length+' אימונים בחודש · '+rows.filter(w=>w.status==='completed').length+' הושלמו · '+pending.length+' מתוכננים';
  byId('calendar-export').disabled=busy||storageProblem||!pending.length;
  byId('calendar-add').disabled=busy||storageProblem;
  byId('calendar-previous').disabled=calendarMonth==='1000-01';
  byId('calendar-next').disabled=calendarMonth==='9998-12';
  const grid=byId('calendar-days'); grid.replaceChildren();
  for (const day of GymmiCalendar.monthDays(calendarMonth)) {
    const workouts=state.workouts.filter(w=>w.date===day);
    const label=new Intl.DateTimeFormat('he-IL',{weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(parseDate(day));
    const button=action('',()=>{ calendarDay=day; calendarMonth=day.slice(0,7); renderCalendar(); },false,'calendar-day');
    button.dataset.date=day; button.setAttribute('aria-label',label+' · '+workouts.length+' אימונים');
    button.setAttribute('aria-pressed',String(day===calendarDay));
    if (day===today()) button.setAttribute('aria-current','date');
    if (day.slice(0,7)!==calendarMonth) button.classList.add('outside-month');
    button.append(element('span',String(Number(day.slice(-2))),'day-number'));
    for (const row of workouts.slice(0,2)) button.append(element('span',row.title,'calendar-event '+row.status));
    if (workouts.length>2) button.append(element('span','ועוד '+(workouts.length-2),'calendar-more'));
    grid.append(button);
  }
  byId('calendar-day-heading').textContent=new Intl.DateTimeFormat('he-IL',{weekday:'long',day:'numeric',month:'long'}).format(parseDate(calendarDay));
  const selected=state.workouts.filter(w=>w.date===calendarDay);
  if (!selected.length) list.append(element('p','אין אימונים ביום הזה. אפשר להוסיף אימון חדש.','empty'));
  for (const row of selected) {
    const card=workoutCard(row);
    if(row.status==='planned') card.append(action('הוסף ל־Google Calendar',()=>{
      if(confirm('לפתוח טיוטת אירוע ב־Google Calendar? שם האימון, התאריך והמשך יועברו ל־Google. פרטי התרגילים לא יועברו. צריך לשמור שם ידנית; אין סנכרון.')) {
        window.open(GymmiCalendar.googleUrl(row),'_blank','noopener,noreferrer');
        notice('נשלחה בקשה לפתיחת טיוטה ב־Google. יש לשמור אותה שם ידנית. Gymmi לא מאשרת שהאירוע נשמר.');
      }
    },busy||storageProblem,'secondary'));
    list.append(card);
  }
}
function setupCalendar() {
  function move(offset) {
    try { calendarMonth=GymmiCalendar.nextMonth(calendarMonth,offset); calendarDay=calendarMonth+'-01'; renderCalendar(); }
    catch(error){ notice(error.message,true); }
  }
  byId('calendar-previous').addEventListener('click',()=>move(-1));
  byId('calendar-next').addEventListener('click',()=>move(1));
  byId('calendar-today').addEventListener('click',()=>{calendarDay=today();calendarMonth=calendarDay.slice(0,7);renderCalendar();});
  byId('calendar-month').addEventListener('change',()=>{
    const value=byId('calendar-month').value;
    try { if(value<'1000-01'||value>'9998-12') throw Error('חודש לא תקין'); GymmiCalendar.monthDays(value);calendarMonth=value;calendarDay=value+'-01';renderCalendar(); }
    catch(error){byId('calendar-month').value=calendarMonth;notice(error.message,true);}
  });
  byId('calendar-add').addEventListener('click',()=>{
    if(busy||storageProblem) return;
    if(byId('workout-title').value.trim()||byId('workout-exercises').value.trim()) {notice('סיים או בטל את טיוטת האימון לפני הוספת אימון מהיומן.',true);return;}
    cancelEdit(); byId('workout-date').value=calendarDay; byId('week-start').value=monday(calendarDay);
    showView('plan'); render(); byId('workout-editor').open=true;byId('workout-title').focus();
  });
  byId('calendar-export').addEventListener('click',()=>{
    if(busy||storageProblem) return;
    try {
      const rows=GymmiCalendar.planned(state.workouts,calendarMonth);
      if(!rows.length) throw Error('אין אימונים מתוכננים בחודש לייצוא');
      const body=GymmiCalendar.ics(rows,activeUser?.id||'guest');
      const url=URL.createObjectURL(new Blob([body],{type:'text/calendar;charset=utf-8'}));
      const link=element('a');link.href=url;link.download='gymmi-'+calendarMonth+'.ics';link.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
      notice('הוכן קובץ יומן עם '+rows.length+' אימונים מתוכננים. הייבוא לקלנדר ידני; שינויים עתידיים לא מסתנכרנים.');
    } catch(error){notice('לא ניתן לייצא יומן: '+error.message,true);}
  });
}
