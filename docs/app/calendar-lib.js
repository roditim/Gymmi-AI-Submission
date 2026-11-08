"use strict";
// Pure date/export helpers. The journal remains the only source of workouts.
const GymmiCalendar = (() => {
  const timeZone = 'Asia/Jerusalem';
  const offsetClock = new Intl.DateTimeFormat('en-US',{timeZone,timeZoneName:'longOffset'});
  function date(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw Error('תאריך לא תקין');
    const result = new Date(value + 'T12:00:00Z');
    if (!Number.isFinite(+result) || result.toISOString().slice(0,10) !== value) throw Error('תאריך לא תקין');
    return result;
  }
  function shift(value, days) { return new Date(+date(value) + days*86400000).toISOString().slice(0,10); }
  const minutes = time => Number(time.slice(0,2))*60 + Number(time.slice(3));
  function timeRange(row) {
    if (row.startTime == null) return null;
    if (typeof row.startTime !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(row.startTime)
      || !Number.isInteger(row.minutes) || row.minutes < 5 || row.minutes > 180) throw Error('שעת התחלה לא תקינה');
    const endMinute = minutes(row.startTime) + row.minutes;
    if (endMinute > 1440) throw Error('האימון צריך להסתיים עד חצות');
    const end = String(Math.floor(endMinute / 60) % 24).padStart(2,'0') + ':' + String(endMinute % 60).padStart(2,'0');
    return { start:row.startTime, end, endDate:endMinute===1440 ? shift(row.date,1) : row.date, endMinute };
  }
  function fitsBusy(row, busy) {
    const range=timeRange(row);
    return Boolean(range && Array.isArray(busy) && busy.every(block =>
      range.endMinute <= minutes(block.start) || minutes(range.start) >= minutes(block.end)));
  }
  function utcStamp(day, time) {
    const wall=Date.parse(day+'T'+time+':00Z');
    let epoch=wall;
    for (let i=0;i<3;i++) {
      const offset=offsetClock.formatToParts(epoch).find(part=>part.type==='timeZoneName').value;
      const [,sign,hours,mins]=offset.match(/GMT([+-])(\d\d):(\d\d)/);
      epoch=wall-(sign==='+'?1:-1)*(Number(hours)*60+Number(mins))*60000;
    }
    return new Date(epoch).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
  }
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
    return rows.filter(row => row.status === 'planned' && row.date.slice(0,7) === month).sort(scheduleOrder);
  }
  function scheduleOrder(a,b) {
    return a.date.localeCompare(b.date) || (a.startTime || '24:00').localeCompare(b.startTime || '24:00');
  }
  function googleUrl(row) {
    const range=timeRange(row);
    const start=range ? utcStamp(row.date,range.start) : date(row.date).toISOString().slice(0,10).replace(/-/g,'');
    const end=range ? utcStamp(range.endDate,range.end) : shift(row.date,1).replace(/-/g,'');
    const query=new URLSearchParams({action:'TEMPLATE',text:row.title,dates:start+'/'+end,
      details:'Gymmi | '+row.minutes+' דקות מתוכננות. העתק ידני; שינויים אינם מסתנכרנים.'});
    if (range) query.set('ctz',timeZone);
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
      const range=timeRange(row);
      lines.push('BEGIN:VEVENT','UID:'+encodeURIComponent(scope+':'+row.id)+'@gymmi.local','DTSTAMP:'+stamp,
        range ? 'DTSTART:'+utcStamp(row.date,range.start) : 'DTSTART;VALUE=DATE:'+row.date.replace(/-/g,''),
        range ? 'DTEND:'+utcStamp(range.endDate,range.end) : 'DTEND;VALUE=DATE:'+shift(row.date,1).replace(/-/g,''),
        'SUMMARY:'+text(row.title),'DESCRIPTION:'+text(row.minutes+' דקות מתוכננות | Gymmi | העתק ידני ללא סנכרון'),
        'TRANSP:TRANSPARENT','END:VEVENT');
    }
    return [...lines,'END:VCALENDAR'].map(fold).join('\r\n')+'\r\n';
  }
  return {monthDays,nextMonth,planned,googleUrl,ics,timeRange,fitsBusy,scheduleOrder};
})();
if (typeof module !== 'undefined') module.exports=GymmiCalendar;
