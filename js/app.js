import {
  fetchRows,
  getCurrentProfile,
  initializeSupabase,
  insertRow,
  isSupabaseConfigured,
  onAuthStateChange,
  signIn,
  signOut,
  signUp,
} from "./supabase.js";

const icon = (name, className = "icon") =>
  `<svg class="${className}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;

const weekDayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const roleLabels = { student: "BSSE Student", cr: "Class Representative", teacher: "Teacher" };
const avatarColors = ["avatar-lilac", "avatar-peach", "avatar-mint", "avatar-blue", "avatar-lemon", "avatar-rose"];
const demoRole = "student";

const dateOffset = (days, hour = 10) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
};

const today = new Date();
const timetableTemplates = [
  { course_code: "SE-301", course_name: "Software Design & Architecture", instructor: "Dr. Mahwish Khan", start_time: "08:30:00", end_time: "10:00:00", room: "Lab 04" },
  { course_code: "CS-306", course_name: "Database Management Systems", instructor: "Sir Ahsan Raza", start_time: "10:15:00", end_time: "11:45:00", room: "Room 12" },
  { course_code: "MTH-205", course_name: "Applied Mathematics", instructor: "Dr. Sana Javed", start_time: "12:15:00", end_time: "13:45:00", room: "Room 08" },
  { course_code: "SE-302", course_name: "Web Engineering", instructor: "Ma’am Hira Saleem", start_time: "14:00:00", end_time: "15:30:00", room: "Lab 02" },
];

const DEMO_DATA = {
  notices: [
    { id: "notice-1", title: "Mid-semester project presentations — schedule & guidelines", body: "BSSE Semester 5 project presentations will take place next week. Each group will have 10 minutes to present and 5 minutes for questions. Please upload your slides before your scheduled slot.", category: "academic", author_name: "Fatima Noor · CR", created_at: dateOffset(-1, 9), is_pinned: true },
    { id: "notice-2", title: "FUSST TechFest 2025 — registrations are now open!", body: "Our biggest tech event is back. Join coding challenges, project showcases, and hands-on workshops. Gather your team and register by Friday to reserve your place.", category: "events", author_name: "BSSE Student Society", created_at: dateOffset(-2, 11), is_pinned: false },
    { id: "notice-3", title: "Database Systems quiz moved to Wednesday", body: "The DBMS quiz has been rescheduled to Wednesday at 10:15 AM during the regular lecture. Coverage remains Chapters 4–6. Bring your student ID.", category: "urgent", author_name: "Dr. Mahwish Khan · Teacher", created_at: dateOffset(-2, 8), is_pinned: true },
    { id: "notice-4", title: "Library extended hours during project week", body: "The central library will stay open until 9:00 PM Sunday through Thursday to give everyone a little extra room to focus. Please remember your campus card at the door.", category: "academic", author_name: "FUSST Student Affairs", created_at: dateOffset(-4, 13), is_pinned: false },
    { id: "notice-5", title: "Guest session: From classroom to your first engineering role", body: "Join FUSST alumni for an honest conversation about getting started in software engineering. Thursday, 2 PM, Main Auditorium. Questions from students are very welcome.", category: "events", author_name: "Computer Science Society", created_at: dateOffset(-6, 10), is_pinned: false },
  ],
  assignments: [
    { id: "assignment-1", title: "Software Architecture Case Study", description: "Analyze the architecture of a real-world software system. Identify the architectural patterns, explain your trade-offs, and include a UML component diagram.", course_code: "SE-301", due_at: dateOffset(2, 23), author_name: "Dr. Mahwish Khan" },
    { id: "assignment-2", title: "Relational Database Design", description: "Design a normalized database schema for the semester project. Include your ERD and justify your normalization decisions.", course_code: "CS-306", due_at: dateOffset(4, 23), author_name: "Sir Ahsan Raza" },
    { id: "assignment-3", title: "Responsive Portfolio Website", description: "Build a portfolio website with semantic HTML and a fully responsive, accessible design.", course_code: "SE-302", due_at: dateOffset(7, 23), author_name: "Ma’am Hira Saleem" },
  ],
  timetable: timetableTemplates.map((entry, index) => ({
    id: `class-${index + 1}`,
    ...entry,
    day_of_week: today.getDay(),
  })),
  profiles: [
    { id: "person-1", full_name: "Fatima Noor", degree: "BSSE", semester: 5, section: "A", role: "cr" },
    { id: "person-2", full_name: "Hamza Tariq", degree: "BSSE", semester: 5, section: "A", role: "student" },
    { id: "person-3", full_name: "Ayesha Siddiqui", degree: "BSSE", semester: 5, section: "A", role: "student" },
    { id: "person-4", full_name: "Dr. Mahwish Khan", degree: "BSSE", semester: 5, section: "A", role: "teacher" },
    { id: "person-5", full_name: "Zain Ali", degree: "BSSE", semester: 5, section: "A", role: "student" },
    { id: "person-6", full_name: "Sir Ahsan Raza", degree: "BSSE", semester: 5, section: "A", role: "teacher" },
    { id: "person-7", full_name: "Mariam Khalid", degree: "BSSE", semester: 5, section: "A", role: "cr" },
    { id: "person-8", full_name: "Usman Yousaf", degree: "BSSE", semester: 5, section: "A", role: "student" },
  ],
};

const RESOURCES = [
  { category: "YOUR DEPARTMENT", title: "FUSST student portal", description: "Official student information, academic resources, and campus updates.", icon: "🎓", label: "University", url: "https://fusst.fui.edu.pk/" },
  { category: "LEARN ANYTHING", title: "freeCodeCamp", description: "Hands-on practice in web development, JavaScript, and data structures.", icon: "🌱", label: "Free learning", url: "https://www.freecodecamp.org/learn/" },
  { category: "KEEP BUILDING", title: "GitHub Student Developer Pack", description: "Developer tools, real-world experience, and student benefits in one place.", icon: "🐙", label: "Student perks", url: "https://education.github.com/pack" },
  { category: "DRAW IT OUT", title: "Excalidraw", description: "Sketch system designs, explain your ideas, and make collaboration visual.", icon: "✏️", label: "Design & diagrams", url: "https://excalidraw.com/" },
  { category: "FOCUS TIME", title: "CS50 on edX", description: "A thoughtful, free introduction to computer science fundamentals.", icon: "💡", label: "Computer science", url: "https://www.edx.org/learn/computer-science/harvard-university-cs50-s-introduction-to-computer-science" },
  { category: "YOUR WORKFLOW", title: "Visual Studio Code", description: "A lightweight editor and a great place to start your next project.", icon: "⌨️", label: "Developer tools", url: "https://code.visualstudio.com/" },
];

const state = {
  data: structuredClone(DEMO_DATA),
  user: null,
  profile: null,
  previewRole: demoRole,
  activeNoticeFilter: "all",
  noticeSearch: "",
  directorySearch: "",
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

function formatDayRange() {
  const start = new Date();
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return `${formatDate(start, { month: "short", day: "numeric" })} – ${formatDate(end, { month: "short", day: "numeric", year: "numeric" })}`;
}

function roleTitle(role) {
  return roleLabels[role] ?? roleLabels.student;
}

function normalizedProfileName(profile, user) {
  return profile?.full_name?.trim() || user?.user_metadata?.full_name?.trim() || user?.email?.split("@")[0] || "You";
}

function effectiveRole() {
  return state.user ? state.profile?.role ?? "student" : state.previewRole;
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
  const category = ["academic", "events", "urgent"].includes(notice.category) ? notice.category : "academic";
  return `<article class="notice-card${compact ? " notice-card-compact" : ""}${notice.is_pinned ? " is-pinned" : ""}">
    ${notice.is_pinned ? `<span class="pinned-label">${icon("bookmark")} PINNED</span>` : ""}
    <div class="notice-card-top"><span class="notice-category category-${category}">${category === "urgent" ? "IMPORTANT" : category.toUpperCase()}</span><span class="notice-date">${escapeHtml(formatDate(notice.created_at, { month: "short", day: "numeric" }))}</span></div>
    <h3>${escapeHtml(notice.title)}</h3><p class="notice-body">${escapeHtml(notice.body)}</p>
    <div class="notice-author"><span class="avatar avatar-lilac">${escapeHtml((notice.author_name || "F").trim().charAt(0).toUpperCase())}</span><span>${escapeHtml(notice.author_name || "FUSST BSSE")}</span><span class="notice-author-dot"></span><span>${escapeHtml(formatDate(notice.created_at, { hour: "numeric", minute: "2-digit" }))}</span></div>
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
    .filter((entry) => Number(entry.day_of_week) === today.getDay())
    .sort((left, right) => (left.start_time ?? "").localeCompare(right.start_time ?? ""));
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
    ? notices.slice(0, 3).map((notice, index) => `<button class="latest-notice" type="button" data-go="notices"><span class="latest-notice-marker marker-${index % 3}"></span><span class="latest-notice-content"><span class="latest-notice-category">${escapeHtml((notice.category || "academic").toUpperCase())}</span><strong>${escapeHtml(notice.title)}</strong><span class="latest-notice-meta">${escapeHtml(notice.author_name || "FUSST BSSE")} <i>·</i> ${escapeHtml(formatDate(notice.created_at, { month: "short", day: "numeric" }))}</span></span>${icon("chevron", "icon latest-chevron")}</button>`).join("")
    : `<div class="empty-state compact-empty"><span class="empty-illustration">📭</span><strong>You’re all caught up.</strong><p>No notices just yet.</p></div>`;
}

