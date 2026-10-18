const SUPABASE_JS_CDN = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const CONFIG = window.FUSST_SUPABASE_CONFIG ?? { url: "", anonKey: "" };
const TABLES = Object.freeze({
  profiles: "profiles",
  notices: "notices",
  assignments: "assignments",
  timetable: "timetable",
  user_notifications: "user_notifications",
  support_threads: "support_threads",
  support_messages: "support_messages",
  portal_settings: "portal_settings",
  staff_audit_log: "staff_audit_log",
});
const PROFILE_PHOTO_BUCKET = "profile-photos";
const PROFILE_PHOTO_TYPES = Object.freeze({
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
});
const MAX_PROFILE_PHOTO_SIZE = 5 * 1024 * 1024;
const profilePhotoUrls = new Map();

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
    .select("id, full_name, degree, semester, section, role, roles, headline, bio, linkedin_url")
    .eq("id", user.id)
    .single();
  if (error) throw error;
  return data;
}

export async function getPortalSettings() {
  const client = await initializeSupabase();
  if (!client) throw new Error("Supabase is not configured. Site availability cannot be verified.");

  const { data, error } = await client
    .from(TABLES.portal_settings)
    .select("maintenance_mode, maintenance_message, updated_at")
    .eq("singleton", true)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("The portal settings are missing from Supabase. Apply the database schema.");
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
  } else if (table === "user_notifications") {
    query = query.order("created_at", { ascending: false }).limit(100);
  } else if (table === "support_threads") {
    query = query.order("updated_at", { ascending: false });
  } else if (table === "support_messages") {
    query = query.gt("expires_at", new Date().toISOString()).order("created_at", { ascending: true });
  } else if (table === "staff_audit_log") {
    query = query.order("created_at", { ascending: false }).limit(40);
  }

  const { data, error } = await query;
  if (error) throw error;
  if (table === "profiles") {
    const paths = [...new Set(data.map((profile) => profile.avatar_path).filter(Boolean))];
    for (const cachedPath of profilePhotoUrls.keys()) {
      if (!paths.includes(cachedPath)) profilePhotoUrls.delete(cachedPath);
    }
    const pathsToSign = paths.filter((path) => (profilePhotoUrls.get(path)?.expiresAt ?? 0) < Date.now() + 120_000);
    if (pathsToSign.length) {
      const { data: signedPhotos, error: signingError } = await client.storage
        .from(PROFILE_PHOTO_BUCKET)
        .createSignedUrls(pathsToSign, 3600);
      if (signingError) throw signingError;
      if (!signedPhotos) throw new Error("Supabase did not return signed profile photo URLs.");
      for (const photo of signedPhotos) {
        if (photo.error) throw new Error(`Could not sign a member profile photo: ${photo.error.message || photo.error}`);
        if (!photo.signedUrl || !photo.path) throw new Error("Supabase returned an incomplete signed profile photo URL.");
        profilePhotoUrls.set(photo.path, {
          url: photo.signedUrl,
          expiresAt: Date.now() + 3_480_000,
        });
      }
    }
  }
  return data;
}

