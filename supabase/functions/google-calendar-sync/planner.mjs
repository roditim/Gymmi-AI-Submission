import { calendarTimeZone, clockTime, fitsAvailability, toMinutes } from '../_shared/google-availability.mjs';

const PLANNED = 'planned';
const eventClock = new Intl.DateTimeFormat('en-GB', {timeZone: calendarTimeZone,
  year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23'});

export function nextDay(day) {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const value = new Date(day + 'T00:00:00Z');
  if (!Number.isFinite(+value) || value.toISOString().slice(0, 10) !== day) return null;
  return new Date(+value + 86400000).toISOString().slice(0, 10);
}

export async function hash(text) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function eventDateTime(value) {
  if (typeof value !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch) || epoch % 60000 !== 0) return null;
  const parts = Object.fromEntries(eventClock.formatToParts(epoch).map(part => [part.type, part.value]));
  return {date: parts.year + '-' + parts.month + '-' + parts.day, time: parts.hour + ':' + parts.minute, epoch};
}

function googleFields(event) {
  const title = event.summary?.trim();
  if (!title || title.length > 100 || event.recurrence?.length || event.recurringEventId ||
      event.attendees?.length || event.attendeesOmitted || (event.eventType && event.eventType !== 'default') || !event.etag) return null;
  const date = event.start?.date;
  if (date) {
    const end = nextDay(date);
    return end && date >= '1000-01-01' && date <= '9998-12-31' && event.end?.date === end ? {title,date} : null;
  }
  const start = eventDateTime(event.start?.dateTime), end = eventDateTime(event.end?.dateTime);
  if (!start || !end) return null;
  const minutes = (end.epoch - start.epoch) / 60000;
  const endMinute = toMinutes(start.time) + minutes;
  const expectedDate = endMinute === 1440 ? nextDay(start.date) : start.date;
  if (!fitsAvailability(start.time, minutes, []) || end.date !== expectedDate || end.time !== clockTime(endMinute % 1440)) return null;
  return {title,date:start.date,startTime:start.time,minutes};
}

export function workoutSchedule(row) {
  return {title:row.title,date:row.date,...(row.startTime ? {startTime:row.startTime,minutes:row.minutes} : {})};
}
function same(a, b) {
  return a.title === b.title && a.date === b.date && (a.startTime || null) === (b.startTime || null)
    && (!a.startTime || a.minutes === b.minutes);
}
export function matchesGoogleEvent(row, event) {
  const fields = googleFields(event);
  return Boolean(fields && same(row, fields));
}
function mapping(eventId, base) { return { eventId, ...base }; }

export function eventBody(row) {
  let start = {date: row.date}, end = {date: nextDay(row.date)};
  if (row.startTime) {
    if (!fitsAvailability(row.startTime, row.minutes, [])) throw Error('invalid_time');
    const endMinute = toMinutes(row.startTime) + row.minutes;
    const endDate = endMinute === 1440 ? nextDay(row.date) : row.date;
    start = {dateTime: row.date + 'T' + row.startTime + ':00', timeZone: calendarTimeZone};
    end = {dateTime: endDate + 'T' + clockTime(endMinute % 1440) + ':00', timeZone: calendarTimeZone};
  }
  return {
    summary: row.title,
    start, end,
    extendedProperties: { private: { gymmiWorkoutId: row.id } }
  };
}

// A shared snapshot tells us which side changed. Simultaneous edits of the
// same event use Gymmi's title/date. Completion itself belongs to Gymmi.
export async function planSync(rows, storedLinks, events) {
  const workouts = new Map(rows.map(row => [row.id, row]));
  const linked = new Map(Object.entries(storedLinks));
  const remote = new Map(events.filter(event => event.status !== 'cancelled').map(event => [event.id, event]));
  const used = new Set();
  const writes = [];
  let changes = false;

  for (const [id, link] of linked) {
    const row = workouts.get(id);
    const event = remote.get(link.eventId);
    const google = event && googleFields(event);
    used.add(link.eventId);
    // A linked event converted to an unsupported series is left alone.
    if (event && !google) continue;
    if (!row || row.status !== PLANNED) {
      if (event) writes.push({ type: 'delete', id, event });
      else linked.delete(id);
    } else if (!event) {
      if (same(row, link)) {
        workouts.delete(id);
        linked.delete(id);
        changes = true;
      } else {
        writes.push({ type: 'create', id, row, previousId: link.eventId });
      }
    } else if (same(row, google)) {
      linked.set(id, mapping(event.id, google));
    } else if (!same(row, link)) {
      writes.push({ type: 'update', id, row, event });
    } else {
      const updated = { ...row, ...google };
      if (!google.startTime) delete updated.startTime;
      workouts.set(id, updated);
      linked.set(id, mapping(event.id, google));
      changes = true;
    }
  }

  for (const event of remote.values()) {
    if (used.has(event.id)) continue;
    const google = googleFields(event);
    const owner = event.extendedProperties?.private?.gymmiWorkoutId;
    const ownerRow = owner && workouts.get(owner);
    if (ownerRow && !linked.has(owner)) {
      // Recover an export whose response or mapping write was interrupted.
      if (ownerRow.status !== PLANNED) continue;
      linked.set(owner, mapping(event.id, google || workoutSchedule(ownerRow)));
      if (google && !same(ownerRow, google)) writes.push({ type: 'update', id: owner, row: ownerRow, event });
      continue;
    }
    if (!google || owner) continue;
    const id = 'gcal-' + await hash(event.id);
    if (!workouts.has(id)) {
      workouts.set(id, { id, minutes: 30, ...google, exercises: 'אירוע שיובא מיומן Gymmi ב־Google Calendar',
        status: PLANNED, resolvedAt: null });
      changes = true;
    }
    linked.set(id, mapping(event.id, google));
  }

  const pending = new Set(writes.map(write => write.id));
  for (const row of workouts.values()) {
    if (row.status === PLANNED && !linked.has(row.id) && !pending.has(row.id)) {
      writes.push({ type: 'create', id: row.id, row });
    }
  }

  if (workouts.size > 1000) throw Error('journal_full');
  return { workouts: changes ? [...workouts.values()] : null, links: Object.fromEntries(linked), writes };
}
