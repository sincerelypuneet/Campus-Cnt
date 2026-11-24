import test from 'node:test';
import assert from 'node:assert/strict';
import { app } from './server.js';
import db from './db.js';

let server;
let baseUrl;
let adminCookie;
let studentCookie;

let testLabId;
let testComputerId;
let testClassroomId;

test.before(async () => {
  server = app.listen(0);
  const { port } = server.address();
  baseUrl = `http://localhost:${port}`;

  // Log in as admin
  const adminRes = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@campusspace.local', password: 'Admin@123' }),
  });
  adminCookie = adminRes.headers.get('set-cookie');

  // Log in as student
  const studentRes = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'student@campusspace.local', password: 'Student@123' }),
  });
  studentCookie = studentRes.headers.get('set-cookie');

  // Set up a test laboratory and computer
  const lab = await db.add('laboratories.json', {
    name: 'Test Maintenance Lab',
    category: 'LPC',
    building: 'Science Block',
    room: '101',
    computers: [
      { id: 'pc-maint-1', name: 'PC-M1', active: true },
      { id: 'pc-maint-2', name: 'PC-M2', active: true },
    ],
    active: true,
    createdAt: new Date().toISOString(),
  });
  testLabId = lab.id;
  testComputerId = 'pc-maint-1';

  // Set up a test classroom
  const classroom = await db.add('classrooms.json', {
    name: 'Room M-101',
    roomNumber: 'M-101',
    building: 'Science Block',
    floor: 1,
    floorNumber: 1,
    capacity: 30,
    seatingCapacity: 30,
    active: true,
    createdAt: new Date().toISOString(),
  });
  testClassroomId = classroom.id;
});

test.after(async () => {
  // Clean up test entities
  if (testLabId) await db.delete('laboratories.json', testLabId);
  if (testClassroomId) await db.delete('classrooms.json', testClassroomId);
  const records = await db.read('maintenance.json');
  const remaining = records.filter(
    (r) => r.labId !== testLabId && r.classroomId !== testClassroomId
  );
  await db.write('maintenance.json', remaining);
  if (server) await new Promise((resolve) => server.close(resolve));
});

test('Student cannot access admin maintenance endpoints (403 Forbidden)', async () => {
  const getRes = await fetch(`${baseUrl}/api/admin/maintenance`, {
    headers: { Cookie: studentCookie },
  });
  assert.equal(getRes.status, 403);

  const postRes = await fetch(`${baseUrl}/api/admin/maintenance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: studentCookie },
    body: JSON.stringify({ type: 'lab', labId: testLabId }),
  });
  assert.equal(postRes.status, 403);
});

test('Admin can create maintenance for a lab computer and view it', async () => {
  const payload = {
    type: 'lab',
    labId: testLabId,
    computerId: testComputerId,
    date: '2026-11-25',
    startTime: '10:00',
    endTime: '12:00',
    reason: 'Screen replacement',
    description: 'Replacing damaged monitor',
  };

  const createRes = await fetch(`${baseUrl}/api/admin/maintenance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify(payload),
  });
  assert.equal(createRes.status, 201);
  const created = await createRes.json();
  assert.equal(created.maintenance.reason, 'Screen replacement');
  assert.equal(created.maintenance.status, 'scheduled');

  const getRes = await fetch(`${baseUrl}/api/admin/maintenance`, {
    headers: { Cookie: adminCookie },
  });
  assert.equal(getRes.status, 200);
  const data = await getRes.json();
  const found = data.maintenance.find((m) => m.id === created.maintenance.id);
  assert.ok(found);
  assert.equal(found.reason, 'Screen replacement');
});

test('Computer under maintenance reflects status in student view and rejects bookings', async () => {
  const slotQuery = `date=2026-11-25&startTime=10:30&endTime=11:30`;
  const viewRes = await fetch(`${baseUrl}/api/student/computer-labs?${slotQuery}`, {
    headers: { Cookie: studentCookie },
  });
  assert.equal(viewRes.status, 200);
  const viewData = await viewRes.json();
  const lab = viewData.labs.find((l) => l.id === testLabId);
  assert.ok(lab);
  const pcM1 = lab.computers.find((c) => c.id === testComputerId);
  const pcM2 = lab.computers.find((c) => c.id === 'pc-maint-2');

  assert.equal(pcM1.availability, 'maintenance');
  assert.equal(pcM2.availability, 'available');

  // Attempting to book pc-maint-1 fails with 409
  const bookRes = await fetch(`${baseUrl}/api/student/computer-lab-bookings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: studentCookie },
    body: JSON.stringify({
      labId: testLabId,
      computerId: testComputerId,
      date: '2026-11-25',
      startTime: '10:30',
      endTime: '11:30',
    }),
  });
  assert.equal(bookRes.status, 409);
  const bookBody = await bookRes.json();
  assert.match(bookBody.message, /maintenance/i);
});

test('Overlapping maintenance for the same resource is rejected with 409', async () => {
  const payload = {
    type: 'lab',
    labId: testLabId,
    computerId: testComputerId,
    date: '2026-11-25',
    startTime: '11:00', // overlaps 10:00–12:00
    endTime: '13:00',
    reason: 'Duplicate check',
  };

  const res = await fetch(`${baseUrl}/api/admin/maintenance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify(payload),
  });
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.match(body.message, /overlapping/i);
});

