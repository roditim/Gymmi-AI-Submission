"use strict";

let googleSyncRequest = 0;
let googleSyncBusy = false;
let googleSyncConnected = false;
let googleSyncCallback = null;

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
  byId("google-sync-connect").hidden = false;
  byId("google-sync-connect").disabled = !!activeUser;
  byId("google-sync-now").hidden = true;
  byId("google-sync-disconnect").hidden = true;
  byId("google-sync-message").textContent = activeUser ? "בודק זמינות סנכרון…" : "התחבר ל־Gymmi כדי להגדיר סנכרון.";
}

function showGoogleSync(result) {
  googleSyncConnected = result.connected;
  byId("google-sync-connect").hidden = result.connected;
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
      byId("google-sync-message").textContent = "החיבור ל־Google לא אושר.";
      return;
    }
    updateGoogleSync("finish", callback);
  } else if (!byId("view-calendar").hidden) updateGoogleSync();
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
  setInterval(() => {
    if (!document.hidden && googleSyncConnected) updateGoogleSync();
  }, 60000);
}
