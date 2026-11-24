import test from 'node:test';
import assert from 'node:assert/strict';
import { app } from './server.js';

test('health check endpoint returns status ok', async () => {
  // Use node's built-in http server to briefly test the app without hardcoding external dependencies
  const server = app.listen(0);
  const { port } = server.address();
  try {
    const res = await fetch(`http://localhost:${port}/api/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.service, 'CampusSpace API');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('static frontend serves index.html at root', async () => {
  const server = app.listen(0);
  const { port } = server.address();
  try {
    const res = await fetch(`http://localhost:${port}/`);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.match(text, /CampusSpace/i);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
