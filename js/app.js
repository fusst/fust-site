import {
  fetchRows,
  fetchPortalUsers,
  fetchSupportMessages,
  getCurrentProfile,
  getCurrentUser,
  getPortalSettings,
  initializeSupabase,
  createSupportThread,
  changeUserRoles,
  deleteNotice,
  deleteProfilePhoto,
  getProfilePhotoUrl,
  insertRow,
  isSupabaseConfigured,
  markNotificationRead,
  onAuthStateChange,
  publishTimetableWeek,
  signIn,
  signOut,
  signUp,
  setPortalMaintenance,
  subscribeToChanges,
  updateSupportThreadStatus,
  updateMyProfile,
  uploadProfilePhoto,
} from "./supabase.js?v=20261018-2";

const icon = (name, className = "icon") =>
  `<svg class="${className}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;

const weekDayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const roleLabels = {
  owner: "Portal Owner",
  technical_team: "Technical Team",
  teacher: "Teacher",
  cr: "Class Representative",
  student: "BSSE Student",
};
const avatarColors = ["avatar-lilac", "avatar-peach", "avatar-mint", "avatar-blue", "avatar-lemon", "avatar-rose"];
const defaultPreviewRole = "student";

const RESOURCES = [
  { category: "OFFICIAL FUSST SITE", title: "FUSST student portal", description: "Official department information and student resources.", icon: "🎓", label: "Official site", url: "https://fusst.fui.edu.pk/" },
  { category: "LEARN ANYTHING", title: "freeCodeCamp", description: "Hands-on practice in web development, JavaScript, and data structures.", icon: "🌱", label: "Free learning", url: "https://www.freecodecamp.org/learn/" },
  { category: "KEEP BUILDING", title: "GitHub Student Developer Pack", description: "Developer tools, real-world experience, and student benefits in one place.", icon: "🐙", label: "Student perks", url: "https://education.github.com/pack" },
  { category: "DRAW IT OUT", title: "Excalidraw", description: "Sketch system designs, explain your ideas, and make collaboration visual.", icon: "✏️", label: "Design & diagrams", url: "https://excalidraw.com/" },
  { category: "FOCUS TIME", title: "CS50 on edX", description: "A thoughtful, free introduction to computer science fundamentals.", icon: "💡", label: "Computer science", url: "https://www.edx.org/learn/computer-science/harvard-university-cs50-s-introduction-to-computer-science" },
  { category: "YOUR WORKFLOW", title: "Visual Studio Code", description: "A lightweight editor and a great place to start your next project.", icon: "⌨️", label: "Developer tools", url: "https://code.visualstudio.com/" },
];

const state = {
  data: { notices: [], assignments: [], timetable: [], profiles: [] },
  user: null,
  profile: null,
  previewRole: defaultPreviewRole,
  notifications: [],
  unreadNotifications: 0,
  supportThreads: [],
  supportMessages: [],
  supportProfiles: [],
  activeSupportThreadId: null,
  staffPanel: "overview",
  staffUsers: [],
  maintenance: null,
  liveSubscriptions: [],
  subscriptionsForUser: null,
  activeNoticeFilter: "all",
  noticeSearch: "",
  directorySearch: "",
  directoryRole: "all",
  globalSearch: "",
  dialogMode: null,
  dialogBusy: false,
  loadError: null,
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function formatDate(value, options = { month: "short", day: "numeric" }) {
  if (!value) return "Date to be announced";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date to be announced";
  return new Intl.DateTimeFormat("en-PK", { timeZone: "Asia/Karachi", ...options }).format(date);
}

function formatTime(value) {
  if (!value) return "TBA";
  const [hour, minute] = value.split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return "TBA";
  const suffix = hour >= 12 ? "PM" : "AM";
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function roleTitle(role) {
  return roleLabels[role] ?? roleLabels.student;
}

function profileRoles(profile) {
  const knownRoles = Object.keys(roleLabels);
  const roles = Array.isArray(profile?.roles) ? profile.roles : [profile?.role ?? "student"];
  return knownRoles.filter((role) => roles.includes(role));
}

function roleNames(roles) {
  return Object.keys(roleLabels).filter((role) => roles.includes(role)).map((role) => roleTitle(role)).join(" · ");
}

function primaryRole(roles) {
  return Object.keys(roleLabels).find((role) => roles.includes(role)) ?? "student";
}

function isPoster() {
  return Boolean(state.user && profileRoles(state.profile).some((role) => ["cr", "teacher", "owner"].includes(role)));
}

function noticeAuthorLabel(notice) {
  const roles = Array.isArray(notice.author_roles)
    ? notice.author_roles
    : profileRoles(state.data.profiles.find((profile) => profile.id === notice.created_by));
  return `${notice.author_name || "FUSST Hub"}${roles.length ? ` · ${roleNames(roles)}` : ""}`;
}

function normalizedProfileName(profile, user) {
  return profile?.full_name?.trim() || user?.user_metadata?.full_name?.trim() || user?.email?.split("@")[0] || "You";
}

function profileAvatar(profile, className, initials, label) {
  const photoUrl = profile?.avatar_path ? getProfilePhotoUrl(profile.avatar_path) : "";
  const photo = photoUrl ? `<img src="${escapeHtml(photoUrl)}" alt="">` : "";
  return `<span class="${className}" role="img" aria-label="${escapeHtml(label)}">${photo || escapeHtml(initials)}</span>`;
}

function isStaff() {
  return Boolean(state.user && profileRoles(state.profile).some((role) => ["technical_team", "owner"].includes(role)));
}

function isOwner() {
  return Boolean(state.user && profileRoles(state.profile).includes("owner"));
}

function effectiveRole() {
  return state.user ? primaryRole(profileRoles(state.profile)) : state.previewRole;
}

function toast(message, type = "success") {
  const element = document.createElement("div");
  element.className = `toast toast-${type}`;
  element.innerHTML = `${icon(type === "success" ? "check" : "bell")}<span>${escapeHtml(message)}</span>`;
  $("#toast-stack").append(element);
  window.setTimeout(() => element.remove(), 4600);
}

function setLoadError(message) {
  state.loadError = message;
  const previous = $(".connection-error");
  previous?.remove();
  const notice = document.createElement("div");
  notice.className = "connection-error";
  notice.setAttribute("role", "alert");
  notice.innerHTML = `<span>${icon("bell")}</span><p><strong>We couldn’t load your portal data.</strong> ${escapeHtml(message)}</p><button class="icon-button" type="button" aria-label="Dismiss connection error">${icon("close")}</button>`;
  $(".content-wrap").prepend(notice);
  notice.querySelector("button").addEventListener("click", () => notice.remove());
}

function isSearchMatch(value) {
  return !state.globalSearch || String(value ?? "").toLowerCase().includes(state.globalSearch);
}

function filteredNotices() {
  return state.data.notices.filter((notice) => {
    const categoryMatches = state.activeNoticeFilter === "all"
      || (state.activeNoticeFilter === "urgent" ? notice.category === "urgent" : notice.category === state.activeNoticeFilter);
    return categoryMatches
      && `${notice.title} ${notice.body} ${notice.author_name}`.toLowerCase().includes(state.noticeSearch)
      && isSearchMatch(`${notice.title} ${notice.body}`);
  });
}

function renderNoticeCard(notice, compact = false) {
  const category = ["academic", "events", "urgent", "community"].includes(notice.category) ? notice.category : "academic";
  const authorLabel = noticeAuthorLabel(notice);
  const canDelete = state.user && (isOwner() || notice.created_by === state.user.id);
  return `<article class="notice-card${compact ? " notice-card-compact" : ""}${notice.is_pinned ? " is-pinned" : ""}" data-notice-card="${escapeHtml(notice.id)}">
    ${notice.is_pinned ? `<span class="pinned-label">${icon("bookmark")} PINNED</span>` : ""}
    <div class="notice-card-top"><span class="notice-category category-${category}">${category === "urgent" ? "IMPORTANT" : category.toUpperCase()}</span><span class="notice-date">${escapeHtml(formatDate(notice.created_at, { month: "short", day: "numeric" }))}</span></div>
    <h3>${escapeHtml(notice.title)}</h3><p class="notice-body">${escapeHtml(notice.body)}</p>
    <div class="notice-author"><span class="avatar avatar-lilac">${escapeHtml((notice.author_name || "F").trim().charAt(0).toUpperCase())}</span><span>${escapeHtml(authorLabel)}</span><span class="notice-author-dot"></span><span>${escapeHtml(formatDate(notice.created_at, { hour: "numeric", minute: "2-digit" }))}</span>${canDelete ? `<button class="notice-delete-button" type="button" data-delete-notice="${escapeHtml(notice.id)}" aria-label="Delete notice">Delete</button>` : ""}</div>
  </article>`;
}

function renderScheduleItem(entry, index) {
  const now = new Date();
  const start = entry.start_time?.slice(0, 5);
  const [startHour = 0, startMinute = 0] = (start ?? "").split(":").map(Number);
  const isNext = index === 0 && (now.getHours() < startHour || (now.getHours() === startHour && now.getMinutes() < startMinute));
  const courseClass = index % 2 === 0 ? "schedule-violet" : "schedule-teal";
  return `<article class="schedule-item"><div class="schedule-times"><span>${escapeHtml(formatTime(entry.start_time))}</span><i></i><span>${escapeHtml(formatTime(entry.end_time))}</span></div><span class="schedule-indicator ${courseClass}${isNext ? " indicator-active" : ""}"></span><div class="schedule-course ${courseClass}"><span class="course-code">${escapeHtml(entry.course_code || "BSSE")}</span><strong>${escapeHtml(entry.course_name || "Class")}</strong><span class="course-instructor">${escapeHtml(entry.instructor || "Course instructor")}</span></div><span class="schedule-location">${icon("pin")}${escapeHtml(entry.room || "Room TBA")}</span></article>`;
}

function getTodayClasses() {
  return [...state.data.timetable]
    .filter((entry) => Number(entry.day_of_week) === new Date().getDay() && timetableEntryApplies(entry, new Date()))
    .filter((entry) => !state.profile || (
      Number(entry.semester ?? state.profile.semester) === Number(state.profile.semester)
      && String(entry.section ?? state.profile.section).toUpperCase() === String(state.profile.section).toUpperCase()
    ))
    .sort((left, right) => (left.start_time ?? "").localeCompare(right.start_time ?? ""));
}

function timetableEntryApplies(entry, date) {
  const selected = localDateInputValue(date);
  if (entry.effective_from && selected < entry.effective_from) return false;
  if (entry.effective_until && selected > entry.effective_until) return false;
  if (entry.week_type && entry.week_type !== "all") {
    const week = new Date(date);
    week.setDate(week.getDate() + 4 - (week.getDay() || 7));
    const yearStart = new Date(week.getFullYear(), 0, 1);
    const weekNumber = Math.ceil((((week - yearStart) / 86400000) + 1) / 7);
    if ((entry.week_type === "even") !== (weekNumber % 2 === 0)) return false;
  }
  return true;
}
function renderDashboard() {
  const notices = [...state.data.notices].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const assignments = [...state.data.assignments].sort((a, b) => new Date(a.due_at) - new Date(b.due_at));
  const upcomingAssignments = assignments.filter((item) => new Date(item.due_at) >= new Date());
  const classes = getTodayClasses();
  $("#stat-notices").textContent = String(notices.filter((notice) => new Date(notice.created_at) > new Date(Date.now() - 7 * 86400000)).length).padStart(2, "0");
  $("#stat-assignments").textContent = String(upcomingAssignments.length).padStart(2, "0");
  $("#stat-classes").textContent = String(classes.length).padStart(2, "0");
  $("#notice-nav-count").textContent = String(notices.length);
  $("#assignment-nav-count").textContent = String(upcomingAssignments.length);
  $("#dashboard-schedule").innerHTML = classes.length
    ? classes.map(renderScheduleItem).join("")
    : `<div class="empty-state compact-empty"><span class="empty-illustration">☀️</span><strong>A little room to breathe.</strong><p>No classes scheduled for today.</p></div>`;
  $("#dashboard-notices").innerHTML = notices.length
    ? notices.slice(0, 3).map((notice, index) => `<button class="latest-notice" type="button" data-go="notices"><span class="latest-notice-marker marker-${index % 3}"></span><span class="latest-notice-content"><span class="latest-notice-category">${escapeHtml((notice.category || "academic").toUpperCase())}</span><strong>${escapeHtml(notice.title)}</strong><span class="latest-notice-meta">${escapeHtml(noticeAuthorLabel(notice))} <i>·</i> ${escapeHtml(formatDate(notice.created_at, { month: "short", day: "numeric" }))}</span></span>${icon("chevron", "icon latest-chevron")}</button>`).join("")
    : `<div class="empty-state compact-empty"><span class="empty-illustration">📭</span><strong>You’re all caught up.</strong><p>No notices just yet.</p></div>`;
}

function renderInbox() {
  const notifications = state.notifications;
  state.unreadNotifications = notifications.filter((item) => !item.read_at).length;
  const count = String(state.unreadNotifications);
  $("#notification-nav-count").textContent = count;
  $("#notification-nav-count").hidden = state.unreadNotifications === 0;
  $("#topbar-notification-count").textContent = count;
  $("#topbar-notification-count").hidden = state.unreadNotifications === 0;
  $("#inbox-summary").innerHTML = `<span class="inbox-summary-icon">${icon("inbox")}</span><span><strong>${state.unreadNotifications ? `${state.unreadNotifications} new ${state.unreadNotifications === 1 ? "update" : "updates"}` : "You’re all caught up."}</strong><small>${state.user ? "Notice updates from across your batch appear here automatically." : "Sign in to keep your notice inbox in sync across your devices."}</small></span>`;

  if (!state.user) {
    $("#notification-list").innerHTML = `<div class="empty-state grid-empty"><span class="empty-illustration">🔐</span><strong>Your inbox is waiting for you.</strong><p>Sign in to see your personal, live-updating announcement inbox.</p><button class="primary-button" type="button" data-open-signin><svg class="icon"><use href="#i-arrow"/></svg> Sign in to your account</button></div>`;
    return;
  }

  $("#notification-list").innerHTML = notifications.length
    ? notifications.map((item) => {
      const category = ["academic", "events", "urgent", "community"].includes(item.category) ? item.category : "academic";
      const sourceNotice = state.data.notices.find((notice) => notice.id === item.notice_id);
      return `<article class="notification-card${item.read_at ? "" : " is-unread"}"><span class="notification-card-icon category-${escapeHtml(category)}">${icon(category === "urgent" ? "bell" : category === "events" ? "sparkle" : "megaphone")}</span><div class="notification-card-content"><div class="notification-card-meta"><span class="notice-category category-${escapeHtml(category)}">${escapeHtml(category === "urgent" ? "IMPORTANT" : category.toUpperCase())}</span><time>${escapeHtml(formatDate(item.created_at, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }))}</time></div><h2>${escapeHtml(item.title)}</h2><p>${escapeHtml(item.body)}</p><span class="notification-source">${icon("megaphone")} New notice · ${escapeHtml(sourceNotice ? noticeAuthorLabel(sourceNotice) : "FUSST Hub")}</span></div><div class="notification-card-actions">${item.read_at ? `<span class="read-indicator">${icon("check")} Read</span>` : `<span class="unread-indicator"><i></i> NEW</span>`}<button class="text-link notification-open-notice" type="button" data-notification-id="${escapeHtml(item.id)}" data-notice-id="${escapeHtml(item.notice_id || "")}">${item.read_at ? "View notice" : "Mark read"} ${icon("arrow")}</button></div></article>`;
    }).join("")
    : `<div class="empty-state grid-empty"><span class="empty-illustration">📬</span><strong>It’s quiet in here.</strong><p>When a CR, teacher, or owner posts a notice, you’ll see it in this inbox.</p></div>`;
}

function renderNotices() {
  const notices = filteredNotices();
  $("#notices-list").innerHTML = notices.length
    ? notices.map((notice) => renderNoticeCard(notice)).join("")
    : `<div class="empty-state grid-empty"><span class="empty-illustration">🔎</span><strong>No notices found.</strong><p>Try another search or choose a different filter.</p><button class="text-link" id="clear-notice-search" type="button">Clear your search</button></div>`;
}

function renderTimetable() {
  if (!$("#timetable-date").value) $("#timetable-date").value = localDateInputValue();
  if (!$("#timetable-semester").dataset.initialized) {
    $("#timetable-semester").value = String(state.profile?.semester || 5);
    $("#timetable-semester").dataset.initialized = "true";
  }
  if (!$("#timetable-section").value) $("#timetable-section").value = state.profile?.section || "A";
  const selectedDate = new Date(`${$("#timetable-date").value || new Date().toISOString().slice(0, 10)}T00:00:00`);
  const semester = Number($("#timetable-semester").value || state.profile?.semester || 5);
  const section = ($("#timetable-section").value || state.profile?.section || "A").trim().toUpperCase();
  const grouped = Array.from({ length: 7 }, (_, day) => ({
    day,
    classes: state.data.timetable
      .filter((entry) => Number(entry.day_of_week) === day
        && Number(entry.semester ?? semester) === semester
        && String(entry.section ?? section).toUpperCase() === section
        && timetableEntryApplies(entry, selectedDate))
      .sort((left, right) => (left.start_time ?? "").localeCompare(right.start_time ?? "")),
  })).filter(({ classes }) => classes.length);

  const effective = state.data.timetable.filter((entry) =>
    Number(entry.semester ?? semester) === semester
      && String(entry.section ?? section).toUpperCase() === section
      && timetableEntryApplies(entry, selectedDate));
  const earliest = effective.map((entry) => entry.effective_from).filter(Boolean).sort().at(-1);
  const latest = effective.map((entry) => entry.effective_until).filter(Boolean).sort().at(-1);
  $("#timetable-effective-dates").textContent = effective.length
    ? `Effective ${formatDate(earliest || selectedDate, { month: "short", day: "numeric", year: "numeric" })}${latest ? ` – ${formatDate(latest, { month: "short", day: "numeric", year: "numeric" })}` : " onward"}`
    : "No schedule published for this date.";

  $("#timetable-list").innerHTML = grouped.length
    ? grouped.map(({ day, classes }) => `<section class="day-column"><div class="day-heading${day === selectedDate.getDay() ? " is-today" : ""}"><span>${escapeHtml(weekDayNames[day])}</span>${day === selectedDate.getDay() ? '<span class="today-marker">SELECTED</span>' : ""}<small>${classes.length} ${classes.length === 1 ? "class" : "classes"}</small></div><div class="day-classes">${classes.map((entry, index) => `<article class="class-card class-card-${index % 4}"><div class="class-time">${icon("clock")} ${escapeHtml(formatTime(entry.start_time))} – ${escapeHtml(formatTime(entry.end_time))}</div><span class="class-code">${escapeHtml(entry.course_code || "BSSE")}</span><h3>${escapeHtml(entry.course_name || "Class")}</h3><p class="class-instructor">${escapeHtml(entry.instructor || "Course instructor")}</p><span class="class-room">${icon("pin")} ${escapeHtml(entry.room || "Room TBA")}</span></article>`).join("")}</div></section>`).join("")
    : `<div class="empty-state grid-empty"><span class="empty-illustration">🗓️</span><strong>Space to shape your week.</strong><p>Your class schedule will show up here when it’s ready.</p></div>`;
}

function renderAssignments() {
  const assignments = [...state.data.assignments].sort((left, right) => new Date(left.due_at) - new Date(right.due_at));
  const upcoming = assignments.filter((item) => new Date(item.due_at) >= new Date());
  const nearest = upcoming[0];
  $("#assignment-summary").innerHTML = `<span class="assignment-summary-icon">${icon("sparkle")}</span><span><strong>${upcoming.length ? `${upcoming.length} ${upcoming.length === 1 ? "upcoming deadline" : "upcoming deadlines"}` : "A clear runway."}</strong><small>${nearest ? `Next up: ${escapeHtml(nearest.title)} · ${escapeHtml(formatDate(nearest.due_at, { month: "long", day: "numeric" }))}` : "No upcoming deadlines — enjoy the breathing room."}</small></span>`;
  $("#assignments-list").innerHTML = assignments.length
    ? assignments.map((assignment, index) => {
      const dueDate = new Date(assignment.due_at);
      const overdue = dueDate < new Date();
      return `<article class="assignment-card"><div class="assignment-card-top"><span class="assignment-course course-tone-${index % 4}">${escapeHtml(assignment.course_code || "BSSE")}</span><span class="assignment-due ${overdue ? "is-overdue" : ""}">${overdue ? "PAST DUE" : "DUE"} · ${escapeHtml(formatDate(assignment.due_at, { month: "short", day: "numeric" }))}</span></div><h3>${escapeHtml(assignment.title)}</h3><p class="assignment-description">${escapeHtml(assignment.description || "Check with your instructor for submission details.")}</p><div class="assignment-card-foot"><span class="assignment-author"><span class="avatar ${avatarColors[index % avatarColors.length]}">${escapeHtml((assignment.author_name || "I").trim().charAt(0).toUpperCase())}</span><span>Posted by <strong>${escapeHtml(assignment.author_name || "Instructor")}</strong></span></span><span class="assignment-deadline">${icon("clock")}${escapeHtml(formatDate(assignment.due_at, { hour: "numeric", minute: "2-digit" }))}</span></div></article>`;
    }).join("")
    : `<div class="empty-state grid-empty"><span class="empty-illustration">🌱</span><strong>Nothing on the horizon.</strong><p>When assignments arrive, you’ll find them here.</p></div>`;
}

function renderResources() {
  $("#resources-list").innerHTML = RESOURCES.map((resource, index) => `<a class="resource-card" href="${escapeHtml(resource.url)}" target="_blank" rel="noreferrer noopener"><div class="resource-card-top"><span class="resource-emoji">${resource.icon}</span><span class="resource-category">${escapeHtml(resource.category)}</span><span class="resource-external">${icon("external")}</span></div><div class="resource-card-copy"><h3>${escapeHtml(resource.title)}</h3><p>${escapeHtml(resource.description)}</p></div><div class="resource-card-foot"><span class="resource-tag resource-tag-${index % 4}">${escapeHtml(resource.label)}</span><span class="resource-explore">LET’S GO ${icon("arrow")}</span></div></a>`).join("");
}

function renderDirectory() {
  const profiles = state.data.profiles.filter((profile) => {
    const roles = profileRoles(profile);
    const searchable = `${profile.full_name} ${profile.headline} ${profile.bio} ${roleNames(roles)}`.toLowerCase();
    return (state.directoryRole === "all" || roles.includes(state.directoryRole))
      && searchable.includes(state.directorySearch)
      && isSearchMatch(searchable);
  });
  $("#directory-count").textContent = `${profiles.length} ${profiles.length === 1 ? "person" : "people"}`;
  const categories = state.directoryRole === "all" ? Object.keys(roleLabels) : [state.directoryRole];
  const roleIcons = { owner: "shield", technical_team: "wrench", teacher: "book", cr: "sparkle" };
  const roleGroups = categories.map((role) => {
    const members = profiles.filter((profile) => profileRoles(profile).includes(role));
    if (!members.length) return "";
    return `<section class="member-role-group"><header class="member-role-heading"><span class="person-role person-role-${role}">${icon(roleIcons[role] || "users")} ${escapeHtml(roleTitle(role))}</span><span>${members.length} ${members.length === 1 ? "member" : "members"}</span></header><div class="directory-grid">${members.map((person, index) => {
      const fullName = person.full_name?.trim() || "FUSST Member";
      const initials = fullName.split(/\s+/).slice(0, 2).map((part) => part.charAt(0)).join("").toUpperCase();
      const roles = profileRoles(person);
      const linkedin = /^https:\/\/(www\.)?linkedin\.com\//i.test(person.linkedin_url || "") ? person.linkedin_url : "";
      return `<article class="person-card"><div class="person-card-top">${profileAvatar(person, `avatar person-avatar ${avatarColors[index % avatarColors.length]}`, initials, `${fullName} profile photo`)}<span class="person-role-list">${roles.map((item) => `<span class="person-role person-role-${item}">${escapeHtml(roleTitle(item))}</span>`).join("")}</span></div><h3>${escapeHtml(fullName)}</h3><p class="person-headline">${escapeHtml(person.headline || "BSSE classmate")}</p>${person.bio ? `<p class="person-bio">${escapeHtml(person.bio)}</p>` : ""}${linkedin ? `<a class="person-link" href="${escapeHtml(linkedin)}" target="_blank" rel="noopener noreferrer">LinkedIn ${icon("external")}</a>` : ""}</article>`;
    }).join("")}</div></section>`;
  }).join("");
  $("#directory-list").innerHTML = profiles.length
    ? roleGroups
    : `<div class="empty-state grid-empty"><span class="empty-illustration">🫧</span><strong>No classmates found.</strong><p>Try a different name, course, or role.</p></div>`;
}

function renderSupport() {
  const staff = isStaff();
  const currentUserId = state.user?.id;
  const threads = state.supportThreads.filter((thread) => staff || thread.user_id === currentUserId);
  const openCount = threads.filter((thread) => thread.status !== "closed").length;
  $("#support-thread-count").textContent = String(threads.length);
  $("#support-nav-count").textContent = String(staff ? openCount : threads.length);
  $("#support-nav-count").hidden = (staff ? openCount : threads.length) === 0;
  $("#support-list-heading").textContent = staff ? "All requests" : "Your messages";
  $("#new-support-thread").hidden = !state.user;
  const list = $("#support-thread-list");

  if (!state.user) {
    list.innerHTML = `<div class="support-list-empty"><span>🔐</span><strong>Sign in to report an issue</strong><p>Your conversation will stay private and follow you across devices.</p><button class="text-link" type="button" data-open-signin>Sign in to continue ${icon("arrow")}</button></div>`;
  } else if (!threads.length) {
    list.innerHTML = `<div class="support-list-empty"><span>🌿</span><strong>Nothing in your queue.</strong><p>${staff ? "Support conversations will appear here when a student reports an issue." : "You haven’t reported an issue yet. When something goes wrong, we’re here to help."}</p></div>`;
  } else {
    list.innerHTML = threads.map((thread) => {
      const profile = state.supportProfiles.find((person) => person.id === thread.user_id);
      const current = state.activeSupportThreadId === thread.id;
      return `<button class="support-thread-item${current ? " is-active" : ""}" type="button" data-support-thread="${escapeHtml(thread.id)}"><span class="thread-avatar ${avatarColors[(threads.indexOf(thread)) % avatarColors.length]}">${escapeHtml((profile?.full_name || "F").trim().charAt(0).toUpperCase())}</span><span class="thread-item-content"><strong>${escapeHtml(thread.subject)}</strong><span>${staff ? `${escapeHtml(profile?.full_name || "Portal user")} · ` : ""}${escapeHtml(formatDate(thread.updated_at, { month: "short", day: "numeric" }))}</span><small>${escapeHtml(thread.status.replace("_", " "))}</small></span><span class="thread-status-dot status-${escapeHtml(thread.status)}"></span></button>`;
    }).join("");
  }

  const activeThread = threads.find((thread) => thread.id === state.activeSupportThreadId);
  const chat = $("#support-chat-panel");
  if (!activeThread) {
    chat.innerHTML = `<div class="support-chat-empty"><span class="empty-illustration">${state.user ? "💬" : "🛡️"}</span><strong>${state.user ? "How can we help?" : "Help is here when you need it."}</strong><p>${state.user ? "Choose a conversation, or tell our technical team what’s going on." : "Sign in to start a private conversation with the technical team."}</p>${state.user ? '<button class="primary-button" type="button" data-support-new><svg class="icon"><use href="#i-plus"/></svg> Start a conversation</button>' : '<button class="primary-button" type="button" data-open-signin>Sign in to continue</button>'}</div>`;
    return;
  }

  const messages = state.supportMessages.filter((message) => message.thread_id === activeThread.id);
  const profile = state.supportProfiles.find((person) => person.id === activeThread.user_id);
  chat.innerHTML = `<div class="chat-header"><span class="thread-avatar avatar-mint">${escapeHtml((profile?.full_name || "F").trim().charAt(0).toUpperCase())}</span><span class="chat-header-copy"><strong>${escapeHtml(activeThread.subject)}</strong><small>${staff ? escapeHtml(profile?.full_name || "Portal user") : "FUSST technical team"} · <span class="status-text-${escapeHtml(activeThread.status)}">${escapeHtml(activeThread.status.replace("_", " "))}</span></small></span>${staff && activeThread.status !== "closed" ? `<label class="chat-status-control"><span class="visually-hidden">Conversation status</span><select data-support-status="${escapeHtml(activeThread.id)}" aria-label="Change conversation status"><option value="open"${activeThread.status === "open" ? " selected" : ""}>Open</option><option value="in_progress"${activeThread.status === "in_progress" ? " selected" : ""}>In progress</option><option value="closed">Close request</option></select></label>` : ""}</div><div class="chat-message-list" id="chat-message-list">${messages.length ? messages.map((message) => {
    const ownMessage = message.sender_id === currentUserId;
    const sender = ownMessage ? normalizedProfileName(state.profile, state.user) : staff ? "Portal user" : "FUSST Tech Team";
    return `<article class="chat-message${ownMessage ? " is-own" : ""}"><span class="chat-message-sender">${escapeHtml(sender)}</span><div class="chat-bubble">${escapeHtml(message.body)}</div><time>${escapeHtml(formatDate(message.created_at, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }))} · Deletes ${escapeHtml(formatDate(message.expires_at, { month: "short", day: "numeric" }))}</time></article>`;
  }).join("") : '<div class="support-list-empty"><span>👋</span><strong>Conversation started.</strong><p>Send the first message when you’re ready.</p></div>'}</div>${activeThread.status === "closed" ? `<div class="chat-closed-banner">${icon("check")} This support conversation is closed.</div>` : `<form class="chat-reply-form" id="chat-reply-form" data-chat-thread="${escapeHtml(activeThread.id)}"><textarea name="message" rows="2" required maxlength="4000" placeholder="${staff ? "Reply to this student..." : "Add any details that will help us investigate..."}" aria-label="Your message"></textarea><div class="chat-reply-footer"><span>Private conversation · messages expire in 7 days</span><button class="primary-button" type="submit" aria-label="Send message">${icon("send")} Send</button></div></form>`}`;
  requestAnimationFrame(() => {
    const messagesPane = $("#chat-message-list");
    if (messagesPane) messagesPane.scrollTop = messagesPane.scrollHeight;
  });
}

function renderStaffConsole() {
  const owner = isOwner();
  const panel = state.staffPanel;
  $$(".staff-owner-only").forEach((tab) => {
    tab.hidden = !owner;
    tab.tabIndex = owner ? 0 : -1;
  });
  $("#control-description").textContent = owner
    ? "You’re the portal owner. Manage roles, keep members informed, and control availability."
    : "Manage support conversations and help keep the portal running smoothly.";
  const heading = owner ? "Owner control room" : "Technical support desk";
  $("#staff-welcome").innerHTML = `<span class="staff-welcome-icon">${icon(owner ? "shield" : "wrench")}</span><span><strong>${heading}</strong><small>${owner ? "Only you can grant staff roles, send owner notices, or enable maintenance." : "Your technical team role gives you access to private user support requests."}</small></span><span class="staff-access-chip">${icon("check")} VERIFIED ACCESS</span>`;

  if (panel === "people" && owner) {
    renderStaffUsers();
    return;
  }
  if (panel === "support") {
    renderSupportQueue();
    return;
  }
  if (panel === "notices" && owner) {
    $("#staff-panel").innerHTML = `<div class="staff-feature-grid"><article class="staff-feature-card"><span class="staff-feature-icon staff-feature-violet">${icon("megaphone")}</span><span class="section-kicker"><span></span> SHARE WITH YOUR COMMUNITY</span><h2>Write an official update.</h2><p>Publish under your own name, or add a display label. Choose which roles the announcement reaches — or send it to every student by default.</p><button class="primary-button" type="button" data-create="notices"><svg class="icon"><use href="#i-plus"/></svg> Compose a notice</button></article><article class="staff-feature-card staff-privacy-card"><span class="staff-feature-icon staff-feature-mint">${icon("inbox")}</span><span class="section-kicker"><span class="kicker-teal"></span> AUTOMATIC AND IN-APP</span><h2>Everyone gets the memo.</h2><p>Matching users receive an inbox notification as soon as your notice publishes. It appears across sessions and updates in real time. No email configuration needed.</p><span class="staff-inline-chip">${icon("check")} Delivered by a secure database trigger</span></article></div>`;
    return;
  }
  if (panel === "maintenance" && owner) {
    renderMaintenancePanel();
    return;
  }
  renderStaffOverview();
}

function renderStaffOverview() {
  const owner = isOwner();
  const allThreads = state.supportThreads;
  const openThreads = allThreads.filter((thread) => thread.status !== "closed");
  const maintenanceEnabled = state.maintenance?.maintenance_mode === true;
  $("#staff-panel").innerHTML = `<div class="staff-metrics-grid"><article class="staff-metric-card"><span class="staff-metric-icon staff-feature-violet">${icon("headset")}</span><span class="staff-metric-value">${openThreads.length}</span><span class="staff-metric-label">Open support requests</span><button class="text-link" type="button" data-staff-tab="support">Open support queue ${icon("arrow")}</button></article>${owner ? `<article class="staff-metric-card"><span class="staff-metric-icon staff-feature-mint">${icon("users-round")}</span><span class="staff-metric-value">${state.staffUsers.length || "—"}</span><span class="staff-metric-label">Portal accounts</span><button class="text-link" type="button" data-staff-tab="people">Manage user roles ${icon("arrow")}</button></article><article class="staff-metric-card"><span class="staff-metric-icon ${maintenanceEnabled ? "staff-feature-coral" : "staff-feature-mint"}">${icon(maintenanceEnabled ? "settings" : "check")}</span><span class="staff-metric-value">${maintenanceEnabled ? "Paused" : "Live"}</span><span class="staff-metric-label">Portal availability</span><button class="text-link" type="button" data-staff-tab="maintenance">Site controls ${icon("arrow")}</button></article>` : ""}</div><div class="staff-section-heading"><div><span class="section-kicker"><span></span> YOUR ROLE, YOUR TOOLS</span><h2>${owner ? "Everything under control." : "People first, fixes next."}</h2></div></div><div class="staff-action-grid">${owner ? `<button class="staff-action-card" type="button" data-staff-tab="people"><span>${icon("users-round")}</span><strong>Manage roles</strong><small>Assign any combination of student, CR, teacher, technical team, and owner roles.</small>${icon("arrow", "icon staff-action-arrow")}</button><button class="staff-action-card" type="button" data-staff-tab="notices"><span>${icon("megaphone")}</span><strong>Post an owner notice</strong><small>Send a custom announcement to everyone or select specific roles.</small>${icon("arrow", "icon staff-action-arrow")}</button><button class="staff-action-card" type="button" data-staff-tab="maintenance"><span>${icon("settings")}</span><strong>Site availability</strong><small>Schedule maintenance and let visitors know what’s happening.</small>${icon("arrow", "icon staff-action-arrow")}</button>` : ""}<button class="staff-action-card" type="button" data-staff-tab="support"><span>${icon("headset")}</span><strong>Help someone out</strong><small>Reply privately to user-reported website problems.</small>${icon("arrow", "icon staff-action-arrow")}</button></div><p class="staff-security-note">${icon("lock")} <span>Role changes and site controls are verified and logged by Supabase. You can’t grant yourself privileges through the role preview.</span></p>`;
}

function renderStaffUsers() {
  const roles = Object.keys(roleLabels);
  $("#staff-panel").innerHTML = `<div class="admin-intro"><div><span class="section-kicker"><span></span> ONLY THE OWNER CAN MAKE CHANGES</span><h2>People & roles</h2><p>Assign any combination of roles. Changes are verified by Supabase and recorded in the audit log.</p></div><span class="staff-owner-badge">${icon("shield")} OWNER ONLY</span></div>${state.staffUsers.length ? `<div class="users-table-wrap"><table class="users-table"><thead><tr><th>PORTAL MEMBER</th><th>JOINED</th><th>VERIFIED ROLES</th><th>MANAGE ROLES</th></tr></thead><tbody>${state.staffUsers.map((user, index) => {
    const activeRoles = profileRoles(user);
    return `<tr><td><div class="user-identity"><span class="avatar ${avatarColors[index % avatarColors.length]}">${escapeHtml((user.full_name || user.email || "F").trim().charAt(0).toUpperCase())}</span><span><strong>${escapeHtml(user.full_name || "Unnamed student")}</strong><small>${escapeHtml(user.email || "")}</small></span></div></td><td>${escapeHtml(formatDate(user.created_at, { month: "short", day: "numeric", year: "numeric" }))}</td><td><div class="person-role-list">${activeRoles.map((role) => `<span class="person-role person-role-${escapeHtml(role)}">${escapeHtml(roleTitle(role))}</span>`).join("")}</div></td><td><fieldset class="role-checkboxes"><legend class="visually-hidden">Roles for ${escapeHtml(user.email || user.full_name)}</legend>${roles.map((role) => `<label><input type="checkbox" value="${role}" data-role-user="${escapeHtml(user.user_id)}"${activeRoles.includes(role) ? " checked" : ""}><span>${escapeHtml(roleTitle(role))}</span></label>`).join("")}</fieldset></td></tr>`;
  }).join("")}</tbody></table></div><p class="staff-security-note">${icon("lock")} <span>Only this owner-verified interface can update roles. The database prevents removing the last owner.</span></p>` : `<div class="empty-state"><span class="empty-illustration">👥</span><strong>No portal accounts found.</strong><p>Accounts will appear here after students sign up.</p></div>`}`;
}

function renderSupportQueue() {
  const threads = state.supportThreads;
  const openCount = threads.filter((thread) => thread.status !== "closed").length;
  $("#staff-panel").innerHTML = `<div class="admin-intro"><div><span class="section-kicker"><span class="kicker-teal"></span> PRIVATE, SEVEN-DAY CONVERSATIONS</span><h2>Support queue</h2><p>${openCount} active ${openCount === 1 ? "request" : "requests"}. Select a conversation to reply directly from the Support section.</p></div><button class="secondary-button" type="button" data-refresh-support>${icon("refresh")} Refresh queue</button></div>${threads.length ? `<div class="support-queue-list">${threads.map((thread) => {
    const profile = state.supportProfiles.find((person) => person.id === thread.user_id);
    return `<button class="support-queue-item" type="button" data-open-thread="${escapeHtml(thread.id)}"><span class="thread-avatar avatar-mint">${escapeHtml((profile?.full_name || "F").trim().charAt(0).toUpperCase())}</span><span class="support-queue-copy"><strong>${escapeHtml(thread.subject)}</strong><small>${escapeHtml(profile?.full_name || "Portal user")} · ${escapeHtml(formatDate(thread.updated_at, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }))}</small></span><span class="support-status-pill status-${escapeHtml(thread.status)}">${escapeHtml(thread.status.replace("_", " "))}</span>${icon("chevron", "icon")}</button>`;
  }).join("")}</div>` : `<div class="empty-state"><span class="empty-illustration">🫶</span><strong>Your queue is clear.</strong><p>New student issue reports will arrive here.</p></div>`}`;
}

function renderMaintenancePanel() {
  const enabled = state.maintenance.maintenance_mode;
  $("#staff-panel").innerHTML = `<div class="maintenance-control-card${enabled ? " is-maintenance" : ""}"><div class="maintenance-card-top"><span class="maintenance-icon">${icon(enabled ? "settings" : "check")}</span><span class="maintenance-state ${enabled ? "state-paused" : "state-live"}"><i></i> ${enabled ? "MAINTENANCE MODE ON" : "PORTAL IS LIVE"}</span></div><h2>${enabled ? "The site is in maintenance mode." : "Everything’s up and running."}</h2><p>${enabled ? "Members currently see a calm maintenance page. You can still access your owner console." : "Turning this on temporarily hides portal pages from members. You and the technical team can still access support and the staff console."}</p><form id="maintenance-form" class="maintenance-form"><label class="form-field">Message shown to visitors<textarea name="message" rows="3" maxlength="500" required>${escapeHtml(state.maintenance.maintenance_message || "We’ll be right back. The portal is undergoing scheduled maintenance.")}</textarea></label><label class="maintenance-toggle-row"><span><strong>Maintenance mode</strong><small>The portal owner can always sign in and access the owner console.</small></span><input type="checkbox" name="enabled"${enabled ? " checked" : ""}><span class="maintenance-switch" aria-hidden="true"></span></label><div class="maintenance-actions"><span>${icon("lock")} Only owners can change availability.</span><button class="primary-button" type="submit">${icon("check")} Save site settings</button></div></form></div><div class="staff-audit-card"><div class="section-kicker"><span></span> OWNER ACTIVITY</div><h3>Recent changes</h3><div id="audit-log-list"><span class="loading-copy">Loading the audit log…</span></div></div>`;
  void loadStaffAuditLog();
}

async function loadStaffAuditLog() {
  const container = $("#audit-log-list");
  if (!container) return;
  try {
    const rows = await fetchRows("staff_audit_log");
    if (!$("#audit-log-list")) return;
    $("#audit-log-list").innerHTML = rows.length
      ? rows.slice(0, 8).map((row) => `<div class="audit-log-item"><span class="audit-log-icon">${icon(row.action.includes("maintenance") ? "settings" : "users")}</span><span><strong>${escapeHtml(row.action.replaceAll("_", " "))}</strong><small>${escapeHtml(formatDate(row.created_at, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }))}</small></span></div>`).join("")
      : `<p class="audit-log-empty">Your administrative actions will appear here.</p>`;
  } catch (error) {
    container.textContent = error.message || "Unable to load the owner activity log.";
  }
}

async function openSupportThread(threadId) {
  state.activeSupportThreadId = threadId;
  state.supportMessages = [];
  renderSupport();
  try {
    state.supportMessages = await fetchSupportMessages(threadId);
  } catch (error) {
    toast(error.message || "Could not load this conversation.", "error");
  }
  renderSupport();
}

function renderAll() {
  renderDashboard();
  renderNotices();
  renderTimetable();
  renderAssignments();
  renderResources();
  renderDirectory();
  renderInbox();
  renderSupport();
  if (isStaff()) renderStaffConsole();
}

function updateRoleControls() {
  const picker = $("#role-switcher");
  const role = effectiveRole();
  picker.value = role;
  picker.disabled = Boolean(state.user);
  const verifiedRoles = profileRoles(state.profile);
  const isPrivileged = isPoster();
  $$(".post-button").forEach((button) => {
    button.classList.toggle("is-role-visible", isPrivileged);
    button.setAttribute("aria-hidden", String(!isPrivileged));
    button.tabIndex = isPrivileged ? 0 : -1;
  });

  $("#role-mode-caption").textContent = state.user
    ? `Verified roles: ${roleNames(verifiedRoles) || "BSSE Student"}`
    : isSupabaseConfigured()
      ? "Preview a role · sign in to use your account"
      : "Preview roles · publishing requires sign-in";
  $("#role-hint").textContent = state.user
    ? isPrivileged ? "Your verified account can publish." : "Your account has read-only access."
    : "Visual preview only · role previews never unlock privileged controls.";
  $("#sidebar-user-name").textContent = normalizedProfileName(state.profile, state.user);
  $("#sidebar-user-role").textContent = state.user ? roleNames(verifiedRoles) || roleTitle("student") : roleTitle(role);
  const sidebarInitial = normalizedProfileName(state.profile, state.user).trim().charAt(0).toUpperCase() || "Y";
  const sidebarPhoto = state.profile?.avatar_path ? getProfilePhotoUrl(state.profile.avatar_path) : "";
  $("#sidebar-user-avatar").innerHTML = sidebarPhoto ? `<img src="${escapeHtml(sidebarPhoto)}" alt="">` : escapeHtml(sidebarInitial);
  $("#auth-button").innerHTML = state.user
    ? `Sign out ${icon("arrow")}`
    : `Sign in ${icon("arrow")}`;
  const staffLink = $(".staff-nav-link");
  staffLink.hidden = !isStaff();
  staffLink.tabIndex = isStaff() ? 0 : -1;
  if (!isStaff() && $("#section-control").classList.contains("is-visible")) {
    navigateTo("dashboard");
  }
  const maintenanceEnabled = state.maintenance?.maintenance_mode === true;
  $("#maintenance-indicator").hidden = !maintenanceEnabled || !isOwner();
  $("#maintenance-screen").hidden = !maintenanceEnabled || isOwner();
  $("#maintenance-message").textContent = state.maintenance?.maintenance_message
    || "We’ll be right back. The portal is undergoing scheduled maintenance.";
  $("#maintenance-signin").hidden = Boolean(state.user);
  $("#maintenance-owner-hint").hidden = Boolean(state.user);
  document.body.classList.toggle(
    "maintenance-active",
    maintenanceEnabled && !isOwner(),
  );
}

function openDialog(content, mode) {
  state.dialogMode = mode;
  state.dialogBusy = false;
  $("#dialog-fields").innerHTML = content.fields;
  $("#dialog-icon").innerHTML = icon(content.icon);
  $("#dialog-eyebrow").textContent = content.eyebrow;
  $("#dialog-title").textContent = content.title;
  $("#dialog-description").textContent = content.description;
  $("#dialog-submit").querySelector("span").textContent = content.submitLabel;
  $("#dialog-footnote").textContent = content.footnote;
  $("#dialog-error").hidden = true;
  $("#dialog-submit").disabled = false;
  $("#dialog-submit").hidden = false;
  const dialog = $("#app-dialog");
  if (!dialog.open) dialog.showModal();
  $("#dialog-fields").querySelector("input:not([type=hidden]), textarea, select")?.focus();
}

function localDateInputValue(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseTimetableCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  const input = String(text || "").replace(/\r\n?/g, "\n");
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character === '"' && quoted && input[index + 1] === '"') {
      value += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(value.trim());
      value = "";
    } else if (character === "\n" && !quoted) {
      row.push(value.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      value = "";
    } else {
      value += character;
    }
  }
  if (quoted) throw new Error("Close the quotation mark in your timetable CSV.");
  row.push(value.trim());
  if (row.some(Boolean)) rows.push(row);
  const firstRow = rows[0]?.map((cell) => cell.toLowerCase().replaceAll(" ", "_")) ?? [];
  if (firstRow[0] === "day" || firstRow[0] === "day_of_week") rows.shift();
  if (!rows.length) throw new Error("Paste at least one timetable class.");
  if (rows.length > 100) throw new Error("A single schedule can contain at most 100 classes.");

  const entries = rows.map((cells, index) => {
    if (cells.length !== 7) throw new Error(`CSV row ${index + 1} needs exactly 7 columns.`);
    const dayText = cells[0].toLowerCase();
    const day = /^\d$/.test(dayText) ? Number(dayText) : weekDayNames.findIndex((name) => name.toLowerCase() === dayText);
    const [startTime, endTime] = [cells[3], cells[4]];
    if (day < 0 || day > 6) throw new Error(`CSV row ${index + 1} has an invalid day.`);
    const validTime = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
    if (!validTime.test(startTime) || !validTime.test(endTime) || endTime <= startTime) {
      throw new Error(`CSV row ${index + 1} needs valid 24-hour start and end times.`);
    }
    if (!cells[1] || cells[1].length > 30 || !cells[2] || cells[2].length > 120
      || cells[5].length > 120 || cells[6].length > 80) {
      throw new Error(`CSV row ${index + 1} has a missing or oversized course, instructor, or room field.`);
    }
    return {
      day_of_week: day,
      course_code: cells[1].toUpperCase(),
      course_name: cells[2],
      start_time: startTime,
      end_time: endTime,
      instructor: cells[5],
      room: cells[6],
    };
  });
  for (let first = 0; first < entries.length; first += 1) {
    for (let second = first + 1; second < entries.length; second += 1) {
      const left = entries[first];
      const right = entries[second];
      if (left.day_of_week === right.day_of_week
        && left.start_time < right.end_time
        && right.start_time < left.end_time) {
        throw new Error(`${weekDayNames[left.day_of_week]} has overlapping classes (${left.course_code} and ${right.course_code}).`);
      }
    }
  }
  return entries;
}

function openComposer(table) {
  const postingRole = effectiveRole();
  const roleMessage = state.user
    ? ["cr", "teacher", "owner"].includes(postingRole)
      ? `Publishing with your verified ${roleTitle(postingRole)} role.`
      : "Only authorized Class Representatives, Teachers, and Owners can publish."
    : "This is a role preview. Sign in with an authorized account to publish.";
  const commonRequired = '<span class="required-marker" aria-hidden="true">*</span>';
  if (table === "notices") {
    const ownerFields = isOwner()
      ? `<label class="form-field">Audience<select name="audience" required><option value="all">Everyone</option><option value="students">Students</option><option value="cr">Class representatives</option><option value="teachers">Teachers</option><option value="technical_team">Technical team</option><option value="owner">Portal owners</option></select></label><label class="form-field">Display as (optional)<input name="author_name" maxlength="120" placeholder="e.g. FUSST Portal Administration" autocomplete="off"></label>`
      : "";
    openDialog({
      icon: "megaphone",
      eyebrow: "MAKE IT OFFICIAL",
      title: "Share an update.",
      description: "A clear announcement goes a long way.",
      submitLabel: "Publish notice",
      footnote: roleMessage,
      fields: `<label class="form-field">Notice title ${commonRequired}<input name="title" required maxlength="160" placeholder="What should everyone know?" autocomplete="off"></label><label class="form-field">Category<select name="category" required><option value="academic">Academic</option><option value="events">Events</option><option value="urgent">Important</option>${isOwner() ? '<option value="community">Community update</option>' : ""}</select></label>${ownerFields}<label class="form-field">The details ${commonRequired}<textarea name="body" required maxlength="5000" rows="5" placeholder="Add the details your classmates need..."></textarea></label><label class="checkbox-field"><input type="checkbox" name="is_pinned"><span>Pin this notice for the whole batch</span></label>`,
    }, "publish:notices");
    return;
  }
  if (table === "assignments") {
    openDialog({
      icon: "clipboard",
      eyebrow: "ONE THING AT A TIME",
      title: "Add an assignment.",
      description: "Give everyone enough time to plan their next steps.",
      submitLabel: "Publish assignment",
      footnote: roleMessage,
      fields: `<label class="form-field">Assignment title ${commonRequired}<input name="title" required maxlength="160" placeholder="e.g. Database design project" autocomplete="off"></label><label class="form-field">Course code<input name="course_code" maxlength="30" placeholder="e.g. SE-301" autocomplete="off"></label><label class="form-field">Due date and time ${commonRequired}<input name="due_at" type="datetime-local" required></label><label class="form-field">Description<textarea name="description" maxlength="5000" rows="4" placeholder="What should students prepare?"></textarea></label>`,
    }, "publish:assignments");
    return;
  }
  const profile = state.profile || {};
  const section = profile.section || "A";
  const semester = profile.semester || 5;
  openDialog({
    icon: "calendar",
    eyebrow: "BULK PUBLISH · VERSIONED SCHEDULE",
    title: "Plan a whole week.",
    description: "Paste a spreadsheet-ready CSV. Supabase validates the whole schedule and replaces it atomically for the selected section and effective dates.",
    submitLabel: "Publish schedule",
    footnote: roleMessage,
    fields: `<div class="form-field-row"><label class="form-field">Semester<select name="semester" required>${Array.from({ length: 8 }, (_, index) => index + 1).map((item) => `<option value="${item}"${Number(semester) === item ? " selected" : ""}>Semester ${item}</option>`).join("")}</select></label><label class="form-field">Section<input name="section" required maxlength="12" value="${escapeHtml(section)}" autocomplete="off"></label></div><div class="form-field-row"><label class="form-field">Effective from<input name="valid_from" type="date" required value="${localDateInputValue()}"></label><label class="form-field">Effective until<input name="valid_until" type="date"></label></div><label class="form-field">Repeat<select name="recurrence"><option value="all">Every week</option><option value="odd">Odd-numbered weeks</option><option value="even">Even-numbered weeks</option></select></label><label class="form-field">Weekly schedule CSV ${commonRequired}<textarea name="schedule_csv" required rows="10" spellcheck="false" placeholder="day,course_code,course_name,start_time,end_time,instructor,room&#10;Monday,SE-301,Software Design,08:30,10:00,Dr. Khan,Lab 04&#10;Wednesday,CS-306,Database Systems,10:15,11:45,Sir Ahsan,Room 12"></textarea></label><p class="form-help">One class per row; use 24-hour times. Dates are inclusive. Leave “Effective until” blank for an open-ended schedule. Uploading the same section and dates replaces that schedule as one database transaction.</p>`,
  }, "publish:timetable");
}

function openProfileEditor() {
  if (!state.user || !state.profile) {
    openAuthDialog();
    return;
  }
  const profile = state.profile;
  const initials = normalizedProfileName(profile, state.user).trim().charAt(0).toUpperCase() || "Y";
  const currentPhoto = profileAvatar(profile, "avatar profile-photo-preview", initials, "Current profile photo");
  openDialog({
    icon: "users-round",
    eyebrow: "YOUR MEMBER PROFILE",
    title: "Make it yours.",
    description: "Share the details and photo you want your classmates to see. Your email and account roles stay private; photos are viewable by signed-in classmates.",
    submitLabel: "Save profile",
    footnote: "Profile updates and photos are saved to your Supabase account.",
    fields: `<div class="profile-photo-field">${currentPhoto}<div><label class="form-field">Profile photo<input id="profile-photo-input" name="profile_photo" type="file" accept="image/jpeg,image/png,image/webp"></label><small>Choose an image from your gallery (JPG, PNG, or WebP, up to 5 MB).</small></div></div><label class="form-field">Display name<input name="full_name" required maxlength="100" value="${escapeHtml(profile.full_name || "")}"></label><label class="form-field">Headline<input name="headline" maxlength="120" value="${escapeHtml(profile.headline || "")}" placeholder="e.g. BSSE student · UI developer"></label><label class="form-field">About<textarea name="bio" rows="4" maxlength="500" placeholder="A little about your interests, projects, or goals">${escapeHtml(profile.bio || "")}</textarea></label><label class="form-field">LinkedIn profile<input name="linkedin_url" type="url" maxlength="300" value="${escapeHtml(profile.linkedin_url || "")}" placeholder="https://www.linkedin.com/in/your-name"></label>`,
  }, "profile:edit");
}

function openSupportDialog() {
  if (!state.user) {
    openAuthDialog();
    return;
  }
  openDialog({
    icon: "headset",
    eyebrow: "WE’RE HERE TO HELP",
    title: "Tell us what’s wrong.",
    description: "Your report is private. The technical team can reply here in the portal.",
    submitLabel: "Send to technical team",
    footnote: "Only you and authorized technical team members can see this conversation. Messages are automatically deleted after 7 days.",
    fields: `<label class="form-field">What do you need help with? <span class="required-marker" aria-hidden="true">*</span><input name="subject" required maxlength="160" placeholder="e.g. I can’t open my timetable" autocomplete="off"></label><label class="form-field">Tell us a little more <span class="required-marker" aria-hidden="true">*</span><textarea name="message" required maxlength="4000" rows="5" placeholder="What happened? What did you expect to happen?"></textarea></label>`,
  }, "support:create");
}

function openAuthDialog(mode = "signin") {
  const registering = mode === "signup";
  openDialog({
    icon: "users",
    eyebrow: "WELCOME TO YOUR COMMUNITY",
    title: registering ? "Your next chapter starts here." : "Good to have you back.",
    description: registering
      ? "Create an account with your email. New accounts start with student access."
      : "Sign in to access your class community and the latest updates.",
    submitLabel: registering ? "Create my account" : "Sign in",
    footnote: registering
      ? "Your role is assigned by your portal administrator — it cannot be chosen at sign-up."
      : "New to the portal? Create an account below.",
    fields: `${registering ? `<label class="form-field">Your name <span class="required-marker" aria-hidden="true">*</span><input name="full_name" required maxlength="120" placeholder="First and last name" autocomplete="name"></label>` : ""}<label class="form-field">Email address <span class="required-marker" aria-hidden="true">*</span><input name="email" type="email" required autocomplete="email" placeholder="you@example.com"></label><label class="form-field">Password <span class="required-marker" aria-hidden="true">*</span><input name="password" type="password" required minlength="6" autocomplete="${registering ? "new-password" : "current-password"}" placeholder="${registering ? "At least 6 characters" : "Your password"}"></label>${!registering ? `<button class="dialog-mode-link" id="auth-switch-signup" type="button">New to FUSST Hub? <strong>Create an account</strong></button>` : `<button class="dialog-mode-link" id="auth-switch-signin" type="button">Already have an account? <strong>Sign in instead</strong></button>`}`,
  }, registering ? "auth:signup" : "auth:signin");
  $("#auth-switch-signup")?.addEventListener("click", () => openAuthDialog("signup"));
  $("#auth-switch-signin")?.addEventListener("click", () => openAuthDialog("signin"));
}

function showDialogError(message) {
  const error = $("#dialog-error");
  error.textContent = message;
  error.hidden = false;
}

function buildInsertPayload(table, formData) {
  if (table === "notices") {
    const notice = {
      title: String(formData.get("title")).trim(),
      body: String(formData.get("body")).trim(),
      category: formData.get("category"),
      is_pinned: formData.get("is_pinned") === "on",
      author_name: normalizedProfileName(state.profile, state.user),
    };
    if (isOwner()) {
      notice.audience = formData.get("audience") || "all";
      notice.author_name = String(formData.get("author_name") || "").trim();
    }
    return notice;
  }
  if (table === "assignments") {
    const rawDueAt = String(formData.get("due_at"));
    if (!rawDueAt || Number.isNaN(new Date(rawDueAt).getTime())) throw new Error("Choose a valid assignment due date and time.");
    return {
      title: String(formData.get("title")).trim(),
      course_code: String(formData.get("course_code") || "").trim().toUpperCase(),
      due_at: new Date(rawDueAt).toISOString(),
      description: String(formData.get("description") || "").trim(),
      author_name: normalizedProfileName(state.profile, state.user),
    };
  }
  const startTime = String(formData.get("start_time"));
  const endTime = String(formData.get("end_time"));
  if (!startTime || !endTime || endTime <= startTime) throw new Error("The class must end after it starts.");
  return {
    course_name: String(formData.get("course_name")).trim(),
    course_code: String(formData.get("course_code")).trim().toUpperCase(),
    day_of_week: Number(formData.get("day_of_week")),
    start_time: `${startTime}:00`,
    end_time: `${endTime}:00`,
    instructor: String(formData.get("instructor") || "").trim(),
    room: String(formData.get("room") || "").trim(),
  };
}

async function handleDialogSubmit(event) {
  event.preventDefault();
  if (state.dialogBusy) return;

  const form = event.target;
  if (!form.reportValidity()) return;
  const formData = new FormData(form);
  state.dialogBusy = true;
  const submit = $("#dialog-submit");
  submit.disabled = true;

  try {
    if (state.dialogMode === "auth:signin") {
      const result = await signIn(String(formData.get("email")).trim(), String(formData.get("password")));
      state.user = result.user;
      state.profile = await getCurrentProfile();
      const dialog = $("#app-dialog");
      if (dialog.open) dialog.close();
      await refreshData();
    } else if (state.dialogMode === "auth:signup") {
      const { user, session } = await signUp(
        String(formData.get("email")).trim(),
        String(formData.get("password")),
        String(formData.get("full_name")).trim(),
      );
      if (!user) throw new Error("The account could not be created. Please try again.");
      if (!session) {
        $("#dialog-fields").innerHTML = `<div class="signup-confirmation"><span>✉️</span><strong>Check your inbox.</strong><p>We’ve sent an email to <strong>${escapeHtml(user.email)}</strong>. Confirm your address to finish creating your account.</p></div>`;
        $("#dialog-submit").hidden = true;
        $("#dialog-footnote").textContent = "Once your email is confirmed, you can sign in here.";
      } else {
        state.user = user;
        state.profile = await getCurrentProfile();
        const dialog = $("#app-dialog");
        if (dialog.open) dialog.close();
        await refreshData();
      }
    } else if (state.dialogMode === "support:create") {
      const threadId = await createSupportThread(
        String(formData.get("subject")).trim(),
        String(formData.get("message")).trim(),
      );
      $("#app-dialog").close();
      await refreshData();
      navigateTo("support");
      await openSupportThread(threadId);
      toast("Your issue was sent to the technical team.");
    } else if (state.dialogMode === "profile:edit") {
      const previousAvatarPath = state.profile.avatar_path || "";
      const photo = formData.get("profile_photo");
      let uploadedAvatarPath = "";
      let avatarPath = previousAvatarPath;
      if (photo instanceof File && photo.size > 0) {
        uploadedAvatarPath = await uploadProfilePhoto(photo);
        avatarPath = uploadedAvatarPath;
      }
      try {
        await updateMyProfile({
          full_name: String(formData.get("full_name")).trim(),
          headline: String(formData.get("headline") || "").trim(),
          bio: String(formData.get("bio") || "").trim(),
          linkedin_url: String(formData.get("linkedin_url") || "").trim(),
          avatar_path: avatarPath,
        });
      } catch (error) {
        if (uploadedAvatarPath) {
          try {
            await deleteProfilePhoto(uploadedAvatarPath);
          } catch (cleanupError) {
            console.error("Could not remove an unreferenced profile photo after a failed profile update.", cleanupError);
          }
        }
        throw error;
      }
      let photoCleanupError = null;
      if (previousAvatarPath && previousAvatarPath !== avatarPath) {
        try {
          await deleteProfilePhoto(previousAvatarPath);
        } catch (error) {
          photoCleanupError = error;
          console.error("The profile was updated, but its previous photo could not be removed.", error);
        }
      }
      $("#app-dialog").close();
      await refreshData();
      toast(photoCleanupError
        ? "Profile updated, but the previous photo could not be removed. Please contact the technical team."
        : "Your member profile has been updated.", photoCleanupError ? "error" : "success");
    } else if (state.dialogMode?.startsWith("publish:")) {
      if (!state.user) {
        showDialogError("Sign in with your authorized account before publishing.");
        return;
      }
      if (!isPoster()) {
        showDialogError("This account can’t publish. Ask a portal administrator to assign the CR, Teacher, or Owner role.");
        return;
      }
      const table = state.dialogMode.split(":")[1];
      if (table === "timetable") {
        const validFrom = String(formData.get("valid_from"));
        const validUntil = String(formData.get("valid_until") || "");
        if (validUntil && validUntil < validFrom) throw new Error("The effective end date must be on or after the start date.");
        const entries = parseTimetableCsv(formData.get("schedule_csv"));
        const inserted = await publishTimetableWeek({
          entries,
          semester: Number(formData.get("semester")),
          section: String(formData.get("section")).trim().toUpperCase(),
          validFrom,
          validUntil,
          recurrence: String(formData.get("recurrence")),
        });
        $("#app-dialog").close();
        await refreshData();
        toast(`${inserted} ${inserted === 1 ? "class" : "classes"} published to the timetable.`);
        return;
      }
      const payload = buildInsertPayload(table, formData);
      await insertRow(table, payload);
      $("#app-dialog").close();
      await refreshData();
      toast(table === "notices" ? "Your notice is now live." : table === "assignments" ? "Your assignment has been posted." : "The timetable has been updated.");
    }
  } catch (error) {
    showDialogError(error.message || "Something went wrong. Please try again.");
  } finally {
    state.dialogBusy = false;
    if ($("#dialog-submit").isConnected) $("#dialog-submit").disabled = false;
  }
}

async function refreshData() {
  state.loadError = null;
  $(".connection-error")?.remove();
  if (!isSupabaseConfigured()) {
    state.data = { notices: [], assignments: [], timetable: [], profiles: [] };
    state.profile = null;
    state.notifications = [];
    state.supportThreads = [];
    state.supportMessages = [];
    state.supportProfiles = [];
    state.staffUsers = [];
    state.maintenance = null;
    setLoadError("Add your Supabase URL and publishable key in js/config.js to load live portal data.");
  } else {
    try {
      await initializeSupabase();
      state.maintenance = await getPortalSettings();
      if (!state.user) {
        state.data = { notices: [], assignments: [], timetable: [], profiles: [] };
        state.profile = null;
        state.notifications = [];
        state.supportThreads = [];
        state.supportMessages = [];
        state.supportProfiles = [];
        state.staffUsers = [];
      } else {
        const [notices, assignments, timetable, profiles, notifications, supportThreads, profile] = await Promise.all([
          fetchRows("notices"),
          fetchRows("assignments"),
          fetchRows("timetable"),
          fetchRows("profiles"),
          fetchRows("user_notifications"),
          fetchRows("support_threads"),
          getCurrentProfile(),
        ]);
        state.data = { notices, assignments, timetable, profiles };
        $("#timetable-semester").value = String(profile.semester || 5);
        $("#timetable-semester").dataset.initialized = "true";
        $("#timetable-section").value = profile.section || "A";
        state.notifications = notifications;
        state.supportThreads = supportThreads;
        state.supportProfiles = profiles;
        state.profile = {
          ...profile,
          avatar_path: profiles.find((member) => member.id === profile.id)?.avatar_path || "",
        };
        state.staffUsers = [];
        if (profileRoles(profile).includes("owner")) {
          state.staffUsers = await fetchPortalUsers();
        }
      }
    } catch (error) {
      state.data = { notices: [], assignments: [], timetable: [], profiles: [] };
      state.maintenance = null;
      state.profile = null;
      state.notifications = [];
      state.supportThreads = [];
      state.supportMessages = [];
      state.supportProfiles = [];
      state.staffUsers = [];
      setLoadError(error.message || "Check your Supabase connection and database migration.");
    }
  }

  updateRoleControls();
  renderAll();
  if (isSupabaseConfigured()) {
    await initializeRealtime();
  } else {
    clearRealtime();
  }
}

function clearRealtime() {
  for (const unsubscribe of state.liveSubscriptions) unsubscribe();
  state.liveSubscriptions = [];
  state.subscriptionsForUser = null;
}

async function initializeRealtime() {
  const userId = state.user?.id ?? null;
  const subscriptionKey = userId ?? "anonymous";
  if (state.subscriptionsForUser === subscriptionKey) return;
  clearRealtime();
  state.subscriptionsForUser = subscriptionKey;

  const subscriptions = userId
    ? [
      ["user_notifications", `user_id=eq.${userId}`],
      ["support_threads", null],
      ["support_messages", null],
      ["profiles", `id=eq.${userId}`],
    ]
    : [];

  try {
    for (const [table, filter] of subscriptions) {
      const unsubscribe = await subscribeToChanges(table, () => {
        void refreshData().catch((error) => {
          console.error("A live portal refresh failed.", error);
          toast("Live updates paused. Refresh the page to retry.", "error");
        });
        if (table === "support_messages" && state.activeSupportThreadId) {
          void loadActiveSupportMessages(state.activeSupportThreadId);
        }
      }, filter);
      state.liveSubscriptions.push(unsubscribe);
    }
    const settingsUnsubscribe = await subscribeToChanges("portal_settings", (payload) => {
      state.maintenance = payload.new ?? state.maintenance;
      updateRoleControls();
    });
    state.liveSubscriptions.push(settingsUnsubscribe);
  } catch (error) {
    clearRealtime();
    console.error("Could not start live portal subscriptions.", error);
    setLoadError("Live updates are unavailable. You can still refresh the portal manually.");
  }
}

async function loadActiveSupportMessages(threadId) {
  try {
    const messages = await fetchSupportMessages(threadId);
    if (state.activeSupportThreadId !== threadId) return;
    state.supportMessages = messages;
    renderSupport();
  } catch (error) {
    toast(error.message || "Could not refresh support messages.", "error");
  }
}

async function refreshStaffPanel() {
  await refreshData();
  if (isOwner()) {
    try {
      state.staffUsers = await fetchPortalUsers();
      renderStaffConsole();
    } catch (error) {
      toast(error.message || "Unable to load owner controls.", "error");
    }
  }
}

function navigateTo(section, { updateHistory = true } = {}) {
  if (section === "control" && !isStaff()) {
    toast("The staff console is available to verified technical team members and the portal owner.", "error");
    section = "dashboard";
  }
  const target = $(`[data-section="${section}"]`) ?? $("#section-dashboard");
  if (!target) return;
  const sectionName = target.dataset.section;

  $$(".page-section").forEach((element) => {
    const active = element === target;
    element.hidden = !active;
    element.classList.toggle("is-visible", active);
  });
  $$("[data-section-link]").forEach((link) => {
    const active = link.dataset.sectionLink === sectionName;
    link.classList.toggle("is-active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  const heading = target.querySelector("h1")?.textContent.replace(".", "") || "Dashboard";
  $("#breadcrumb-current").textContent = heading;
  if (updateHistory && window.location.hash !== `#${sectionName}`) {
    window.history.pushState({ section: sectionName }, "", `#${sectionName}`);
  }
  $("#sidebar").classList.remove("is-open");
  $("#mobile-scrim").classList.remove("is-visible");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try {
    window.localStorage.setItem("fusst-theme", theme);
  } catch (error) {
    console.warn("The appearance preference cannot be saved in this browser.", error);
  }
  $$("button.theme-toggle").forEach((button) => {
    const action = theme === "dark" ? "light" : "dark";
    button.setAttribute("aria-label", `Switch to ${action} mode`);
    button.setAttribute("title", `Switch to ${action} mode`);
    button.innerHTML = icon(theme === "dark" ? "sun" : "moon");
  });
  $("meta[name='theme-color']").setAttribute("content", theme === "dark" ? "#131419" : "#f7f8fc");
}

