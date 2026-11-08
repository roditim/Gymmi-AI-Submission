"use strict";

const labels = {
  goal: {general: 'כושר כללי', cut: 'חיטוב', muscle: 'עלייה במסת שריר', strength: 'כוח', endurance: 'סיבולת', mobility: 'תנועתיות'},
  audience: {adults: 'מבוגרים', women: 'נשים', men: 'גברים', children: 'ילדים (דרך הורה או אפוטרופוס)', older: 'גיל שלישי'},
  format: {online: 'אונליין', in_person: 'פנים אל פנים', either: 'שני הפורמטים מתאימים לי', both: 'אונליין ופנים אל פנים'},
  focus: {beginner: 'התחלה הדרגתית', technique: 'טכניקה', consistency: 'התמדה ומעקב', flexible: 'גמישות'},
};
const byId = id => document.getElementById(id);
const client = supabase.createClient(GYMMI_CONFIG.url, GYMMI_CONFIG.publishableKey);
const matchForm = byId('coach-match-form');
const profileForm = byId('coach-profile-form');
const profileDialog = byId('coach-profile');
let userId = null;
let generation = 0;
let directory = [];
let myProfile = null;
let myScores = new Map();
let matches = [];
let ready = false;
let matching = false;
let quizVersion = 0;

function options(select, entries, placeholder) {
  select.replaceChildren(new Option(placeholder, ''));
  for (const [value, label] of entries) select.add(new Option(label, value));
}

function checkboxes(target, name, entries) {
  for (const [value, caption] of entries) {
    const label = document.createElement('label');
    label.className = 'coach-check';
    const input = document.createElement('input');
    Object.assign(input, {type: 'checkbox', name, value});
    label.append(input, caption);
    target.append(label);
  }
}

function renderCard(coach, reason) {
  const card = byId('coach-card').content.firstElementChild.cloneNode(true);
  card.dataset.coachId = coach.id;
  card.querySelector('h3').textContent = coach.display_name;
  card.querySelector('.coach-bio').textContent = coach.bio;
  card.querySelector('.coach-score').textContent = coach.rating_count
    ? '★ ' + Number(coach.rating).toFixed(1) + ' / 5 · ' + coach.rating_count + ' דירוגים'
    : 'עדיין אין דירוגים';
  card.querySelector('.coach-goals').textContent = coach.specialties.map(value => labels.goal[value]).join(' · ');
  card.querySelector('.coach-audience').textContent = coach.audiences.map(value => labels.audience[value]).join(' · ');
  card.querySelector('.coach-format').textContent = labels.format[coach.format] + ' · ' + labels.focus[coach.focus];
  const contact = card.querySelector('.coach-contact');
  const [local, domain] = coach.contact_email.split('@');
  contact.href = 'mailto:' + encodeURIComponent(local) + '@' + domain;
  if (reason) {
    const explanation = card.querySelector('.coach-reason');
    explanation.textContent = reason;
    explanation.hidden = false;
  }
  if (userId && ready && !coach.is_mine) {
    const form = card.querySelector('.coach-rating-form');
    const select = form.elements.score;
    const remove = form.querySelector('.coach-rating-remove');
    options(select, [1, 2, 3, 4, 5].map(score => [score, score]), 'בחרו');
    select.value = myScores.get(coach.id) ?? '';
    remove.hidden = !myScores.has(coach.id);
    form.hidden = false;
    form.addEventListener('submit', event => {
      event.preventDefault();
      saveRating(coach, form, Number(select.value));
    });
    remove.addEventListener('click', () => saveRating(coach, form, null));
  }
  return card;
}