function renderNotices() {
  const notices = filteredNotices();
  $("#notices-list").innerHTML = notices.length
    ? notices.map((notice) => renderNoticeCard(notice)).join("")
    : `<div class="empty-state grid-empty"><span class="empty-illustration">🔎</span><strong>No notices found.</strong><p>Try another search or choose a different filter.</p><button class="text-link" id="clear-notice-search" type="button">Clear your search</button></div>`;
}

function renderTimetable() {
  const grouped = Array.from({ length: 7 }, (_, day) => ({
    day,
    classes: state.data.timetable
      .filter((entry) => Number(entry.day_of_week) === day)
      .sort((left, right) => (left.start_time ?? "").localeCompare(right.start_time ?? "")),
  })).filter(({ classes }) => classes.length);

  $("#timetable-list").innerHTML = grouped.length
    ? grouped.map(({ day, classes }) => `<section class="day-column"><div class="day-heading${day === today.getDay() ? " is-today" : ""}"><span>${escapeHtml(weekDayNames[day])}</span>${day === today.getDay() ? '<span class="today-marker">TODAY</span>' : ""}<small>${classes.length} ${classes.length === 1 ? "class" : "classes"}</small></div><div class="day-classes">${classes.map((entry, index) => `<article class="class-card class-card-${index % 4}"><div class="class-time">${icon("clock")} ${escapeHtml(formatTime(entry.start_time))} – ${escapeHtml(formatTime(entry.end_time))}</div><span class="class-code">${escapeHtml(entry.course_code || "BSSE")}</span><h3>${escapeHtml(entry.course_name || "Class")}</h3><p class="class-instructor">${escapeHtml(entry.instructor || "Course instructor")}</p><span class="class-room">${icon("pin")} ${escapeHtml(entry.room || "Room TBA")}</span></article>`).join("")}</div></section>`).join("")
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
    const searchable = `${profile.full_name} ${profile.degree} ${profile.role} ${profile.section} ${profile.semester}`.toLowerCase();
    return searchable.includes(state.directorySearch) && isSearchMatch(searchable);
  });
  $("#directory-count").textContent = `${profiles.length} ${profiles.length === 1 ? "person" : "people"}`;
  $("#directory-list").innerHTML = profiles.length
    ? profiles.map((person, index) => {
      const fullName = person.full_name?.trim() || "BSSE Student";
      const initials = fullName.split(/\s+/).slice(0, 2).map((part) => part.charAt(0)).join("").toUpperCase();
      const role = roleLabels[person.role] ? person.role : "student";
      return `<article class="person-card"><div class="person-card-top"><span class="avatar person-avatar ${avatarColors[index % avatarColors.length]}">${escapeHtml(initials)}</span><span class="person-role person-role-${role}">${role === "cr" ? icon("sparkle") : role === "teacher" ? icon("book") : ""}${escapeHtml(role === "cr" ? "CLASS REP" : role === "teacher" ? "TEACHER" : "STUDENT")}</span></div><h3>${escapeHtml(fullName)}</h3><p>${escapeHtml(person.degree || "BSSE")} · Semester ${escapeHtml(person.semester ?? "5")}</p><span class="person-section">SECTION ${escapeHtml(person.section || "A")}</span></article>`;
    }).join("")
    : `<div class="empty-state grid-empty"><span class="empty-illustration">🫧</span><strong>No classmates found.</strong><p>Try a different name, course, or role.</p></div>`;
}

