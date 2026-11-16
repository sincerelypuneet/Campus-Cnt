fetch('/api/health')
  .then((response) => {
    if (!response.ok) {
      throw new Error(`Health check failed with status ${response.status}`);
    }

    return response.json();
  })
  .then((health) => {
    document.documentElement.dataset.apiStatus = health.status;
  })
  .catch((error) => {
    console.error('Unable to reach the CampusSpace API:', error);
  });