function renderDirectory() {
  const goal = byId('filter-goal').value;
  const audience = byId('filter-audience').value;
  const rows = directory.filter(coach => (!goal || coach.specialties.includes(goal))
    && (!audience || coach.audiences.includes(audience)));
  byId('coach-list').replaceChildren(...rows.map(coach => renderCard(coach)));
  byId('coach-directory-status').textContent = rows.length ? rows.length + ' מאמנים'
    : 'אין כרגע פרופילים מתאימים בספרייה.';
  const cards = matches.flatMap(match => {
    const coach = directory.find(row => row.id === match.id);
    return coach ? [renderCard(coach, match.reason)] : [];
  });
  byId('coach-matches').replaceChildren(...cards);
  byId('coach-matches').hidden = !cards.length;
}

async function loadDirectory() {
  const version = generation;
  const [profiles, personal, scores] = await Promise.all([
    client.rpc('coach_directory'),
    userId ? client.from('coach_profiles').select('*').eq('owner_id', userId).maybeSingle() : {},
    userId ? client.from('coach_ratings').select('coach_id,score').eq('reviewer_id', userId) : {},
  ]);
  if (version !== generation) return false;
  if (profiles.error || personal.error || scores.error) {
    byId('coach-directory-status').textContent = 'לא ניתן לטעון את הספרייה כרגע. נסו לרענן את העמוד.';
    return false;
  }
  directory = profiles.data;
  myProfile = personal.data || null;
  myScores = new Map((scores.data || []).map(row => [row.coach_id, row.score]));
  ready = true;
  renderDirectory();
  return true;
}

function renderSession() {
  byId('coach-login').hidden = Boolean(userId);
  byId('coach-session').hidden = !userId;
  byId('coach-register').hidden = Boolean(userId);
  byId('open-coach-profile').hidden = !userId || !ready;
  byId('coach-match-submit').disabled = !userId || !ready || matching;
}

async function saveRating(coach, form, score) {
  const version = generation;
  const controls = [...form.elements];
  controls.forEach(control => { control.disabled = true; });
  const ratings = client.from('coach_ratings');
  const result = score === null
    ? await ratings.delete().eq('coach_id', coach.id).eq('reviewer_id', userId)
    : await ratings.upsert({coach_id: coach.id, reviewer_id: userId, score}, {onConflict: 'coach_id,reviewer_id'});
  if (version !== generation) return;
  if (result.error) {
    form.querySelector('.coach-rating-status').textContent = 'הדירוג לא נשמר. ייתכן שהפרופיל כבר הוסתר.';
    controls.forEach(control => { control.disabled = false; });
    return;
  }
  await loadDirectory();
  if (version === generation) byId('coach-message').textContent = score === null ? 'הדירוג הוסר.' : 'הדירוג נשמר.';
}

byId('open-coach-profile').addEventListener('click', () => {
  profileForm.reset();
  for (const field of ['display_name', 'bio', 'format', 'focus', 'contact_email']) {
    profileForm.elements[field].value = myProfile?.[field] ?? '';
  }
  for (const field of ['specialties', 'audiences']) {
    for (const input of profileForm.querySelectorAll('[name="' + field + '"]')) {
      input.checked = myProfile?.[field].includes(input.value) ?? false;
    }
  }
  profileForm.elements.published.checked = myProfile?.published ?? false;
  byId('coach-profile-status').textContent = '';
  profileDialog.showModal();
});
byId('close-coach-profile').addEventListener('click', () => profileDialog.close());
profileForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!userId || !ready) return;
  const form = new FormData(profileForm);
  const data = Object.fromEntries(['display_name', 'bio', 'format', 'focus', 'contact_email']
    .map(field => [field, form.get(field).trim()]));
  data.specialties = form.getAll('specialties');
  data.audiences = form.getAll('audiences');
  data.published = form.has('published');
  const status = byId('coach-profile-status');
  if (!data.specialties.length || !data.audiences.length) {
    status.textContent = 'בחרו לפחות התמחות אחת וקהל יעד אחד.';
    return;
  }
  const button = profileForm.querySelector('[type=submit]');
  button.disabled = true;
  const version = generation;
  const profiles = client.from('coach_profiles');
  const result = myProfile ? await profiles.update(data).eq('id', myProfile.id).select('id').single()
    : await profiles.insert({...data, owner_id: userId}).select('id').single();
  button.disabled = false;
  if (version !== generation) return;
  if (result.error) {
    status.textContent = 'לא ניתן לשמור את הפרופיל. בדקו את הפרטים ונסו שוב.';
    return;
  }
  profileDialog.close();
  await loadDirectory();
  if (version === generation) byId('coach-message').textContent = data.published ? 'הפרופיל פורסם בספרייה.' : 'הפרופיל נשמר כפרטי.';
});