function renderAll() {
  renderDashboard();
  renderNotices();
  renderTimetable();
  renderAssignments();
  renderResources();
  renderDirectory();
}

function updateRoleControls() {
  const picker = $("#role-switcher");
  const role = effectiveRole();
  picker.value = role;
  picker.disabled = Boolean(state.user);
  const authRole = state.user ? state.profile?.role ?? "student" : null;
  const activeRole = authRole ?? state.previewRole;
  const isPrivileged = activeRole === "cr" || activeRole === "teacher";
  $$(".post-button").forEach((button) => {
    button.classList.toggle("is-role-visible", isPrivileged);
    button.setAttribute("aria-hidden", String(!isPrivileged));
    button.tabIndex = isPrivileged ? 0 : -1;
  });

  $("#role-mode-caption").textContent = state.user
    ? `Publishing as your verified ${roleTitle(role).toLowerCase()} account`
    : isSupabaseConfigured()
      ? "Preview a role · sign in to use your account"
      : "Preview roles · publishing requires sign-in";
  $("#role-hint").textContent = state.user
    ? isPrivileged ? "Your account is authorized to publish." : "Student accounts can read portal data."
    : "Preview only · publishing requires an authorized account";
  $("#sidebar-user-name").textContent = normalizedProfileName(state.profile, state.user);
  $("#sidebar-user-role").textContent = roleTitle(role);
  $("#auth-button").innerHTML = state.user
    ? `Sign out ${icon("arrow")}`
    : `Sign in ${icon("arrow")}`;
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
  const dialog = $("#app-dialog");
  if (!dialog.open) dialog.showModal();
  $("#dialog-fields").querySelector("input:not([type=hidden]), textarea, select")?.focus();
}

