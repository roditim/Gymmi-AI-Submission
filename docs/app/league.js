"use strict";

let leagueRequest = 0;
let leagueUpdating = false;
let experienceTimer;
let experienceFlight;
const levelSize = 500;

function experienceTotal() {
  return state.workouts.filter(workout => workout.status === 'completed').length * 100;
}

function updateExperienceMeter(meter, value) {
  meter.setAttribute('aria-valuenow', value);
  meter.firstElementChild.style.width = (value / levelSize * 100) + '%';
}

function renderExperience() {
  const earned = experienceTotal();
  const level = 'רמה ' + (1 + Math.floor(earned / levelSize));
  byId("exp-level").textContent = level;
  byId("exp-total").textContent = earned + " EXP";
  byId("exp-progress").value = earned % levelSize;
  byId("exp-next").textContent = (levelSize - earned % levelSize) + " EXP לרמה הבאה";
  byId('exp-home-label').textContent = level + ' · ' + earned + ' EXP';
  updateExperienceMeter(byId('exp-home-progress'), earned % levelSize);
}

function closeExperienceToast() {
  clearTimeout(experienceTimer);
  experienceFlight?.cancel();
  byId('exp-celebration').hidden = true;
  byId('exp-confetti').replaceChildren();
}

function celebrateExperience(before) {
  const earned = experienceTotal();
  if (earned <= before) return;
  closeExperienceToast();
  const level = 1 + Math.floor(earned / levelSize);
  const levelUp = Math.floor(before / levelSize) < level - 1;
  const points = byId('exp-gain');
  points.textContent = '+' + (earned - before) + ' EXP';
  byId('exp-celebration-text').textContent = levelUp ? 'עלית לרמה ' + level + '!' : 'כל הכבוד, האימון הושלם!';
  byId('exp-celebration-total').textContent = earned + ' EXP מצטבר';
  const toastMeter = byId('exp-celebration-progress');
  updateExperienceMeter(toastMeter, earned % levelSize);
  byId('exp-celebration').hidden = false;
  experienceTimer = setTimeout(closeExperienceToast, 5200);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || !points.animate) return;

  const confetti = byId('exp-confetti');
  for (let i = 0; i < 20; i++) {
    const piece = element('i');
    const angle = i / 20 * Math.PI * 2;
    const radius = 50 + (i % 4) * 20;
    piece.style.setProperty('--x', Math.cos(angle) * radius + 'px');
    piece.style.setProperty('--y', Math.sin(angle) * radius + 'px');
    piece.style.setProperty('--delay', (i % 5) * 28 + 'ms');
    confetti.append(piece);
  }
  const homeMeter = byId('exp-home-progress');
  const bounds = homeMeter.getBoundingClientRect();
  const target = bounds.top >= 0 && bounds.bottom <= innerHeight && bounds.width ? homeMeter : toastMeter;
  const from = points.getBoundingClientRect(), to = target.getBoundingClientRect();
  const token = element('span', points.textContent, 'exp-flight');
  token.setAttribute('aria-hidden', 'true');
  token.style.left = from.left + 'px'; token.style.top = from.top + 'px';
  document.body.append(token);
  experienceFlight = token.animate([
    {opacity: 0, transform: 'translate(0,0) scale(1)'},
    {opacity: 1, offset: .25},
    {opacity: 0, transform: 'translate(' + (to.left + to.width / 2 - from.left - from.width / 2)
      + 'px,' + (to.top - from.top) + 'px) scale(.45)'},
  ], {duration: 720, delay: 300, easing: 'ease-in-out'});
  experienceFlight.finished.then(() => token.remove(), () => token.remove());
  const widths = [{width: before % levelSize / levelSize * 100 + '%'}];
  if (levelUp) widths.push({width: '100%', offset: .77}, {width: '0%', offset: .8});
  widths.push({width: earned % levelSize / levelSize * 100 + '%'});
  for (const meter of new Set([target, homeMeter, toastMeter])) {
    meter.firstElementChild.animate(widths, {duration: 620, delay: 770, easing: 'ease-out', fill: 'backwards'});
  }
}

function resetLeague() {
  closeExperienceToast();
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
  if (byId("view-league").hidden || accountLoading) return;
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
  byId('exp-celebration-close').addEventListener('click', closeExperienceToast);
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

