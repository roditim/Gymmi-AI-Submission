import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planSync, eventBody } from '../supabase/functions/google-calendar-sync/planner.mjs';

const row = (title = 'Walk', date = '2026-11-08', status = 'planned') =>
  ({ id: 'a', title, date, status, minutes: 35, exercises: 'Private routine', resolvedAt: null });
const event = (summary = 'Walk', date = '2026-11-08') => {
  const { start, end } = eventBody(row(summary, date));
  return { id: 'event1', summary, start, end, etag: '"etag"' };
};
const baseline = { a: { eventId: 'event1', title: 'Walk', date: '2026-11-08' } };

test('a new planned workout exports one all-day event, excluding exercise details', async () => {
  const plan = await planSync([row()], {}, []);
  assert.equal(plan.workouts, null);
  assert.equal(plan.writes.length, 1);
  const change = plan.writes[0];
  assert.equal(change.type, 'create');
  assert.deepEqual(eventBody(change.row), {
    summary: 'Walk', start: { date: '2026-11-08' }, end: { date: '2026-11-09' },
    extendedProperties: { private: { gymmiWorkoutId: 'a' } }
  });
});

test('an all-day mobile edit pulls a date/title and preserves private workout fields', async () => {
  const plan = await planSync([row()], baseline, [event('Evening walk', '2026-11-09')]);
  assert.deepEqual(plan.workouts, [row('Evening walk', '2026-11-09')]);
  assert.equal(plan.links.a.date, '2026-11-09');
  assert.deepEqual(plan.writes, []);
});

test('Gymmi wins simultaneous edits, using the Google etag for conditional writes', async () => {
  const plan = await planSync([row('Local edit')], baseline, [event('Google edit')]);
  assert.equal(plan.workouts, null);
  assert.equal(plan.writes[0].type, 'update');
  assert.equal(plan.writes[0].event.etag, '"etag"');
  assert.equal(plan.writes[0].row.title, 'Local edit');
});

test('Google removals delete unchanged planned rows and Gymmi completions preserve the journal', async () => {
  const fromGoogle = await planSync([row()], baseline, []);
  assert.deepEqual(fromGoogle.workouts, []);
  assert.deepEqual(fromGoogle.links, {});
  const completed = await planSync([row('Walk', '2026-11-08', 'completed')], baseline, [event()]);
  assert.equal(completed.workouts, null);
  assert.equal(completed.writes[0].type, 'delete');
  const locallyChanged = await planSync([row('New walk')], baseline, []);
  assert.equal(locallyChanged.writes[0].previousId, 'event1');
});

test('Google additions import once, with timed and recurring events excluded', async () => {
  const timed = { ...event(), id: 'timed', start: { dateTime: '2026-11-08T13:00:00+02:00' } };
  const recurring = { ...event(), id: 'series', recurrence: ['RRULE:FREQ=WEEKLY'] };
  const converted = await planSync([row()], baseline, [{ ...timed, id: 'event1' }]);
  assert.equal(converted.workouts, null);
  assert.equal(converted.writes.length, 0);
  const first = await planSync([], {}, [event(), timed, recurring]);
  assert.equal(first.workouts.length, 1);
  assert.equal(first.workouts[0].status, 'planned');
  assert.equal(first.workouts[0].minutes, 30);
  const again = await planSync(first.workouts, first.links, [event(), timed, recurring]);
  assert.equal(again.workouts, null);
  assert.equal(again.writes.length, 0);
});

test('recover an already-created Google export without a duplicate workout', async () => {
  const remote = { ...event(), extendedProperties: { private: { gymmiWorkoutId: 'a' } } };
  const plan = await planSync([row()], {}, [remote]);
  assert.equal(plan.workouts, null);
  assert.equal(plan.links.a.eventId, remote.id);
  assert.equal(plan.writes.length, 0);
});
