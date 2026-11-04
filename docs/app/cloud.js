"use strict";

// Supabase manages passwords and sessions. Only its publishable key is public.
// Database RLS checks ownership even if somebody bypasses this JavaScript.
const cloud = (() => {
  let client;
  function connect() {
    client = supabase.createClient(GYMMI_CONFIG.url, GYMMI_CONFIG.publishableKey, {
      global: { fetch: (url, options = {}) => fetch(url, { ...options,
        signal: AbortSignal.any([...(options.signal ? [options.signal] : []), AbortSignal.timeout(15000)]) }) }
    });
    return client;
  }
  async function load(userId) {
    const { data, error } = await client.from("workout_journals").select("workouts,revision").eq("user_id", userId).maybeSingle();
    if (error) throw error;
    return data || { workouts: [], revision: 0 };
  }
  async function save(userId, workouts, revision) {
    const table = client.from("workout_journals");
    // A conditional update prevents an old device overwriting a newer journal.
    const query = revision === 0
      ? table.insert({ user_id: userId, workouts, revision: 1 })
      : table.update({ workouts, revision: revision + 1 }).eq("user_id", userId).eq("revision", revision);
    const { data, error } = await query.select("revision").maybeSingle();
    if (error?.code === "23505" || (!error && !data)) throw new Error("היומן עודכן ממכשיר אחר. שמור את פרטי הטיוטה שבטופס, וטען מחדש מהענן לפני עריכה נוספת.");
    if (error) throw error;
    return data.revision;
  }
  return { connect, load, save };
})();
