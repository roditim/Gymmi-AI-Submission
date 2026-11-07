"use strict";

let leagueRequest = 0;
let leagueUpdating = false;

function renderExperience() {
  const earned = state.workouts.filter(workout => workout.status === "completed").length * 100;
  byId("exp-level").textContent = "רמה " + (1 + Math.floor(earned / 500));
  byId("exp-total").textContent = earned + " EXP";
  byId("exp-progress").value = earned % 500;
  byId("exp-next").textContent = (500 - earned % 500) + " EXP לרמה הבאה";
}

function resetLeague() {
  leagueRequest += 1;
  leagueUpdating = false;
  byId("league-form").reset();
  byId("league-nickname").placeholder = "למשל: GymmiRunner";
  byId("league-join").disabled = false;
  byId("league-leave").disabled = false;
  byId("league-refresh").disabled = false;
  byId("league-member").hidden = true;
  byId("league-guest").hidden = !!activeUser;
  byId("league-leave").hidden = true;
  byId("league-body").replaceChildren();
  byId("league-table").hidden = true;
  byId("league-status").textContent = "";
}

async function loadLeague() {
  if (!byId("league-panel").open || accountLoading) return;
  const request = ++leagueRequest;
  const user = activeUser;
  byId("league-guest").hidden = !!user;
  byId("league-member").hidden = !user;
  if (!user) return;

  try {
    const { profile, rows } = await cloud.loadLeague(user.id);
    if (request !== leagueRequest) return;
    byId("league-nickname").placeholder = profile?.nickname || "למשל: GymmiRunner";
    byId("league-leave").hidden = !profile;
    byId("league-join").textContent = profile ? "עדכן כינוי" : "הצטרף לדירוג";
    const list = byId("league-body");
    list.replaceChildren();
    for (const row of rows) {
      const tr = element("tr");
      tr.append(
        element("td", String(row.place)),
        element("td", row.nickname + (row.is_you ? " (אני)" : "")),
        element("td", String(row.weekly_exp))
      );
      list.append(tr);
    }
    byId("league-table").hidden = !rows.length;
    byId("league-status").textContent = rows.length ? "" : "אין עדיין משתתפים בדירוג.";
  } catch {
    if (request === leagueRequest) {
      byId("league-table").hidden = true;
      byId("league-status").textContent = "לא ניתן לטעון את הדירוג. אפשר לנסות לרענן.";
    }
  }
}

async function saveLeagueMembership(nickname) {
  if (!activeUser || accountLoading || leagueUpdating) return;
  const generation = accountGeneration;
  leagueUpdating = true;
  byId("league-join").disabled = true;
  byId("league-leave").disabled = true;
  byId("league-refresh").disabled = true;
  leagueRequest += 1;

  try {
    await cloud.saveLeagueMembership(activeUser.id, nickname);
    if (generation !== accountGeneration) return;
    byId("league-form").reset();
    await loadLeague();
  } catch {
    if (generation === accountGeneration) {
      byId("league-status").textContent = "השינוי בדירוג לא נשמר. אפשר לנסות שוב.";
    }
  } finally {
    if (generation === accountGeneration) {
      leagueUpdating = false;
      byId("league-join").disabled = false;
      byId("league-leave").disabled = false;
      byId("league-refresh").disabled = false;
    }
  }
}

function setupLeague() {
  byId("league-panel").addEventListener("toggle", loadLeague);
  byId("league-calendar").addEventListener("click", () => {
    showView("calendar");
    focusCurrentView();
  });
  byId("league-sign-in").addEventListener("click", openAccount);
  byId("league-refresh").addEventListener("click", loadLeague);
  byId("league-leave").addEventListener("click", () => saveLeagueMembership(null));
  byId("league-form").addEventListener("submit", event => {
    event.preventDefault();
    const nickname = byId("league-nickname").value.trim();
    if (!/^[A-Za-z0-9א-ת _-]{3,24}$/.test(nickname)) {
      byId("league-status").textContent = "בחר כינוי של 3–24 תווים בעברית או באנגלית, עם ספרות, רווח, מקף או קו תחתון.";
      return;
    }
    saveLeagueMembership(nickname);
  });
}

