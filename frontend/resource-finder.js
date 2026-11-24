// frontend/resource-finder.js

(() => {
  const form = document.getElementById('resource-search');
  const resultsContainer = document.getElementById('resource-results');
  const message = document.getElementById('finder-message');
  const summary = document.getElementById('results-summary');
  const statsBox = document.getElementById('results-stats');
  const totalStat = document.getElementById('total-stat');
  const availableStat = document.getElementById('available-stat');
  const clearFiltersBtn = document.getElementById('clear-filters');

  // Modal elements
  const modal = document.getElementById('action-modal');
  const modalTitle = document.getElementById('modal-title');
  const modalBody = document.getElementById('modal-body');
  const modalClose = document.getElementById('modal-close');
  const modalCancel = document.getElementById('modal-cancel');
  const modalConfirm = document.getElementById('modal-confirm');

  let currentAction = null;
  let lastSearch = null;

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
    message.innerHTML = `${escapeHtml(text)}${allowSignIn ? ' <a href="login-student.html?next=find-resource.html">Sign in to continue</a>.' : ''}`;
  }

  function localDateKey(date) {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
  }

  function formatTime(timeStr) {
    return timeStr || '';
  }

  async function loadOptions() {
    try {
      const options = await requestJson('/api/student/resources/options');
      const buildingSelect = document.getElementById('filter-building');
      const currentVal = buildingSelect.value;
      buildingSelect.innerHTML = `<option value="">All buildings</option>${(options.buildings || []).map((b) =>
        `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`
      ).join('')}`;
      if (currentVal) buildingSelect.value = currentVal;
    } catch (error) {
      console.warn('Could not load options:', error);
    }
  }

  function initDefaultTimes() {
    const now = new Date();
    document.getElementById('filter-date').min = localDateKey(now);
    document.getElementById('filter-date').value = localDateKey(now);

    const nextHour = (now.getHours() + 1) % 24;
    const endHour = (nextHour + 1) % 24;
    document.getElementById('filter-start-time').value = `${String(nextHour).padStart(2, '0')}:00`;
    document.getElementById('filter-end-time').value = `${String(endHour).padStart(2, '0')}:00`;
  }

  function renderResults(resources, criteria) {
    const total = resources.length;
    const availableCount = resources.filter((r) => r.availability === 'available').length;

    statsBox.hidden = false;
    totalStat.textContent = `${total} resource${total === 1 ? '' : 's'}`;
    availableStat.textContent = `${availableCount} available`;

    if (total === 0) {
      summary.textContent = 'No resources match your search parameters.';
      resultsContainer.innerHTML = `
        <div class="empty-state">
          <strong>No resources found</strong>
          <p>No classrooms, laboratories, or workstations matched your selected criteria. Try adjusting your time slot, lowering the minimum capacity, or clearing the equipment filter.</p>
        </div>`;
      return;
    }

    summary.textContent = `Found ${total} resource${total === 1 ? '' : 's'} (${availableCount} available) for ${criteria.date} (${criteria.startTime}–${criteria.endTime}).`;

    resultsContainer.innerHTML = resources.map((res) => {
      const isAvailable = res.availability === 'available';
      const isMaint = res.availability === 'maintenance';
      const isOccupied = res.availability === 'occupied';
      const isApproval = res.availability === 'request_required';

      let statusBadgeClass = 'badge--neutral';
      if (isAvailable) statusBadgeClass = 'status--available';
      else if (isMaint) statusBadgeClass = 'status--maintenance';
      else if (isOccupied) statusBadgeClass = 'status--occupied';
      else if (isApproval) statusBadgeClass = 'status--request_required';

      let actionMarkup = '';
      if (res.bookingAction) {
        if (res.bookingAction.type === 'reserve_classroom') {
          actionMarkup = `<button class="button button--primary" type="button" data-action="reserve_classroom" data-resource-id="${escapeHtml(res.id)}">Reserve Classroom</button>`;
        } else if (res.bookingAction.type === 'book_computer') {
          actionMarkup = `<button class="button button--primary" type="button" data-action="book_computer" data-lab-id="${escapeHtml(res.labId)}" data-pc-id="${escapeHtml(res.computerId)}">Book Workstation</button>`;
        } else if (res.bookingAction.type === 'request_hpc' || res.bookingAction.type === 'request_hpc_lab') {
          actionMarkup = `<button class="button button--quiet" type="button" data-action="request_hpc" data-lab-id="${escapeHtml(res.labId || res.id)}">Request HPC Access</button>`;
        } else if (res.bookingAction.type === 'view_lab_pcs') {
          actionMarkup = `<a class="button button--quiet" href="${escapeHtml(res.bookingAction.url || 'computer-labs.html')}">View Lab Computers</a>`;
        }
      } else if (isMaint) {
        actionMarkup = `<button class="button button--quiet" disabled type="button">Under Maintenance</button>`;
      } else if (isOccupied) {
        actionMarkup = `<button class="button button--quiet" disabled type="button">Unavailable</button>`;
      }

      return `
        <article class="resource-card" data-id="${escapeHtml(res.id)}">
          <div>
            <div class="resource-card-header">
              <div>
                <h3 class="resource-card-title">${escapeHtml(res.name)}</h3>
                <div class="resource-card-meta">
                  <span class="badge badge--type">${escapeHtml(res.typeLabel)}</span>
                  <span class="badge ${statusBadgeClass}">${escapeHtml(res.statusLabel)}</span>
                </div>
              </div>
              <span class="badge badge--neutral">${escapeHtml(res.capacity)} ${res.capacity === 1 ? 'seat' : 'seats'}</span>
            </div>

            <div class="resource-card-body">
              <div class="resource-detail-row">
                <span class="resource-detail-icon">📍</span>
                <span>${escapeHtml(res.location || 'Campus location')}</span>
              </div>
              <div class="resource-detail-row">
                <span class="resource-detail-icon">⏱</span>
                <span>${escapeHtml(res.slot.date)} (${escapeHtml(res.slot.weekday)}) · ${escapeHtml(res.slot.startTime)}–${escapeHtml(res.slot.endTime)}</span>
              </div>
              <div class="resource-detail-row">
                <span class="resource-detail-icon">⚙</span>
                <span>${escapeHtml(res.specifications || 'Standard campus facilities')}</span>
              </div>

              ${res.maintenanceReason ? `
                <div class="resource-maintenance-alert">
                  <strong>⚠️ Maintenance Notice:</strong> ${escapeHtml(res.maintenanceReason)}
                </div>` : ''}
            </div>
          </div>

          <div class="resource-card-footer">
            ${actionMarkup}
          </div>
        </article>
      `;
    }).join('');
  }

  async function executeSearch(criteria, updateMessage = true) {
    lastSearch = criteria;
    const response = await requestJson('/api/student/resources/search', {
      method: 'POST',
      body: JSON.stringify(criteria),
    });
    renderResults(response.resources || [], criteria);
    if (updateMessage) {
      showMessage('Availability verified across all campus resources.', false);
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submitBtn = document.getElementById('search-submit');
    submitBtn.disabled = true;
    summary.textContent = 'Verifying resource availability, timetables, and maintenance windows…';
    showMessage('');

    const formData = new FormData(form);
    const criteria = {
      resourceType: formData.get('type') || 'all',
      date: formData.get('date'),
      startTime: formData.get('startTime'),
      endTime: formData.get('endTime'),
      building: formData.get('building') || '',
      minCapacity: Number(formData.get('minCapacity')) || 1,
      equipment: formData.get('equipment') || '',
      sortBy: formData.get('sortBy') || 'availability',
      availableOnly: formData.get('availableOnly') === 'on',
    };

    try {
      await executeSearch(criteria);
    } catch (error) {
      summary.textContent = 'Search could not be completed.';
      statsBox.hidden = true;
      showMessage(error.message || 'Could not verify resource availability.', true, error.status === 401 || error.status === 403);
    } finally {
      submitBtn.disabled = false;
    }
  });

  clearFiltersBtn.addEventListener('click', () => {
    form.reset();
    initDefaultTimes();
    resultsContainer.innerHTML = '';
    statsBox.hidden = true;
    summary.textContent = 'Select a date and time slot above to discover available resources.';
    showMessage('');
  });

  // Modal helpers
  function openModal(title, bodyHtml, onConfirm) {
    modalTitle.textContent = title;
    modalBody.innerHTML = bodyHtml;
    currentAction = onConfirm;
    modal.hidden = false;
  }

  function closeModal() {
    modal.hidden = true;
    currentAction = null;
    modalConfirm.disabled = false;
  }

  modalClose.addEventListener('click', closeModal);
  modalCancel.addEventListener('click', closeModal);
  modalConfirm.addEventListener('click', async () => {
    if (typeof currentAction === 'function') {
      modalConfirm.disabled = true;
      try {
        await currentAction();
        closeModal();
      } catch (err) {
        modalConfirm.disabled = false;
        alert(err.message || 'Action failed.');
      }
    }
  });

  // Results action clicks
  resultsContainer.addEventListener('click', async (event) => {
    const target = event.target;
    const action = target.dataset.action;
    if (!action || !lastSearch) return;

    if (action === 'reserve_classroom') {
      const classroomId = target.dataset.resourceId;
      openModal(
        'Confirm Classroom Reservation',
        `
        <div class="modal-info-box">
          <p><strong>Date:</strong> ${escapeHtml(lastSearch.date)}</p>
          <p><strong>Time:</strong> ${escapeHtml(lastSearch.startTime)} – ${escapeHtml(lastSearch.endTime)}</p>
          <p><strong>Classroom ID:</strong> ${escapeHtml(classroomId)}</p>
        </div>
        <p>Would you like to reserve this classroom? Once confirmed, this room will be reserved exclusively for your scheduled activity.</p>
        `,
        async () => {
          await requestJson('/api/student/classroom-reservations', {
            method: 'POST',
            body: JSON.stringify({
              classroomId,
              date: lastSearch.date,
              startTime: lastSearch.startTime,
              endTime: lastSearch.endTime,
            }),
          });
          showMessage('Reservation confirmed! The classroom has been booked for you.', false);
          await executeSearch(lastSearch, false);
        }
      );
    } else if (action === 'book_computer') {
      const labId = target.dataset.labId;
      const computerId = target.dataset.pcId;
      openModal(
        'Confirm Workstation Booking',
        `
        <div class="modal-info-box">
          <p><strong>Date:</strong> ${escapeHtml(lastSearch.date)}</p>
          <p><strong>Time:</strong> ${escapeHtml(lastSearch.startTime)} – ${escapeHtml(lastSearch.endTime)}</p>
          <p><strong>Workstation ID:</strong> ${escapeHtml(computerId)}</p>
        </div>
        <p>Confirm your booking for this computer workstation. It will be reserved immediately upon confirmation.</p>
        `,
        async () => {
          await requestJson('/api/student/computer-lab-bookings', {
            method: 'POST',
            body: JSON.stringify({
              labId,
              computerId,
              date: lastSearch.date,
              startTime: lastSearch.startTime,
              endTime: lastSearch.endTime,
            }),
          });
          showMessage('Workstation booked successfully! Enjoy your session.', false);
          await executeSearch(lastSearch, false);
        }
      );
    } else if (action === 'request_hpc') {
      const labId = target.dataset.labId;
      openModal(
        'Submit High Performance Computing Request',
        `
        <div class="modal-info-box">
          <p><strong>Date:</strong> ${escapeHtml(lastSearch.date)}</p>
          <p><strong>Time:</strong> ${escapeHtml(lastSearch.startTime)} – ${escapeHtml(lastSearch.endTime)}</p>
        </div>
        <div style="display:grid; gap:8px;">
          <label for="hpc-purpose"><strong>Purpose of HPC Access:</strong></label>
          <textarea id="hpc-purpose" rows="3" style="width:100%; border:1px solid #dfe4ed; border-radius:8px; padding:8px; font:inherit;" placeholder="Describe your computational project, simulation, or AI research..."></textarea>
        </div>
        `,
        async () => {
          const purposeInput = document.getElementById('hpc-purpose');
          const purpose = purposeInput ? purposeInput.value.trim() : '';
          if (!purpose) {
            throw new Error('Please enter a purpose for your HPC request.');
          }
          await requestJson('/api/student/lab-requests', {
            method: 'POST',
            body: JSON.stringify({
              labId,
              date: lastSearch.date,
              startTime: lastSearch.startTime,
              endTime: lastSearch.endTime,
              purpose,
            }),
          });
          showMessage('HPC request submitted! An administrator will review your request shortly.', false);
          await executeSearch(lastSearch, false);
        }
      );
    }
  });

  // Init
  initDefaultTimes();
  loadOptions();
})();