function initializeTheme() {
  try {
    const savedTheme = window.localStorage.getItem("fusst-theme");
    setTheme(savedTheme === "dark" || savedTheme === "light" ? savedTheme : "light");
  } catch (error) {
    console.warn("The appearance preference cannot be read in this browser.", error);
    setTheme("light");
  }
}

function initializeSearch() {
  $("#notice-filter").addEventListener("input", (event) => {
    state.noticeSearch = event.currentTarget.value.trim().toLowerCase();
    renderNotices();
  });
  $("#directory-filter").addEventListener("input", (event) => {
    state.directorySearch = event.currentTarget.value.trim().toLowerCase();
    renderDirectory();
  });
  $("#directory-role-filter").addEventListener("change", (event) => {
    state.directoryRole = event.currentTarget.value;
    renderDirectory();
  });
  ["timetable-date", "timetable-semester", "timetable-section"].forEach((id) => {
    $(`#${id}`).addEventListener("change", renderTimetable);
  });
  $("#global-search").addEventListener("input", (event) => {
    state.globalSearch = event.currentTarget.value.trim().toLowerCase();
    renderNotices();
    renderDirectory();
    renderDashboard();
    if (state.globalSearch) {
      navigateTo("notices");
      $("#notice-filter").value = event.currentTarget.value;
      state.noticeSearch = state.globalSearch;
      renderNotices();
    }
  });
  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      $("#global-search").focus();
    }
    if (event.key === "Escape") {
      $("#sidebar").classList.remove("is-open");
      $("#mobile-scrim").classList.remove("is-visible");
    }
  });
}

