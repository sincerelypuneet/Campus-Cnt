document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('entry-form');
  const modal = document.getElementById('entry-modal');
  const tableBody = document.querySelector('#timetable-container tbody');
  const viewMode = document.getElementById('view-mode');
  const teacherSelect = document.getElementById('teacher-select');
  const departmentSelect = document.getElementById('timetable-dept-select');
  const classroomSelect = document.getElementById('classroom-select');
  const dayOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  let entries = [];
  let teachers = [];

  async function fetchJSON(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'same-origin',
      ...options,
      headers: { ...(options.headers || {}), ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || `Request failed (${response.status})`);
    return result;
  }

  function setStatus(message, isError = false) {
    let status = document.getElementById('timetable-status');
    if (!status) {
      status = document.createElement('p');
      status.id = 'timetable-status';
      status.setAttribute('role', 'status');
      const anchor = document.querySelector('#timetable-section .management-overview-grid')
        || document.getElementById('timetable-container');
      if (anchor) anchor.after(status);
    }
    status.className = isError ? 'form-error' : 'form-success';
    status.textContent = message;
  }

  function fillOptions(select, items, placeholder, labelFor) {
    select.replaceChildren(new Option(placeholder, ''));
    items.forEach(item => select.add(new Option(labelFor(item), item.id)));
  }

  function renderEntries() {
    const today = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(new Date());
    const visibleEntries = entries
      .filter(entry => entry.active !== false)
      .filter(entry => viewMode.value !== 'daily' || entry.day === today)
      .sort((a, b) => dayOrder.indexOf(a.day) - dayOrder.indexOf(b.day) || String(a.startTime).localeCompare(String(b.startTime)));
    tableBody.replaceChildren();

    if (!visibleEntries.length) {
      const row = tableBody.insertRow();
      const cell = row.insertCell();
      cell.colSpan = 7;
      cell.textContent = viewMode.value === 'daily' ? 'No entries scheduled for today.' : 'No timetable entries yet.';
      return;
    }

    visibleEntries.forEach(entry => {
      const row = tableBody.insertRow();
      const teacher = teachers.find(item => item.id === entry.teacherId);
      [
        entry.day,
        `${entry.startTime || ''}–${entry.endTime || ''}`,
        `${entry.subjectName || ''} (${entry.subjectCode || ''})`,
        teacher ? teacher.fullName : entry.teacherId,
        [entry.classOrSemester, entry.section].filter(Boolean).join(' · '),
        [entry.building, entry.classroomNumber && `Room ${entry.classroomNumber}`].filter(Boolean).join(' · '),
      ].forEach(value => {
        row.insertCell().textContent = value || '';
      });

      const actions = row.insertCell();
      actions.className = 'timetable-actions';
      const editButton = document.createElement('button');
      editButton.type = 'button';
      editButton.className = 'action-btn';
      editButton.dataset.action = 'edit';
      editButton.dataset.id = entry.id;
      editButton.textContent = 'Edit';
      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'action-btn';
      deleteButton.dataset.action = 'delete';
      deleteButton.dataset.id = entry.id;
      deleteButton.textContent = 'Deactivate';
      actions.append(editButton, deleteButton);
    });
  }

  function openModal(entry) {
    form.reset();
    delete form.dataset.editId;
    document.getElementById('entry-modal-title').textContent = entry ? 'Edit Timetable Entry' : 'Add Timetable Entry';
    if (entry) {
      Object.keys(entry).forEach(key => {
        if (form.elements[key]) form.elements[key].value = entry[key] || '';
      });
      form.dataset.editId = entry.id;
    }
    modal.style.display = 'block';
    modal.setAttribute('aria-hidden', 'false');
  }

  function closeModal() {
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
  }

  async function loadEntries() {
    entries = await fetchJSON('/api/admin/timetable');
    renderEntries();
  }

  document.getElementById('add-entry').addEventListener('click', () => openModal());
  document.getElementById('entry-modal-close').addEventListener('click', closeModal);
  modal.addEventListener('click', event => {
    if (event.target === modal) closeModal();
  });
  viewMode.addEventListener('change', renderEntries);
  classroomSelect.addEventListener('change', () => {
    const room = classrooms.find(item => item.id === classroomSelect.value);
    if (!room) return;
    form.elements.building.value = room.building || '';
    form.elements.classroomNumber.value = room.name || '';
  });

  tableBody.addEventListener('click', async event => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const entry = entries.find(item => item.id === button.dataset.id);
    if (!entry) return;
    if (button.dataset.action === 'edit') {
      openModal(entry);
      return;
    }
    if (!window.confirm('Deactivate this timetable entry?')) return;
    try {
      await fetchJSON(`/api/admin/timetable/${encodeURIComponent(entry.id)}`, { method: 'DELETE' });
      setStatus('Timetable entry deactivated.');
      await loadEntries();
    } catch (error) {
      setStatus(error.message || 'Unable to deactivate timetable entry.', true);
    }
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(form));
    const method = form.dataset.editId ? 'PUT' : 'POST';
    const url = form.dataset.editId
      ? `/api/admin/timetable/${encodeURIComponent(form.dataset.editId)}`
      : '/api/admin/timetable';
    try {
      await fetchJSON(url, { method, body: JSON.stringify(payload) });
      closeModal();
      setStatus('Timetable entry saved.');
      await loadEntries();
    } catch (error) {
      setStatus(error.message || 'Unable to save timetable entry.', true);
    }
  });

  let classrooms = [];
  Promise.all([
    fetchJSON('/api/admin/teachers'),
    fetchJSON('/api/admin/departments'),
    fetchJSON('/api/admin/classrooms'),
  ]).then(async ([teacherList, departments, classroomList]) => {
    teachers = teacherList;
    classrooms = classroomList.filter(room => room.active !== false);
    fillOptions(teacherSelect, teachers.filter(teacher => teacher.active !== false), 'Select teacher', teacher => teacher.fullName);
    fillOptions(departmentSelect, departments, 'Select department', department => department.name);
    fillOptions(classroomSelect, classrooms, 'Select classroom', room => [room.name, room.building].filter(Boolean).join(' · '));
    await loadEntries();
  }).catch(error => {
    setStatus(error.message || 'Unable to load timetable data.', true);
  });
});
