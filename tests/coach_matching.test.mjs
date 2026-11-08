import {test} from 'node:test';
import assert from 'node:assert/strict';
import {answers, shortlist, providerRequest, validateMatches} from '../supabase/functions/coach-match/matching.mjs';

const chosen = {goal: 'strength', audience: 'children', format: 'online', focus: 'beginner'};
const coach = {id: 'real-id', specialties: ['strength'], audiences: ['children'], format: 'both',
  focus: 'beginner', rating: 4.5, rating_count: 10, bio: 'private-to-model', contact_email: 'coach@example.com'};

test('questionnaire uses approved codes and sends no contact information to OpenAI', () => {
  const selected = answers({...chosen, email: 'client@example.com'});
  assert.deepEqual(selected, chosen);
  assert.throws(() => answers({...chosen, goal: 'free text'}));
  const request = providerRequest(selected, [coach]);
  assert.equal(request.store, false);
  assert.equal(request.text.format.strict, true);
  assert.deepEqual(JSON.parse(request.input).candidates, [{
    candidate: 1, goals: coach.specialties, audiences: coach.audiences, focus: 'beginner',
    format: 'both', rating: 4.5, ratingCount: 10,
  }]);
});

test('children require an explicit audience match, and goal and format remain hard constraints', () => {
  const adults = {...coach, id: 'adults', audiences: ['adults']};
  assert.deepEqual(shortlist([coach, adults, {...coach, format: 'in_person'},
    {...coach, specialties: ['cut']}, {...coach, is_mine: true}], chosen), [coach]);
  assert.deepEqual(shortlist([adults], {...chosen, audience: 'women'}), [adults]);
});

test('the model cannot invent a coach, duplicate a recommendation or leave an empty reason', () => {
  const matches = [{candidate: 1, reason: 'מתאים למטרת הכוח'}];
  assert.deepEqual(validateMatches({matches}, [coach]), [{id: coach.id, reason: matches[0].reason}]);
  assert.throws(() => validateMatches({matches: [{candidate: 2, reason: 'invalid'}]}, [coach]));
  assert.throws(() => validateMatches({matches: [matches[0], matches[0]]}, [coach, {...coach, id: 'second'}]));
  assert.throws(() => validateMatches({matches: [{candidate: 1, reason: ' '}]}, [coach]));
});
