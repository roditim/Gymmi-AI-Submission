"use strict";

let googleSyncRequest = 0;
let googleSyncBusy = false;
let googleSyncConnected = false;
let googleSyncCallback = null;
let googleConnection = 'guest';
let googleAvailabilityGeneration = 0;
const googleAvailability = new Map();
const googleDemoKey = 'gymmi-google-calendar-demo';
const googleDemoButtons = ['google-demo-dashboard', 'google-demo-calendar', 'google-demo-ai'];
let googleDemoAvailable = false;
let googleDemoEnabled = false;
let googleDemoPreference;

const googleSyncMessages = {
  permission: "ההרשאה ל־Google פגה או שהיומן הוסר. נתק את החיבור וחבר מחדש.",
  changed: "זוהה שינוי בזמן הסנכרון. הפעולה תיבדק שוב בסבב הבא.",
  pending: "יש עוד שינויים לסנכרון. הם ימשיכו בסבב הבא.",
  calendar_full: "יומן Google גדול מדי לסנכרון בגרסה הזאת.",
  journal_full: "אין מקום לאימונים נוספים ביומן Gymmi.",
  temporary: "Google Calendar לא זמין כרגע. הסנכרון ינסה שוב בהמשך.",
  busy: "מתבצע סנכרון. נסה לנתק שוב בעוד רגע.",
  state: "בקשת החיבור פגה. התחל חיבור חדש.",
  unconfigured: "הסנכרון ייפתח אחרי הגדרת ההרשאה של Gymmi ב־Google."
};

function resetGoogleSync() {
  googleSyncRequest += 1;
  googleSyncBusy = false;
  googleSyncConnected = false;
  googleDemoAvailable = false;
  googleDemoEnabled = false;
  googleConnection = activeUser ? 'checking' : 'guest';
  clearGoogleAvailability();
  byId("google-sync-connect").hidden = false;
  byId("google-sync-connect").disabled = !!activeUser;
  byId("google-sync-now").hidden = true;
  byId("google-sync-disconnect").hidden = true;
  byId("google-sync-message").textContent = activeUser ? "בודק זמינות סנכרון…" : "התחבר ל־Gymmi כדי להגדיר סנכרון.";
}

function showGoogleSync(result) {
  googleSyncConnected = result.connected;
  googleConnection = !result.available ? 'unconfigured'
    : result.paused ? 'paused' : result.connected ? 'connected' : 'disconnected';
  const previousDemo = googleDemoEnabled;
  googleDemoAvailable = result.demoAvailable === true && !result.connected;
  if (googleDemoAvailable) {
    try { googleDemoPreference = sessionStorage.getItem(googleDemoKey); }
    catch { /* Keep the preference in memory if tab storage is blocked. */ }
  }
  googleDemoEnabled = googleDemoAvailable && googleDemoPreference !== 'off';
  if (previousDemo !== googleDemoEnabled) clearAIDraft();
  if (previousDemo !== googleDemoEnabled || (!googleDemoEnabled && googleConnection !== 'connected')) clearGoogleAvailability();
  byId("google-sync-connect").disabled = !result.available || googleSyncBusy;
  byId("google-sync-now").hidden = !result.connected;
  byId("google-sync-now").disabled = !result.available || result.paused || googleSyncBusy;
  byId("google-sync-disconnect").hidden = !result.connected;
  byId("google-sync-disconnect").disabled = googleSyncBusy;
  const last = result.lastSync && new Intl.DateTimeFormat("he-IL", {
    dateStyle: "short", timeStyle: "short"
  }).format(new Date(result.lastSync));
  byId("google-sync-message").textContent = result.problem ? (googleSyncMessages[result.problem] || googleSyncMessages.temporary) :
    !result.available ? googleSyncMessages.unconfigured :
    !result.connected ? "בחר בחיבור כדי ליצור יומן Gymmi בחשבון Google שתבחר." :
    last ? "מחובר · סנכרון אחרון " + last : "מחובר · ממתין לסנכרון הראשון.";
  updateAvailabilityViews();
  refreshAI();
}

function canRefreshFromGoogle() {
  return !busy && !accountLoading && !storageProblem &&
    !byId("workout-dialog").open && !byId("editing-id").value &&
    !byId("workout-title").value.trim() && !byId("workout-exercises").value.trim() &&
    byId("ai-proposal").hidden;
}

async function refreshFromGoogle(remoteRevision, user, request) {
  if (remoteRevision <= revision || !canRefreshFromGoogle()) return;
  const previous = revision;
  const journal = await cloud.load(user.id);
  if (request !== googleSyncRequest || activeUser?.id !== user.id ||
      revision !== previous || !canRefreshFromGoogle() || journal.revision <= revision) return;
  state = validate({ version: 1, workouts: journal.workouts });
  revision = journal.revision;
  render();
  loadLeague();
}