export async function insertRow(table, values) {
  if (!Object.hasOwn(TABLES, table) || !["notices", "assignments", "timetable", "support_messages"].includes(table)) {
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

export async function fetchSupportMessages(threadId) {
  const client = await initializeSupabase();
  if (!client) throw new Error("Sign in to view support conversations.");

  const { data, error } = await client
    .from(TABLES.support_messages)
    .select("id, thread_id, sender_id, body, created_at, expires_at")
    .eq("thread_id", threadId)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

export async function createSupportThread(subject, message) {
  const client = await initializeSupabase();
  if (!client) throw new Error("Sign in to contact the technical team.");

  const { data, error } = await client.rpc("create_support_thread", {
    thread_subject: subject,
    first_message: message,
  });
  if (error) throw error;
  return data;
}

export async function updateSupportThreadStatus(threadId, status) {
  const client = await initializeSupabase();
  if (!client) throw new Error("Sign in with a technical team or owner account.");

  const { error } = await client.rpc("set_support_thread_status", {
    thread_id: threadId,
    new_status: status,
  });
  if (error) throw error;
}

export async function markNotificationRead(notificationId) {
  const client = await initializeSupabase();
  if (!client) throw new Error("Sign in to update your inbox.");

  const { error } = await client.rpc("mark_notification_read", {
    notification_id: notificationId,
  });
  if (error) throw error;
}

export async function fetchPortalUsers() {
  const client = await initializeSupabase();
  if (!client) throw new Error("Sign in to the owner account to manage portal roles.");

  const { data, error } = await client.rpc("list_portal_users");
  if (error) throw error;
  return data;
}

export async function changeUserRoles(userId, roles) {
  const client = await initializeSupabase();
  if (!client) throw new Error("Sign in to the owner account to manage portal roles.");

  const { error } = await client.rpc("change_profile_roles", {
    target_profile_id: userId,
    new_roles: roles,
  });
  if (error) throw error;
}

export async function updateMyProfile(profile) {
  const client = await initializeSupabase();
  if (!client) throw new Error("Sign in to update your member profile.");

  const values = {
    new_full_name: profile.full_name,
    new_headline: profile.headline,
    new_bio: profile.bio,
    new_linkedin_url: profile.linkedin_url,
    new_avatar_path: profile.avatar_path,
  };
  const { error } = await client.rpc("update_my_profile", values);
  if (!error) return;
  if (!["PGRST202", "42883"].includes(error.code)) throw error;
  if (profile.avatar_path) {
    throw new Error("Apply the latest Supabase schema migration before saving a profile photo.");
  }

  const { error: legacyError } = await client.rpc("update_my_profile", {
    new_full_name: values.new_full_name,
    new_headline: values.new_headline,
    new_bio: values.new_bio,
    new_linkedin_url: values.new_linkedin_url,
  });
  if (legacyError) {
    if (["PGRST202", "42883"].includes(legacyError.code)) {
      throw new Error("Apply the latest Supabase schema migration before updating your profile.");
    }
    throw legacyError;
  }
}

export function getProfilePhotoUrl(path) {
  if (!path || !/^[\da-f-]+\/avatar-[\da-f-]+\.(jpg|png|webp)$/i.test(path)) return "";
  const signedPhoto = profilePhotoUrls.get(path);
  return signedPhoto && signedPhoto.expiresAt > Date.now() ? signedPhoto.url : "";
}

export async function uploadProfilePhoto(file) {
  const extension = PROFILE_PHOTO_TYPES[file?.type];
  if (!extension || file.size > MAX_PROFILE_PHOTO_SIZE) {
    throw new Error("Choose a JPG, PNG, or WebP image up to 5 MB.");
  }
  const client = await initializeSupabase();
  if (!client) throw new Error("Sign in to upload a profile photo.");

  const user = await getCurrentUser();
  if (!user) throw new Error("Sign in to upload a profile photo.");
  const path = `${user.id}/avatar-${crypto.randomUUID()}.${extension}`;
  const { error } = await client.storage
    .from(PROFILE_PHOTO_BUCKET)
    .upload(path, file, { cacheControl: "3600", contentType: file.type, upsert: false });
  if (error) {
    if (error.message.toLowerCase().includes("bucket not found")) {
      throw new Error("Apply the latest Supabase schema migration before uploading a profile photo.");
    }
    throw error;
  }
  return path;
}

export async function deleteProfilePhoto(path) {
  if (!path) return;
  const client = await initializeSupabase();
  if (!client) throw new Error("Sign in to manage your profile photo.");
  const user = await getCurrentUser();
  if (!user || !path.startsWith(`${user.id}/`)) {
    throw new Error("You can remove only your own profile photo.");
  }
  const { error } = await client.storage.from(PROFILE_PHOTO_BUCKET).remove([path]);
  if (error) throw error;
}

export async function deleteNotice(noticeId) {
  const client = await initializeSupabase();
  if (!client) throw new Error("Sign in to manage notices.");

  const { data, error } = await client
    .from(TABLES.notices)
    .delete()
    .eq("id", noticeId)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("This notice could not be deleted. It may belong to someone else.");
}

export async function publishTimetableWeek(schedule) {
  const client = await initializeSupabase();
  if (!client) throw new Error("Sign in with a verified CR, Teacher, or Owner account.");

  const { data, error } = await client.rpc("publish_timetable_week", {
    schedule_entries: schedule.entries,
    target_semester: schedule.semester,
    target_section: schedule.section,
    valid_from: schedule.validFrom,
    valid_until: schedule.validUntil || null,
    recurrence: schedule.recurrence,
  });
  if (error) throw error;
  return data;
}

export async function setPortalMaintenance(enabled, message) {
  const client = await initializeSupabase();
  if (!client) throw new Error("Sign in to the owner account to change site maintenance.");

  const { error } = await client.rpc("set_portal_maintenance", {
    enabled,
    message,
  });
  if (error) throw error;
}

export async function subscribeToChanges(table, callback, filter) {
  if (!Object.hasOwn(TABLES, table)) throw new Error(`Unsupported Supabase table: ${table}`);
  const client = await initializeSupabase();
  if (!client) return () => {};

  let changeOptions = { event: "*", schema: "public", table };
  if (filter) changeOptions.filter = filter;
  const channel = client
    .channel(`fussthub:${table}:${crypto.randomUUID()}`)
    .on("postgres_changes", changeOptions, callback)
    .subscribe((status, error) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.error(`Could not subscribe to live ${table} updates.`, error);
      }
    });
  return () => {
    void client.removeChannel(channel);
  };
}
