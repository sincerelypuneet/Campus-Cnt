document.addEventListener('DOMContentLoaded', () => {
  const navLinks = document.querySelectorAll('.nav-link[data-section]');
  const sections = {
    dashboard: document.getElementById('dashboard-section'),
    teachers: document.getElementById('teachers-section'),
    timetable: document.getElementById('timetable-section'),
    labs: document.getElementById('labs-section'),
    placeholder: document.getElementById('placeholder-section'),
  };
  const sidebar = document.getElementById('sidebar');
  const sidebarToggle = document.getElementById('toggle-sidebar');
  let mobileNavigation = window.matchMedia('(max-width: 768px)').matches;
  const modalFocusSelector = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

  document.querySelectorAll('.modal').forEach(modal => {
    let returnFocus = null;
    const dialog = modal.querySelector('[role="dialog"]');
    const observer = new MutationObserver(() => {
      if (modal.getAttribute('aria-hidden') === 'false') {
        if (modal.dataset.keyboardOpen) return;
        returnFocus = document.activeElement;
        modal.dataset.keyboardOpen = 'true';
        const firstField = dialog && dialog.querySelector('input:not([disabled]), select:not([disabled]), textarea:not([disabled])');
        (firstField || dialog).focus();
      } else if (modal.dataset.keyboardOpen) {
        delete modal.dataset.keyboardOpen;
        if (returnFocus && returnFocus.isConnected && !returnFocus.closest('[hidden]')) {
          returnFocus.focus();
        } else {
          const fallback = modal.id === 'teacher-modal'
            ? document.getElementById('add-teacher-btn')
            : document.getElementById('add-entry');
          if (fallback) fallback.focus();
        }
      }
    });
    observer.observe(modal, { attributes: true, attributeFilter: ['aria-hidden'] });

    modal.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        const closeButton = modal.querySelector('.close');
        if (closeButton) closeButton.click();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = Array.from(modal.querySelectorAll(modalFocusSelector))
        .filter(element => element.offsetParent !== null);
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
  });

  function setNavigationCollapsed(collapsed) {
    sidebar.classList.toggle('collapsed', collapsed);
    sidebarToggle.setAttribute('aria-expanded', String(!collapsed));
  }

  if (mobileNavigation) setNavigationCollapsed(true);

  window.addEventListener('resize', () => {
    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    if (isMobile !== mobileNavigation) {
      mobileNavigation = isMobile;
      setNavigationCollapsed(isMobile);
    }
  });

  function showSection(name) {
    const section = sections[name] || sections.placeholder;
    Object.values(sections).forEach(item => {
      if (item) item.hidden = item !== section;
    });
    navLinks.forEach(link => {
      const active = link.dataset.section === name;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  }

  navLinks.forEach(link => {
    link.addEventListener('click', event => {
      event.preventDefault();
      showSection(link.dataset.section);
      setNavigationCollapsed(mobileNavigation);
    });
  });

  if (sidebarToggle && sidebar) {
    sidebarToggle.addEventListener('click', () => {
      setNavigationCollapsed(!sidebar.classList.contains('collapsed'));
    });
  }

  const logout = document.getElementById('logout');
  if (logout) logout.addEventListener('click', async event => {
    event.preventDefault();
    try {
      const response = await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });
      if (!response.ok) throw new Error(`Logout failed (${response.status})`);
      window.location.assign('login.html');
    } catch (error) {
      window.alert(error.message || 'Unable to log out. Please try again.');
    }
  });

  const teacherModal = document.getElementById('teacher-modal');
  const addTeacher = () => {
    showSection('teachers');
    if (!teacherModal) return;
    teacherModal.style.display = 'block';
    teacherModal.setAttribute('aria-hidden', 'false');
  };
  [document.getElementById('add-teacher'), document.getElementById('add-teacher-btn')]
    .filter(Boolean)
    .forEach(button => button.addEventListener('click', addTeacher));

  const email = document.getElementById('user-email');
  const statsGrid = document.getElementById('stats-grid');
  if (!statsGrid) return;
  statsGrid.setAttribute('aria-busy', 'true');
  fetch('/api/admin/stats', { credentials: 'same-origin' })
    .then(async response => {
      if (response.status === 401 || response.status === 403) {
        window.location.replace('login.html');
        return null;
      }
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || `Request failed (${response.status})`);
      return result;
    })
    .then(stats => {
      if (!stats) return;
      const labels = [
        ['totalTeachers', 'Teachers'],
        ['totalStudents', 'Students'],
        ['totalClassrooms', 'Classrooms'],
        ['totalLaboratories', 'Laboratories'],
      ];
      statsGrid.replaceChildren(...labels.map(([key, label]) => {
        const card = document.createElement('div');
        card.className = 'stat-card';
        const value = document.createElement('div');
        value.className = 'value';
        value.textContent = stats[key] ?? 0;
        const caption = document.createElement('div');
        caption.className = 'label';
        caption.textContent = label;
        card.append(value, caption);
        return card;
      }));
      statsGrid.setAttribute('aria-busy', 'false');
      if (stats.email && email) email.textContent = stats.email;
      const list = document.getElementById('timetable-list');
      const timetableItems = (stats.todaysClasses || []).map(entry => {
        const item = document.createElement('li');
        item.textContent = `${entry.startTime || ''} ${entry.subjectName || 'Scheduled class'}${entry.classroomNumber ? ` · Room ${entry.classroomNumber}` : ''}`;
        return item;
      });
      if (timetableItems.length === 0) {
        const emptyState = document.createElement('li');
        emptyState.className = 'dashboard-state';
        emptyState.textContent = 'No classes are scheduled for today.';
        timetableItems.push(emptyState);
      }
      list.replaceChildren(...timetableItems);
    })
    .catch(error => {
      console.error('Unable to load admin dashboard:', error);
      statsGrid.setAttribute('aria-busy', 'false');
      const errorState = document.createElement('p');
      errorState.className = 'dashboard-state dashboard-state--error';
      errorState.setAttribute('role', 'alert');
      errorState.textContent = 'Dashboard data could not be loaded. Please refresh to try again.';
      statsGrid.replaceChildren(errorState);
    });
});
