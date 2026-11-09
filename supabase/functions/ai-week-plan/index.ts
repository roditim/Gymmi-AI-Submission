import { requestData, candidates, providerRequest, modelProposal } from './planner.mjs';

const origin = 'https://roditim.github.io';
const headers = { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':origin,
  'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods':'POST, OPTIONS', 'Cache-Control':'no-store' };
const url = Deno.env.get('SUPABASE_URL')!;
const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async req => {
  const callerOrigin = req.headers.get('Origin');
  const allowed = !callerOrigin || [origin,'http://127.0.0.1:8530','http://localhost:8530'].includes(callerOrigin);
  const responseHeaders = {...headers,'Access-Control-Allow-Origin':allowed && callerOrigin ? callerOrigin : origin,'Vary':'Origin'};
  const reply = (status:number, body:unknown) => new Response(JSON.stringify(body), {status,headers:responseHeaders});
  if (!allowed) return reply(403,{error:'מקור הבקשה אינו מורשה.'});
  if (req.method === 'OPTIONS') return new Response(null,{status:204,headers:responseHeaders});
  if (req.method !== 'POST') return reply(405,{error:'נדרשת בקשת POST.'});
  const authorization = req.headers.get('Authorization') || '';
  if (!authorization.startsWith('Bearer ')) return reply(401,{error:'יש להתחבר לחשבון כדי להשתמש בעוזר.'});
  try {
    // Validate the caller with Auth, even when the gateway has already checked JWT.
    const auth = await fetch(url+'/auth/v1/user',{headers:{apikey:anon,Authorization:authorization},signal:AbortSignal.timeout(5000)});
    if (!auth.ok) return reply(401,{error:'החיבור לחשבון אינו תקף. התחבר מחדש.'});
    const user = await auth.json();
    if (!user.id) return reply(401,{error:'נדרש חשבון משתמש.'});
    const raw = await req.text();
    if (raw.length > 4000) return reply(400,{error:'הבקשה ארוכה מדי.'});
    let request, body;
    try { body = JSON.parse(raw); request = requestData(body); } catch { return reply(400,{error:'בדוק את השבוע, הזמינות ורשימת האימונים (עד 7).'}); }
    const calendarDemo = body.calendarDemo === true;
    if (calendarDemo && user.id !== Deno.env.get('GYMMI_GOOGLE_DEMO_USER_ID')) {
      return reply(403,{error:'הדמיית Google Calendar זמינה בחשבון ההדגמה בלבד.'});
    }
    const journal = await fetch(url+'/rest/v1/workout_journals?select=workouts&user_id=eq.'+encodeURIComponent(user.id),
      {headers:{apikey:anon,Authorization:authorization},signal:AbortSignal.timeout(5000)});
    if (!journal.ok) return reply(503,{error:'לא ניתן לטעון את היומן. נסה שוב מאוחר יותר.'});
    const rows = await journal.json();
    const parts = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jerusalem',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
    const today = ['year','month','day'].map(type => parts.find(p=>p.type===type)!.value).join('-');
    let input;
    try { input = candidates(request,rows[0]?.workouts,today); } catch { return reply(400,{error:'יש לבחור עד 7 אימונים שטרם סומנו, בשבוע הנבחר עם ימים עתידיים או היום.'}); }
    let availability = 'manual';
    if (calendarDemo || body.useGoogleAvailability === true) {
      availability = 'unavailable';
      try {
        const response = await fetch(url+'/functions/v1/google-calendar-sync', {
          method:'POST', headers:{apikey:anon,Authorization:authorization,'Content-Type':'application/json'},
          body:JSON.stringify({action:'availability',weekStart:body.weekStart,demo:calendarDemo}), signal:AbortSignal.timeout(8000),
        });
        const result = response.ok && await response.json();
        if (result?.available && (result.source === 'demo') === calendarDemo && input.dates.every(date => Array.isArray(result.busy?.[date]))) {
          input = {...input,busy:result.busy};
          availability = 'used';
        }
      } catch { /* A connected calendar must be checked before proposing a time. */ }
      if (availability !== 'used') return reply(503,{error:calendarDemo
        ? 'לא ניתן לטעון את שעות ההדגמה. נסו שוב.' : 'לא ניתן לבדוק את שעות Google Calendar כרגע. נסו שוב או בדקו את החיבור ביומן.'});
    }
    const key = Deno.env.get('OPENAI_API_KEY');
    if (!key) return reply(503,{error:'עוזר ה־AI אינו מוגדר כרגע.'});
    const quota = await fetch(url+'/rest/v1/rpc/claim_ai_request',{method:'POST',headers:{apikey:service,Authorization:'Bearer '+service,'Content-Type':'application/json'},body:JSON.stringify({p_user_id:user.id}),signal:AbortSignal.timeout(5000)});
    if (!quota.ok) {
      const reason = await quota.text();
      return reason.includes('AI_USER_LIMIT') || reason.includes('AI_DEMO_LIMIT')
        ? reply(429,{error:'מכסת בקשות ה־AI להדגמה מוצתה (עד 3 ביום לחשבון ומכסה כוללת לפרויקט).'})
        : reply(503,{error:'לא ניתן לבדוק את מכסת ה־AI כרגע.'});
    }
    const result = await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(providerRequest(request.preferences,input)),signal:AbortSignal.timeout(30000)});
    if (!result.ok) return reply(503,{error:'ספק ה־AI אינו זמין כרגע. לא נשמר שינוי ביומן.'});
    const data = await result.json();
    if (data.status !== 'completed') return reply(502,{error:'ה־AI לא החזיר הצעה מלאה. היומן לא השתנה.'});
    try {
      const text = (data.output || []).flatMap((o:any)=>o.content || []).filter((c:any)=>c.type==='output_text').map((c:any)=>c.text).join('');
      const proposal = modelProposal(JSON.parse(text),input);
      return reply(200,{...proposal,model:'gpt-5.4-mini',availability:calendarDemo ? 'demo' : availability});
    } catch { return reply(502,{error:'הצעת ה־AI לא עברה בדיקה. היומן לא השתנה.'}); }
  } catch { return reply(503,{error:'עוזר ה־AI לא הצליח להשלים את הבקשה. היומן לא השתנה.'}); }
});
