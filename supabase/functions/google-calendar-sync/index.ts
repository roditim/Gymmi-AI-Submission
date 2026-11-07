import { eventBody, hash, planSync } from './planner.mjs';

const app = 'https://roditim.github.io/Gymmi-AI-Submission/app/';
const origin = new URL(app).origin;
const scope = 'https://www.googleapis.com/auth/calendar.app.created';
const supabase = Deno.env.get('SUPABASE_URL')!;
const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const clientId = Deno.env.get('GOOGLE_CALENDAR_CLIENT_ID');
const clientSecret = Deno.env.get('GOOGLE_CALENDAR_CLIENT_SECRET');
const tokenKey = Deno.env.get('GOOGLE_CALENDAR_TOKEN_KEY');
const workerKey = Deno.env.get('GOOGLE_CALENDAR_WORKER_KEY');
const configured = Boolean(clientId && clientSecret && tokenKey && workerKey);
const connections = 'google_calendar_connections';
const queryUser = (id: string) => 'user_id=eq.' + encodeURIComponent(id);
const iso = (offset = 0) => new Date(Date.now() + offset).toISOString();

class SyncError extends Error {
  constructor(message: string, public status = 503) { super(message); }
}

async function db(path: string, method = 'GET', body?: unknown) {
  const result = await fetch(supabase + '/rest/v1/' + path, {
    method, signal: AbortSignal.timeout(5000),
    headers: { apikey: service, Authorization: 'Bearer ' + service,
      'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!result.ok) throw new SyncError('database');
  return result.status === 204 ? null : result.json();
}

async function google(path: string, access: string, method = 'GET', body?: unknown, etag?: string) {
  const result = await fetch('https://www.googleapis.com/calendar/v3/' + path, {
    method, signal: AbortSignal.timeout(5000),
    headers: { Authorization: 'Bearer ' + access, 'Content-Type': 'application/json',
      ...(etag ? { 'If-Match': etag } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!result.ok) throw new SyncError('google', result.status);
  return result.status === 204 ? null : result.json();
}

function base64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function encryptionKey() {
  const bytes = Uint8Array.from(atob(tokenKey!), char => char.charCodeAt(0));
  if (bytes.length !== 32) throw new SyncError('config');
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function encrypt(token: string, user: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(user) },
    await encryptionKey(), new TextEncoder().encode(token)
  ));
  return btoa(String.fromCharCode(...iv, ...bytes));
}

async function decrypt(value: string, user: string) {
  const bytes = Uint8Array.from(atob(value), char => char.charCodeAt(0));
  const token = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData: new TextEncoder().encode(user) },
    await encryptionKey(), bytes.slice(12)
  );
  return new TextDecoder().decode(token);
}

async function tokenRequest(fields: Record<string, string>) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', signal: AbortSignal.timeout(7000),
    body: new URLSearchParams({ ...fields, client_id: clientId!, client_secret: clientSecret! })
  });
  const tokens = await response.json();
  if (!response.ok || typeof tokens.access_token !== 'string') {
    throw new SyncError(tokens.error === 'invalid_grant' ? 'permission' : 'google');
  }
  return tokens;
}

async function begin(user: string) {
  if ((await db(connections + '?select=user_id&' + queryUser(user))).length) throw new SyncError('already_connected', 409);
  const state = 'gymmi_' + base64url(crypto.getRandomValues(new Uint8Array(32)));
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  await db('google_calendar_states?' + queryUser(user), 'DELETE');
  await db('google_calendar_states', 'POST',
    { user_id: user, state_hash: await hash(state), verifier, expires_at: iso(600000) });
  return { url: 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: clientId!, redirect_uri: app, response_type: 'code', scope, state,
    access_type: 'offline', prompt: 'consent', code_challenge: challenge, code_challenge_method: 'S256'
  }) };
}

