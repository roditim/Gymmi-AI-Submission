import { answers, shortlist, providerRequest, validateMatches } from './matching.mjs';

const site = 'https://roditim.github.io';
const origins = [site, 'http://127.0.0.1:8530', 'http://localhost:8530'];
const project = Deno.env.get('SUPABASE_URL')!;
const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async request => {
  const origin = request.headers.get('Origin');
  const headers = {
    'Access-Control-Allow-Origin': origin && origins.includes(origin) ? origin : site,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json',
    'Cache-Control': 'no-store', 'Vary': 'Origin',
  };
  const reply = (status: number, body: unknown) => Response.json(body, {status, headers});
  if (origin && !origins.includes(origin)) return reply(403, {error: 'מקור הבקשה אינו מורשה.'});
  if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers});
  if (request.method !== 'POST') return reply(405, {error: 'נדרשת בקשת POST.'});
  const authorization = request.headers.get('Authorization') || '';
  const userHeaders = {apikey: anon, Authorization: authorization};
  if (!authorization.startsWith('Bearer ')) return reply(401, {error: 'התחברו לחשבון כדי לקבל התאמה.'});

  try {
    const auth = await fetch(project + '/auth/v1/user', {headers: userHeaders, signal: AbortSignal.timeout(5000)});
    if (!auth.ok) return reply(401, {error: 'החיבור לחשבון אינו תקף.'});
    const user = await auth.json();
    if (!user.id) return reply(401, {error: 'נדרש חשבון משתמש.'});
    let selected;
    try {
      const raw = await request.text();
      if (raw.length > 500) throw Error('Request too long');
      selected = answers(JSON.parse(raw));
    } catch {
      return reply(400, {error: 'בחרו תשובה בכל שדה בשאלון.'});
    }
    const directory = await fetch(project + '/rest/v1/rpc/coach_directory', {
      headers: userHeaders, signal: AbortSignal.timeout(5000),
    });
    if (!directory.ok) return reply(503, {error: 'לא ניתן לטעון את ספריית המאמנים כרגע.'});
    const rows = shortlist(await directory.json(), selected);
    if (!rows.length) return reply(200, {matches: []});
    const key = Deno.env.get('OPENAI_API_KEY');
    if (!key) return reply(503, {error: 'שירות ההתאמה עדיין אינו מוגדר.'});
    const quota = await fetch(project + '/rest/v1/rpc/claim_coach_match', {
      method: 'POST', headers: {apikey: service, Authorization: 'Bearer ' + service, 'Content-Type': 'application/json'},
      body: JSON.stringify({p_user_id: user.id}), signal: AbortSignal.timeout(5000),
    });
    if (!quota.ok) {
      const error = await quota.text();
      if (error.includes('AI_DEMO_LIMIT') || error.includes('AI_USER_LIMIT')) {
        return reply(429, {error: 'מכסת ההתאמות הגיעה למגבלה. הספרייה עדיין זמינה.'});
      }
      return reply(503, {error: 'לא ניתן לבדוק את מכסת ההתאמות.'});
    }
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST', headers: {Authorization: 'Bearer ' + key, 'Content-Type': 'application/json'},
      body: JSON.stringify(providerRequest(selected, rows)), signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) return reply(503, {error: 'שירות ה־AI אינו זמין כרגע.'});
    const result = await response.json();
    try {
      if (result.status !== 'completed') throw Error('Incomplete response');
      const output = result.output.flatMap((item: {content?: {type: string; text: string}[]}) => item.content || [])
        .filter((item: {type: string}) => item.type === 'output_text')
        .map((item: {text: string}) => item.text).join('');
      return reply(200, {matches: validateMatches(JSON.parse(output), rows)});
    } catch {
      return reply(502, {error: 'הצעת ההתאמה לא עברה בדיקה. אפשר לבחור מאמן מהספרייה.'});
    }
  } catch {
    return reply(503, {error: 'לא ניתן לקבל התאמה כרגע. אפשר להמשיך לספרייה.'});
  }
});