async function updateGoogleSync(action = "status", payload = {}) {
  if (!activeUser || accountLoading || googleSyncBusy) return;
  const user = activeUser;
  const request = ++googleSyncRequest;
  googleSyncBusy = true;
  if (action !== "status") {
    byId("google-sync-connect").disabled = true;
    byId("google-sync-now").disabled = true;
    byId("google-sync-disconnect").disabled = true;
  }
  let result;
  try {
    result = await cloud.googleCalendar({ action, ...payload });
    if (request !== googleSyncRequest) return;
    if (action === "start") {
      const destination = new URL(result.url);
      if (destination.origin !== "https://accounts.google.com") throw Error("temporary");
      location.assign(destination.href);
      return;
    }
    if (result.connected) await refreshFromGoogle(result.revision, user, request);
  } catch (error) {
    if (request === googleSyncRequest) {
      byId("google-sync-message").textContent = googleSyncMessages[error.message] || googleSyncMessages.temporary;
      byId("google-sync-connect").disabled = false;
      byId("google-sync-now").disabled = false;
      byId("google-sync-disconnect").disabled = false;
      if (!googleSyncConnected) googleConnection = error.message === 'unconfigured' ? 'unconfigured' : 'error';
      updateAvailabilityViews();
      refreshAI();
    }
  } finally {
    if (request === googleSyncRequest) {
      googleSyncBusy = false;
      if (result && action !== "start") showGoogleSync(result);
    }
  }
}

function syncGoogleAfterAccountChange() {
  if (googleSyncCallback && activeUser) {
    const callback = googleSyncCallback;
    googleSyncCallback = null;
    showView("calendar", false);
    if (callback.error) {
      googleConnection = 'disconnected';
      renderGoogleAvailability();
      refreshAI();
      byId("google-sync-message").textContent = "החיבור ל־Google לא אושר.";
      return;
    }
    updateGoogleSync("finish", callback);
  } else if (activeUser) updateGoogleSync();
}

function clearGoogleAvailability() {
  googleAvailabilityGeneration++;
  googleAvailability.clear();
}

function availabilityMessage(week) {
  const data = googleAvailability.get(week);
  if (googleDemoEnabled) {
    return 'מצב דמו · מחובר ליומן לדוגמה'
      + (data?.reason ? ' · טעינת שעות ההדגמה נכשלה.' : data?.busy ? '' : ' · טוען שעות לדוגמה…');
  }
  const status = {
    guest: 'התחברו ל־Gymmi כדי לחבר את Google Calendar.',
    checking: 'בודק את מצב החיבור ל־Google Calendar…',
    unconfigured: 'Google Calendar עדיין ממתין להגדרת החיבור של Gymmi.',
    disconnected: 'Google Calendar עדיין לא מחובר לחשבון הזה.',
    paused: 'החיבור ל־Google מושהה. ניתן לחבר מחדש ביומן.',
    error: 'מצב החיבור ל־Google Calendar אינו זמין כרגע.',
  };
  if (googleConnection !== 'connected') return status[googleConnection];
  if (data?.busy) return 'מחובר ל־Google Calendar · שעות תפוסות מהיומן הראשי (שעון ישראל)';
  if (data?.reason === 'freebusy_permission') return 'מחובר ל־Google · כדי לראות שעות תפוסות, חברו מחדש ואשרו גישה לזמינות.';
  if (data?.reason) return 'מחובר ל־Google · השעות התפוסות לא נטענו כרגע.';
  return 'מחובר ל־Google · טוען שעות תפוסות…';
}

function showBusyHours(id, entries, includeDate) {
  const list = byId(id);
  list.replaceChildren();
  if (!entries) return;
  for (const [date, blocks] of Object.entries(entries)) {
    if (!blocks.length) continue;
    const row = element('li');
    if (includeDate) row.append(element('strong', new Intl.DateTimeFormat('he-IL', {
      weekday: 'short', day: 'numeric', month: 'numeric',
    }).format(parseDate(date))));
    const times = element('bdi', blocks.map(block => block.start + '–' + block.end).join(' · '));
    times.dir = 'ltr';
    row.append(times); list.append(row);
  }
  if (!list.children.length) list.append(element('li', 'אין שעות תפוסות בטווח הזה.'));
}

