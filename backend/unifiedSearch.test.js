// backend/unifiedSearch.test.js

import test from 'node:test';
import assert from 'node:assert/strict';
import { app } from './server.js';
import db from './db.js';

let server;
let baseUrl;
let studentCookie;
let adminCookie;

// Test entity IDs
let testClassroomId;
let testLabId;
let testMaintId;
let testClassroomMaintId;
let testReservationId;
let testLabBookingId;

const testDate = '2028-11-20'; // Future date to avoid conflicts with today

test.before(async () => {
  server = app.listen(0);
  const { port } = server.address();
  baseUrl = `http://localhost:${port}`;

  // Log in as student
  const studentRes = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'student@campusspace.local', password: 'Student@123' }),
  });
  studentCookie = studentRes.headers.get('set-cookie');

  // Log in as admin
  const adminRes = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@campusspace.local', password: 'Admin@123' }),
  });
  adminCookie = adminRes.headers.get('set-cookie');

  // 1. Create a test classroom
  const room = await db.add('classrooms.json', {
    name: 'Search Test Hall 901',
    roomNumber: '901',
    building: 'Engineering Wing',
    floorNumber: 4,
    seatingCapacity: 75,
    capacity: 75,
    roomType: 'Lecture Hall',
    availabilityStatus: 'available',
    facilities: ['Smart Board', 'Laser Projector'],
    active: true,
  });
  testClassroomId = room.id;

  // 2. Create a test laboratory with LPC computers
  const lab = await db.add('laboratories.json', {
    name: 'Unified Robotics Lab',
    category: 'LPC',
    building: 'Engineering Wing',
    floor: 2,
    room: '205',
    capacity: 10,
    equipment: ['Robotics Kit', 'High-Speed Wi-Fi'],
    computers: [
      { id: 'pc-uni-1', name: 'Workstation Alpha', specs: 'Intel i9, 32GB RAM', active: true },
      { id: 'pc-uni-2', name: 'Workstation Beta', specs: 'Intel i7, 16GB RAM', active: true },
      { id: 'pc-uni-3', name: 'Workstation Gamma', specs: 'Intel i7, 16GB RAM', active: true },
    ],
    active: true,
  });
  testLabId = lab.id;

  // 3. Create a maintenance record for pc-uni-1 (10:00 - 12:00)
  const maintRes = await fetch(`${baseUrl}/api/admin/maintenance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({
      type: 'lab',
      labId: testLabId,
      computerId: 'pc-uni-1',
      date: testDate,
      startTime: '10:00',
      endTime: '12:00',
      reason: 'GPU calibration',
    }),
  });
  const maintData = await maintRes.json();
  testMaintId = maintData.maintenance?.id || maintData.id;

  // 4. Create a confirmed booking for pc-uni-2 (10:00 - 12:00)
  const booking = await db.add('lab_bookings.json', {
    labId: testLabId,
    computerId: 'pc-uni-2',
    userId: 'student-test',
    studentId: 'student-test',
    date: testDate,
    startTime: '10:00',
    endTime: '12:00',
    status: 'confirmed',
    active: true,
    createdAt: new Date().toISOString(),
  });
  testLabBookingId = booking.id;

  // 5. Create a confirmed classroom reservation for 14:00 - 16:00
  const reservation = await db.add('classroom_reservations.json', {
    classroomId: testClassroomId,
    studentId: 'student-test',
    date: testDate,
    startTime: '14:00',
    endTime: '16:00',
    status: 'confirmed',
    active: true,
    createdAt: new Date().toISOString(),
  });
  testReservationId = reservation.id;
});

test.after(async () => {
  // Clean up test data
  if (testClassroomId) await db.delete('classrooms.json', testClassroomId);
  if (testLabId) await db.delete('laboratories.json', testLabId);
  if (testMaintId) await db.delete('maintenance.json', testMaintId);
  if (testClassroomMaintId) await db.delete('maintenance.json', testClassroomMaintId);
  if (testReservationId) await db.delete('classroom_reservations.json', testReservationId);
  if (testLabBookingId) await db.delete('lab_bookings.json', testLabBookingId);

  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('Unauthorized requests to /api/student/resources/search are rejected with 401', async () => {
  const res = await fetch(`${baseUrl}/api/student/resources/search?date=${testDate}&startTime=10:00&endTime=11:00`);
  assert.equal(res.status, 401);
});

test('Invalid search parameters return 400 with helpful error messages', async () => {
  // Missing date/time
  const res1 = await fetch(`${baseUrl}/api/student/resources/search`, {
    headers: { Cookie: studentCookie },
  });
  assert.equal(res1.status, 400);

  // End time before start time
  const res2 = await fetch(`${baseUrl}/api/student/resources/search?date=${testDate}&startTime=12:00&endTime=10:00`, {
    headers: { Cookie: studentCookie },
  });
  assert.equal(res2.status, 400);

  // Invalid date format
  const res3 = await fetch(`${baseUrl}/api/student/resources/search?date=not-a-date&startTime=10:00&endTime=11:00`, {
    headers: { Cookie: studentCookie },
  });
  assert.equal(res3.status, 400);

  // Past date
  const res4 = await fetch(`${baseUrl}/api/student/resources/search?date=2020-01-01&startTime=10:00&endTime=11:00`, {
    headers: { Cookie: studentCookie },
  });
  assert.equal(res4.status, 400);

  // Invalid resource type
  const res5 = await fetch(`${baseUrl}/api/student/resources/search?type=invalid_type&date=${testDate}&startTime=10:00&endTime=11:00`, {
    headers: { Cookie: studentCookie },
  });
  assert.equal(res5.status, 400);
});

test('Searching classrooms independently returns only classrooms and excludes labs/computers', async () => {
  const res = await fetch(`${baseUrl}/api/student/resources/search?type=classroom&date=${testDate}&startTime=10:00&endTime=11:00`, {
    headers: { Cookie: studentCookie },
  });
  assert.equal(res.status, 200);
  const data = await res.json();

  assert.ok(Array.isArray(data.resources));
  assert.ok(data.resources.length > 0);
  assert.ok(data.resources.every((r) => r.resourceType === 'classroom'));

  const testRoom = data.resources.find((r) => r.id === testClassroomId);
  assert.ok(testRoom, 'Test classroom should be found');
  assert.equal(testRoom.availability, 'available');
  assert.equal(testRoom.capacity, 75);
  assert.equal(testRoom.bookingAction?.type, 'reserve_classroom');
});

test('Searching computer laboratories independently returns only laboratory resources', async () => {
  const res = await fetch(`${baseUrl}/api/student/resources/search?type=computer_lab&date=${testDate}&startTime=10:00&endTime=11:00`, {
    headers: { Cookie: studentCookie },
  });
  assert.equal(res.status, 200);
  const data = await res.json();

  assert.ok(Array.isArray(data.resources));
  assert.ok(data.resources.every((r) => r.resourceType === 'computer_lab'));

  const testLab = data.resources.find((r) => r.id === testLabId);
  assert.ok(testLab, 'Test lab should be found');
  assert.equal(testLab.building, 'Engineering Wing');
});

test('Searching individual workstations independently returns computer resources', async () => {
  const res = await fetch(`${baseUrl}/api/student/resources/search?type=computer&date=${testDate}&startTime=10:00&endTime=11:00`, {
    headers: { Cookie: studentCookie },
  });
  assert.equal(res.status, 200);
  const data = await res.json();

  assert.ok(Array.isArray(data.resources));
  assert.ok(data.resources.every((r) => r.resourceType === 'computer'));

  // Should contain our workstations
  const pcs = data.resources.filter((r) => r.labId === testLabId);
  assert.equal(pcs.length, 3);
});

test('Combined search (type=all) returns mixed resources across all categories', async () => {
  const res = await fetch(`${baseUrl}/api/student/resources/search?type=all&date=${testDate}&startTime=10:00&endTime=11:00&building=Engineering Wing`, {
    headers: { Cookie: studentCookie },
  });
  assert.equal(res.status, 200);
  const data = await res.json();

  const types = new Set(data.resources.map((r) => r.resourceType));
  assert.ok(types.has('classroom'), 'Should contain classrooms');
  assert.ok(types.has('computer_lab'), 'Should contain computer labs');
  assert.ok(types.has('computer'), 'Should contain workstations');
});

test('Workstation maintenance and confirmed reservations are strictly enforced', async () => {
  // Query 10:00 - 11:00 on testDate (overlaps pc-uni-1 maintenance and pc-uni-2 booking)
  const res = await fetch(`${baseUrl}/api/student/resources/search?type=computer&date=${testDate}&startTime=10:00&endTime=11:00`, {
    headers: { Cookie: studentCookie },
  });
  assert.equal(res.status, 200);
  const data = await res.json();

  const pc1 = data.resources.find((r) => r.computerId === 'pc-uni-1');
  const pc2 = data.resources.find((r) => r.computerId === 'pc-uni-2');
  const pc3 = data.resources.find((r) => r.computerId === 'pc-uni-3');

  // pc-uni-1 is under maintenance
  assert.ok(pc1);
  assert.equal(pc1.availability, 'maintenance');
  assert.equal(pc1.maintenanceReason, 'GPU calibration');
  assert.equal(pc1.bookingAction, null);

  // pc-uni-2 is occupied by confirmed booking
  assert.ok(pc2);
  assert.equal(pc2.availability, 'occupied');
  assert.equal(pc2.bookingAction, null);

  // pc-uni-3 is free and available
  assert.ok(pc3);
  assert.equal(pc3.availability, 'available');
  assert.equal(pc3.bookingAction?.type, 'book_computer');
});

test('Adjacent time slots do not trigger false conflict', async () => {
  // Maintenance and reservation are 10:00 - 12:00.
  // Slot 12:00 - 13:00 touches end time but does not overlap.
  const res = await fetch(`${baseUrl}/api/student/resources/search?type=computer&date=${testDate}&startTime=12:00&endTime=13:00`, {
    headers: { Cookie: studentCookie },
  });
  assert.equal(res.status, 200);
  const data = await res.json();

  const pc1 = data.resources.find((r) => r.computerId === 'pc-uni-1');
  const pc2 = data.resources.find((r) => r.computerId === 'pc-uni-2');

  assert.ok(pc1);
  assert.equal(pc1.availability, 'available', 'pc1 should be available in adjacent slot');
  assert.ok(pc2);
  assert.equal(pc2.availability, 'available', 'pc2 should be available in adjacent slot');
});

test('Classroom confirmed reservation correctly marks room as occupied', async () => {
  // Classroom has reservation at 14:00 - 16:00
  const res = await fetch(`${baseUrl}/api/student/resources/search?type=classroom&date=${testDate}&startTime=14:30&endTime=15:30`, {
    headers: { Cookie: studentCookie },
  });
  assert.equal(res.status, 200);
  const data = await res.json();

  const room = data.resources.find((r) => r.id === testClassroomId);
  assert.ok(room);
  assert.equal(room.availability, 'occupied');
  assert.equal(room.bookingAction, null);
});

test('Capacity filtering excludes resources below the specified threshold', async () => {
  // Test classroom has 75 capacity, lab has 10, workstations have 1.
  const res = await fetch(`${baseUrl}/api/student/resources/search?type=all&date=${testDate}&startTime=10:00&endTime=11:00&minCapacity=50`, {
    headers: { Cookie: studentCookie },
  });
  assert.equal(res.status, 200);
  const data = await res.json();

  assert.ok(data.resources.length > 0);
  assert.ok(data.resources.every((r) => r.capacity >= 50));
  assert.ok(data.resources.some((r) => r.id === testClassroomId));
  assert.ok(!data.resources.some((r) => r.id === testLabId));
  assert.ok(!data.resources.some((r) => r.resourceType === 'computer'));
});

test('Equipment and facilities filter matches keywords correctly', async () => {
  const res = await fetch(`${baseUrl}/api/student/resources/search?type=all&date=${testDate}&startTime=10:00&endTime=11:00&equipment=Laser Projector`, {
    headers: { Cookie: studentCookie },
  });
  assert.equal(res.status, 200);
  const data = await res.json();

  assert.ok(data.resources.length > 0);
  assert.ok(data.resources.some((r) => r.id === testClassroomId));
  assert.ok(!data.resources.some((r) => r.id === testLabId));
});

test('Available-only filter excludes occupied and maintenance resources', async () => {
  const res = await fetch(`${baseUrl}/api/student/resources/search?type=computer&date=${testDate}&startTime=10:00&endTime=11:00&availableOnly=true`, {
    headers: { Cookie: studentCookie },
  });
  assert.equal(res.status, 200);
  const data = await res.json();

  assert.ok(data.resources.every((r) => r.availability === 'available'));
  assert.ok(!data.resources.some((r) => r.computerId === 'pc-uni-1')); // Was maintenance
  assert.ok(!data.resources.some((r) => r.computerId === 'pc-uni-2')); // Was occupied
  assert.ok(data.resources.some((r) => r.computerId === 'pc-uni-3'));  // Was available
});

test('Sorting by capacity orders resources properly in asc and desc', async () => {
  // Test ascending
  const resAsc = await fetch(`${baseUrl}/api/student/resources/search?type=all&date=${testDate}&startTime=10:00&endTime=11:00&sortBy=capacity&sortOrder=asc`, {
    headers: { Cookie: studentCookie },
  });
  assert.equal(resAsc.status, 200);
  const dataAsc = await resAsc.json();

  const capacitiesAsc = dataAsc.resources.map((r) => r.capacity);
  for (let i = 0; i < capacitiesAsc.length - 1; i++) {
    assert.ok(capacitiesAsc[i] <= capacitiesAsc[i + 1], `Asc: ${capacitiesAsc[i]} should be <= ${capacitiesAsc[i + 1]}`);
  }

  // Test descending (default for capacity)
  const resDesc = await fetch(`${baseUrl}/api/student/resources/search?type=all&date=${testDate}&startTime=10:00&endTime=11:00&sortBy=capacity`, {
    headers: { Cookie: studentCookie },
  });
  assert.equal(resDesc.status, 200);
  const dataDesc = await resDesc.json();

  const capacitiesDesc = dataDesc.resources.map((r) => r.capacity);
  for (let i = 0; i < capacitiesDesc.length - 1; i++) {
    assert.ok(capacitiesDesc[i] >= capacitiesDesc[i + 1], `Desc: ${capacitiesDesc[i]} should be >= ${capacitiesDesc[i + 1]}`);
  }
});

test('Empty search results return empty array without server error', async () => {
  const res = await fetch(`${baseUrl}/api/student/resources/search?type=all&date=${testDate}&startTime=10:00&endTime=11:00&building=NonExistentBuildingXYZ`, {
    headers: { Cookie: studentCookie },
  });
  assert.equal(res.status, 200);
  const data = await res.json();

  assert.equal(data.total, 0);
  assert.deepEqual(data.resources, []);
});

test('GET /api/student/resources/options returns valid building and resource type lists', async () => {
  const res = await fetch(`${baseUrl}/api/student/resources/options`, {
    headers: { Cookie: studentCookie },
  });
  assert.equal(res.status, 200);
  const data = await res.json();

  assert.ok(Array.isArray(data.resourceTypes));
  assert.ok(data.resourceTypes.length >= 4);
  assert.ok(Array.isArray(data.buildings));
  assert.ok(data.buildings.includes('Engineering Wing'));
  assert.ok(Array.isArray(data.facilities));
});
