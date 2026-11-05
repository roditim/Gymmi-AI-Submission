"use strict";
// Pure date/export helpers. The journal remains the only source of workouts.
const GymmiCalendar = (() => {
  function date(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw Error('תאריך לא תקין');
    const result = new Date(value + 'T12:00:00Z');
    if (!Number.isFinite(+result) || result.toISOString().slice(0,10) !== value) throw Error('תאריך לא תקין');
    return result;
  }
  function shift(value, days) { return new Date(+date(value) + days*86400000).toISOString().slice(0,10); }
  function monthDays(month) {
    const first = date(month + '-01');
    const start = shift(month + '-01', -first.getUTCDay());
    return Array.from({length:42}, (_,i) => shift(start,i));
  }
  function nextMonth(month, offset) {
    const value = date(month + '-01'); value.setUTCMonth(value.getUTCMonth() + offset);
    const result = value.toISOString().slice(0,7);
    if (!/^\d{4}-\d{2}$/.test(result) || result < '1000-01' || result > '9998-12') throw Error('החודש מחוץ לטווח');
    return result;
  }
  function planned(rows, month) {
    monthDays(month);
    return rows.filter(row => row.status === 'planned' && row.date.slice(0,7) === month).sort((a,b)=>a.date.localeCompare(b.date));
  }
  function googleUrl(row) {
    const start=date(row.date).toISOString().slice(0,10).replace(/-/g,'');
    const end=shift(row.date,1).replace(/-/g,'');
    const query=new URLSearchParams({action:'TEMPLATE',text:row.title,dates:start+'/'+end,
      details:'Gymmi | '+row.minutes+' דקות מתוכננות. העתק ידני; שינויים אינם מסתנכרנים.'});
    return 'https://calendar.google.com/calendar/render?'+query;
  }
  function text(value) {
    return value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,'').replace(/\\/g,'\\\\')
      .replace(/\r\n|\r|\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');
  }
  function fold(line) {
    const parts=[]; let part='', size=0;
    for (const char of line) {
      const bytes=new TextEncoder().encode(char).length;
      if (size+bytes>75) { parts.push(part); part=' '; size=1; }
      part+=char; size+=bytes;
    }
    return [...parts,part].join('\r\n');
  }
  function ics(rows, scope, now=new Date()) {
    const stamp=now.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
    const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Gymmi//Workout Planner//EN','CALSCALE:GREGORIAN'];
    const ids=new Set();
    for (const row of rows) {
      if (!row || typeof row.id!=='string' || !row.id || ids.has(row.id) || typeof row.title!=='string' || !row.title.trim() || !Number.isInteger(row.minutes) || row.minutes<5 || row.minutes>180 || row.status!=='planned') throw Error('אימון לא תקין לייצוא');
      ids.add(row.id); date(row.date);
      lines.push('BEGIN:VEVENT','UID:'+encodeURIComponent(scope+':'+row.id)+'@gymmi.local','DTSTAMP:'+stamp,
        'DTSTART;VALUE=DATE:'+row.date.replace(/-/g,''),'DTEND;VALUE=DATE:'+shift(row.date,1).replace(/-/g,''),
        'SUMMARY:'+text(row.title),'DESCRIPTION:'+text(row.minutes+' דקות מתוכננות | Gymmi | העתק ידני ללא סנכרון'),
        'TRANSP:TRANSPARENT','END:VEVENT');
    }
    return [...lines,'END:VCALENDAR'].map(fold).join('\r\n')+'\r\n';
  }
  return {monthDays,nextMonth,planned,googleUrl,ics};
})();
if (typeof module !== 'undefined') module.exports=GymmiCalendar;
