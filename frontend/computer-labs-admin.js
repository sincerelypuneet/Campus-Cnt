document.addEventListener('DOMContentLoaded', () => {
  const labList = document.getElementById('admin-lab-list');
  const requestList = document.getElementById('admin-hpc-request-list');
  const message = document.getElementById('admin-lab-message');
  const createForm = document.getElementById('admin-lab-create-form');
  const utilizationForm = document.getElementById('admin-lab-utilization-form');
  const maintenanceForm = document.getElementById('admin-maintenance-form');
  const maintenanceList = document.getElementById('admin-maintenance-list');
  const maintenanceType = document.getElementById('maintenance-type-select');
  const maintenanceLabGroup = document.getElementById('maintenance-lab-group');
  const maintenancePcGroup = document.getElementById('maintenance-pc-group');
  const maintenanceClassroomGroup = document.getElementById('maintenance-classroom-group');
  const maintenanceLabSelect = document.getElementById('maintenance-lab-select');
  const maintenancePcSelect = document.getElementById('maintenance-pc-select');
  const maintenanceClassroomSelect = document.getElementById('maintenance-classroom-select');
  const maintenanceDateInput = document.getElementById('maintenance-date-input');
  let currentLabs = [];
  let currentClassrooms = [];
  let allMaintenanceRecords = [];
  let activeMaintenanceFilter = 'all';

  const today = new Date();
  const localDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  utilizationForm.elements.date.min = localDate;
  utilizationForm.elements.date.value = localDate;
  if (maintenanceDateInput) {
    maintenanceDateInput.min = localDate;
    maintenanceDateInput.value = localDate;
  }

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
    if (!response.ok) throw new Error(result.message || `Request failed (${response.status})`);
    return result;
  }

  function showMessage(text, success = false) {
    message.textContent = text;
    message.classList.toggle('is-success', success);
  }

  function labCard(lab) {
    const computers = lab.computers || [];
    const utilization = lab.utilization
      ? `<p class="admin-utilization-summary">${lab.utilization.occupied} occupied · ${lab.utilization.available} available · ${lab.utilization.total} total</p>`
      : '<p class="admin-lab-muted">Choose a time above to calculate utilization.</p>';
    const pcMarkup = computers.map((computer) => {
      const state = computer.availability === 'occupied' ? 'Occupied' : computer.availability === 'available' ? 'Available' : '';
      return `<div class="admin-pc-row"><span><strong>${escapeHtml(computer.name || 'Computer')}</strong>${state ? `<small class="${state === 'Occupied' ? 'is-occupied' : 'is-available'}">${state}</small>` : ''}</span>
        <button type="button" class="admin-small-button admin-danger-button" data-remove-computer="${escapeHtml(computer.id)}" data-lab-id="${escapeHtml(lab.id)}">Remove</button></div>`;
    }).join('') || '<p class="admin-lab-muted">No active PCs. Add a computer below.</p>';
    return `<article class="admin-lab-card">
      <form class="admin-lab-form admin-edit-lab-form" data-edit-lab="${escapeHtml(lab.id)}">
        <div class="admin-lab-card-heading"><h3>${escapeHtml(lab.name)}</h3><span class="admin-category">${escapeHtml(lab.category)}</span></div>
        <label>Laboratory name<input name="name" value="${escapeHtml(lab.name)}" maxlength="120" required /></label>
        <label>Category<select name="category" required>
          <option value="LPC" ${lab.category === 'LPC' ? 'selected' : ''}>LPC – Low Performance Computing</option>
          <option value="HPC" ${lab.category === 'HPC' ? 'selected' : ''}>HPC – High Performance Computing</option>
        </select></label>
        <label>Building<input name="building" value="${escapeHtml(lab.building || '')}" maxlength="120" required /></label>
        <label>Room<input name="room" value="${escapeHtml(lab.room || '')}" maxlength="80" /></label>
        <label class="admin-lab-wide">Description<textarea name="description" maxlength="500" rows="2">${escapeHtml(lab.description || '')}</textarea></label>
        <div class="admin-lab-actions admin-lab-wide"><button type="submit" class="admin-small-button">Save changes</button><button type="button" class="admin-small-button admin-danger-button" data-remove-lab="${escapeHtml(lab.id)}">Remove lab</button></div>
      </form>
      <div class="admin-pc-section"><h4>Active PCs (${computers.length})</h4>${utilization}${pcMarkup}
        <form class="admin-add-pc-form" data-add-pc="${escapeHtml(lab.id)}"><label>Add PC<input name="name" maxlength="80" placeholder="e.g. LPC-01" required /></label><button class="admin-small-button" type="submit">Add PC</button></form>
      </div>
    </article>`;
  }

  function renderRequests(requests) {
    requestList.innerHTML = requests.map((item) => {
      const pending = String(item.status || '').toLowerCase() === 'pending';
      const status = String(item.status || 'pending');
      return `<article class="admin-hpc-request">
        <div class="admin-hpc-copy"><strong>${escapeHtml(item.labName || 'HPC lab')} · ${escapeHtml(item.studentName || 'Student')}</strong>
          <small>${escapeHtml(item.studentId || '')} · ${escapeHtml(item.date)} · ${escapeHtml(item.startTime)}–${escapeHtml(item.endTime)}</small>
          <p>${escapeHtml(item.purpose || 'Purpose not provided')}${item.computerName ? ` · PC: ${escapeHtml(item.computerName)}` : ''}</p>
        </div><span class="admin-request-status ${pending ? 'is-pending' : ''}">${escapeHtml(status)}</span>
        ${pending ? `<div class="admin-request-actions"><button type="button" class="admin-small-button" data-decision="approved" data-request-id="${escapeHtml(item.id)}">Approve</button><button type="button" class="admin-small-button admin-danger-button" data-decision="rejected" data-request-id="${escapeHtml(item.id)}">Reject</button></div>` : ''}
      </article>`;
    }).join('') || '<p class="admin-lab-muted">No HPC booking requests have been submitted.</p>';
  }

  async function loadManagement(query = '') {
    const [result, classroomsData, maintenanceData] = await Promise.all([
      requestJson(`/api/admin/computer-labs${query}`),
      requestJson('/api/admin/classrooms').catch(() => []),
      requestJson('/api/admin/maintenance').catch(() => ({ maintenance: [] })),
    ]);
    currentLabs = (result.labs || []).filter((lab) => lab.active !== false);
    currentClassrooms = Array.isArray(classroomsData) ? classroomsData.filter((c) => c.active !== false) : [];
    allMaintenanceRecords = maintenanceData.maintenance || [];

    labList.innerHTML = currentLabs.map(labCard).join('') ||
      '<p class="admin-lab-muted">No laboratories yet. Add one above.</p>';
    renderRequests(result.requests || []);
    populateMaintenanceDropdowns();
    renderMaintenance();
  }

  function populateMaintenanceDropdowns() {
    if (maintenanceLabSelect) {
      const selectedLabId = maintenanceLabSelect.value;
      maintenanceLabSelect.innerHTML = currentLabs.map((l) => `<option value="${escapeHtml(l.id)}">${escapeHtml(l.name)}</option>`).join('');
      if (selectedLabId && currentLabs.some((l) => l.id === selectedLabId)) {
        maintenanceLabSelect.value = selectedLabId;
      }
      updatePcDropdown();
    }
    if (maintenanceClassroomSelect) {
      maintenanceClassroomSelect.innerHTML = currentClassrooms.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name || `Room ${c.classroomNumber || c.roomNumber}`)}</option>`).join('');
    }
  }

  function updatePcDropdown() {
    if (!maintenancePcSelect || !maintenanceLabSelect) return;
    const lab = currentLabs.find((l) => l.id === maintenanceLabSelect.value);
    const pcs = lab && Array.isArray(lab.computers) ? lab.computers.filter((p) => p.active !== false) : [];
    const currentVal = maintenancePcSelect.value;
    maintenancePcSelect.innerHTML = '<option value="all">Entire Laboratory (All PCs)</option>' +
      pcs.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join('');
    if (currentVal && (currentVal === 'all' || pcs.some((p) => p.id === currentVal))) {
      maintenancePcSelect.value = currentVal;
    }
  }

  function renderMaintenance() {
    if (!maintenanceList) return;
    const filtered = allMaintenanceRecords.filter((rec) => {
      if (activeMaintenanceFilter === 'all') return true;
      return rec.status === activeMaintenanceFilter;
    });

    if (!filtered.length) {
      maintenanceList.innerHTML = '<p class="admin-lab-muted">No maintenance records found for this filter.</p>';
      return;
    }

    maintenanceList.innerHTML = filtered.map((rec) => {
      const isCancellable = rec.status === 'scheduled' || rec.status === 'active';
      return `<article class="admin-maintenance-card" data-maintenance-id="${escapeHtml(rec.id)}">
        <div class="admin-maintenance-info">
          <strong>${escapeHtml(rec.resourceName)} ${rec.subResourceName ? `· ${escapeHtml(rec.subResourceName)}` : ''}</strong>
          <small>${escapeHtml(rec.date)} · ${escapeHtml(rec.startTime)}–${escapeHtml(rec.endTime)}</small>
          <p><strong>Reason:</strong> ${escapeHtml(rec.reason)}${rec.description ? ` — ${escapeHtml(rec.description)}` : ''}</p>
        </div>
        <div class="admin-maintenance-actions">
          <span class="status-badge status-${escapeHtml(rec.status)}">${escapeHtml(rec.status)}</span>
          ${isCancellable ? `<button type="button" class="admin-small-button admin-danger-button" data-cancel-maintenance="${escapeHtml(rec.id)}">Cancel</button>` : ''}
        </div>
      </article>`;
    }).join('');
  }

  if (maintenanceType) {
    maintenanceType.addEventListener('change', () => {
      const isLab = maintenanceType.value === 'lab';
      if (maintenanceLabGroup) maintenanceLabGroup.style.display = isLab ? '' : 'none';
      if (maintenancePcGroup) maintenancePcGroup.style.display = isLab ? '' : 'none';
      if (maintenanceClassroomGroup) maintenanceClassroomGroup.style.display = isLab ? 'none' : '';
    });
  }

  if (maintenanceLabSelect) {
    maintenanceLabSelect.addEventListener('change', updatePcDropdown);
  }

  if (maintenanceForm) {
    maintenanceForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submit = maintenanceForm.querySelector('button[type="submit"]');
      submit.disabled = true;
      const values = Object.fromEntries(new FormData(maintenanceForm));
      try {
        await requestJson('/api/admin/maintenance', {
          method: 'POST',
          body: JSON.stringify(values),
        });
        showMessage('Maintenance scheduled successfully.', true);
        maintenanceForm.reset();
        if (maintenanceDateInput) maintenanceDateInput.value = localDate;
        if (maintenanceType) maintenanceType.dispatchEvent(new Event('change'));
        await loadManagement();
      } catch (error) {
        showMessage(error.message || 'Could not schedule maintenance.');
      } finally {
        submit.disabled = false;
      }
    });
  }

  document.querySelectorAll('[data-maintenance-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-maintenance-filter]').forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      activeMaintenanceFilter = btn.dataset.maintenanceFilter;
      renderMaintenance();
    });
  });

  if (maintenanceList) {
    maintenanceList.addEventListener('click', async (event) => {
      const cancelBtn = event.target.closest('[data-cancel-maintenance]');
      if (!cancelBtn) return;
      cancelBtn.disabled = true;
      try {
        await requestJson(`/api/admin/maintenance/${encodeURIComponent(cancelBtn.dataset.cancelMaintenance)}/cancel`, {
          method: 'POST',
        });
        showMessage('Maintenance record cancelled.', true);
        await loadManagement();
      } catch (error) {
        showMessage(error.message || 'Could not cancel maintenance.');
        cancelBtn.disabled = false;
      }
    });
  }

  createForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = createForm.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      await requestJson('/api/admin/computer-labs', {
        method: 'POST',
        body: JSON.stringify(Object.fromEntries(new FormData(createForm))),
      });
      createForm.reset();
      showMessage('Laboratory added.', true);
      await loadManagement();
    } catch (error) {
      showMessage(error.message || 'Could not add the laboratory.');
    } finally {
      submit.disabled = false;
    }
  });

  utilizationForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!utilizationForm.reportValidity()) return;
    const query = new URLSearchParams(Object.fromEntries(new FormData(utilizationForm))).toString();
    try {
      await loadManagement(`?${query}`);
      showMessage('Utilization updated for the selected time.', true);
    } catch (error) {
      showMessage(error.message || 'Could not load utilization.');
    }
  });

  labList.addEventListener('submit', async (event) => {
    const editForm = event.target.closest('[data-edit-lab]');
    const addPcForm = event.target.closest('[data-add-pc]');
    if (!editForm && !addPcForm) return;
    event.preventDefault();
    const form = editForm || addPcForm;
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      if (editForm) {
        await requestJson(`/api/admin/computer-labs/${encodeURIComponent(editForm.dataset.editLab)}`, {
          method: 'PUT',
          body: JSON.stringify(Object.fromEntries(new FormData(editForm))),
        });
        showMessage('Laboratory details saved.', true);
      } else {
        await requestJson(`/api/admin/computer-labs/${encodeURIComponent(addPcForm.dataset.addPc)}/computers`, {
          method: 'POST',
          body: JSON.stringify(Object.fromEntries(new FormData(addPcForm))),
        });
        showMessage('Computer added.', true);
      }
      await loadManagement();
    } catch (error) {
      showMessage(error.message || 'Could not save laboratory changes.');
      submit.disabled = false;
    }
  });

  labList.addEventListener('click', async (event) => {
    const removeComputer = event.target.closest('[data-remove-computer]');
    const removeLab = event.target.closest('[data-remove-lab]');
    if (!removeComputer && !removeLab) return;
    const button = removeComputer || removeLab;
    button.disabled = true;
    const url = removeComputer
      ? `/api/admin/computer-labs/${encodeURIComponent(removeComputer.dataset.labId)}/computers/${encodeURIComponent(removeComputer.dataset.removeComputer)}`
      : `/api/admin/computer-labs/${encodeURIComponent(removeLab.dataset.removeLab)}`;
    try {
      await requestJson(url, { method: 'DELETE' });
      showMessage(removeComputer ? 'Computer removed.' : 'Laboratory removed.', true);
      await loadManagement();
    } catch (error) {
      showMessage(error.message || 'Could not remove this resource.');
      button.disabled = false;
    }
  });

  requestList.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-decision]');
    if (!button) return;
    button.disabled = true;
    try {
      await requestJson(`/api/admin/computer-lab-requests/${encodeURIComponent(button.dataset.requestId)}/decision`, {
        method: 'POST',
        body: JSON.stringify({ decision: button.dataset.decision }),
      });
      showMessage(button.dataset.decision === 'approved' ? 'HPC request approved and a PC reserved.' : 'HPC request rejected.', true);
      await loadManagement();
    } catch (error) {
      showMessage(error.message || 'Could not update the request.');
      button.disabled = false;
    }
  });

  loadManagement().catch((error) => showMessage(error.message || 'Could not load computer laboratory management.'));
});
