// teachers.js – client‑side logic for Teacher Management

document.addEventListener('DOMContentLoaded', () => {
  const teacherTableBody = document.querySelector('#teacher-table tbody');
  const searchInput = document.getElementById('search-input');
  const deptFilter = document.getElementById('dept-filter');
  const searchBtn = document.getElementById('search-btn');
  const addBtn = document.getElementById('add-teacher-btn');
  const modal = document.getElementById('teacher-modal');
  const modalClose = document.getElementById('modal-close');
  const modalTitle = document.getElementById('modal-title');
  const form = document.getElementById('teacher-form');
  const deptSelect = document.getElementById('dept-select');
  const departmentNames = new Map();
  let teacherRecords = [];

  // Helper: fetch JSON with credentials
  const fetchJSON = (url, opts = {}) => fetch(url, { credentials: 'include', ...opts }).then(r => {
    if (!r.ok) return r.json().then(err => Promise.reject(err));
    return r.json();
  });

  // Load departments for dropdowns and filter
  async function loadDepartments() {
    const deps = await fetchJSON('/api/admin/departments');
    deptFilter.innerHTML = '<option value="">All Departments</option>';
    deptSelect.innerHTML = '<option value="">Select Department</option>';
    deps.forEach(d => {
      departmentNames.set(d.id, d.name);
      const opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = d.name;
      deptFilter.appendChild(opt.cloneNode(true));
      deptSelect.appendChild(opt);
    });
  }

  // Render teacher rows
  function renderTeachers(teachers) {
    teacherTableBody.replaceChildren();
    teachers.forEach(t => {
      const tr = document.createElement('tr');
      [
        t.fullName,
        t.email,
        departmentNames.get(t.departmentId) || t.departmentId,
        t.designation,
        (t.subjectsTaught || []).join(', '),
        (t.assignedClassrooms || []).join(', '),
      ].forEach(value => {
        tr.insertCell().textContent = value || '';
      });

      const status = document.createElement('span');
      status.className = `status-badge ${t.active === false ? 'inactive' : 'active'}`;
      status.textContent = t.active === false ? 'Inactive' : 'Active';
      tr.insertCell().appendChild(status);

      const actions = tr.insertCell();
      actions.className = 'teacher-actions';
      const editButton = document.createElement('button');
      editButton.type = 'button';
      editButton.className = 'action-icons edit';
      editButton.dataset.id = t.id;
      editButton.dataset.action = 'edit';
      editButton.title = 'Edit';
      editButton.setAttribute('aria-label', `Edit ${t.fullName}`);
      editButton.innerHTML = '<i class="fas fa-edit" aria-hidden="true"></i>';

      const deactivateButton = document.createElement('button');
      deactivateButton.type = 'button';
      deactivateButton.className = 'action-icons deactivate';
      deactivateButton.dataset.id = t.id;
      deactivateButton.dataset.action = 'deactivate';
      deactivateButton.title = 'Deactivate';
      deactivateButton.setAttribute('aria-label', `Deactivate ${t.fullName}`);
      deactivateButton.innerHTML = '<i class="fas fa-trash-alt" aria-hidden="true"></i>';
      actions.append(editButton, deactivateButton);
      teacherTableBody.appendChild(tr);
    });
  }

  // Load teacher list (optionally with filters)
  async function loadTeachers() {
    const q = searchInput.value.trim();
    const dept = deptFilter.value;
    const query = new URLSearchParams();
    if (q) query.append('q', q);
    if (dept) query.append('department', dept);
    const url = '/api/admin/teachers' + (query.toString() ? `?${query}` : '');
    const data = await fetchJSON(url);
    teacherRecords = data;
    renderTeachers(data);
  }

  // Show modal for add / edit
  function openModal(isEdit = false, teacher = null) {
    modal.style.display = 'block';
    modal.setAttribute('aria-hidden', 'false');
    modalTitle.textContent = isEdit ? 'Edit Teacher' : 'Add Teacher';
    form.reset();
    form.password.required = !isEdit;
    // Populate fields if edit
    if (isEdit && teacher) {
      form.fullName.value = teacher.fullName || '';
      form.email.value = teacher.email || '';
      form.contactNumber.value = teacher.contactNumber || '';
      form.departmentId.value = teacher.departmentId || '';
      form.designation.value = teacher.designation || '';
      form.subjectsTaught.value = (teacher.subjectsTaught || []).join(', ');
      form.assignedClassrooms.value = (teacher.assignedClassrooms || []).join(', ');
      form.profileImage.value = teacher.profileImage || '';
      // Password field optional on edit – leave blank to keep existing
      form.password.value = '';
      form.dataset.editId = teacher.id;
    } else {
      delete form.dataset.editId;
    }
  }

  // Close modal
  function closeModal() {
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
  }

  // Submit add / edit form
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const payload = {
      fullName: form.fullName.value.trim(),
      email: form.email.value.trim(),
      contactNumber: form.contactNumber.value.trim(),
      departmentId: form.departmentId.value,
      designation: form.designation.value.trim(),
      subjectsTaught: form.subjectsTaught.value.split(',').map(s => s.trim()).filter(Boolean),
      assignedClassrooms: form.assignedClassrooms.value.split(',').map(s => s.trim()).filter(Boolean),
      profileImage: form.profileImage.value.trim() || null,
    };
    // Include password only on create or when user entered a new one
    if (form.password.value) payload.password = form.password.value;

    try {
      if (form.dataset.editId) {
        // Update existing teacher
        await fetchJSON(`/api/admin/teachers/${form.dataset.editId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        // Create new teacher
        await fetchJSON('/api/admin/teachers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }
      closeModal();
      loadTeachers();
    } catch (err) {
      alert(err.message || 'Operation failed');
    }
  });

  // Table action icons (edit / deactivate)
  teacherTableBody.addEventListener('click', async e => {
    const target = e.target.closest('button[data-action]');
    if (!target) return;
    const teacher = teacherRecords.find(item => item.id === target.dataset.id);
    if (!teacher) return;
    try {
      if (target.dataset.action === 'edit') {
        openModal(true, teacher);
      } else if (confirm('Are you sure you want to deactivate this teacher?')) {
        await fetchJSON(`/api/admin/teachers/${encodeURIComponent(teacher.id)}`, { method: 'DELETE' });
        await loadTeachers();
      }
    } catch (err) {
      alert(err.message || 'Operation failed');
    }
  });

  // Search & filter actions
  const reloadTeachers = () => loadTeachers().catch(err => alert(err.message || 'Unable to load teachers'));
  searchBtn.addEventListener('click', reloadTeachers);
  deptFilter.addEventListener('change', reloadTeachers);

  // Add button
  addBtn.addEventListener('click', () => openModal(false));

  // Modal close
  modalClose.addEventListener('click', closeModal);
  window.addEventListener('click', e => {
    if (e.target === modal) closeModal();
  });

  // Initial load
  loadDepartments().then(loadTeachers).catch(err => {
    console.error('Teacher management initialization failed:', err);
  });
});
