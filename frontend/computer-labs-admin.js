document.addEventListener('DOMContentLoaded', () => {
  const labList = document.getElementById('admin-lab-list');
  const requestList = document.getElementById('admin-hpc-request-list');
  const message = document.getElementById('admin-lab-message');
  const createForm = document.getElementById('admin-lab-create-form');
  const utilizationForm = document.getElementById('admin-lab-utilization-form');
  const today = new Date();
  const localDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  utilizationForm.elements.date.min = localDate;
  utilizationForm.elements.date.value = localDate;

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
    const result = await requestJson(`/api/admin/computer-labs${query}`);
    labList.innerHTML = (result.labs || []).filter((lab) => lab.active !== false).map(labCard).join('') ||
      '<p class="admin-lab-muted">No laboratories yet. Add one above.</p>';
    renderRequests(result.requests || []);
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
