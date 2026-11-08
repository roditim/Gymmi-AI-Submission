const test=require('node:test'), assert=require('node:assert/strict');
const calendar=require('../docs/app/calendar-lib.js');
const row={id:'test-id',date:'2026-12-31',title:'אימון, כוח; A\\B\nBEGIN:VEVENT',minutes:30,exercises:'PRIVATE ROUTINE',status:'planned'};
test('month grid includes leap day and has Sunday-first 42 consecutive dates',()=>{
  const days=calendar.monthDays('2028-02'); assert.equal(days.length,42);assert.equal(new Date(days[0]+'T12:00Z').getUTCDay(),0);
  assert.ok(days.includes('2028-02-29'));assert.equal(new Set(days).size,42);
  for(let i=1;i<days.length;i++) assert.equal(Date.parse(days[i])-Date.parse(days[i-1]),86400000);
});
test('month navigation crosses years and rejects invalid or empty dates',()=>{
  assert.equal(calendar.nextMonth('2026-12',1),'2027-01');assert.equal(calendar.nextMonth('2027-01',-1),'2026-12');
  for(const value of ['', '2026-13','2026-00'])assert.throws(()=>calendar.monthDays(value));
  assert.throws(()=>calendar.nextMonth('1000-01',-1));
});
test('only planned workouts from selected month are exported',()=>{
  const rows=[row,{...row,id:'2',status:'completed'},{...row,id:'3',status:'skipped'},{...row,id:'4',date:'2027-01-01'}];
  assert.deepEqual(calendar.planned(rows,'2026-12'),[row]);
});
test('Google draft safely encodes text, all-day date and next-year exclusive end; excludes private details',()=>{
  const url=new URL(calendar.googleUrl(row));assert.equal(url.origin,'https://calendar.google.com');
  assert.equal(url.searchParams.get('text'),row.title);assert.equal(url.searchParams.get('dates'),'20261231/20270101');
  assert.ok(!url.href.includes('PRIVATE'));assert.equal(url.searchParams.get('action'),'TEMPLATE');
});
test('ICS escapes event injection, folds Hebrew by UTF-8 bytes and exports no exercise details',()=>{
  const result=calendar.ics([{...row,title:row.title+'א'.repeat(90)}],'guest',new Date('2026-11-05T12:30:00Z'));
  assert.equal(result.split('\r\n').filter(l=>l==='BEGIN:VEVENT').length,1);
  assert.ok(result.includes('DTEND;VALUE=DATE:20270101'));assert.ok(!result.includes('PRIVATE ROUTINE'));
  for(const line of result.split('\r\n'))assert.ok(Buffer.byteLength(line)<=75);
  const unfolded=result.replace(/\r\n /g,'');assert.ok(unfolded.includes('א'.repeat(90)));assert.ok(unfolded.includes('\\nBEGIN:VEVENT'));
  assert.ok(unfolded.includes('אימון\\, כוח\\; A\\\\B'));assert.ok(result.endsWith('END:VCALENDAR\r\n'));
});
test('UID stays stable across date changes and differs across accounts',()=>{
  const uid=(rows,scope)=>calendar.ics(rows,scope).match(/UID:(.*)/)[1];
  assert.equal(uid([row],'guest'),uid([{...row,date:'2027-01-01'}],'guest'));
  assert.notEqual(uid([row],'guest'),uid([row],'other'));
});
test('ICS rejects corrupt dates, duplicate ids and unplanned workouts',()=>{
  assert.throws(()=>calendar.ics([{...row,date:'2026-02-30'}],'guest'));
  assert.throws(()=>calendar.ics([row,row],'guest'));
  assert.throws(()=>calendar.ics([{...row,status:'completed'}],'guest'));
});
test('timed exports use Israel time and retain the complete workout duration', () => {
  const row = {id:'timed',title:'Walk',date:'2026-11-16',startTime:'18:00',minutes:30,status:'planned'};
  const range = calendar.timeRange(row);
  assert.equal(range.end,'18:30');
  assert.equal(new URL(calendar.googleUrl(row)).searchParams.get('dates'),'20261116T160000Z/20261116T163000Z');
  assert.match(calendar.ics([row],'guest'),/DTSTART:20261116T160000Z\r\nDTEND:20261116T163000Z/);
});