async function finish(user: string, code: unknown, state: unknown) {
  if (typeof code !== 'string' || code.length < 1 || code.length > 2048 ||
      typeof state !== 'string' || !/^gymmi_[A-Za-z0-9_-]{43}$/.test(state)) throw new SyncError('state', 400);
  const [attempt] = await db('google_calendar_states?' + queryUser(user) + '&state_hash=eq.' + await hash(state) +
    '&expires_at=gt.' + encodeURIComponent(iso()), 'DELETE');
  if (!attempt) throw new SyncError('state', 400);
  if ((await db(connections + '?select=user_id&' + queryUser(user))).length) throw new SyncError('already_connected', 409);
  const tokens = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: app, code_verifier: attempt.verifier });
  if (typeof tokens.refresh_token !== 'string' || !tokens.scope?.split(' ').includes(scope)) throw new SyncError('permission', 400);
  const cipher = await encrypt(tokens.refresh_token, user);
  const calendar = await google('calendars', tokens.access_token, 'POST', {
    summary: 'Gymmi', description: 'Workouts synced with Gymmi', timeZone: 'Asia/Jerusalem'
  });
  try {
    await db(connections, 'POST', { user_id: user, calendar_id: calendar.id, refresh_cipher: cipher });
  } catch (error) {
    // Only compensate for the new empty calendar if a conflicting link won.
    const [existing] = await db(connections + '?select=calendar_id&' + queryUser(user));
    if (existing && existing.calendar_id !== calendar.id) {
      await google('calendars/' + encodeURIComponent(calendar.id), tokens.access_token, 'DELETE').catch(() => {});
    }
    if (existing?.calendar_id !== calendar.id) throw error;
  }
}

async function listEvents(base: string, access: string) {
  const events = [];
  const parameters = new URLSearchParams({ maxResults: '250', showDeleted: 'false',
    fields: 'nextPageToken,items(id,status,etag,summary,start(date),end(date),recurrence,recurringEventId,extendedProperties(private),attendees,attendeesOmitted,eventType)' });
  for (let page = 0; page < 5; page++) {
    const response = await google(base + '?' + parameters, access);
    events.push(...(response.items || []));
    if (!response.nextPageToken) return events;
    parameters.set('pageToken', response.nextPageToken);
  }
  throw new SyncError('calendar_full');
}

async function sendChange(base: string, access: string, change: any) {
  if (change.type === 'delete') {
    await google(base + '/' + encodeURIComponent(change.event.id) + '?sendUpdates=none', access, 'DELETE', undefined, change.event.etag);
    return null;
  }
  if (change.type === 'update') {
    const event = await google(base + '/' + encodeURIComponent(change.event.id) + '?sendUpdates=none', access,
      'PATCH', eventBody(change.row), change.event.etag);
    return event.id;
  }
  const id = 'gymmi' + await hash(change.id + '\n' + (change.previousId || ''));
  try {
    return (await google(base + '?sendUpdates=none', access, 'POST', { ...eventBody(change.row), id })).id;
  } catch (error) {
    if (!(error instanceof SyncError) || error.status !== 409) throw error;
    // A previous POST might already have succeeded before the response was lost.
    const existing = await google(base + '/' + id, access).catch(error => {
      if (error instanceof SyncError && [404, 410].includes(error.status)) return null;
      throw error;
    });
    if (existing && existing.status !== 'cancelled') {
      if (existing.extendedProperties?.private?.gymmiWorkoutId !== change.id ||
          existing.summary !== change.row.title || existing.start?.date !== change.row.date ||
          existing.end?.date !== eventBody(change.row).end.date) throw new SyncError('changed');
      return existing.id;
    }
    // Google can retain a deleted ID. A new ID permits re-adding that workout.
    return (await google(base + '?sendUpdates=none', access, 'POST',
      { ...eventBody(change.row), id: 'gymmi' + crypto.randomUUID().replace(/-/g, '') })).id;
  }
}

async function syncOne(user: string) {
  const lease = crypto.randomUUID();
  const [link] = await db(connections + '?' + queryUser(user) +
    '&paused=eq.false&and=(or(lease_until.is.null,lease_until.lt.' + encodeURIComponent(iso()) +
    '),or(last_attempt_at.is.null,last_attempt_at.lt.' + encodeURIComponent(iso(-30000)) + '))',
    'PATCH', { lease_id: lease, lease_until: iso(120000), last_attempt_at: iso() });
  if (!link) return;
  const ownedLease = connections + '?' + queryUser(user) + '&lease_id=eq.' + lease;
  const started = Date.now();
  const updates: Record<string, unknown> = { lease_id: null, lease_until: null, next_sync_at: iso(120000) };
  try {
    const refresh = await decrypt(link.refresh_cipher, user);
    const tokens = await tokenRequest({ grant_type: 'refresh_token', refresh_token: refresh });
    if (typeof tokens.refresh_token === 'string' && tokens.refresh_token !== refresh) {
      await db(ownedLease, 'PATCH', { refresh_cipher: await encrypt(tokens.refresh_token, user) });
    }
    const base = 'calendars/' + encodeURIComponent(link.calendar_id) + '/events';
    const [journal, events] = await Promise.all([
      db('workout_journals?select=workouts,revision&' + queryUser(user)),
      listEvents(base, tokens.access_token).catch(error => {
        if (error instanceof SyncError && [404, 410].includes(error.status)) throw new SyncError('permission');
        throw error;
      })
    ]);
    const plan = await planSync(journal[0]?.workouts || [], link.links, events);
    const committed = await db('rpc/commit_google_calendar_pull', 'POST', {
      p_user: user, p_lease: lease, p_revision: journal[0]?.revision || 0,
      p_workouts: plan.workouts, p_links: plan.links
    });
    if (!committed) throw new SyncError('changed');
    updates.links = plan.links;
    let done = 0;
    for (const change of plan.writes.slice(0, 12)) {
      if (Date.now() - started > 28000) break;
      const eventId = await sendChange(base, tokens.access_token, change);
      if (eventId) Object.defineProperty(plan.links, change.id, {
        value: { eventId, title: change.row.title, date: change.row.date }, enumerable: true, configurable: true, writable: true
      });
      else delete plan.links[change.id];
      done++;
    }
    updates.last_error = done < plan.writes.length ? 'pending' : null;
    if (done === plan.writes.length) updates.last_sync_at = iso();
  } catch (error) {
    const reason = error instanceof SyncError ? error.message : 'google';
    updates.paused = reason === 'permission';
    updates.last_error = ['permission', 'changed', 'calendar_full', 'journal_full'].includes(reason) ? reason : 'temporary';
  } finally {
    await db(ownedLease, 'PATCH', updates);
  }
}

