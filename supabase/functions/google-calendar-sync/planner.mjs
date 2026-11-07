const PLANNED = 'planned';

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

function googleFields(event) {
  const title = event.summary?.trim();
  const date = event.start?.date;
  const end = nextDay(date);
  if (!title || title.length > 100 || !end || date < '1000-01-01' || date > '9998-12-31' ||
      event.end?.date !== end || event.recurrence?.length || event.recurringEventId ||
      event.attendees?.length || event.attendeesOmitted || (event.eventType && event.eventType !== 'default') || !event.etag) return null;
  return { title, date };
}

function fields(row) { return { title: row.title, date: row.date }; }
function same(a, b) { return a.title === b.title && a.date === b.date; }
function mapping(eventId, base) { return { eventId, ...base }; }

export function eventBody(row) {
  return {
    summary: row.title,
    start: { date: row.date },
    end: { date: nextDay(row.date) },
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
    // A linked event converted to a timed event or a series is left alone.
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
      workouts.set(id, { ...row, ...google });
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
      linked.set(owner, mapping(event.id, google || fields(ownerRow)));
      if (google && !same(ownerRow, google)) writes.push({ type: 'update', id: owner, row: ownerRow, event });
      continue;
    }
    if (!google || owner) continue;
    const id = 'gcal-' + await hash(event.id);
    if (!workouts.has(id)) {
      workouts.set(id, { id, ...google, minutes: 30, exercises: 'אירוע שיובא מיומן Gymmi ב־Google Calendar',
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
