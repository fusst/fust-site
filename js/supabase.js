const SUPABASE_JS_CDN = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const CONFIG = window.FUSST_SUPABASE_CONFIG ?? { url: "", anonKey: "" };
const TABLES = Object.freeze({
  profiles: "profiles",
  notices: "notices",
  assignments: "assignments",
  timetable: "timetable",
});

let clientPromise;

export function isSupabaseConfigured() {
  return Boolean(CONFIG.url?.trim() && CONFIG.anonKey?.trim());
}

export async function initializeSupabase() {
  if (!CONFIG.url?.trim() && !CONFIG.anonKey?.trim()) {
    return null;
  }
  if (!CONFIG.url?.trim() || !CONFIG.anonKey?.trim()) {
    throw new Error("Add both your Supabase project URL and anon key in js/config.js.");
  }
  if (!clientPromise) {
    clientPromise = import(SUPABASE_JS_CDN)
      .then(({ createClient }) => createClient(CONFIG.url.trim(), CONFIG.anonKey.trim(), {
        auth: {
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: true,
        },
      }))
      .catch((error) => {
        clientPromise = undefined;
        throw new Error(`Could not load the Supabase JavaScript client: ${error.message}`);
      });
  }
  return clientPromise;
}

export async function getCurrentUser() {
  const client = await initializeSupabase();
  if (!client) return null;

  const { data, error } = await client.auth.getUser();
  if (error) throw error;
  return data.user;
}

export async function getCurrentProfile() {
  const client = await initializeSupabase();
  if (!client) return null;

  const user = await getCurrentUser();
  if (!user) return null;

  const { data, error } = await client
    .from(TABLES.profiles)
    .select("id, full_name, degree, semester, section, role")
    .eq("id", user.id)
    .single();
  if (error) throw error;
  return data;
}

export async function signIn(email, password) {
  const client = await initializeSupabase();
  if (!client) throw new Error("Add your Supabase credentials in js/config.js to enable sign-in.");

  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signUp(email, password, fullName) {
  const client = await initializeSupabase();
  if (!client) throw new Error("Add your Supabase credentials in js/config.js to enable sign-up.");

  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName.trim() } },
  });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const client = await initializeSupabase();
  if (!client) return;

  const { error } = await client.auth.signOut();
  if (error) throw error;
}

export async function onAuthStateChange(callback) {
  const client = await initializeSupabase();
  if (!client) return () => {};

  const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
    callback(event, session);
  });
  return () => subscription.unsubscribe();
}

export async function fetchRows(table) {
  if (!Object.hasOwn(TABLES, table)) throw new Error(`Unsupported Supabase table: ${table}`);
  const client = await initializeSupabase();
  if (!client) throw new Error("Supabase is not configured. Set up js/config.js before fetching live data.");

  let query = client.from(TABLES[table]).select("*");
  if (table === "notices") {
    query = query.order("is_pinned", { ascending: false }).order("created_at", { ascending: false });
  } else if (table === "assignments") {
    query = query.order("due_at", { ascending: true });
  } else if (table === "timetable") {
    query = query.order("day_of_week", { ascending: true }).order("start_time", { ascending: true });
  } else if (table === "profiles") {
    query = query.order("full_name", { ascending: true });
  }

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function insertRow(table, values) {
  if (!Object.hasOwn(TABLES, table) || table === "profiles") {
    throw new Error(`The ${table} table is not available for portal posts.`);
  }
  const client = await initializeSupabase();
  if (!client) throw new Error("Supabase is not configured. Set up js/config.js before publishing.");

  const { data, error } = await client
    .from(TABLES[table])
    .insert(values)
    .select("*")
    .single();
  if (error) {
    if (error.code === "42501" || error.code === "PGRST301") {
      throw new Error("Your account needs the CR or Teacher role to publish. Ask your portal administrator to grant access.");
    }
    throw error;
  }
  return data;
}
