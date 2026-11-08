"use strict";
// AI proposes dates only. Existing save() remains the single persistence path.
let aiDraft = null;
function clearAIDraft() {
  aiDraft = null;
  byId('ai-proposal').hidden = true;
  byId('ai-assignments').replaceChildren(); byId('ai-warnings').replaceChildren();
}
function refreshAI() {
  if (aiDraft && (aiDraft.userId !== activeUser?.id || aiDraft.week !== byId('week-start').value || aiDraft.base !== JSON.stringify(state))) clearAIDraft();
  byId('ai-generate').disabled = busy || storageProblem || !activeUser || !authReady;
  byId('ai-apply').disabled = busy || !aiDraft?.proposal.assignments.length;
  byId('ai-dismiss').disabled = busy;
  byId('ai-status').textContent = activeUser ? 'הצע שיבוץ לאימונים שטרם סומנו בשבוע הנבחר. עד 3 בקשות ביום לחשבון, בכפוף למכסת ההדגמה.' : 'התחבר לחשבון כדי לקבל הצעת שיבוץ לאימונים שלך.';
}
function checkAIResult(proposal, rows, dates) {
  if (!proposal || typeof proposal.summary !== 'string' || proposal.summary.length > 800 || !Array.isArray(proposal.assignments) || proposal.assignments.length > rows.length || !Array.isArray(proposal.warnings) || proposal.warnings.length > 7 || proposal.warnings.some(s=>typeof s !== 'string' || s.length > 300)) throw Error('התקבלה הצעה לא תקינה. היומן לא השתנה.');
  const ids = new Set(), usedDates = new Set();
  for (const item of proposal.assignments) {
    if (!item || !rows.some(w=>w.id===item.workoutId) || !dates.includes(item.date) || item.date < today() || ids.has(item.workoutId) || usedDates.has(item.date) || typeof item.reason !== 'string' || item.reason.length > 300) throw Error('התקבלה הצעה לא תקינה. היומן לא השתנה.');
    ids.add(item.workoutId); usedDates.add(item.date);
  }
  return proposal;
}
function setupAI() {
  byId('ai-preferences').addEventListener('input', () => { clearAIDraft(); refreshAI(); byId('ai-feedback').hidden = true; });
  byId('ai-dismiss').addEventListener('click', () => { clearAIDraft(); refreshAI(); notice('ההצעה בוטלה. היומן לא השתנה.'); });
  byId('ai-form').addEventListener('submit', async event => {
    event.preventDefault(); if (busy || !activeUser || storageProblem) return;
    if (byId('workout-title').value.trim() || byId('workout-exercises').value.trim()) { notice('סיים את עריכת האימון או בטל אותה לפני בקשת שיבוץ.',true); return; }
    clearAIDraft();
    const week = byId('week-start').value;
    const dates = Array.from({length:7},(_,i)=>shiftDate(week,i));
    const rows = state.workouts.filter(w=>w.status==='planned' && dates.includes(w.date));
    if (!rows.length || rows.length > 7) { notice('הוסף לתוכנית בין אימון אחד ל־7 אימונים שטרם סומנו בשבוע הנבחר.',true); return; }
    const preferences = byId('ai-preferences').value.trim();
    const base = JSON.stringify(state), userId = activeUser.id, generation = accountGeneration;
    setBusy(true); notice('עוזר ה־AI מכין הצעה. עדיין לא מתבצעת שמירה…');
    try {
      const proposal = await cloud.plan({weekStart:week,preferences,workoutIds:rows.map(w=>w.id)});
      if (generation !== accountGeneration || week !== byId('week-start').value || base !== JSON.stringify(state)) throw Error('היומן או החשבון השתנו בזמן הבקשה. בקש הצעה חדשה.');
      checkAIResult(proposal,rows,dates);
      aiDraft = {proposal,week,base,userId};
      byId('ai-summary').textContent = proposal.summary;
      for (const item of proposal.assignments) {
        const workout = rows.find(w=>w.id===item.workoutId);
        const itemRow=element('li');
        itemRow.append(element('strong',workout.title),element('p','תאריך נוכחי: '+workout.date+' · תאריך מוצע: '+item.date),element('p',item.reason));
        byId('ai-assignments').append(itemRow);
      }
      for (const warning of proposal.warnings) byId('ai-warnings').append(element('li',warning));
      byId('ai-proposal').hidden = false; notice('התקבלה הצעת AI. בדוק אותה לפני אישור; היומן עדיין לא השתנה.');
      if (byId('ai-dialog').open) byId('ai-proposal-heading').focus();
    } catch (error) { notice(error.message,true); }
    finally { setBusy(false); }
  });
  byId('ai-apply').addEventListener('click', async () => {
    if (busy || !aiDraft?.proposal.assignments.length) return;
    if (byId('workout-title').value.trim() || byId('workout-exercises').value.trim()) { notice('סיים את עריכת האימון או בטל אותה לפני אישור השיבוץ.',true); return; }
    if (aiDraft.userId !== activeUser?.id || aiDraft.base !== JSON.stringify(state) || aiDraft.week !== byId('week-start').value) { clearAIDraft(); notice('היומן השתנה. בקש הצעה חדשה.',true); return; }
    if (!confirm('לשמור את התאריכים שהוצעו? רק האימונים המופיעים בהצעה ישתנו.')) return;
    const assignments = aiDraft.proposal.assignments;
    const next = {version:1,workouts:state.workouts.map(row => {
      const item = assignments.find(a=>a.workoutId===row.id); return item ? {...row,date:item.date} : row;
    })};
    if (await save(next)) { clearAIDraft(); cancelEdit(); refreshAI(); byId('ai-dialog').close(); notice('השיבוץ שאישרת נשמר בחשבון.'); }
  });
}