function initializeEvents() {
  $$("[data-section-link]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      navigateTo(link.dataset.sectionLink);
    });
  });
  $$("[data-go]").forEach((button) => {
    button.addEventListener("click", () => navigateTo(button.dataset.go));
  });
  $("#notice-filters").addEventListener("click", (event) => {
    const button = event.target.closest("[data-filter]");
    if (!button) return;
    state.activeNoticeFilter = button.dataset.filter;
    $$("#notice-filters .filter-pill").forEach((pill) => pill.classList.toggle("is-selected", pill === button));
    renderNotices();
  });
  $("#notices-list").addEventListener("click", (event) => {
    if (event.target.closest("#clear-notice-search")) {
      state.noticeSearch = "";
      $("#notice-filter").value = "";
      state.activeNoticeFilter = "all";
      $$("#notice-filters .filter-pill").forEach((pill) => pill.classList.toggle("is-selected", pill.dataset.filter === "all"));
      renderNotices();
    }
  });
  $("#notification-list").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-notification-id]");
    if (!button) return;
    const noticeId = button.dataset.noticeId;
    const notification = state.notifications.find((item) => item.id === button.dataset.notificationId);
    try {
      if (notification && !notification.read_at) {
        button.disabled = true;
        await markNotificationRead(notification.id);
        await refreshData();
      }
      if (noticeId) {
        navigateTo("notices");
        requestAnimationFrame(() => {
          const noticeCard = [...$$("[data-notice-card]")].find((card) => card.dataset.noticeCard === noticeId);
          noticeCard?.scrollIntoView({ behavior: "smooth", block: "center" });
          noticeCard?.focus({ preventScroll: true });
        });
      }
    } catch (error) {
      toast(error.message || "Could not update this notification.", "error");
    }
  });
  $("#inbox-shortcut").addEventListener("click", () => navigateTo("inbox"));
  $("#refresh-inbox").addEventListener("click", async () => {
    try {
      await refreshData();
      toast("Your inbox is up to date.");
    } catch (error) {
      toast(error.message || "Could not refresh your inbox.", "error");
    }
  });
  document.addEventListener("click", async (event) => {
    if (event.target.closest("#maintenance-signin")) {
      openAuthDialog();
      return;
    }
    if (event.target.closest("[data-open-signin]")) {
      openAuthDialog();
      return;
    }
    if (event.target.closest("[data-support-new]") || event.target.closest("#new-support-thread")) {
      openSupportDialog();
      return;
    }
    if (event.target.closest("[data-open-profile-editor]")) {
      openProfileEditor();
      return;
    }
    const deleteNoticeButton = event.target.closest("[data-delete-notice]");
    if (deleteNoticeButton) {
      const notice = state.data.notices.find((item) => item.id === deleteNoticeButton.dataset.deleteNotice);
      if (!notice || !state.user || (!isOwner() && notice.created_by !== state.user.id)) {
        toast("You can delete only your own notices.", "error");
        return;
      }
      if (!window.confirm(`Delete “${notice.title}”? This cannot be undone.`)) return;
      deleteNoticeButton.disabled = true;
      try {
        await deleteNotice(notice.id);
        await refreshData();
        toast("Notice deleted.");
      } catch (error) {
        toast(error.message || "Could not delete this notice.", "error");
        deleteNoticeButton.disabled = false;
      }
      return;
    }
    const button = event.target.closest("[data-create]");
    if (button) {
      openComposer(button.dataset.create);
      return;
    }
    const staffTab = event.target.closest("[data-staff-tab]");
    if (staffTab) {
      const nextPanel = staffTab.dataset.staffTab;
      if (["people", "notices", "maintenance"].includes(nextPanel) && !isOwner()) {
        toast("Only the portal owner can access that control.", "error");
        return;
      }
      state.staffPanel = nextPanel;
      $$("#staff-tabs .staff-tab").forEach((tab) => {
        const selected = tab.dataset.staffTab === nextPanel;
        tab.classList.toggle("is-selected", selected);
        tab.setAttribute("aria-selected", String(selected));
      });
      renderStaffConsole();
      if (nextPanel === "people" && isOwner()) {
        void fetchPortalUsers()
          .then((users) => {
            state.staffUsers = users;
            renderStaffUsers();
          })
          .catch((error) => toast(error.message || "Could not load portal users.", "error"));
      }
      return;
    }
    const threadButton = event.target.closest("[data-support-thread], [data-open-thread]");
    if (threadButton) {
      const threadId = threadButton.dataset.supportThread || threadButton.dataset.openThread;
      navigateTo("support");
      void openSupportThread(threadId);
      return;
    }
    if (event.target.closest("[data-refresh-support]")) {
      void refreshStaffPanel();
    }
  });
  $("#role-switcher").addEventListener("change", (event) => {
    if (state.user) return;
    state.previewRole = event.currentTarget.value;
    updateRoleControls();
    const description = state.previewRole === "student"
      ? "Student preview — just here to explore."
      : `${roleTitle(state.previewRole)} preview — your account role is never changed.`;
    toast(description, "success");
  });
  $$(".theme-toggle").forEach((button) => {
    button.addEventListener("click", () => {
      setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
    });
  });
  $("#menu-toggle").addEventListener("click", () => {
    $("#sidebar").classList.add("is-open");
    $("#mobile-scrim").classList.add("is-visible");
  });
  $("#mobile-scrim").addEventListener("click", () => {
    $("#sidebar").classList.remove("is-open");
    $("#mobile-scrim").classList.remove("is-visible");
  });
  $("#auth-button").addEventListener("click", async () => {
    if (!state.user) {
      openAuthDialog();
      return;
    }
    try {
      await signOut();
      state.user = null;
      state.profile = null;
      state.previewRole = defaultPreviewRole;
      await refreshData();
      toast("You’ve been signed out.");
    } catch (error) {
      toast(error.message || "Could not sign out. Please try again.", "error");
    }
  });
  $("#staff-panel").addEventListener("change", async (event) => {
    const roleInput = event.target.closest("[data-role-user]");
    if (roleInput) {
      if (!isOwner()) {
        toast("Only the verified portal owner can change account roles.", "error");
        return;
      }
      const checkboxes = [...$$(`[data-role-user="${CSS.escape(roleInput.dataset.roleUser)}"]`)];
      checkboxes.forEach((checkbox) => { checkbox.disabled = true; });
      try {
        const selectedRoles = checkboxes.filter((checkbox) => checkbox.checked).map((checkbox) => checkbox.value);
        await changeUserRoles(roleInput.dataset.roleUser, selectedRoles);
        state.staffUsers = await fetchPortalUsers();
        renderStaffUsers();
        toast("The member’s roles were updated and recorded.");
      } catch (error) {
        toast(error.message || "Could not update this member’s roles.", "error");
        try {
          state.staffUsers = await fetchPortalUsers();
          renderStaffUsers();
        } catch (refreshError) {
          console.error("Could not refresh the owner role-management panel.", refreshError);
        }
      }
      return;
    }
    const statusSelect = event.target.closest("[data-support-status]");
    if (statusSelect) {
      statusSelect.disabled = true;
      try {
        await updateSupportThreadStatus(statusSelect.dataset.supportStatus, statusSelect.value);
        await refreshData();
        toast("The support request status was updated.");
      } catch (error) {
        toast(error.message || "Could not update the support request.", "error");
        await refreshData();
      }
    }
  });
  $("#staff-panel").addEventListener("submit", async (event) => {
    if (event.target.id !== "maintenance-form") return;
    event.preventDefault();
    if (!isOwner()) {
      toast("Only the verified portal owner can change maintenance mode.", "error");
      return;
    }
    const form = event.target;
    const submitButton = form.querySelector("[type=submit]");
    const formData = new FormData(form);
    submitButton.disabled = true;
    try {
      await setPortalMaintenance(
        formData.get("enabled") === "on",
        String(formData.get("message")).trim(),
      );
      await refreshData();
      state.staffPanel = "maintenance";
      renderStaffConsole();
      toast(state.maintenance?.maintenance_mode ? "Maintenance mode is now active." : "The portal is live again.");
    } catch (error) {
      toast(error.message || "Could not save the portal settings.", "error");
    } finally {
      if (submitButton.isConnected) submitButton.disabled = false;
    }
  });
  document.addEventListener("submit", async (event) => {
    const form = event.target;
    if (form.id !== "chat-reply-form") return;
    event.preventDefault();
    const submitButton = form.querySelector("[type=submit]");
    if (!form.reportValidity() || !state.user) return;
    const body = String(new FormData(form).get("message")).trim();
    submitButton.disabled = true;
    try {
      await insertRow("support_messages", {
        thread_id: form.dataset.chatThread,
        body,
      });
      await refreshData();
      if (initialSection === "control" && isStaff()) {
        navigateTo("control", { updateHistory: false });
      }
      await openSupportThread(form.dataset.chatThread);
    } catch (error) {
      toast(error.message || "Could not send your support message.", "error");
    } finally {
      if (submitButton.isConnected) submitButton.disabled = false;
    }
  });
  $("#refresh-control").addEventListener("click", async () => {
    try {
      await refreshStaffPanel();
      toast("Staff console refreshed.");
    } catch (error) {
      toast(error.message || "Could not refresh the staff console.", "error");
    }
  });
  $("#dialog-form").addEventListener("submit", handleDialogSubmit);
  $("#dialog-fields").addEventListener("change", (event) => {
    const input = event.target.closest("#profile-photo-input");
    const photo = input?.files?.[0];
    if (!photo) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(photo.type) || photo.size > 5 * 1024 * 1024) {
      input.value = "";
      const preview = $("#profile-photo-preview");
      if (preview?.dataset.previewUrl) URL.revokeObjectURL(preview.dataset.previewUrl);
      if (preview) {
        delete preview.dataset.previewUrl;
        const photoUrl = state.profile?.avatar_path ? getProfilePhotoUrl(state.profile.avatar_path) : "";
        const initial = normalizedProfileName(state.profile, state.user).trim().charAt(0).toUpperCase() || "Y";
        preview.innerHTML = photoUrl ? `<img src="${escapeHtml(photoUrl)}" alt="">` : escapeHtml(initial);
      }
      toast("Choose a JPG, PNG, or WebP image up to 5 MB.", "error");
      return;
    }
    const preview = $("#profile-photo-preview");
    const previousPreview = preview.dataset.previewUrl;
    if (previousPreview) URL.revokeObjectURL(previousPreview);
    const previewUrl = URL.createObjectURL(photo);
    preview.dataset.previewUrl = previewUrl;
    preview.innerHTML = `<img src="${previewUrl}" alt="">`;
  });
  $("#dialog-close").addEventListener("click", () => $("#app-dialog").close());
  $("#dialog-cancel").addEventListener("click", () => $("#app-dialog").close());
  $("#app-dialog").addEventListener("click", (event) => {
    if (event.target === event.currentTarget) event.currentTarget.close();
  });
  $("#app-dialog").addEventListener("close", () => {
    const preview = $("#profile-photo-preview");
    if (preview?.dataset.previewUrl) URL.revokeObjectURL(preview.dataset.previewUrl);
  });
  window.addEventListener("popstate", () => navigateTo(window.location.hash.slice(1) || "dashboard", { updateHistory: false }));
  window.addEventListener("hashchange", () => navigateTo(window.location.hash.slice(1) || "dashboard", { updateHistory: false }));
}