function renderGoogleAvailability() {
  const planWeek = byId('week-start').value;
  const dayWeek = calendarDay ? monday(calendarDay) : planWeek;
  const weekly = googleAvailability.get(planWeek)?.busy;
  const daily = googleAvailability.get(dayWeek)?.busy;
  byId('google-dashboard').hidden = byId('view-plan').hidden;
  byId('google-sync-title').textContent = googleDemoEnabled ? 'Google Calendar · מצב דמו' : 'סנכרון עם Google Calendar';
  byId('google-sync-details').hidden = googleDemoEnabled;
  byId('google-sync-connect').hidden = googleDemoEnabled || googleSyncConnected;
  byId('google-sync-message').hidden = googleDemoEnabled;
  byId('google-sync-demo-message').hidden = !googleDemoEnabled;
  for (const id of googleDemoButtons) {
    const button = byId(id);
    button.hidden = !googleDemoAvailable;
    button.disabled = busy || accountLoading;
    button.setAttribute('aria-pressed', String(googleDemoEnabled));
    button.textContent = googleDemoEnabled ? 'כבה הדמיית Google Calendar' : 'הפעל הדמיית Google Calendar';
  }
  byId('google-dashboard-status').textContent = availabilityMessage(planWeek);
  byId('ai-google-status').textContent = availabilityMessage(planWeek);
  byId('google-calendar-status').textContent = availabilityMessage(dayWeek);
  showBusyHours('google-week-busy', weekly, true);
  showBusyHours('ai-demo-busy', googleDemoEnabled ? weekly : null, true);
  showBusyHours('google-day-busy', daily && calendarDay ? {[calendarDay]: daily[calendarDay] || []} : null, false);
  for (const day of document.querySelectorAll('#calendar-days [data-date]')) {
    const hasBusy = Boolean(daily?.[day.dataset.date]?.length);
    day.toggleAttribute('data-google-busy', hasBusy);
    if (hasBusy) day.setAttribute('aria-description', googleDemoEnabled ? 'יש שעות תפוסות לדוגמה' : 'יש שעות תפוסות ב־Google Calendar');
    else day.removeAttribute('aria-description');
  }
}

async function loadGoogleAvailability(week) {
  if (!activeUser || (!googleDemoEnabled && googleConnection !== 'connected') || !week) return;
  const current = googleAvailability.get(week);
  if (current?.pending || current?.until > Date.now()) return;
  const generation = googleAvailabilityGeneration;
  const demo = googleDemoEnabled;
  googleAvailability.set(week, {pending: true});
  let result;
  try {
    result = await cloud.googleCalendar({action: 'availability', weekStart: week, demo});
    if (result.available && (result.source === 'demo') !== demo) throw Error('Wrong calendar source');
  } catch {
    result = {reason: 'temporary'};
  }
  if (generation !== googleAvailabilityGeneration) return;
  googleAvailability.set(week, {busy: result.available ? result.busy : null,
    reason: result.available ? null : result.reason || 'temporary', until: Date.now() + 60000});
  if (googleAvailability.size > 10) {
    const old = [...googleAvailability].find(([key, value]) => key !== week && !value.pending);
    if (old) googleAvailability.delete(old[0]);
  }
  renderGoogleAvailability();
}

function updateAvailabilityViews() {
  renderGoogleAvailability();
  if (!byId('view-plan').hidden || byId('ai-dialog').open) loadGoogleAvailability(byId('week-start').value);
  if (!byId('view-calendar').hidden && calendarDay) loadGoogleAvailability(monday(calendarDay));
}

function toggleGoogleDemo() {
  if (!googleDemoAvailable || !activeUser || busy || accountLoading) return;
  googleDemoEnabled = !googleDemoEnabled;
  googleDemoPreference = googleDemoEnabled ? 'on' : 'off';
  try { sessionStorage.setItem(googleDemoKey, googleDemoPreference); }
  catch { /* Keep the preference in memory if tab storage is blocked. */ }
  clearAIDraft();
  byId('ai-feedback').hidden = true;
  clearGoogleAvailability();
  updateAvailabilityViews();
  refreshAI();
}

function setupGoogleSync() {
  const query = new URLSearchParams(location.search);
  const oauthState = query.get("state");
  if (oauthState?.startsWith("gymmi_") && (query.has("code") || query.has("error"))) {
    googleSyncCallback = { state: oauthState, code: query.get("code"), error: query.has("error") };
    for (const key of ["state", "code", "error", "error_description", "error_uri", "scope", "authuser", "prompt", "hd"]) query.delete(key);
    history.replaceState(null, "", location.pathname + (query.size ? "?" + query : "") + location.hash);
  }
  byId("google-sync-connect").addEventListener("click", () => {
    if (activeUser) updateGoogleSync("start");
    else openAccount();
  });
  byId("google-sync-now").addEventListener("click", () => updateGoogleSync("sync"));
  byId("google-sync-disconnect").addEventListener("click", () => {
    if (confirm("להפסיק את הסנכרון? היומן שכבר נוצר ב־Google יישאר בחשבון Google שלך.")) {
      updateGoogleSync("disconnect");
    }
  });
  for (const id of ['google-dashboard-settings', 'ai-google-settings']) byId(id).addEventListener('click', () => {
    if (byId('ai-dialog').open) byId('ai-dialog').close();
    showView('calendar');
    focusCurrentView();
  });
  for (const id of googleDemoButtons) byId(id).addEventListener('click', toggleGoogleDemo);
  setInterval(() => {
    if (!document.hidden && googleSyncConnected) updateGoogleSync();
  }, 60000);
}
