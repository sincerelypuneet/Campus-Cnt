// frontend/login-student.js
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('login-form');
  const message = document.getElementById('login-message');

  async function requestJson(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.message || `Request failed (${response.status})`);
    }
    return result;
  }

  if (form) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = form.querySelector('button[type="submit"]');
      const credentials = Object.fromEntries(new FormData(form));

      button.disabled = true;
      message.hidden = true;
      message.textContent = '';

      try {
        const result = await requestJson('/api/login', {
          method: 'POST',
          body: JSON.stringify(credentials),
        });

        if (result.role !== 'student') {
          await requestJson('/api/logout', { method: 'POST' });
          throw new Error('Please sign in with a student account.');
        }

        const next = new URLSearchParams(window.location.search).get('next');
        if (['find-classroom.html', 'find-teacher.html', 'computer-labs.html', 'find-resource.html'].includes(next)) {
          window.location.assign(next);
        } else {
          window.location.assign('student.html');
        }
      } catch (error) {
        message.textContent = error.message || 'Sign in failed. Check your campus email and password.';
        message.hidden = false;
      } finally {
        button.disabled = false;
      }
    });
  }
});
