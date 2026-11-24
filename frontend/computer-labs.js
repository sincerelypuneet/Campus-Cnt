document.addEventListener('DOMContentLoaded', () => {
  const message = document.getElementById('page-message');
  const labList = document.getElementById('lab-list');
  const requestList = document.getElementById('request-list');
  const availabilityForm = document.getElementById('availability-form');
  const hpcForm = document.getElementById('hpc-request-form');
  const hpcPanel = document.getElementById('hpc-request-panel');
  const hpcLabSelect = document.getElementById('hpc-lab-select');
  const today = new Date();
  const localDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  let labs = [];
  let selectedCategory = 'LPC';
  let hasAvailability = false;

  availabilityForm.elements.date.min = localDate;
  availabilityForm.elements.date.value = localDate;
  hpcForm.elements.date.min = localDate;
  hpcForm.elements.date.value = localDate;

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

  function showMessage(text, success = false) {
    message.textContent = text;
    message.classList.toggle('is-success', success);
  }

  function slotValues() {
    return {
      date: availabilityForm.elements.date.value,
      startTime: availabilityForm.elements.startTime.value,
      endTime: availabilityForm.elements.endTime.value,
    };
  }

  function renderLabs() {
    const visibleLabs = labs.filter((lab) => lab.category === selectedCategory);
    labList.innerHTML = visibleLabs.map((lab) => {
      const computers = lab.computers || [];
      const computerMarkup = selectedCategory === 'LPC'
        ? `<div class="computer-list">${computers.length ? computers.map((computer) => {
          const availability = hasAvailability ? computer.availability : 'unknown';
          const available = availability === 'available';
          const inMaintenance = availability === 'maintenance';
          const stateLabel = inMaintenance ? 'Maintenance' : availability === 'occupied' ? 'Occupied' : available ? 'Available' : 'Check a time';
          const stateClass = inMaintenance ? 'state--occupied' : availability === 'occupied' ? 'state--occupied' : available ? '' : 'state--neutral';
          return `<div class="computer-row">
            <div><strong>${escapeHtml(computer.name || 'Computer')}</strong><small>${escapeHtml(computer.id || '')}</small></div>
            <span class="state ${stateClass}">${stateLabel}</span>
            ${available ? `<button class="button button--primary" type="button" data-book-lab="${escapeHtml(lab.id)}" data-computer="${escapeHtml(computer.id)}">Reserve</button>` : ''}
          </div>`;
        }).join('') : '<p class="empty-state">No active PCs are listed. Contact the Lab Head/Admin.</p>'}</div>`
        : `<p class="muted">Submit a booking request with your student details and purpose. No PC is held until the request is approved.</p>`;
      return `<article class="lab-card">
        <div class="section-title-row"><h3>${escapeHtml(lab.name || 'Computer laboratory')}</h3><span class="lab-badge">${escapeHtml(lab.category)}</span></div>
        <p class="lab-meta">${escapeHtml([lab.building, lab.room].filter(Boolean).join(' · ') || 'Location not listed')}</p>
        ${lab.description ? `<p class="muted">${escapeHtml(lab.description)}</p>` : ''}
        ${computerMarkup}
        ${selectedCategory === 'HPC' ? `<button class="button button--quiet" type="button" data-request-lab="${escapeHtml(lab.id)}">Request this HPC lab</button>` : ''}
      </article>`;
    }).join('') || '<div class="empty-state">No active laboratories in this category.</div>';
    hpcPanel.hidden = selectedCategory !== 'HPC' || !labs.some((lab) => lab.category === 'HPC');
    hpcLabSelect.innerHTML = labs.filter((lab) => lab.category === 'HPC')
      .map((lab) => `<option value="${escapeHtml(lab.id)}">${escapeHtml(lab.name || 'Computer laboratory')}</option>`).join('');
  }

  async function loadLabs(query = '') {
    const result = await requestJson(`/api/student/computer-labs${query}`);
    labs = result.labs || [];
    if (result.profile) {
      const studentId = hpcForm.elements.studentId;
      const name = hpcForm.elements.name;
      studentId.value = result.profile.studentId || '';
      name.value = result.profile.name || '';
      studentId.readOnly = Boolean(studentId.value);
      name.readOnly = Boolean(name.value);
    }
    renderLabs();
  }

  async function loadRequests() {
    const result = await requestJson('/api/student/computer-lab-requests');
    const requests = result.requests || [];
    requestList.innerHTML = requests.map((item) => {
      const status = String(item.status || 'pending').toLowerCase();
      const label = status.charAt(0).toUpperCase() + status.slice(1);
      const statusClass = status === 'rejected' ? 'state--rejected' : status === 'pending' ? 'state--pending' : '';
      return `<article class="request-row"><div class="request-copy">
        <strong>${escapeHtml(item.labName || 'Computer laboratory')} · ${escapeHtml(item.category || 'Lab')}</strong>
        <small>${escapeHtml(item.date)} · ${escapeHtml(item.startTime)}–${escapeHtml(item.endTime)}${item.computerName ? ` · ${escapeHtml(item.computerName)}` : ''}</small>
        ${item.purpose ? `<p>${escapeHtml(item.purpose)}</p>` : ''}
      </div><span class="state ${statusClass}">${escapeHtml(label)}</span></article>`;
    }).join('') || '<div class="empty-state">You have no bookings or requests yet.</div>';
  }

  document.querySelectorAll('[data-category]').forEach((button) => {
    button.addEventListener('click', () => {
      selectedCategory = button.dataset.category;
      document.querySelectorAll('[data-category]').forEach((item) => item.classList.toggle('is-active', item === button));
      renderLabs();
    });
  });

  availabilityForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!availabilityForm.reportValidity()) return;
    const query = new URLSearchParams(slotValues()).toString();
    try {
      await loadLabs(`?${query}`);
      hasAvailability = true;
      showMessage('Availability updated for the selected time.', true);
      renderLabs();
    } catch (error) {
      showMessage(error.message || 'Could not check availability.');
    }
  });

  availabilityForm.addEventListener('input', () => {
    if (!hasAvailability) return;
    hasAvailability = false;
    renderLabs();
    showMessage('Check availability again after changing the selected time.');
  });

  labList.addEventListener('click', async (event) => {
    const reserveButton = event.target.closest('[data-book-lab]');
    const requestButton = event.target.closest('[data-request-lab]');
    if (reserveButton) {
      if (!availabilityForm.reportValidity()) return;
      reserveButton.disabled = true;
      try {
        await requestJson('/api/student/computer-lab-bookings', {
          method: 'POST',
          body: JSON.stringify({ ...slotValues(), labId: reserveButton.dataset.bookLab, computerId: reserveButton.dataset.computer }),
        });
      } catch (error) {
        showMessage(error.message || 'Could not reserve this computer.');
        reserveButton.disabled = false;
        return;
      }
      showMessage('Your LPC computer is reserved.', true);
      try {
        const query = new URLSearchParams(slotValues()).toString();
        await Promise.all([loadLabs(`?${query}`), loadRequests()]);
        hasAvailability = true;
        renderLabs();
      } catch (error) {
        showMessage(`Your computer is reserved, but the latest availability could not be loaded: ${error.message}`);
      }
    }
    if (requestButton) {
      hpcLabSelect.value = requestButton.dataset.requestLab;
      hpcPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
      hpcForm.elements.date.value = availabilityForm.elements.date.value || localDate;
      hpcForm.elements.startTime.value = availabilityForm.elements.startTime.value;
      hpcForm.elements.endTime.value = availabilityForm.elements.endTime.value;
    }
  });

  hpcForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!hpcForm.reportValidity()) return;
    const submit = hpcForm.querySelector('button[type="submit"]');
    submit.disabled = true;
    const values = Object.fromEntries(new FormData(hpcForm));
    try {
      await requestJson('/api/student/computer-lab-requests', { method: 'POST', body: JSON.stringify(values) });
    } catch (error) {
      showMessage(error.message || 'Could not submit the HPC request.');
      submit.disabled = false;
      return;
    }
    showMessage('Your HPC request was sent to the Lab Head/Admin.', true);
    hpcForm.elements.purpose.value = '';
    try {
      await loadRequests();
    } catch (error) {
      showMessage(`Your request was sent, but the request list could not be refreshed: ${error.message}`);
    }
    submit.disabled = false;
  });

  document.getElementById('refresh-requests').addEventListener('click', () => {
    loadRequests().catch((error) => showMessage(error.message || 'Could not refresh requests.'));
  });

  Promise.all([loadLabs(), loadRequests()]).catch((error) => {
    if (error.status === 401 || error.status === 403) {
      showMessage('Please sign in with a student account to manage computer lab bookings.');
    } else {
      showMessage(error.message || 'Computer laboratories could not be loaded.');
    }
  });
});
