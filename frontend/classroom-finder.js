(() => {
  const form = document.getElementById('classroom-search');
  const results = document.getElementById('classroom-results');
  const message = document.getElementById('finder-message');
  const summary = document.getElementById('results-summary');
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
    message.innerHTML = `${escapeHtml(text)}${allowSignIn ? ' <a href="login-student.html?next=find-classroom.html">Sign in to continue</a>.' : ''}`;
  }

  function localDateKey(date) {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
  }

  function populateOptions(select, values, placeholder) {
    select.innerHTML = `<option value="">${placeholder}</option>${values.map((value) =>
      `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`
    ).join('')}`;
  }

  async function loadOptions() {
    try {
      const options = await requestJson('/api/student/classrooms/options');
      populateOptions(form.elements.building, options.buildings || [], 'All buildings');
      populateOptions(form.elements.floor, options.floors || [], 'All floors');
    } catch (error) {
      showMessage(error.message || 'Could not load classroom filters.', true, error.status === 401 || error.status === 403);
    }
  }

  function renderClassrooms(classrooms) {
    summary.textContent = `${classrooms.length} available classroom${classrooms.length === 1 ? '' : 's'} for your selected time.`;
    if (!classrooms.length) {
      results.innerHTML = '<div class="empty-state"><strong>No classrooms available</strong>Try another time, building, floor, or seating capacity.</div>';
      return;
    }
    results.innerHTML = classrooms.map((room) => {
      const facilities = (room.facilities || []).map(escapeHtml).join(' · ') || 'No facilities listed';
      const floor = room.floor === null || room.floor === undefined ? 'Floor not listed' : `Floor ${escapeHtml(room.floor)}`;
      return `<article class="classroom-card">
        <div class="room-heading">
          <div><h3>${escapeHtml(room.roomNumber)}</h3><p>${escapeHtml(room.building)} · ${floor}</p></div>
          <span class="room-capacity">${escapeHtml(room.seatingCapacity)} seats</span>
        </div>
        <p class="room-meta">${escapeHtml(room.roomType)}</p>
        <div class="room-time"><span aria-hidden="true">◷</span><strong>Available ${escapeHtml(room.availableTimeSlot.startTime)}–${escapeHtml(room.availableTimeSlot.endTime)}</strong></div>
        <p class="room-facilities"><strong>Facilities:</strong> ${facilities}</p>
        <div class="room-actions"><button class="button button--quiet" type="button" data-reserve="${escapeHtml(room.id)}">Reserve this room</button></div>
      </article>`;
    }).join('');
  }

  async function searchClassrooms(criteria, updateMessage = true) {
    const response = await requestJson('/api/student/classrooms/search', {
      method: 'POST',
      body: JSON.stringify(criteria),
    });
    lastSearch = criteria;
    renderClassrooms(response.classrooms || []);
    if (updateMessage) showMessage('Availability checked. No room was reserved.');
  }

  form.elements.date.min = localDateKey(new Date());
  form.elements.date.value = localDateKey(new Date());
  loadOptions();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    const criteria = Object.fromEntries(new FormData(form));
    criteria.minCapacity = Number(criteria.minCapacity);
    button.disabled = true;
    results.innerHTML = '';
    summary.textContent = 'Checking classroom schedules and reservations…';
    showMessage('');
    try {
      await searchClassrooms(criteria);
    } catch (error) {
      summary.textContent = 'Search could not be completed.';
      showMessage(error.message || 'Could not search classrooms.', true, error.status === 401 || error.status === 403);
    } finally {
      button.disabled = false;
    }
  });

  results.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-reserve]');
    if (!button || !lastSearch) return;
    if (!window.confirm('Reserve this classroom for the selected time?')) return;
    button.disabled = true;
    try {
      await requestJson('/api/student/classroom-reservations', {
        method: 'POST',
        body: JSON.stringify({ ...lastSearch, classroomId: button.dataset.reserve }),
      });
      showMessage('Reservation confirmed. The room has been removed from the available results.');
      await searchClassrooms(lastSearch, false);
    } catch (error) {
      showMessage(error.message || 'Could not reserve this classroom.', true, error.status === 401 || error.status === 403);
      if (error.status === 409) {
        try {
          await searchClassrooms(lastSearch, false);
        } catch (refreshError) {
          console.error('Could not refresh classroom availability after a reservation conflict:', refreshError);
        }
      }
    }
  });
})();