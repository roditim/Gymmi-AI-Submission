"use strict";

// Guest data stays local. A signed-in account uses its own cloud journal.
const STORAGE_KEY = "gymmi-workouts-v1";
const statusNames = { planned: "מתוכנן", completed: "הושלם", skipped: "דילגתי" };
const byId = id => document.getElementById(id);
let state = { version: 1, workouts: [] };
let storageProblem = false;
let activeUser = null;
let revision = 0;
let busy = false;
let accountLoading = false;
let accountGeneration = 0;
let authClient;
let authReady = false;
let noticeTimer;

function setBusy(value) {
  busy = value || accountLoading;
  for (const el of document.querySelectorAll("#workout-form input, #workout-form textarea, #workout-form button, #auth-form input, #auth-form button, #account-actions button, #ai-form textarea, #ai-form button, #import-data, #reset-data, #example-plan")) el.disabled = busy;
  byId("save-workout").disabled = busy || storageProblem;
  byId("example-plan").disabled = busy || storageProblem;
  byId("sign-in").disabled = busy || !authReady;
  byId("sign-up").disabled = busy || !authReady;
  render();
}
function readGuest() {
  state = { version: 1, workouts: [] }; storageProblem = false;
  byId("storage-error").hidden = true;
  try { const saved = localStorage.getItem(STORAGE_KEY); if (saved) state = validate(JSON.parse(saved)); }
  catch (error) {
    storageProblem = true; byId("storage-error").textContent = "לא ניתן לקרוא את היומן המקומי. הנתונים לא הוחלפו. אפשר להוריד גיבוי ולשחזר קובץ תקין במסך גיבוי ונתונים.";
    byId("storage-error").hidden = false;
  }
}
async function changeAccount(user) {
  const generation = ++accountGeneration;
  accountLoading = true;
  activeUser = user; revision = 0; cancelEdit();
  state = { version: 1, workouts: [] }; storageProblem = !!user;
  byId("storage-error").hidden = true;
  byId("auth-form").hidden = !!user; byId("account-actions").hidden = !user;
  byId("reset-data").textContent = user ? "מחק את האימונים בחשבון" : "מחק את הנתונים בדפדפן הזה";
  byId("account-status").textContent = user ? "טוען את היומן מהענן…" : "מצב אורח — היומן נשמר בדפדפן הזה.";
  setBusy(true);
  try {
    if (user) {
      const journal = await cloud.load(user.id);
      if (generation !== accountGeneration) return;
      state = validate({ version: 1, workouts: journal.workouts }); revision = journal.revision; storageProblem = false;
      byId("account-status").textContent = "מחובר: " + user.email + " · שמירה בענן";
      byId('account-dialog').close();
    } else readGuest();
  } catch (error) {
    if (generation === accountGeneration) {
      notice("היומן לא נטען. העריכה חסומה כדי לשמור על הנתונים בענן. נסה לטעון מחדש. " + error.message, true);
      byId("account-status").textContent = "מחובר · טעינת הענן נכשלה";
    }
  } finally { if (generation === accountGeneration) { accountLoading = false; setBusy(false); } }
}

