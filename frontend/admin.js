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

  function showSection(name) {
    const section = sections[name] || sections.placeholder;
    Object.values(sections).forEach(item => {
      item.hidden = item !== section;
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
      sidebar.classList.remove('collapsed');
    });
  });

  document.getElementById('toggle-sidebar').addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
  });

  document.getElementById('logout').addEventListener('click', async event => {
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
    teacherModal.style.display = 'block';
    teacherModal.setAttribute('aria-hidden', 'false');
  };
  document.getElementById('add-teacher').addEventListener('click', addTeacher);
  document.getElementById('add-teacher-btn').addEventListener('click', addTeacher);

  const email = document.getElementById('user-email');
  const statsGrid = document.getElementById('stats-grid');
  fetch('/api/admin/stats', { credentials: 'same-origin' })
    .then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || `Request failed (${response.status})`);
      return result;
    })
    .then(stats => {
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
      if (stats.email) email.textContent = stats.email;
      const list = document.getElementById('timetable-list');
      list.replaceChildren(...(stats.todaysClasses || []).map(entry => {
        const item = document.createElement('li');
        item.textContent = `${entry.startTime || ''} ${entry.subjectName || 'Scheduled class'}${entry.classroomNumber ? ` · Room ${entry.classroomNumber}` : ''}`;
        return item;
      }));
    })
    .catch(error => {
      console.error('Unable to load admin dashboard:', error);
    });
});