test('Adjacent maintenance intervals are allowed without conflict', async () => {
  const adjacentPayload = {
    type: 'lab',
    labId: testLabId,
    computerId: testComputerId,
    date: '2026-11-25',
    startTime: '12:00', // exactly starts when previous ends
    endTime: '14:00',
    reason: 'Next phase inspection',
  };

  const res = await fetch(`${baseUrl}/api/admin/maintenance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify(adjacentPayload),
  });
  assert.equal(res.status, 201);
});

test('Maintenance cannot be scheduled over an existing confirmed reservation', async () => {
  // First, create a confirmed booking for pc-maint-2 on 2026-11-26 14:00-15:00
  const booking = await db.add('lab_bookings.json', {
    labId: testLabId,
    labName: 'Test Maintenance Lab',
    category: 'LPC',
    computerId: 'pc-maint-2',
    computerName: 'PC-M2',
    userId: 'some-user',
    studentId: 'CS26-001',
    studentName: 'Alex Morgan',
    date: '2026-11-26',
    startTime: '14:00',
    endTime: '15:00',
    status: 'confirmed',
    createdAt: new Date().toISOString(),
  });

  try {
    // Attempting to schedule maintenance on pc-maint-2 for overlapping time -> 409
    const maintRes = await fetch(`${baseUrl}/api/admin/maintenance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        type: 'lab',
        labId: testLabId,
        computerId: 'pc-maint-2',
        date: '2026-11-26',
        startTime: '14:30',
        endTime: '16:00',
        reason: 'Network wiring',
      }),
    });
    assert.equal(maintRes.status, 409);
    const body = await maintRes.json();
    assert.match(body.message, /confirmed/i);
  } finally {
    await db.delete('lab_bookings.json', booking.id);
  }
});

test('Pending reservations do not block maintenance scheduling', async () => {
  const pendingBooking = await db.add('lab_bookings.json', {
    labId: testLabId,
    labName: 'Test Maintenance Lab',
    category: 'HPC',
    userId: 'some-user',
    studentId: 'CS26-001',
    studentName: 'Alex Morgan',
    date: '2026-11-27',
    startTime: '09:00',
    endTime: '10:00',
    status: 'pending',
    createdAt: new Date().toISOString(),
  });

  try {
    const maintRes = await fetch(`${baseUrl}/api/admin/maintenance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        type: 'lab',
        labId: testLabId,
        computerId: 'all',
        date: '2026-11-27',
        startTime: '09:00',
        endTime: '11:00',
        reason: 'Entire lab deep clean',
      }),
    });
    assert.equal(maintRes.status, 201);
  } finally {
    await db.delete('lab_bookings.json', pendingBooking.id);
  }
});

test('Admin can cancel maintenance and restore availability', async () => {
  // Create a maintenance record
  const createRes = await fetch(`${baseUrl}/api/admin/maintenance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({
      type: 'lab',
      labId: testLabId,
      computerId: 'pc-maint-2',
      date: '2026-11-28',
      startTime: '10:00',
      endTime: '11:00',
      reason: 'Temporary test',
    }),
  });
  assert.equal(createRes.status, 201);
  const created = await createRes.json();

  // Cancel it
  const cancelRes = await fetch(`${baseUrl}/api/admin/maintenance/${created.maintenance.id}/cancel`, {
    method: 'POST',
    headers: { Cookie: adminCookie },
  });
  assert.equal(cancelRes.status, 200);

  // Verify availability is restored
  const viewRes = await fetch(`${baseUrl}/api/student/computer-labs?date=2026-11-28&startTime=10:00&endTime=11:00`, {
    headers: { Cookie: studentCookie },
  });
  const viewData = await viewRes.json();
  const lab = viewData.labs.find((l) => l.id === testLabId);
  const pc = lab.computers.find((c) => c.id === 'pc-maint-2');
  assert.equal(pc.availability, 'available');
});

test('Admin can create classroom maintenance and it excludes classroom from student search', async () => {
  const maintRes = await fetch(`${baseUrl}/api/admin/maintenance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({
      type: 'classroom',
      classroomId: testClassroomId,
      date: '2026-11-29',
      startTime: '09:00',
      endTime: '11:00',
      reason: 'A/C maintenance',
    }),
  });
  assert.equal(maintRes.status, 201);

  // Student searches for classrooms during maintenance
  const searchRes = await fetch(`${baseUrl}/api/student/classrooms/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: studentCookie },
    body: JSON.stringify({
      date: '2026-11-29',
      startTime: '09:30',
      endTime: '10:30',
      minCapacity: 10,
    }),
  });
  assert.equal(searchRes.status, 200);
  const searchData = await searchRes.json();
  const found = searchData.classrooms.find((c) => c.id === testClassroomId);
  assert.equal(found, undefined, 'Classroom under maintenance must be excluded from availability');
});

test('Validation rejects invalid dates and times with 400', async () => {
  const badTime = await fetch(`${baseUrl}/api/admin/maintenance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({
      type: 'classroom',
      classroomId: testClassroomId,
      date: '2026-11-29',
      startTime: '12:00',
      endTime: '10:00', // End before start
      reason: 'Invalid time test',
    }),
  });
  assert.equal(badTime.status, 400);

  const badDate = await fetch(`${baseUrl}/api/admin/maintenance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({
      type: 'classroom',
      classroomId: testClassroomId,
      date: 'not-a-date',
      startTime: '10:00',
      endTime: '12:00',
      reason: 'Invalid date test',
    }),
  });
  assert.equal(badDate.status, 400);
});