matchForm.addEventListener('change', () => {
  quizVersion++;
  matches = [];
  renderDirectory();
  byId('coach-match-status').textContent = userId ? '' : 'התחברו כדי לקבל התאמות.';
});
matchForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!userId || !ready || matching) return;
  const version = generation;
  const quiz = quizVersion;
  const status = byId('coach-match-status');
  matching = true;
  renderSession();
  matches = [];
  renderDirectory();
  status.textContent = 'בודק את הפרופילים בספרייה…';
  try {
    const {data, error} = await client.functions.invoke('coach-match', {
      body: Object.fromEntries(new FormData(matchForm)), signal: AbortSignal.timeout(45000),
    });
    if (version !== generation || quiz !== quizVersion) return;
    if (error) {
      const details = await error.context?.json?.().catch(() => null);
      throw Error(details?.error || 'לא ניתן לקבל התאמה כרגע. הספרייה זמינה לבחירה עצמאית.');
    }
    if (!await loadDirectory() || version !== generation || quiz !== quizVersion) return;
    matches = data.matches.filter(match => directory.some(coach => coach.id === match.id));
    renderDirectory();
    status.textContent = matches.length ? 'הצעות התאמה לפי הבחירות שלכם.'
      : 'אין כרגע התאמה לשילוב שבחרתם. אפשר לשנות תשובות או לעיין בספרייה.';
  } catch (error) {
    if (version === generation && quiz === quizVersion) status.textContent = error.message;
  } finally {
    if (version === generation) {
      matching = false;
      renderSession();
    }
  }
});

for (const [name, values] of Object.entries(labels)) {
  options(matchForm.elements[name], Object.entries(values).filter(([key]) => key !== 'both'), 'בחרו תשובה');
}
options(profileForm.elements.format, Object.entries(labels.format).filter(([key]) => key !== 'either'), 'בחרו פורמט');
options(profileForm.elements.focus, Object.entries(labels.focus), 'בחרו דגש');
checkboxes(byId('coach-specialties'), 'specialties', Object.entries(labels.goal));
checkboxes(byId('coach-audiences'), 'audiences', Object.entries(labels.audience));
options(byId('filter-goal'), Object.entries(labels.goal), 'כל ההתמחויות');
options(byId('filter-audience'), Object.entries(labels.audience), 'כל הקהלים');
byId('filter-goal').addEventListener('change', renderDirectory);
byId('filter-audience').addEventListener('change', renderDirectory);

client.auth.onAuthStateChange((event, session) => {
  const next = session?.user.id || null;
  if (event !== 'INITIAL_SESSION' && next === userId) return;
  userId = next;
  const version = ++generation;
  ready = false;
  matching = false;
  matches = [];
  myProfile = null;
  myScores.clear();
  profileDialog.close();
  byId('coach-message').textContent = '';
  byId('coach-match-status').textContent = userId ? '' : 'התחברו כדי לקבל התאמות.';
  renderSession();
  renderDirectory();
  byId('coach-directory-status').textContent = 'טוען מאמנים…';
  // Keep Supabase calls outside the Auth callback.
  setTimeout(async () => {
    if (version !== generation) return;
    await loadDirectory();
    if (version === generation) renderSession();
  }, 0);
});
