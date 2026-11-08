export const calendarTimeZone = 'Asia/Jerusalem';
const localClock = new Intl.DateTimeFormat('en-GB', {
  timeZone: calendarTimeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const offsetClock = new Intl.DateTimeFormat('en-US', {timeZone: calendarTimeZone, timeZoneName: 'longOffset'});
const dayMillis = 86400000;

function midnight(date) {
  const utc = Date.parse(date + 'T00:00:00Z');
  const offset = offsetClock.formatToParts(utc).find(part => part.type === 'timeZoneName').value;
  const [, sign, hours, minutes] = offset.match(/GMT([+-])(\d\d):(\d\d)/);
  return utc - (sign === '+' ? 1 : -1) * (+hours * 60 + +minutes) * 60000;
}

export function googleWeek(start) {
  if (typeof start !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(start)) throw Error('Invalid week');
  const noon = new Date(start + 'T12:00:00Z');
  if (noon.getUTCFullYear() < 2000 || noon.getUTCFullYear() > 2100 || noon.getUTCDay() !== 1
    || noon.toISOString().slice(0, 10) !== start) throw Error('Invalid week');
  const dates = Array.from({length: 8}, (_, i) => new Date(+noon + i * dayMillis).toISOString().slice(0, 10));
  const boundaries = dates.map(midnight);
  return {dates: dates.slice(0, 7), boundaries, query: {
    timeMin: new Date(boundaries[0]).toISOString(), timeMax: new Date(boundaries[7]).toISOString(),
    timeZone: calendarTimeZone, items: [{id: 'primary'}],
  }};
}

export function busyByDay(week, response) {
  const primary = response?.calendars?.primary;
  if (!primary || primary.errors?.length || !Array.isArray(primary.busy) || primary.busy.length > 500) throw Error('Invalid busy response');
  const periods = primary.busy.map(period => [Date.parse(period.start), Date.parse(period.end)]);
  if (periods.some(([start, end]) => !Number.isFinite(start) || !Number.isFinite(end) || start >= end)) throw Error('Invalid busy interval');
  return Object.fromEntries(week.dates.map((date, i) => {
    const dayStart = week.boundaries[i], dayEnd = week.boundaries[i + 1];
    const overlaps = periods.filter(([start, end]) => start < dayEnd && end > dayStart)
      .map(([start, end]) => [Math.max(start, dayStart), Math.min(end, dayEnd)]).sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const interval of overlaps) {
      const last = merged.at(-1);
      if (last && interval[0] <= last[1]) last[1] = Math.max(last[1], interval[1]);
      else merged.push(interval);
    }
    return [date, merged.map(([start, end]) => {
      const from = localClock.format(start);
      const roundedEnd = Math.ceil(end / 60000) * 60000;
      const to = roundedEnd >= dayEnd ? '24:00' : localClock.format(roundedEnd);
      return from < to ? {start: from, end: to} : {start: '00:00', end: '24:00'};
    })];
  }));
}

const minutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
export const clockTime = value => String(Math.floor(value / 60)).padStart(2, '0') + ':' + String(value % 60).padStart(2, '0');
export const toMinutes = minutes;

export function fitsAvailability(time, duration, busy) {
  if (typeof time !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time) || !Array.isArray(busy)
    || !Number.isInteger(duration) || duration < 5 || duration > 180) return false;
  const start = minutes(time), end = start + duration;
  return end <= 1440 && busy.every(block => end <= minutes(block.start) || start >= minutes(block.end));
}
