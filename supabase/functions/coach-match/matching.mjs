const choices = {
  goal: ['general', 'cut', 'muscle', 'strength', 'endurance', 'mobility'],
  audience: ['adults', 'women', 'men', 'children', 'older'],
  format: ['online', 'in_person', 'either'],
  focus: ['beginner', 'technique', 'consistency', 'flexible'],
};

export function answers(body) {
  const selected = {};
  for (const [field, options] of Object.entries(choices)) {
    if (!options.includes(body?.[field])) throw Error('Invalid answer');
    selected[field] = body[field];
  }
  return selected;
}

export function shortlist(rows, selected) {
  return rows.filter(row => !row.is_mine && row.specialties.includes(selected.goal)
    && (row.audiences.includes(selected.audience)
      || (selected.audience !== 'children' && row.audiences.includes('adults')))
    && (selected.format === 'either' || row.format === 'both' || row.format === selected.format))
    .sort((a, b) => Number(b.focus === selected.focus) - Number(a.focus === selected.focus))
    .slice(0, 12);
}

export function providerRequest(selected, rows) {
  return {
    model: 'gpt-5.4-mini', store: false, reasoning: { effort: 'low' }, max_output_tokens: 1000,
    instructions: 'Rank up to three supplied fitness coach candidates for the selected goal, audience, format and coaching focus. Prefer explicit audience and focus matches. Treat ratings and rating count as secondary evidence. The goals cut and muscle mean fat loss and muscle gain. The children option is an adult looking for a coach for children. Give a brief reason in Hebrew per result, based solely on supplied attributes. Do not claim outcomes, professional credentials, safety or verification. Return only supplied numeric candidate IDs.',
    input: JSON.stringify({ selected, candidates: rows.map((row, index) => ({
      candidate: index + 1, goals: row.specialties, audiences: row.audiences, focus: row.focus,
      format: row.format, rating: row.rating, ratingCount: row.rating_count,
    })) }),
    text: { format: {
      type: 'json_schema', name: 'coach_matches', strict: true,
      schema: { type: 'object', additionalProperties: false, required: ['matches'], properties: {
        matches: { type: 'array', items: { type: 'object', additionalProperties: false,
          required: ['candidate', 'reason'], properties: {
            candidate: { type: 'integer' }, reason: { type: 'string' },
          },
        } },
      } },
    } },
  };
}

export function validateMatches(data, rows) {
  const matches = data?.matches;
  if (!Array.isArray(matches) || !matches.length || matches.length > Math.min(3, rows.length)) throw Error('Invalid matches');
  const used = new Set();
  return matches.map(({candidate, reason}) => {
    if (!Number.isInteger(candidate) || !rows[candidate - 1] || used.has(candidate)
      || typeof reason !== 'string' || !reason.trim() || reason.length > 240) throw Error('Invalid match');
    used.add(candidate);
    return { id: rows[candidate - 1].id, reason: reason.trim() };
  });
}