function roleValue() {
  return ["student", "cr", "teacher"].includes(effectiveRole()) ? effectiveRole() : "student";
}

function openComposer(table) {
  const postingRole = effectiveRole();
  const roleMessage = state.user
    ? postingRole === "cr" || postingRole === "teacher"
      ? `Publishing as ${roleTitle(postingRole)}.`
      : "Only Class Representatives and Teachers can publish. Sign in with an authorized account."
    : "This is a role preview. Sign in with an authorized account to publish.";
  const commonRequired = '<span class="required-marker" aria-hidden="true">*</span>';
  if (table === "notices") {
    openDialog({
      icon: "megaphone",
      eyebrow: "MAKE IT OFFICIAL",
      title: "Share an update.",
      description: "A clear announcement goes a long way.",
      submitLabel: "Publish notice",
      footnote: roleMessage,
      fields: `<label class="form-field">Notice title ${commonRequired}<input name="title" required maxlength="160" placeholder="What should everyone know?" autocomplete="off"></label><label class="form-field">Category<select name="category" required><option value="academic">Academic</option><option value="events">Events</option><option value="urgent">Important</option></select></label><label class="form-field">The details ${commonRequired}<textarea name="body" required maxlength="5000" rows="5" placeholder="Add the details your classmates need..."></textarea></label><label class="checkbox-field"><input type="checkbox" name="is_pinned"><span>Pin this notice for the whole batch</span></label>`,
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
  openDialog({
    icon: "calendar",
    eyebrow: "YOUR WEEK, AT A GLANCE",
    title: "Add a class.",
    description: "A little planning makes the whole semester easier.",
    submitLabel: "Add to timetable",
    footnote: roleMessage,
    fields: `<label class="form-field">Course name ${commonRequired}<input name="course_name" required maxlength="120" placeholder="e.g. Software Design & Architecture" autocomplete="off"></label><div class="form-field-row"><label class="form-field">Course code ${commonRequired}<input name="course_code" required maxlength="30" placeholder="SE-301" autocomplete="off"></label><label class="form-field">Day of the week ${commonRequired}<select name="day_of_week" required>${weekDayNames.map((day, index) => `<option value="${index}"${index === today.getDay() ? " selected" : ""}>${day}</option>`).join("")}</select></label></div><div class="form-field-row"><label class="form-field">Starts ${commonRequired}<input name="start_time" type="time" required></label><label class="form-field">Ends ${commonRequired}<input name="end_time" type="time" required></label></div><label class="form-field">Instructor<input name="instructor" maxlength="120" placeholder="Instructor name" autocomplete="off"></label><label class="form-field">Room<input name="room" maxlength="80" placeholder="e.g. Lab 04" autocomplete="off"></label>`,
  }, "publish:timetable");
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
    return {
      title: String(formData.get("title")).trim(),
      body: String(formData.get("body")).trim(),
      category: formData.get("category"),
      is_pinned: formData.get("is_pinned") === "on",
      author_name: normalizedProfileName(state.profile, state.user),
    };
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

  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const formData = new FormData(form);
  state.dialogBusy = true;
  const submit = $("#dialog-submit");
  submit.disabled = true;

  try {
    if (state.dialogMode === "auth:signin") {
      await signIn(String(formData.get("email")).trim(), String(formData.get("password")));
      const dialog = $("#app-dialog");
      if (dialog.open) dialog.close();
      await refreshData();
      toast("Welcome back to FUSST Hub.");
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
        const dialog = $("#app-dialog");
        if (dialog.open) dialog.close();
        await refreshData();
        toast("Welcome to the community! Your account starts with student access.");
      }
    } else if (state.dialogMode?.startsWith("publish:")) {
      if (!state.user) {
        showDialogError("Sign in with your authorized CR or Teacher account before publishing.");
        return;
      }
      if (!["cr", "teacher"].includes(state.profile?.role)) {
        showDialogError("This account can’t publish. A portal administrator must assign you the CR or Teacher role.");
        return;
      }
      const table = state.dialogMode.split(":")[1];
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
  if (isSupabaseConfigured()) {
    try {
      await initializeSupabase();
      const [notices, assignments, timetable, profiles, profile] = await Promise.all([
        fetchRows("notices"),
        fetchRows("assignments"),
        fetchRows("timetable"),
        fetchRows("profiles"),
        getCurrentProfile(),
      ]);
      state.data = { notices, assignments, timetable, profiles };
      state.profile = profile;
    } catch (error) {
      state.data = { notices: [], assignments: [], timetable: [], profiles: [] };
      state.profile = null;
      setLoadError(error.message || "Check your Supabase connection and try again.");
    }
  } else {
    state.data = structuredClone(DEMO_DATA);
    state.profile = null;
  }

  updateRoleControls();
  renderAll();
}

function navigateTo(section, { updateHistory = true } = {}) {
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
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-create]");
    if (button) openComposer(button.dataset.create);
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
      state.previewRole = demoRole;
      await refreshData();
      toast("You’ve been signed out.");
    } catch (error) {
      toast(error.message || "Could not sign out. Please try again.", "error");
    }
  });
  $("#dialog-form").addEventListener("submit", handleDialogSubmit);
  $("#dialog-close").addEventListener("click", () => $("#app-dialog").close());
  $("#dialog-cancel").addEventListener("click", () => $("#app-dialog").close());
  $("#app-dialog").addEventListener("click", (event) => {
    if (event.target === event.currentTarget) event.currentTarget.close();
  });
  window.addEventListener("popstate", () => navigateTo(window.location.hash.slice(1) || "dashboard", { updateHistory: false }));
  window.addEventListener("hashchange", () => navigateTo(window.location.hash.slice(1) || "dashboard", { updateHistory: false }));
}

async function initializeAuth() {
  if (!isSupabaseConfigured()) return;
  try {
    await initializeSupabase();
    const user = await (await import("./supabase.js")).getCurrentUser();
    if (user) {
      state.user = user;
      state.profile = await getCurrentProfile();
    }
    await onAuthStateChange((event, session) => {
      if (event === "INITIAL_SESSION") return;
      state.user = session?.user ?? null;
      void refreshData().then(() => {
        if (event === "SIGNED_IN") toast("You’re signed in to FUSST Hub.");
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
  $("#timetable-week-label").textContent = formatDayRange();
}

initializeTheme();
initializeStaticLabels();
initializeEvents();
initializeSearch();
if (window.location.hash) navigateTo(window.location.hash.slice(1), { updateHistory: false });
updateRoleControls();
renderAll();
void initializeAuth();
