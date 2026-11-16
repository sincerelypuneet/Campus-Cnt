const form = document.getElementById('login-form');
const message = document.getElementById('login-message');

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(result.message || `Request failed (${response.status})`);
  }

  return result;
}

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
      body: JSON.stringify(credentials)
    });

    if (result.role !== 'admin') {
      await requestJson('/api/logout', { method: 'POST' });
      throw new Error('Please sign in with an administrator account.');
    }

    window.location.assign('admin.html');
  } catch (error) {
    message.textContent = error.message || 'Sign in failed. Please try again.';
    message.hidden = false;
  } finally {
    button.disabled = false;
  }
});
