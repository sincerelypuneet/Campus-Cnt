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
      const opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = d.name;
      deptFilter.appendChild(opt.cloneNode(true));
      deptSelect.appendChild(opt);
    });
  }

  // Render teacher rows
  function renderTeachers(teachers) {
    teacherTableBody.innerHTML = '';
    teachers.forEach(t => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${t.fullName || ''}</td>
        <td>${t.email || ''}</td>
        <td>${t.departmentId || ''}</td>
        <td>${t.designation || ''}</td>
        <td>${(t.subjectsTaught || []).join(', ')}</td>
        <td>${(t.assignedClassrooms || []).join(', ')}</td>
        <td>${t.active ? 'Active' : 'Inactive'}</td>
        <td>
          <i class="fas fa-edit action-icons" data-id="${t.id}" title="Edit"></i>
          <i class="fas fa-trash-alt action-icons" data-id="${t.id}" title="Deactivate"></i>
        </td>`;
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
    renderTeachers(data);
  }

  // Show modal for add / edit
  function openModal(isEdit = false, teacher = null) {
    modal.style.display = 'block';
    modalTitle.textContent = isEdit ? 'Edit Teacher' : 'Add Teacher';
    form.reset();
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
    const target = e.target;
    if (target.classList.contains('action-icons')) {
      const id = target.dataset.id;
      if (target.title === 'Edit') {
        // Fetch teacher details for edit (could reuse list data but fetch single for freshness)
        const teacher = await fetchJSON(`/api/admin/teachers/${id}`);
        openModal(true, teacher);
      } else if (target.title === 'Deactivate') {
        if (confirm('Are you sure you want to deactivate this teacher?')) {
          await fetchJSON(`/api/admin/teachers/${id}`, { method: 'DELETE' });
          loadTeachers();
        }
      }
    }
  });

  // Search & filter actions
  searchBtn.addEventListener('click', loadTeachers);
  deptFilter.addEventListener('change', loadTeachers);

  // Add button
  addBtn.addEventListener('click', () => openModal(false));

  // Modal close
  modalClose.addEventListener('click', closeModal);
  window.addEventListener('click', e => {
    if (e.target === modal) closeModal();
  });

  // Initial load
  loadDepartments().then(loadTeachers).catch(err => console.error('Init error', err));
});