function isoDate(value) {
  return value.getFullYear() + "-" + String(value.getMonth() + 1).padStart(2, "0") + "-" + String(value.getDate()).padStart(2, "0");
}
function today() { return isoDate(new Date()); }
function parseDate(text) {
  if (typeof text !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error("תאריך לא תקין");
  const [year, month, day] = text.split("-").map(Number);
  const value = new Date(year, month - 1, day, 12);
  if (isoDate(value) !== text) throw new Error("תאריך לא תקין");
  return value;
}
function shiftDate(text, days) {
  const value = parseDate(text); value.setDate(value.getDate() + days); return isoDate(value);
}
function monday(text) {
  const value = parseDate(text); return shiftDate(text, -((value.getDay() + 6) % 7));
}
function notice(text, isError = false) {
  const el = byId("message");el.replaceChildren(element('span',text));el.hidden=false;
  const close=element('button','×','notice-close');close.type='button';close.setAttribute('aria-label','סגור הודעה');close.addEventListener('click',()=>{el.hidden=true;});el.append(close);
  clearTimeout(noticeTimer);if(!isError)noticeTimer=setTimeout(()=>{el.hidden=true;},7000);
  el.setAttribute("role", isError ? "alert" : "status");
  for (const [dialogId, feedbackId] of [['workout-dialog','editor-feedback'],['account-dialog','account-feedback']]) {
    if(byId(dialogId).open){const feedback=byId(feedbackId);feedback.textContent=text;feedback.hidden=false;feedback.setAttribute('role',isError?'alert':'status');}
  }
}
function validate(payload) {
  if (!payload || payload.version !== 1 || !Array.isArray(payload.workouts) || payload.workouts.length > 1000) throw new Error("פורמט גיבוי לא נתמך");
  const ids = new Set();
  for (const row of payload.workouts) {
    if (!row || typeof row.id !== "string" || !row.id || row.id.length > 100 || ids.has(row.id)) throw new Error("מזהה אימון חסר או כפול");
    ids.add(row.id); parseDate(row.date);
    if (typeof row.title !== "string" || !row.title.trim() || row.title.length > 100) throw new Error("שם אימון לא תקין");
    if (typeof row.exercises !== "string" || !row.exercises.trim() || row.exercises.length > 2000) throw new Error("פרטי אימון חסרים או ארוכים מדי");
    if (!Number.isInteger(row.minutes) || row.minutes < 5 || row.minutes > 180) throw new Error("משך האימון צריך להיות בין 5 ל־180 דקות");
    if (!Object.hasOwn(statusNames, row.status)) throw new Error("סטטוס אימון לא תקין");
    if (row.status !== "planned" && row.date > today()) throw new Error("אין לסמן אימון עתידי כהושלם או כדילוג");
    if (row.status === "planned" ? row.resolvedAt !== null : typeof row.resolvedAt !== "string" || !Number.isFinite(Date.parse(row.resolvedAt))) throw new Error("זמן הסימון אינו מתאים לסטטוס");
  }
  return payload;
}
async function save(next, recover = false) {
  if (busy) return false;
  const generation = accountGeneration;
  if (storageProblem && !(recover && !activeUser)) { notice("השמירה חסומה עד לטיפול בטעינת הנתונים.", true); return false; }
  setBusy(true);
  try {
    validate(next);
    if (activeUser) {
      const nextRevision = await cloud.save(activeUser.id, next.workouts, revision);
      if (generation !== accountGeneration) return false;
      revision = nextRevision;
    } else localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    state = next; storageProblem = false; byId("storage-error").hidden = true; render(); return true;
  }
  catch (error) { notice("השינוי לא נשמר: " + error.message, true); return false; }
  finally { if (generation === accountGeneration) setBusy(false); }
}
function update(id, changes) {
  const next = { version: 1, workouts: state.workouts.map(row => row.id === id ? { ...row, ...changes } : row) };
  return save(next);
}
async function mark(id, status) {
  const row = state.workouts.find(w => w.id === id);
  if (!row || row.status === status) return;
  if (status !== "planned" && row.date > today()) { notice("אפשר לסמן רק אימון של היום או של יום קודם.", true); return; }
  if (await update(id, { status, resolvedAt: status === "planned" ? null : new Date().toISOString() })) notice("סטטוס האימון נשמר.");
}
function element(tag, text, className) {
  const el = document.createElement(tag); if (text !== undefined) el.textContent = text;
  if (className) el.className = className; return el;
}
function action(text, callback, disabled = false, className = "secondary") {
  const button = element("button", text, className); button.type = "button"; button.disabled = disabled || busy;
  button.addEventListener("click", callback); return button;
}
function editWorkout(row) {
  showView('plan');
  byId("editing-id").value = row.id; byId("workout-title").value = row.title;
  byId("workout-date").value = row.date; byId("workout-minutes").value = row.minutes;
  byId("workout-exercises").value = row.exercises; byId("save-workout").textContent = "שמור שינויים";
  byId("editor-heading").textContent = "עריכת אימון"; byId("cancel-edit").hidden = false;
  presentWorkoutEditor();
}
function cancelEdit() {
  byId("workout-form").reset(); byId("editing-id").value = ""; byId("workout-date").value = today();
  byId("save-workout").textContent = "הוסף אימון"; byId("editor-heading").textContent = "הוספת אימון";
  byId("cancel-edit").hidden = true;
  byId('workout-dialog').close();
}
function workoutCard(row, history = false) {
  const card = element("article", undefined, "workout " + row.status); card.dataset.id = row.id; card.dataset.date=row.date;card.tabIndex=-1;
  const heading = element("div", undefined, "quest-header");
  heading.append(element("p", new Intl.DateTimeFormat("he-IL", { weekday: "long", day: "numeric", month: "long" }).format(parseDate(row.date)), "date"));
  heading.append(element("span", statusNames[row.status], "status-badge")); card.append(heading);
  card.append(element("h3", row.title));
  card.append(element("p", row.minutes + " דקות מתוכננות", "duration"));
  const routine=element('details',undefined,'routine-details');routine.append(element('summary','פרטי האימון'),element('p',row.exercises));card.append(routine);
  if (!history) {
    const buttons = element("div", undefined, "actions");
    buttons.append(action("סמן הושלם", () => mark(row.id, "completed"), storageProblem || row.date > today() || row.status === "completed", ""));
    buttons.append(action("ערוך", () => editWorkout(row), storageProblem));
    const menu=element('details',undefined,'card-menu'),menuSummary=element('summary','•••');menuSummary.setAttribute('aria-label','אפשרויות לאימון '+row.title);menu.append(menuSummary);
    const options=element('div',undefined,'card-menu-options');
    options.append(action("דילגתי", () => mark(row.id, "skipped"), storageProblem || row.date > today() || row.status === "skipped"));
    options.append(action("בטל סימון", () => mark(row.id, "planned"), storageProblem || row.status === "planned"));
    options.append(action("מחק", async () => { if (confirm("למחוק את האימון הזה מהיומן?")) {
      if (await save({ version: 1, workouts: state.workouts.filter(w => w.id !== row.id) })) { cancelEdit(); notice("האימון נמחק."); }
    } }, storageProblem, "danger"));menu.append(options);buttons.append(menu);card.append(buttons);
  }
  return card;
}
function render() {
  refreshAI();
  const start = byId("week-start").value; const end = shiftDate(start, 7);
  const rows = state.workouts.filter(w => w.date >= start && w.date < end).sort((a, b) => a.date.localeCompare(b.date));
  const completed = rows.filter(w => w.status === "completed").length;
  byId("planned-count").textContent = rows.length; byId("completed-count").textContent = completed;
  byId("skipped-count").textContent = rows.filter(w => w.status === "skipped").length;
  byId("week-progress").value = rows.length ? completed / rows.length : 0;
  byId("progress-text").textContent = rows.length ? "הושלמו " + completed + " מתוך " + rows.length + " אימונים השבוע" : "עוד לא נוספו אימונים לשבוע הזה";
  const list = byId("workout-list"); list.replaceChildren();
  if (!rows.length) {const empty=element('div',undefined,'empty');empty.append(element('span','＋','empty-mark'),element('h3','מקום לאימון הראשון שלך'),element('p','בחר אימון אחד לשבוע הזה. את השאר אפשר לבנות בהמשך.'),action('לתכנן אימון',()=>openWorkoutEditor(),storageProblem));list.append(empty);}
  for (const row of rows) list.append(workoutCard(row));
  const history = byId("history-list"); history.replaceChildren();
  const past = state.workouts.filter(w => w.status !== "planned").sort((a, b) => b.date.localeCompare(a.date));
  if (!past.length) history.append(element("p", "אימונים שהושלמו או שסומנו כדילוג יופיעו כאן.", "empty"));
  for (const row of past) history.append(workoutCard(row, true));
  renderCalendar();
  refreshUX();
}
byId("workout-form").addEventListener("submit", async event => {
  event.preventDefault(); const id = byId("editing-id").value;
  const fields = { title: byId("workout-title").value.trim(), date: byId("workout-date").value,
    minutes: Number(byId("workout-minutes").value), exercises: byId("workout-exercises").value.trim() };
  let saved;
  if (id) saved = await update(id, fields);
  else saved = await save({ version: 1, workouts: [...state.workouts, { id: crypto.randomUUID(), ...fields, status: "planned", resolvedAt: null }] });
  if (saved) { byId("week-start").value = monday(fields.date); cancelEdit(); render(); notice("האימון נשמר בתוכנית."); }
});
byId("cancel-edit").addEventListener("click", cancelEdit);
byId("example-plan").addEventListener("click", async () => {
  const start = byId("week-start").value; const end = shiftDate(start, 7);
  if (state.workouts.some(w => w.date >= start && w.date < end)) { notice("כבר קיימים אימונים בשבוע הזה. אפשר להוסיף או לערוך אימון בנפרד."); return; }
  const templates = [[0, "הליכה", "הליכה במסלול לבחירתך. אפשר לערוך את פרטי האימון."],
    [2, "אימון כוח", "הוסף כאן את התרגילים מתוך התוכנית שלך או מהתוכנית שקיבלת ממאמן."],
    [4, "תנועתיות", "הוסף כאן את תרגילי התנועתיות מתוך התוכנית שלך."]];
  const added = templates.map(([offset, title, exercises]) => ({ id: crypto.randomUUID(), date: shiftDate(start, offset), title, exercises, minutes: 30, status: "planned", resolvedAt: null }));
  if (await save({ version: 1, workouts: [...state.workouts, ...added] })) notice("נוספו שלושה אימונים לדוגמה. אפשר לערוך אותם.");
});
byId("week-start").addEventListener("change", () => { try { byId("week-start").value = monday(byId("week-start").value); render(); } catch (error) { notice(error.message, true); } });
byId("previous-week").addEventListener("click", () => { byId("week-start").value = shiftDate(byId("week-start").value, -7); render(); });
byId("next-week").addEventListener("click", () => { byId("week-start").value = shiftDate(byId("week-start").value, 7); render(); });
byId("current-week").addEventListener("click", () => { byId("week-start").value = monday(today()); render(); });
for (const button of document.querySelectorAll("[data-view]")) button.addEventListener("click", () => { showView(button.dataset.view); focusCurrentView(); });
byId("export-data").addEventListener("click", () => {
  try {
  if (activeUser && storageProblem) throw new Error("יש לטעון את היומן בענן לפני ייצוא.");
  const raw = storageProblem ? localStorage.getItem(STORAGE_KEY) : JSON.stringify(state, null, 2);
  const url = URL.createObjectURL(new Blob([raw || "{}"], { type: "application/json" }));
  const link = element("a"); link.href = url; link.download = "gymmi-backup-" + today() + ".json";
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) { notice("לא ניתן לייצא את הנתונים: " + error.message, true); }
});
byId("import-data").addEventListener("change", async event => {
  const file = event.target.files[0]; if (!file) return;
  const generation = accountGeneration;
  try {
    if (file.size > 1000000) throw new Error("קובץ הגיבוי גדול מדי");
    const imported = validate(JSON.parse(await file.text()));
    if (generation !== accountGeneration) throw new Error("החשבון השתנה בזמן קריאת הקובץ. בחר שוב את הגיבוי עבור היומן הרצוי.");
    if (confirm("נמצאו " + imported.workouts.length + " אימונים בגיבוי. להחליף את היומן הנוכחי?")) {
      if (await save(imported, true)) { cancelEdit(); render(); notice("הגיבוי שוחזר."); }
    }
  } catch (error) { notice("הגיבוי לא שוחזר: " + error.message, true); }
  event.target.value = "";
});
byId("reset-data").addEventListener("click", async () => {
  if (!confirm(activeUser ? "למחוק את כל האימונים בחשבון בענן? כדאי להוריד גיבוי קודם." : "למחוק את כל אימוני Gymmi בדפדפן הזה? כדאי להוריד גיבוי קודם.")) return;
  if (await save({ version: 1, workouts: [] }, true)) { cancelEdit(); notice("היומן אופס."); }
});
byId("week-start").value = monday(today()); byId("workout-date").value = today();
readGuest(); setBusy(false);

async function authenticate(signUp) {
  if (busy || !authClient || !byId("auth-form").reportValidity()) return;
  setBusy(true);
  try {
    const credentials = { email: byId("auth-email").value.trim(), password: byId("auth-password").value };
    const result = signUp ? await authClient.auth.signUp(credentials) : await authClient.auth.signInWithPassword(credentials);
    if (result.error) throw result.error;
    byId("auth-password").value = "";
    notice(signUp ? (result.data.session ? "החשבון נוצר ונכנסת בהצלחה. כתובת המייל אינה מאומתת ב־MVP הלימודי." : "לא התקבלה כניסה אוטומטית. נסה להיכנס או בדוק את הגדרות ההרשמה.") : "הכניסה הצליחה.");
  } catch (error) { notice("הפעולה לא הושלמה: " + error.message, true); }
  finally { setBusy(false); }
}
byId("auth-form").addEventListener("submit", event => { event.preventDefault(); authenticate(false); });
byId("sign-up").addEventListener("click", () => authenticate(true));
byId("reload-cloud").addEventListener("click", () => { if (confirm("לטעון את הגרסה האחרונה מהענן? טיוטת עריכה בטופס תיסגר.")) changeAccount(activeUser); });
byId("upload-local").addEventListener("click", async () => {
  try {
    const local = validate(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{"version":1,"workouts":[]}'));
    if (!local.workouts.length) { notice("אין אימונים ביומן המקומי להעברה."); return; }
    if (confirm("להחליף את יומן החשבון ב־" + local.workouts.length + " אימונים מהדפדפן הזה? היומן המקומי יישאר כגיבוי.")) {
      if (await save(local)) { cancelEdit(); notice("היומן הועבר לחשבון. העותק המקומי נשאר בדפדפן."); }
    }
  } catch (error) { notice("היומן המקומי לא הועבר: " + error.message, true); }
});
byId("sign-out").addEventListener("click", async () => {
  if (busy) return;
  setBusy(true);
  try { const { error } = await authClient.auth.signOut({ scope: "local" }); if (error) throw error; notice("יצאת מהחשבון במכשיר הזה."); }
  catch (error) { notice("היציאה נכשלה: " + error.message, true); }
  finally { setBusy(false); }
});
setupAI();
setupCalendar();
setupUX();
(async () => {
  try {
    // The auth SDK also needs storage. Avoid starting it when access is denied.
    localStorage.getItem(STORAGE_KEY);
    await new Promise((resolve, reject) => {
      const script = document.createElement("script"); script.src = "vendor/supabase.js";
      script.onload = resolve; script.onerror = () => reject(new Error("טעינת חיבור הענן נכשלה"));
      document.head.append(script);
    });
    authClient = cloud.connect();
    // Do not await Supabase queries inside its synchronous auth callback.
    authClient.auth.onAuthStateChange((event, session) => {
      const user = session?.user || null;
      if (user?.id !== activeUser?.id || event === "INITIAL_SESSION" && user) setTimeout(() => changeAccount(user), 0);
    });
    const { error } = await authClient.auth.getSession(); if (error) throw error;
    authReady = true; setBusy(false);
  } catch (error) {
    byId("account-status").textContent = "חיבור החשבון אינו זמין. אפשר להמשיך במצב אורח.";
    byId("sign-in").disabled = true; byId("sign-up").disabled = true;
  }
})();