async function status(user: string) {
  const [link] = await db(connections + '?select=last_sync_at,last_error,paused&' + queryUser(user));
  if (!link) return { available: configured, connected: false };
  const [journal] = await db('workout_journals?select=revision&' + queryUser(user));
  return { available: configured, connected: true, lastSync: link.last_sync_at,
    problem: link.last_error, paused: link.paused, revision: journal?.revision || 0 };
}

Deno.serve(async req => {
  const caller = req.headers.get('Origin');
  const allowed = !caller || [origin, 'http://127.0.0.1:8530', 'http://localhost:8530'].includes(caller);
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Origin',
    'Access-Control-Allow-Origin': allowed && caller ? caller : origin,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS' };
  const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers });
  if (!allowed) return reply({ error: 'origin' }, 403);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return reply({ error: 'method' }, 405);
  try {
    const raw = await req.text();
    if (raw.length > 4096) return reply({ error: 'request' }, 400);
    const body = JSON.parse(raw);
    if (!body || typeof body.action !== 'string') return reply({ error: 'request' }, 400);
    if (body.action === 'worker') {
      if (!workerKey || req.headers.get('x-gymmi-calendar-worker') !== workerKey) return reply({ error: 'auth' }, 401);
      if (!configured) return reply({ processed: 0 });
      const due = await db(connections + '?select=user_id&paused=eq.false&next_sync_at=lte.' +
        encodeURIComponent(iso()) + '&order=next_sync_at&limit=4');
      await Promise.all(due.map((row: { user_id: string }) => syncOne(row.user_id)));
      return reply({ processed: due.length });
    }
    const bearer = req.headers.get('Authorization');
    if (!bearer?.startsWith('Bearer ')) return reply({ error: 'auth' }, 401);
    const auth = await fetch(supabase + '/auth/v1/user', {
      headers: { apikey: anon, Authorization: bearer }, signal: AbortSignal.timeout(5000)
    });
    if (!auth.ok) return reply({ error: 'auth' }, 401);
    const { id: user } = await auth.json();
    if (!user) return reply({ error: 'auth' }, 401);
    if (body.action === 'status') return reply(await status(user));
    if (!configured && body.action !== 'disconnect') return reply({ error: 'unconfigured' }, 503);
    switch (body.action) {
      case 'start': return reply(await begin(user));
      case 'finish': await finish(user, body.code, body.state); break;
      case 'sync': await syncOne(user); break;
      case 'disconnect': {
        await db('google_calendar_states?' + queryUser(user), 'DELETE');
        const removed = await db(connections + '?' + queryUser(user) + '&or=(lease_until.is.null,lease_until.lt.' +
          encodeURIComponent(iso()) + ')', 'DELETE');
        if (!removed.length && (await db(connections + '?select=user_id&' + queryUser(user))).length) {
          return reply({ error: 'busy' }, 409);
        }
        break;
      }
      default: return reply({ error: 'action' }, 400);
    }
    return reply(await status(user));
  } catch (error) {
    if (error instanceof SyntaxError) return reply({ error: 'request' }, 400);
    const known = error instanceof SyncError ? error : new SyncError('temporary');
    // Provider errors never disclose access tokens or raw response bodies.
    return reply({ error: known.message }, [400, 409].includes(known.status) ? known.status : 503);
  }
});
