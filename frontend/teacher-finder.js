(() => {
  const searchForm = document.getElementById('teacher-search');
  const results = document.getElementById('teacher-results');
  const resultsSummary = document.getElementById('results-summary');
  const message = document.getElementById('finder-message');
  const profileSection = document.getElementById('teacher-profile');
  const availabilityForm = document.getElementById('availability-search');
  let selectedTeacher = null;

  const escapeHtml = (value) => String(value == null ? '' : value)
    .replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);

  async function requestJson(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(result.message || `Request failed (${response.status})`);
      error.status = response.status;
      throw error;
    }
    return result;
  }

  function showMessage(text, isError = false, allowSignIn = false) {
    message.classList.toggle('message--error', isError);
    message.innerHTML = `${escapeHtml(text)}${allowSignIn ? ' <a href="login-student.html?next=find-teacher.html">Sign in to continue</a>.' : ''}`;
  }

  function localDateKey(date) {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
  }

  function populateSelect(select, options, placeholder) {
    select.innerHTML = `<option value="">${placeholder}</option>${options.map((option) =>
      `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`
    ).join('')}`;
  }

  function initials(name) {
    return String(name || 'Teacher').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  }

  function renderTeachers(teachers) {
    resultsSummary.textContent = `${teachers.length} faculty member${teachers.length === 1 ? '' : 's'} found.`;
    if (!teachers.length) {
      results.innerHTML = '<div class="empty-state"><strong>No faculty members found</strong>Try changing or clearing one or more search filters.</div>';
      return;
    }
    results.innerHTML = teachers.map((teacher) => `<button class="teacher-result" type="button" data-teacher="${escapeHtml(teacher.id)}">
      <span class="teacher-avatar" aria-hidden="true">${escapeHtml(initials(teacher.fullName))}</span>
      <span class="teacher-result-copy"><strong>${escapeHtml(teacher.fullName)}</strong><small>${escapeHtml(teacher.designation)} · ${escapeHtml(teacher.department)}<br>${escapeHtml((teacher.subjectsTaught || []).join(', ') || 'Subjects not listed')}</small></span>
      <span class="teacher-id">ID ${escapeHtml(teacher.teacherId)}</span>
    </button>`).join('');
  }

  function scheduleRows(entries, includeDay = true) {
    if (!entries.length) return '<div class="empty-state"><strong>No schedule entries</strong>No timetable records are available for this period.</div>';
    return entries.map((entry) => `<div class="schedule-row">
      <div><strong>${includeDay ? `${escapeHtml(entry.day || entry.date)} · ` : ''}${escapeHtml(entry.subjectName)}</strong>
        <small>${escapeHtml([entry.building, entry.classroom && `Room ${entry.classroom}`].filter(Boolean).join(' · ') || 'Location not listed')}</small></div>
      <span class="schedule-time">${escapeHtml(entry.startTime)}–${escapeHtml(entry.endTime)}</span>
    </div>`).join('');
  }

  function intervalChips(intervals) {
    return intervals.length
      ? `<div class="interval-list">${intervals.map((interval) => `<span class="interval-chip">${escapeHtml(interval.start)}–${escapeHtml(interval.end)}</span>`).join('')}</div>`
      : '<p class="muted">No intervals in the selected time range.</p>';
  }

  function statusClass(status) {
    if (status === 'Available') return 'status--available';
    if (status === 'Busy') return 'status--busy';
    if (status === 'Currently teaching') return 'status--teaching';
    if (status === 'Unavailable or outside working hours') return 'status--unavailable';
    return '';
  }

  function renderProfile(data) {
    selectedTeacher = data;
    const teacher = data.teacher;
    document.getElementById('profile-name').textContent = teacher.fullName;
    document.getElementById('profile-role').textContent = teacher.designation;
    document.getElementById('profile-avatar').textContent = initials(teacher.fullName);
    document.getElementById('profile-department').textContent = teacher.department;
    document.getElementById('profile-subjects').textContent = teacher.subjectsTaught.join(', ') || 'Not listed';
    document.getElementById('profile-classrooms').textContent = teacher.assignedClassrooms.join(', ') || 'Not listed';
    document.getElementById('profile-id').textContent = teacher.teacherId;
    const status = document.getElementById('current-status');
    status.textContent = teacher.currentAvailability.status;
    status.className = `status ${statusClass(teacher.currentAvailability.status)}`;
    document.getElementById('current-status-note').textContent = teacher.currentAvailability.message;
    document.getElementById('today-schedule').innerHTML = scheduleRows(data.todaySchedule, false);
    document.getElementById('upcoming-classes').innerHTML = scheduleRows(data.upcomingClasses, true);
    document.getElementById('weekly-timetable').innerHTML = scheduleRows(data.weeklyTimetable, true);
    const freePeriods = document.getElementById('free-periods');
    freePeriods.innerHTML = data.freePeriods.length
      ? data.freePeriods.map((interval) => `<span class="free-period">${escapeHtml(interval.day)} · ${escapeHtml(interval.startTime)}–${escapeHtml(interval.endTime)} · Not confirmed</span>`).join('')
      : '<div class="empty-state"><strong>No gaps between listed classes</strong>Working hours are not inferred from missing timetable entries.</div>';
    const availabilityDepartment = availabilityForm.elements.department;
    availabilityDepartment.value = teacher.departmentId || '';
    profileSection.hidden = false;
    profileSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.getElementById('availability-result').innerHTML = '';
  }

  async function loadOptions() {
    const options = await requestJson('/api/student/faculty/options');
    populateSelect(searchForm.elements.department,
      (options.departments || []).map((item) => ({ value: item.name, label: item.name })), 'All departments');
    populateSelect(searchForm.elements.subject,
      (options.subjects || []).map((item) => ({ value: item.name, label: item.name })), 'All subjects');
    populateSelect(searchForm.elements.designation,
      (options.designations || []).map((item) => ({ value: item, label: item })), 'All designations');
    populateSelect(availabilityForm.elements.department,
      (options.departments || []).map((item) => ({ value: item.id, label: item.name })), 'All departments');
  }

  async function searchTeachers() {
    const params = new URLSearchParams();
    for (const [key, value] of new FormData(searchForm)) {
      if (String(value).trim()) params.set(key, String(value).trim());
    }
    const query = params.toString();
    const result = await requestJson(`/api/student/faculty/search${query ? `?${query}` : ''}`);
    renderTeachers(result.teachers || []);
  }

  function renderAvailability(result) {
    const container = document.getElementById('availability-result');
    container.innerHTML = `<div class="availability-summary">
        <strong class="status ${statusClass(result.status)}">${escapeHtml(result.status)}</strong>
        <p>${result.confirmedAvailability
          ? 'Confirmed availability covers the complete requested interval.'
          : 'A gap in the timetable is not a confirmation of availability.'}</p>
      </div>
      <div class="interval-group"><h3>Free from recorded classes (not necessarily confirmed)</h3>${intervalChips(result.freeIntervals || [])}</div>
      <div class="interval-group"><h3>Confirmed available intervals</h3>${intervalChips(result.confirmedAvailableIntervals || [])}</div>
      ${result.overlappingClasses && result.overlappingClasses.length
        ? `<div class="interval-group"><h3>Scheduled during this search</h3>${scheduleRows(result.overlappingClasses, false)}</div>`
        : ''}`;
  }

  async function openTeacher(id) {
    showMessage('');
    profileSection.hidden = true;
    try {
      const profile = await requestJson(`/api/student/faculty/${encodeURIComponent(id)}`);
      renderProfile(profile);
    } catch (error) {
      showMessage(error.message || 'Could not load this teacher profile.', true, error.status === 401 || error.status === 403);
    }
  }

  searchForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = searchForm.querySelector('button[type="submit"]');
    button.disabled = true;
    showMessage('');
    try {
      await searchTeachers();
    } catch (error) {
      resultsSummary.textContent = 'Search could not be completed.';
      showMessage(error.message || 'Could not search faculty.', true, error.status === 401 || error.status === 403);
    } finally {
      button.disabled = false;
    }
  });

  results.addEventListener('click', (event) => {
    const button = event.target.closest('[data-teacher]');
    if (button) openTeacher(button.dataset.teacher);
  });

  document.getElementById('back-to-results').addEventListener('click', () => {
    profileSection.hidden = true;
    selectedTeacher = null;
    document.getElementById('teacher-results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  const dateInput = availabilityForm.elements.date;
  dateInput.min = localDateKey(new Date());
  dateInput.value = localDateKey(new Date());
  availabilityForm.elements.day.value = new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(new Date());
  dateInput.addEventListener('change', () => {
    if (!dateInput.value) return;
    availabilityForm.elements.day.value = new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(new Date(`${dateInput.value}T00:00:00`));
  });

  availabilityForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!selectedTeacher) return;
    const button = availabilityForm.querySelector('button[type="submit"]');
    button.disabled = true;
    const output = document.getElementById('availability-result');
    output.innerHTML = '<p class="muted">Checking the teacher timetable and confirmed availability…</p>';
    try {
      const result = await requestJson(`/api/student/faculty/${encodeURIComponent(selectedTeacher.teacher.id)}/availability`, {
        method: 'POST',
        body: JSON.stringify(Object.fromEntries(new FormData(availabilityForm))),
      });
      renderAvailability(result);
    } catch (error) {
      output.innerHTML = `<p class="message--error">${escapeHtml(error.message || 'Could not check availability.')}${error.status === 401 || error.status === 403 ? ' <a href="login-student.html?next=find-teacher.html">Sign in to continue</a>.' : ''}</p>`;
    } finally {
      button.disabled = false;
    }
  });

  (async () => {
    try {
      await loadOptions();
      await searchTeachers();
    } catch (error) {
      showMessage(error.message || 'Could not load the faculty directory.', true, error.status === 401 || error.status === 403);
    }
  })();
})();
