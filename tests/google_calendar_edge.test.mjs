import assert from 'node:assert/strict';
import { test } from 'node:test';

test('OAuth state belongs to one account and the worker pushes and pulls through a simulated Google API', async () => {
  const scope = 'https://www.googleapis.com/auth/calendar.app.created';
  const freeBusyScope = 'https://www.googleapis.com/auth/calendar.freebusy';
  const settings = {
    SUPABASE_URL: 'https://supabase.test', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service',
    GOOGLE_CALENDAR_CLIENT_ID: 'fake-client', GOOGLE_CALENDAR_CLIENT_SECRET: 'fake-secret',
    GOOGLE_CALENDAR_TOKEN_KEY: Buffer.alloc(32, 4).toString('base64'), GOOGLE_CALENDAR_WORKER_KEY: 'worker-test',
    GYMMI_GOOGLE_DEMO_USER_ID: 'b'
  };
  let handler, state, link, event;
  let revision = 1;
  let journal = [{ id: 'abc', status: 'planned', title: 'Walk', date: '2026-11-08', minutes: 30,
    exercises: 'Private exercise details', resolvedAt: null }];
  const response = (value, status = 200) => Response.json(value, { status });
  const oldFetch = globalThis.fetch;
  globalThis.Deno = { env: { get: key => settings[key] }, serve: fn => { handler = fn; } };
  globalThis.fetch = async (input, init) => {
    const url = new URL(input), method = init.method || 'GET';
    const body = init.body && typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
    if (url.host === 'supabase.test') {
      if (url.pathname === '/auth/v1/user') {
        const token = init.headers.Authorization.slice(7);
        return ['a', 'b'].includes(token) ? response({ id: token }) : response({}, 401);
      }
      assert.equal(init.headers.Authorization, 'Bearer service');
      const owner = url.searchParams.get('user_id')?.slice(3);
      if (url.pathname.endsWith('/google_calendar_states')) {
        if (method === 'POST') { state = body; return response([state]); }
        if (method === 'DELETE') {
          const match = state && state.user_id === owner &&
            (!url.searchParams.has('state_hash') || url.searchParams.get('state_hash') === 'eq.' + state.state_hash);
          if (!match) return response([]);
          const result = state;
          state = undefined;
          return response([result]);
        }
      }
      if (url.pathname.endsWith('/google_calendar_connections')) {
        if (method === 'POST') {
          link = { ...body, links: {}, paused: false };
          return response([link]);
        }
        if (!link || owner && owner !== link.user_id) return response([]);
        if (method === 'PATCH') Object.assign(link, body);
        if (method === 'DELETE') { const old = link; link = undefined; return response([old]); }
        return response([link]);
      }
      if (url.pathname.endsWith('/workout_journals')) return response([{ workouts: journal, revision }]);
      if (url.pathname.endsWith('/rpc/commit_google_calendar_pull')) {
        assert.equal(body.p_user, 'a');
        assert.equal(body.p_lease, link.lease_id);
        if (body.p_revision !== revision) return response(false);
        if (body.p_workouts !== null) { journal = body.p_workouts; revision++; }
        link.links = body.p_links;
        return response(true);
      }
    }
    if (url.host === 'oauth2.googleapis.com') {
      assert.equal(body.get('client_secret'), 'fake-secret');
      if (body.get('grant_type') === 'authorization_code') {
        assert.equal(body.get('code_verifier').length, 43);
        assert.equal(body.get('redirect_uri'), 'https://roditim.github.io/Gymmi-AI-Submission/app/');
        return response({ access_token: 'access', refresh_token: 'refresh-secret', scope });
      }
      assert.equal(body.get('refresh_token'), 'refresh-secret');
      return response({ access_token: 'access' });
    }
    if (url.host === 'www.googleapis.com') {
      assert.equal(init.headers.Authorization, 'Bearer access');
      if (url.pathname.endsWith('/calendars') && method === 'POST') return response({ id: 'gymmi-test' });
      if (url.pathname.endsWith('/freeBusy')) {
        assert.equal(method,'POST');
        assert.deepEqual(body.items,[{id:'primary'}]);
        return response({calendars:{primary:{busy:[{start:'2026-11-11T18:00:00+02:00',end:'2026-11-11T19:00:00+02:00'}]}}});
      }
      assert.equal(url.pathname, '/calendar/v3/calendars/gymmi-test/events');
      if (method === 'POST') {
        assert.equal(url.searchParams.get('sendUpdates'), 'none');
        assert.equal(JSON.stringify(body).includes('Private exercise'), false);
        event = { ...body, etag: '"etag-1"' };
        return response(event);
      }
      return response({ items: event ? [event] : [] });
    }
    throw Error('Unexpected simulated endpoint: ' + url);
  };
  try {
    await import('../supabase/functions/google-calendar-sync/index.ts');
    const invoke = (body, user, worker) => handler(new Request('https://local.test', { method: 'POST',
      body: JSON.stringify(body), headers: { ...(user ? { Authorization: 'Bearer ' + user } : {}),
        ...(worker ? { 'x-gymmi-calendar-worker': worker } : {}) } }));
    assert.equal((await invoke({ action: 'status' })).status, 401);
    const demoAvailability = {action:'availability',weekStart:'2026-11-16',demo:true};
    assert.equal((await invoke(demoAvailability,'a')).status,403);
    assert.equal((await (await invoke({action:'status'},'a')).json()).demoAvailable,false);
    assert.equal((await (await invoke({action:'status'},'b')).json()).demoAvailable,true);
    const demo = await (await invoke(demoAvailability,'b')).json();
    assert.equal(demo.source,'demo');
    assert.deepEqual(demo.busy['2026-11-18'],[{start:'18:00',end:'18:30'}]);
    assert.deepEqual(demo.busy['2026-11-20'],[{start:'09:00',end:'09:30'}]);
    assert.deepEqual(demo.busy['2026-11-19'],[]);
    const authUrl = new URL((await (await invoke({ action: 'start' }, 'a')).json()).url);
    assert.deepEqual(authUrl.searchParams.get('scope').split(' '), [scope,freeBusyScope]);
    assert.equal(authUrl.searchParams.get('access_type'), 'offline');
    assert.equal(authUrl.searchParams.get('code_challenge_method'), 'S256');
    const finish = { action: 'finish', code: 'mock-code', state: authUrl.searchParams.get('state') };
    assert.equal((await invoke(finish, 'b')).status, 400);
    const connected = await (await invoke(finish, 'a')).json();
    assert.equal(connected.connected, true);
    assert.equal(JSON.stringify(connected).includes('refresh-secret'), false);
    assert.notEqual(link.refresh_cipher, 'refresh-secret');
    const freeBusy = {action:'availability',weekStart:'2026-11-09'};
    assert.equal((await (await invoke(freeBusy,'b')).json()).available,false);
    const available = await (await invoke(freeBusy,'a')).json();
    assert.deepEqual(available.busy['2026-11-11'],[{start:'18:00',end:'19:00'}]);
    assert.equal(JSON.stringify(available).includes('refresh-secret'),false);
    assert.equal((await invoke(finish, 'a')).status, 400);
    assert.equal((await invoke({ action: 'worker' }, 'a')).status, 401);
    assert.equal((await invoke({ action: 'worker' }, null, 'worker-test')).status, 200);
    assert.equal(event.summary, 'Walk');
    assert.equal(link.links.abc.eventId, event.id);
    event = { ...event, summary: 'Moved on phone', start: { dateTime:'2026-11-10T18:15:00+02:00' }, end: { dateTime:'2026-11-10T18:45:00+02:00' }, etag: '"etag-2"' };
    assert.equal((await invoke({ action: 'worker' }, null, 'worker-test')).status, 200);
    assert.equal(journal[0].title, 'Moved on phone');
    assert.equal(journal[0].date, '2026-11-10');
    assert.equal(journal[0].startTime,'18:15');
    assert.equal(journal[0].minutes,30);
    assert.equal(journal[0].exercises, 'Private exercise details');
    assert.equal(revision, 2);
    assert.equal((await (await invoke({ action: 'disconnect' }, 'a')).json()).connected, false);
    assert.equal(event.summary, 'Moved on phone');
  } finally {
    delete globalThis.Deno;
    globalThis.fetch = oldFetch;
  }
});