async function initializeAuth() {
  if (!isSupabaseConfigured()) {
    await refreshData();
    return;
  }
  try {
    await initializeSupabase();
    const user = await getCurrentUser();
    if (user) {
      state.user = user;
      state.profile = await getCurrentProfile();
    }
    await onAuthStateChange((event, session) => {
      if (event === "INITIAL_SESSION") return;
      state.user = session?.user ?? null;
      state.profile = null;
      if (event === "SIGNED_OUT") state.previewRole = defaultPreviewRole;
      void refreshData()
        .then(() => {
          if (event === "SIGNED_IN") toast("You’re signed in to FUSST Hub.");
        })
        .catch((error) => {
          console.error("Could not refresh portal data after an authentication change.", error);
          setLoadError("Your sign-in changed, but the portal data could not be refreshed.");
        });
    });
    await refreshData();
  } catch (error) {
    setLoadError(error.message || "The Supabase connection could not be initialized.");
  }
}

function initializeStaticLabels() {
  const todayPakistan = new Intl.DateTimeFormat("en-PK", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "Asia/Karachi",
  }).format(new Date());
  $("#today-label").textContent = todayPakistan;
}

initializeTheme();
initializeStaticLabels();
initializeEvents();
initializeSearch();
const initialSection = window.location.hash.slice(1);
if (initialSection && initialSection !== "control") {
  navigateTo(initialSection, { updateHistory: false });
}
updateRoleControls();
renderAll();
void initializeAuth();
