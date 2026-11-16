(() => {
  const views = {
    dashboard: 'Dashboard',
    teachers: 'Find a Teacher',
    availability: 'Teacher Availability',
    classrooms: 'Find Free Classroom',
    labs: 'Computer Labs',
    requests: 'My Lab Requests',
    notifications: 'Notifications',
    profile: 'My Profile'
  };
  const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const loginScreen = document.getElementById('login-screen');
  const appShell = document.getElementById('app-shell');
  const page = document.getElementById('page-content');
  const toast = document.getElementById('toast');
  let data = null;
  let activeView = 'dashboard';
  let selectedTeacherId = null;
  let searchTerm = '';
  let toastTimer;

  const escapeHtml = (value) => String(value == null ? '' : value)
    .replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);

  async function requestJson(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(result.message || result.error || `Request failed (${response.status})`);
      error.status = response.status;
      throw error;
    }
    return result;
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('is-visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 3000);
  }

  function showLogin(message = '') {
    appShell.hidden = true;
    loginScreen.hidden = false;
    document.getElementById('login-message').textContent = message;
  }

  function initials(name) {
    return String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  }

  function formatDate(date) {
    return new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(date);
  }

  function localDateKey(date) {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
  }

  function displayDate(value) {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
  }

  function teacherById(id) {
    return data.teachers.find((teacher) => teacher.id === id);
  }

  function teacherName(id) {
    const teacher = teacherById(id);
    return teacher ? teacher.fullName : 'Teacher';
  }

  function updateHeader() {
    document.getElementById('view-name').textContent = views[activeView];
    document.querySelectorAll('.nav-item[data-view]').forEach((item) => {
      const current = item.dataset.view === activeView;
      item.classList.toggle('is-active', current);
      if (current) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    });
    const email = data.profile.email || '';
    document.getElementById('student-email').textContent = email;
    document.getElementById('user-avatar').textContent = initials(data.profile.fullName || email);
    const unread = data.notifications.filter((item) => !item.read).length;
    const badge = document.getElementById('notification-count');
    badge.hidden = unread === 0;
    badge.textContent = unread > 9 ? '9+' : String(unread);
  }

  function emptyState(title, message) {
    return `<div class="empty-state"><strong>${escapeHtml(title)}</strong>${escapeHtml(message)}</div>`;
  }

  function pageHeading(title, description, trailing = '') {
    return `<div class="page-heading"><div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p></div>${trailing}</div>`;
  }

  function resourceRow(room) {
    const label = room.availability === 'busy' ? 'In use' : room.availability === 'free' ? 'Free now' : 'No schedule';
    const statusClass = room.availability === 'busy' ? 'status--busy' : room.availability === 'unknown' ? 'status--neutral' : '';
    return `<div class="resource-row">
      <span class="resource-symbol" aria-hidden="true">▤</span>
      <div class="resource-info"><strong>${escapeHtml(room.name || 'Classroom')}</strong><small>${escapeHtml([room.building, room.classroomNumber && `Room ${room.classroomNumber}`, room.capacity && `${room.capacity} seats`].filter(Boolean).join(' · ') || 'Campus classroom')}</small></div>
      <span class="status ${statusClass}">${label}</span>
    </div>`;
  }

  function teacherRow(teacher) {
    return `<button class="teacher-row" data-teacher="${escapeHtml(teacher.id)}">
      <span class="teacher-avatar">${escapeHtml(initials(teacher.fullName))}</span>
      <span class="teacher-info"><strong>${escapeHtml(teacher.fullName)}</strong><small>${escapeHtml(teacher.designation || teacher.department || 'Faculty')}</small></span>
      <span class="quick-arrow" aria-hidden="true">›</span>
    </button>`;
  }

  function announcementRow(item) {
    return `<div class="announcement-row"><span class="announcement-dot"></span><div><strong>${escapeHtml(item.title || 'Campus announcement')}</strong><small>${escapeHtml(item.summary || item.message || '')}${item.createdAt ? ` · ${escapeHtml(displayDate(item.createdAt))}` : ''}</small></div></div>`;
  }

  function dashboard() {
    const profileName = data.profile.fullName || data.profile.email || 'Student';
    const freeRooms = data.classrooms.filter((room) => room.availability === 'free');
    const recentIds = getRecentTeacherIds();
    const recent = recentIds.map(teacherById).filter(Boolean).slice(0, 3);
    const announcements = data.announcements.slice(0, 3);
    const resourcesMarkup = [
      ...freeRooms.slice(0, 3).map(resourceRow),
      ...data.labs.slice(0, 2).map((lab) => `<div class="resource-row">
        <span class="resource-symbol" aria-hidden="true">▦</span>
        <div class="resource-info"><strong>${escapeHtml(lab.name || 'Computer lab')}</strong><small>${escapeHtml([lab.building, ...((lab.equipment || []).slice(0, 2))].filter(Boolean).join(' · ') || 'Computer lab')}</small></div>
        <span class="status status--neutral">Check availability</span>
      </div>`)
    ].join('');
    const roomsMarkup = resourcesMarkup || emptyState('No available resources listed', 'There are no free classrooms or lab records available right now.');
    const teachersMarkup = recent.length
      ? recent.map(teacherRow).join('')
      : emptyState('Your recently viewed teachers will appear here', 'Choose “Find a Teacher” to browse faculty profiles.');
    const announcementsMarkup = announcements.length
      ? announcements.map(announcementRow).join('')
      : emptyState('No announcements right now', 'New campus notices will appear here when they are published.');
    return `<div class="welcome-row">
      <div><h1>Hi${profileName.includes('@') ? '' : `, ${escapeHtml(profileName.split(/\s+/)[0])}`} 👋</h1><p>What would you like to find on campus today?</p></div>
      <span class="date-pill"><span aria-hidden="true">◷</span>${escapeHtml(formatDate(new Date()))}</span>
    </div>
    <section class="search-hero" aria-label="Search campus resources">
      <div class="search-copy"><h2>What are you looking for?</h2><p>Search teachers, classrooms, and computer labs in one place.</p>
        <form class="search-control" id="global-search-form"><span aria-hidden="true">⌕</span><input id="global-search" type="search" placeholder="Try a teacher, subject, or room" aria-label="What are you looking for?" value="${escapeHtml(searchTerm)}" /><button type="submit">Search</button></form>
      </div><div class="search-illustration" aria-hidden="true">⌕</div>
    </section>
    <div class="section-title-row"><h2>Quick links</h2></div>
    <section class="quick-grid" aria-label="Quick links">
      <button class="quick-card" data-go="teachers"><span class="quick-icon quick-icon--violet">♙</span><span class="quick-card-copy"><strong>Find a Teacher</strong><small>Browse faculty profiles and contact details</small></span><span class="quick-arrow">›</span></button>
      <button class="quick-card" data-go="classrooms"><span class="quick-icon quick-icon--green">▤</span><span class="quick-card-copy"><strong>Find a Free Classroom</strong><small>See rooms not scheduled for use right now</small></span><span class="quick-arrow">›</span></button>
      <button class="quick-card" data-go="labs"><span class="quick-icon quick-icon--orange">▦</span><span class="quick-card-copy"><strong>Find a Computer Lab</strong><small>Explore campus labs and request a visit</small></span><span class="quick-arrow">›</span></button>
    </section>
    <section class="dashboard-grid">
      <div class="panel"><div class="section-title-row"><div><h2>Today's available resources</h2><p class="panel-subtitle">Room schedule and campus lab information</p></div><button class="text-button" data-go="classrooms">See all</button></div><div class="resource-list">${roomsMarkup}</div></div>
      <div class="stack">
        <div class="panel"><div class="section-title-row"><div><h2>Recently viewed teachers</h2><p class="panel-subtitle">Pick up where you left off</p></div><button class="text-button" data-go="teachers">Browse</button></div><div class="teacher-list">${teachersMarkup}</div></div>
        <div class="panel"><div class="section-title-row"><div><h2>Important announcements</h2><p class="panel-subtitle">Updates from your campus</p></div><button class="text-button" data-go="notifications">All updates</button></div><div class="announcement-list">${announcementsMarkup}</div></div>
      </div>
    </section>`;
  }

  function teachersView() {
    if (selectedTeacherId) {
      const teacher = teacherById(selectedTeacherId);
      if (!teacher) selectedTeacherId = null;
      else {
        const entries = data.timetable.filter((entry) => entry.teacherId === teacher.id);
        const timetable = entries.length
          ? entries.map((entry) => `<div class="timetable-item"><div><strong>${escapeHtml(entry.day)} · ${escapeHtml(entry.subjectName || entry.activity || 'Scheduled activity')}</strong><small>${escapeHtml([entry.building, entry.classroomNumber && `Room ${entry.classroomNumber}`, entry.classroomName].filter(Boolean).join(' · '))}</small></div><span class="timetable-time">${escapeHtml(entry.startTime)}–${escapeHtml(entry.endTime)}</span></div>`).join('')
          : emptyState('No timetable published', 'The campus has not added timetable entries for this teacher.');
        return `${pageHeading(teacher.fullName, 'Faculty profile', '<span class="read-only">◉ Read-only profile</span>')}
          <button class="button button--quiet" data-action="back-teachers">← All teachers</button>
          <section class="panel detail-panel"><div class="teacher-card-top"><span class="teacher-avatar">${escapeHtml(initials(teacher.fullName))}</span><div><h3>${escapeHtml(teacher.designation || 'Faculty')}</h3><p>${escapeHtml(teacher.department || 'Department not listed')}</p></div></div>
            <div class="profile-grid" style="margin-top:17px">
              <div class="profile-field"><small>Email</small><strong>${escapeHtml(teacher.email || 'Not listed')}</strong></div>
              <div class="profile-field"><small>Office / cabin</small><strong>${escapeHtml(teacher.cabin || teacher.office || teacher.officeLocation || 'Not listed')}</strong></div>
              <div class="profile-field"><small>Subjects</small><strong>${escapeHtml(Array.isArray(teacher.subjectsTaught) ? teacher.subjectsTaught.join(', ') : teacher.subjectsTaught || 'Not listed')}</strong></div>
              <div class="profile-field"><small>Specialization</small><strong>${escapeHtml(teacher.specialization || 'Not listed')}</strong></div>
            </div><div class="section-title-row" style="margin-top:22px"><h2>Timetable</h2><span class="read-only">Read only</span></div>${timetable}</section>`;
      }
    }
    const matched = data.teachers.filter((teacher) => {
      const haystack = [teacher.fullName, teacher.department, teacher.designation, teacher.email, teacher.subjectsTaught]
        .flat().join(' ').toLowerCase();
      return haystack.includes(searchTerm.toLowerCase());
    });
    const cards = matched.map((teacher) => `<article class="teacher-card" role="button" tabindex="0" data-teacher="${escapeHtml(teacher.id)}">
      <div class="teacher-card-top"><span class="teacher-avatar">${escapeHtml(initials(teacher.fullName))}</span><div><h3>${escapeHtml(teacher.fullName)}</h3><p>${escapeHtml(teacher.designation || 'Faculty')}</p></div><span class="read-only">Read only</span></div>
      <p>${escapeHtml(teacher.department || 'Department not listed')}</p><p>${escapeHtml(teacher.email || 'Contact details not listed')}</p></article>`).join('');
    return `${pageHeading('Find a Teacher', 'Search faculty profiles and view their published timetables. Faculty information is read-only.')}
      <div class="toolbar"><input class="input" id="teacher-search" type="search" placeholder="Name, subject, or department" value="${escapeHtml(searchTerm)}" aria-label="Search teachers" /></div>
      <section class="card-grid">${cards || emptyState('No teachers found', 'Try another name or ask your campus office about faculty directory access.')}</section>`;
  }

  function availabilityView() {
    const day = new Date().toLocaleDateString(undefined, { weekday: 'long' });
    const entries = data.timetable.filter((entry) => entry.day === day).sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)));
    const rows = entries.map((entry) => `<div class="timetable-item"><div><strong>${escapeHtml(teacherName(entry.teacherId))} · ${escapeHtml(entry.subjectName || entry.activity || 'Scheduled activity')}</strong><small>${escapeHtml([entry.building, entry.classroomName, entry.classroomNumber && `Room ${entry.classroomNumber}`].filter(Boolean).join(' · '))}</small></div><span class="timetable-time">${escapeHtml(entry.startTime)}–${escapeHtml(entry.endTime)}</span></div>`).join('');
    return `${pageHeading('Teacher Availability', 'See faculty timetables for today. Timetable entries show scheduled commitments, not unscheduled office hours.')}
      <section class="panel"><div class="section-title-row"><div><h2>${escapeHtml(day)}'s timetable</h2><p class="panel-subtitle">Published schedule · read-only</p></div><span class="read-only">Read only</span></div>
        ${rows || emptyState('No timetable entries for today', 'There are no published faculty schedule entries for today.')}</section>
      <div class="section-title-row" style="margin-top:20px"><h2>Browse all faculty schedules</h2><button class="text-button" data-go="teachers">Find a teacher</button></div>
      <section class="card-grid">${data.teachers.map((teacher) => `<article class="teacher-card" role="button" tabindex="0" data-teacher="${escapeHtml(teacher.id)}"><div class="teacher-card-top"><span class="teacher-avatar">${escapeHtml(initials(teacher.fullName))}</span><div><h3>${escapeHtml(teacher.fullName)}</h3><p>${escapeHtml(teacher.department || 'Faculty')}</p></div></div></article>`).join('') || emptyState('No faculty listed', 'Faculty schedules will appear once published.')}</section>`;
  }

  function classroomsView() {
    const available = data.classrooms.filter((room) => room.availability === 'free');
    const rooms = data.classrooms.map((room) => `<article class="info-card"><div class="section-title-row"><h3>${escapeHtml(room.name || 'Classroom')}</h3><span class="status ${room.availability === 'busy' ? 'status--busy' : room.availability === 'unknown' ? 'status--neutral' : ''}">${room.availability === 'busy' ? 'In use' : room.availability === 'unknown' ? 'No schedule' : 'Free now'}</span></div>
      <p>${escapeHtml([room.building, room.floor, room.classroomNumber && `Room ${room.classroomNumber}`].filter(Boolean).join(' · ') || 'Location not listed')}</p>
      <p>${escapeHtml([room.capacity && `${room.capacity} seats`, ...(room.resources || room.amenities || [])].filter(Boolean).join(' · ') || 'No room details listed')}</p></article>`).join('');
    return `${pageHeading('Find a Free Classroom', `${available.length} room${available.length === 1 ? '' : 's'} without a scheduled class right now, based on today's timetable.`)}
      <section class="card-grid">${rooms || emptyState('No classrooms listed', 'Classrooms will appear here when campus records are available.')}</section>`;
  }

  function labsView() {
    const labs = data.labs.map((lab) => `<article class="info-card"><div class="section-title-row"><h3>${escapeHtml(lab.name || 'Computer lab')}</h3><span class="status status--neutral">Check availability</span></div>
      <p>${escapeHtml([lab.building, lab.floor, lab.room].filter(Boolean).join(' · ') || 'Location not listed')}</p>
      <p>${escapeHtml([...(lab.equipment || lab.resources || []), lab.capacity && `${lab.capacity} seats`].filter(Boolean).join(' · ') || 'Equipment details not listed')}</p></article>`).join('');
    return `${pageHeading('Computer Labs', 'Explore campus computer labs. Lab capacity and live workstation availability are not provided in the current campus records.')}
      <section class="card-grid">${labs || emptyState('No computer labs listed', 'Lab information will appear here when campus records are available.')}</section>
      <section class="panel detail-panel"><div class="section-title-row"><div><h2>Request lab access</h2><p class="panel-subtitle">Your request is sent to the campus team for review.</p></div></div>
        <form class="request-form" id="lab-request-form">
          <label class="form-field"><span class="field-label">Computer lab</span><select class="select" name="labId" required>${data.labs.map((lab) => `<option value="${escapeHtml(lab.id)}">${escapeHtml(lab.name || 'Computer lab')}</option>`).join('')}</select></label>
          <label class="form-field"><span class="field-label">Date</span><input class="input" name="date" type="date" min="${localDateKey(new Date())}" required /></label>
          <label class="form-field"><span class="field-label">Start time</span><input class="input" name="startTime" type="time" required /></label>
          <label class="form-field"><span class="field-label">End time</span><input class="input" name="endTime" type="time" required /></label>
          <label class="form-field form-field--wide"><span class="field-label">What will you work on?</span><textarea class="textarea" name="purpose" maxlength="500" required></textarea></label>
          <div class="form-field form-field--wide"><button class="button button--primary" type="submit" ${data.labs.length ? '' : 'disabled'}>Send request</button></div>
        </form></section>`;
  }

  function requestsView() {
    const rows = data.requests.map((item) => `<div class="timetable-item"><div><strong>${escapeHtml(item.labName || 'Computer lab request')} · ${escapeHtml(item.purpose || 'Purpose not listed')}</strong><small>${escapeHtml(displayDate(item.date))}${item.timeSlot ? ` · ${escapeHtml(item.timeSlot)}` : ''}</small></div><span class="status ${String(item.status).toLowerCase() === 'rejected' ? 'status--busy' : 'status--neutral'}">${escapeHtml(item.status || 'Pending')}</span></div>`).join('');
    return `${pageHeading('My Lab Requests', 'Track requests submitted using your campus account.')}
      <section class="panel">${rows || emptyState('No lab requests yet', 'When you request lab access, its status will show up here.')}</section>
      <p class="muted" style="font-size:11px">Need to make a request? Go to <button class="text-button" data-go="labs">Computer Labs</button>.</p>`;
  }

  function notificationsView() {
    const notifications = data.notifications.map((item) => `<article class="notification-card ${item.read ? '' : 'is-unread'}">
      <span class="announcement-dot"></span><div class="notification-copy"><strong>${escapeHtml(item.title || 'Campus update')}</strong><p>${escapeHtml(item.message || item.summary || '')}</p><small>${escapeHtml(displayDate(item.createdAt))}</small></div>
      ${item.read ? '' : `<button class="text-button" data-read="${escapeHtml(item.id)}">Mark read</button>`}</article>`).join('');
    const announcements = data.announcements.map(announcementRow).join('');
    return `${pageHeading('Notifications', 'Important updates and messages for your student account.')}
      <div class="section-title-row"><h2>Your notifications</h2>${data.notifications.some((item) => !item.read) ? '<button class="text-button" data-action="mark-all-read">Mark all read</button>' : ''}</div>
      <section>${notifications || emptyState('You are all caught up', 'New account notifications will appear here.')}</section>
      <div class="section-title-row" style="margin-top:25px"><h2>Campus announcements</h2></div>
      <section class="panel announcement-list">${announcements || emptyState('No announcements published', 'Campus notices will appear here when they are added.')}</section>`;
  }

  function profileView() {
    const profile = data.profile;
    const fields = [
      ['Full name', profile.fullName], ['Student ID', profile.studentId], ['Campus email', profile.email],
      ['Program', profile.program], ['Year / semester', profile.semester], ['Department', profile.department],
      ['Section', profile.section], ['Phone', profile.phone]
    ];
    return `${pageHeading('My Profile', 'Your student details from your campus account.')}
      <section class="panel"><div class="section-title-row"><div><h2>Student information</h2><p class="panel-subtitle">Contact the campus office to update your account details.</p></div><span class="read-only">Campus account</span></div>
      <div class="profile-grid">${fields.map(([label, value]) => `<div class="profile-field"><small>${escapeHtml(label)}</small><strong>${escapeHtml(value || 'Not listed')}</strong></div>`).join('')}</div></section>`;
  }

  function render() {
    if (!data) return;
    updateHeader();
    const renderers = {
      dashboard, teachers: teachersView, availability: availabilityView, classrooms: classroomsView,
      labs: labsView, requests: requestsView, notifications: notificationsView, profile: profileView
    };
    page.innerHTML = renderers[activeView]();
  }

  function getRecentTeacherIds() {
    try {
      return JSON.parse(localStorage.getItem('campusspace.recentTeachers') || '[]');
    } catch (error) {
      console.warn('Could not read recently viewed teachers:', error);
      return [];
    }
  }

  function openTeacher(id) {
    const teacher = teacherById(id);
    if (!teacher) return;
    selectedTeacherId = id;
    try {
      localStorage.setItem('campusspace.recentTeachers', JSON.stringify([id, ...getRecentTeacherIds().filter((recentId) => recentId !== id)].slice(0, 5)));
    } catch (error) {
      console.warn('Could not save recently viewed teachers:', error);
    }
    activeView = 'teachers';
    render();
    page.focus();
  }

  function setView(view) {
    if (!views[view]) return;
    activeView = view;
    selectedTeacherId = null;
    if (view === 'teachers') searchTerm = '';
    render();
    closeMenu();
    page.focus();
  }

  function closeMenu() {
    document.getElementById('sidebar').classList.remove('is-open');
    document.getElementById('backdrop').hidden = true;
    document.getElementById('menu-button').setAttribute('aria-expanded', 'false');
  }

  async function loadDashboard() {
    try {
      data = await requestJson('/api/student/dashboard');
      loginScreen.hidden = true;
      appShell.hidden = false;
      render();
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        showLogin(error.status === 403 ? 'This account does not have student portal access.' : '');
      } else {
        showLogin('CampusSpace could not load data from the server. Please try again in a moment.');
        console.error('Unable to load student dashboard:', error);
      }
    }
  }

  document.getElementById('login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    document.getElementById('login-message').textContent = '';
    try {
      const credentials = Object.fromEntries(new FormData(form));
      const result = await requestJson('/api/login', { method: 'POST', body: JSON.stringify(credentials) });
      if (result.role !== 'student') {
        await requestJson('/api/logout', { method: 'POST' });
        throw new Error('Please sign in with a student account.');
      }
      form.reset();
      await loadDashboard();
    } catch (error) {
      document.getElementById('login-message').textContent = error.message || 'Sign in failed. Check your campus email and password.';
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById('logout-button').addEventListener('click', async () => {
    try {
      await requestJson('/api/logout', { method: 'POST' });
      data = null;
      showLogin('You have been logged out.');
    } catch (error) {
      showToast(error.message || 'Could not log out. Please try again.');
    }
  });

  document.querySelector('.navigation').addEventListener('click', (event) => {
    const item = event.target.closest('[data-view]');
    if (item) setView(item.dataset.view);
  });

  page.addEventListener('click', async (event) => {
    const nav = event.target.closest('[data-go]');
    if (nav) return setView(nav.dataset.go);
    const teacher = event.target.closest('[data-teacher]');
    if (teacher) return openTeacher(teacher.dataset.teacher);
    if (event.target.closest('[data-action="back-teachers"]')) {
      selectedTeacherId = null;
      render();
      return;
    }
    const mark = event.target.closest('[data-read]');
    if (mark) {
      try {
        await requestJson(`/api/student/notifications/${encodeURIComponent(mark.dataset.read)}`, {
          method: 'PATCH', body: JSON.stringify({ read: true })
        });
        const notification = data.notifications.find((item) => item.id === mark.dataset.read);
        if (notification) notification.read = true;
        render();
      } catch (error) {
        showToast(error.message || 'Could not update notification.');
      }
      return;
    }
    if (event.target.closest('[data-action="mark-all-read"]')) {
      const unread = data.notifications.filter((item) => !item.read);
      try {
        await Promise.all(unread.map((item) => requestJson(`/api/student/notifications/${encodeURIComponent(item.id)}`, {
          method: 'PATCH', body: JSON.stringify({ read: true })
        })));
        unread.forEach((item) => { item.read = true; });
        render();
      } catch (error) {
        showToast(error.message || 'Could not update notifications.');
      }
    }
  });

  page.addEventListener('keydown', (event) => {
    const teacher = event.target.closest('[data-teacher][role="button"]');
    if (teacher && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      openTeacher(teacher.dataset.teacher);
    }
  });

  page.addEventListener('input', (event) => {
    if (event.target.id === 'teacher-search') {
      const position = event.target.selectionStart;
      searchTerm = event.target.value;
      render();
      const input = document.getElementById('teacher-search');
      input.focus();
      input.setSelectionRange(position, position);
    }
  });

  page.addEventListener('submit', async (event) => {
    if (event.target.id === 'global-search-form') {
      event.preventDefault();
      searchTerm = document.getElementById('global-search').value.trim();
      activeView = 'teachers';
      selectedTeacherId = null;
      render();
      return;
    }
    if (event.target.id === 'lab-request-form') {
      event.preventDefault();
      const form = event.target;
      const submit = form.querySelector('button[type="submit"]');
      submit.disabled = true;
      const values = Object.fromEntries(new FormData(form));
      try {
        const created = await requestJson('/api/student/lab-requests', { method: 'POST', body: JSON.stringify(values) });
        data.requests.unshift(created);
        showToast('Your lab request has been sent.');
        setView('requests');
      } catch (error) {
        showToast(error.message || 'Could not send your lab request.');
        submit.disabled = false;
      }
    }
  });

  document.getElementById('menu-button').addEventListener('click', () => {
    const sidebar = document.getElementById('sidebar');
    const open = !sidebar.classList.contains('is-open');
    sidebar.classList.toggle('is-open', open);
    document.getElementById('backdrop').hidden = !open;
    document.getElementById('menu-button').setAttribute('aria-expanded', String(open));
  });
  document.getElementById('backdrop').addEventListener('click', closeMenu);

  loadDashboard();
})();
