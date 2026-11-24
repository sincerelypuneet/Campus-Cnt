import test from 'node:test';
import assert from 'node:assert/strict';
import { app } from './server.js';
import db from './db.js';
import bcrypt from 'bcryptjs';

let server;
let baseUrl;

test.before(async () => {
  server = app.listen(0);
  const { port } = server.address();
  baseUrl = `http://localhost:${port}`;
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

test('POST /api/login succeeds with valid admin credentials', async () => {
  const res = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@campusspace.local', password: 'Admin@123' }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.role, 'admin');
  assert.equal(body.email, 'admin@campusspace.local');
  const setCookie = res.headers.get('set-cookie');
  assert.ok(setCookie && setCookie.includes('token='));
});

test('POST /api/login succeeds with valid student credentials', async () => {
  const res = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'student@campusspace.local', password: 'Student@123' }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.role, 'student');
  assert.equal(body.email, 'student@campusspace.local');
});

test('POST /api/login rejects invalid password', async () => {
  const res = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@campusspace.local', password: 'WrongPassword999' }),
  });
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.message, 'Invalid credentials');
});

test('POST /api/login rejects nonexistent user', async () => {
  const res = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'nonexistent@campusspace.local', password: 'SomePassword' }),
  });
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.message, 'Invalid credentials');
});

test('POST /api/login rejects missing or non-string inputs', async () => {
  const emptyRes = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(emptyRes.status, 400);

  const invalidTypeRes = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 12345, password: true }),
  });
  assert.equal(invalidTypeRes.status, 400);
});

test('POST /api/login rejects inactive accounts', async () => {
  // Add a temporary inactive user
  const tempInactive = {
    id: 'inactive-test-user-id',
    email: 'inactive@campusspace.local',
    passwordHash: await bcrypt.hash('InactivePass123', 10),
    role: 'student',
    active: false,
  };
  await db.mutate('users.json', (users) => {
    users.push(tempInactive);
    return { changed: true, value: null };
  });

  try {
    const res = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'inactive@campusspace.local', password: 'InactivePass123' }),
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.match(body.message, /deactivated/i);
  } finally {
    await db.mutate('users.json', (users) => {
      const idx = users.findIndex((u) => u.id === 'inactive-test-user-id');
      if (idx >= 0) users.splice(idx, 1);
      return { changed: true, value: null };
    });
  }
});

test('POST /api/login handles malformed user records safely without crashing', async () => {
  const malformedUser = {
    id: 'malformed-user-id',
    email: 'malformed@campusspace.local',
    // Missing passwordHash
    role: 'student',
  };
  await db.mutate('users.json', (users) => {
    users.push(malformedUser);
    return { changed: true, value: null };
  });

  try {
    const res = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'malformed@campusspace.local', password: 'AnyPassword' }),
    });
    assert.equal(res.status, 401);
  } finally {
    await db.mutate('users.json', (users) => {
      const idx = users.findIndex((u) => u.id === 'malformed-user-id');
      if (idx >= 0) users.splice(idx, 1);
      return { changed: true, value: null };
    });
  }
});

test('Role-based access control protects admin and student endpoints', async () => {
  // 1. Login as admin
  const adminLogin = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@campusspace.local', password: 'Admin@123' }),
  });
  const adminCookie = adminLogin.headers.get('set-cookie');

  // 2. Login as student
  const studentLogin = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'student@campusspace.local', password: 'Student@123' }),
  });
  const studentCookie = studentLogin.headers.get('set-cookie');

  // Unauthenticated requests
  const noAuthAdmin = await fetch(`${baseUrl}/api/admin/stats`);
  assert.equal(noAuthAdmin.status, 401);

  const noAuthStudent = await fetch(`${baseUrl}/api/student/dashboard`);
  assert.equal(noAuthStudent.status, 401);

  // Student trying to access admin endpoint -> 403 Forbidden
  const studentAtAdmin = await fetch(`${baseUrl}/api/admin/stats`, {
    headers: { Cookie: studentCookie },
  });
  assert.equal(studentAtAdmin.status, 403);

  // Admin accessing admin endpoint -> 200 OK
  const adminAtAdmin = await fetch(`${baseUrl}/api/admin/stats`, {
    headers: { Cookie: adminCookie },
  });
  assert.equal(adminAtAdmin.status, 200);

  // Student accessing student dashboard -> 200 OK
  const studentAtStudent = await fetch(`${baseUrl}/api/student/dashboard`, {
    headers: { Cookie: studentCookie },
  });
  assert.equal(studentAtStudent.status, 200);

  // Admin trying to access student dashboard -> 403 Forbidden
  const adminAtStudent = await fetch(`${baseUrl}/api/student/dashboard`, {
    headers: { Cookie: adminCookie },
  });
  assert.equal(adminAtStudent.status, 403);
});

test('Authorization: Bearer <token> header is supported', async () => {
  const adminLogin = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@campusspace.local', password: 'Admin@123' }),
  });
  const cookieHeader = adminLogin.headers.get('set-cookie');
  const tokenMatch = /token=([^;]+)/.exec(cookieHeader);
  assert.ok(tokenMatch);
  const token = tokenMatch[1];

  const res = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.user.email, 'admin@campusspace.local');
  assert.equal(body.user.role, 'admin');
});

test('POST /api/logout clears authentication cookie', async () => {
  const res = await fetch(`${baseUrl}/api/logout`, { method: 'POST' });
  assert.equal(res.status, 200);
  const cookie = res.headers.get('set-cookie');
  assert.ok(cookie && (cookie.includes('token=;') || cookie.includes('Max-Age=0') || cookie.includes('Expires=')));
});
