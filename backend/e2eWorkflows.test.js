// backend/e2eWorkflows.test.js

import test from 'node:test';
import assert from 'node:assert/strict';
import { app } from './server.js';
import db from './db.js';

let server;
let baseUrl;

// Shared test entities
let testClassroomId;
let testLpcLabId;
let testHpcLabId;
let testTeacherId;
let testTeacherUserId;
let testHpcRequestId;
let testReservationId;
let testLpcBookingId;
let testMaintenanceId;

const futureDate = '2029-05-15'; // Far future date ensuring no past conflicts

test.before(async () => {
  server = app.listen(0);
  const { port } = server.address();
  baseUrl = `http://localhost:${port}`;

  // 1. Create a test classroom
  const room = await db.add('classrooms.json', {
    name: 'E2E Room 501',
    roomNumber: '501',
    building: 'Technology Complex',
    floorNumber: 5,
    seatingCapacity: 60,
    capacity: 60,
    roomType: 'Classroom',
    availabilityStatus: 'available',
    facilities: ['Projector', 'Air Conditioning'],
    active: true,
  });
  testClassroomId = room.id;

  // 2. Create an LPC lab with computers
  const lpcLab = await db.add('laboratories.json', {
    name: 'E2E LPC Lab',
    category: 'LPC',
    type: 'LPC',
    building: 'Technology Complex',
    floor: 1,
    room: '101',
    capacity: 10,
    equipment: ['Standard PCs', 'Laser Printer'],
    computers: [
      { id: 'pc-e2e-1', name: 'PC-1', specs: 'Intel i5, 8GB', active: true },
      { id: 'pc-e2e-2', name: 'PC-2', specs: 'Intel i5, 8GB', active: true },
    ],
    active: true,
  });
  testLpcLabId = lpcLab.id;

  // 3. Create an HPC lab with computers
  const hpcLab = await db.add('laboratories.json', {
    name: 'E2E HPC Lab',
    category: 'HPC',
    type: 'HPC',
    building: 'Technology Complex',
    floor: 2,
    room: '201',
    capacity: 5,
    equipment: ['GPU Cluster', 'Linux Workstations'],
    computers: [
      { id: 'hpc-e2e-1', name: 'HPC-1', specs: 'NVIDIA A100, 128GB', active: true },
      { id: 'hpc-e2e-2', name: 'HPC-2', specs: 'NVIDIA A100, 128GB', active: true },
    ],
    active: true,
  });
  testHpcLabId = hpcLab.id;
});

test.after(async () => {
  // Cleanup test entities from database
  if (testClassroomId) await db.delete('classrooms.json', testClassroomId);
  if (testLpcLabId) await db.delete('laboratories.json', testLpcLabId);
  if (testHpcLabId) await db.delete('laboratories.json', testHpcLabId);
  if (testTeacherId) await db.delete('teachers.json', testTeacherId);
  if (testTeacherUserId) await db.delete('users.json', testTeacherUserId);
  if (testReservationId) await db.delete('classroom_reservations.json', testReservationId);
  if (testLpcBookingId) await db.delete('lab_bookings.json', testLpcBookingId);
  if (testHpcRequestId) await db.delete('lab_bookings.json', testHpcRequestId);
  if (testMaintenanceId) await db.delete('maintenance.json', testMaintenanceId);

  // Clean any timetable entry created for this teacher
  if (testTeacherId) {
    const allTt = await db.read('timetable.json');
    const cleanTt = allTt.filter(t => t.teacherId !== testTeacherId);
    await db.write('timetable.json', cleanTt);
  }

  // Clean any remaining test records
  const allMaint = await db.read('maintenance.json');
  const cleanMaint = allMaint.filter(m => m.labId !== testLpcLabId && m.labId !== testHpcLabId && m.classroomId !== testClassroomId);
  await db.write('maintenance.json', cleanMaint);

  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('E2E Student Workflow: Login, explore, reserve classroom, book LPC, request HPC, and search unified resources', async () => {
  // 1. Student login
  const loginRes = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'student@campusspace.local', password: 'Student@123' }),
  });
  assert.equal(loginRes.status, 200);
  const loginData = await loginRes.json();
  assert.equal(loginData.role, 'student');
  const cookie = loginRes.headers.get('set-cookie');
  assert.ok(cookie, 'Login should provide session cookie');

  // 2. Fetch student dashboard
  const dashRes = await fetch(`${baseUrl}/api/student/dashboard`, {
    headers: { Cookie: cookie },
  });
  assert.equal(dashRes.status, 200);
  const dashData = await dashRes.json();
  assert.ok(dashData.profile, 'Dashboard should have student profile');
  assert.ok(Array.isArray(dashData.classrooms), 'Dashboard should list classrooms');
  assert.ok(Array.isArray(dashData.labs), 'Dashboard should list labs');

  // 3. Search classrooms
  const searchClassRes = await fetch(`${baseUrl}/api/student/classrooms/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      date: futureDate,
      startTime: '10:00',
      endTime: '12:00',
      minCapacity: 40,
    }),
  });
  assert.equal(searchClassRes.status, 200);
  const searchClassData = await searchClassRes.json();
  assert.ok(searchClassData.classrooms.some(r => r.id === testClassroomId), 'Test classroom should appear in search results');

  // 4. Reserve classroom
  const reserveRes = await fetch(`${baseUrl}/api/student/classroom-reservations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      classroomId: testClassroomId,
      date: futureDate,
      startTime: '10:00',
      endTime: '12:00',
    }),
  });
  assert.equal(reserveRes.status, 201);
  const reserveData = await reserveRes.json();
  testReservationId = reserveData.id;
  assert.equal(reserveData.classroomId, testClassroomId);

  // 5. Verify classroom is no longer available in the same slot
  const reSearchRes = await fetch(`${baseUrl}/api/student/classrooms/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      date: futureDate,
      startTime: '10:00',
      endTime: '12:00',
      minCapacity: 40,
    }),
  });
  const reSearchData = await reSearchRes.json();
  assert.ok(!reSearchData.classrooms.some(r => r.id === testClassroomId), 'Reserved classroom must not appear as available');

  // 6. Double booking same classroom rejected with 409
  const doubleRes = await fetch(`${baseUrl}/api/student/classroom-reservations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      classroomId: testClassroomId,
      date: futureDate,
      startTime: '10:30',
      endTime: '11:30',
    }),
  });
  assert.equal(doubleRes.status, 409);

  // 7. Search computer labs
  const labsRes = await fetch(`${baseUrl}/api/student/computer-labs?date=${futureDate}&startTime=13:00&endTime=14:00`, {
    headers: { Cookie: cookie },
  });
  assert.equal(labsRes.status, 200);
  const labsData = await labsRes.json();
  const myLpcLab = labsData.labs.find(l => l.id === testLpcLabId);
  assert.ok(myLpcLab);
  assert.ok(myLpcLab.computers.every(c => c.availability === 'available'));

  // 8. Book LPC workstation directly
  const lpcBookRes = await fetch(`${baseUrl}/api/student/computer-lab-bookings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      labId: testLpcLabId,
      computerId: 'pc-e2e-1',
      date: futureDate,
      startTime: '13:00',
      endTime: '14:00',
    }),
  });
  assert.equal(lpcBookRes.status, 201);
  const lpcBookData = await lpcBookRes.json();
  testLpcBookingId = lpcBookData.booking.id;

  // 9. Conflicting LPC booking rejected with 409
  const conflictLpcRes = await fetch(`${baseUrl}/api/student/computer-lab-bookings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      labId: testLpcLabId,
      computerId: 'pc-e2e-1',
      date: futureDate,
      startTime: '13:30',
      endTime: '14:30',
    }),
  });
  assert.equal(conflictLpcRes.status, 409);

  // 10. Submit HPC lab request
  const hpcReqRes = await fetch(`${baseUrl}/api/student/lab-requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      labId: testHpcLabId,
      date: futureDate,
      startTime: '15:00',
      endTime: '17:00',
      purpose: 'Deep learning neural network training model evaluation',
    }),
  });
  assert.equal(hpcReqRes.status, 201);
  const hpcReqData = await hpcReqRes.json();
  testHpcRequestId = hpcReqData.id;
  assert.equal(hpcReqData.status, 'pending');

  // 11. View my requests
  const myReqsRes = await fetch(`${baseUrl}/api/student/computer-lab-requests`, {
    headers: { Cookie: cookie },
  });
  assert.equal(myReqsRes.status, 200);
  const myReqsData = await myReqsRes.json();
  assert.ok(myReqsData.requests.some(r => r.id === testHpcRequestId));

  // 12. Unified resource search discovers all three types
  const unifiedRes = await fetch(`${baseUrl}/api/student/resources/search?type=all&date=${futureDate}&startTime=08:00&endTime=09:00&building=Technology Complex`, {
    headers: { Cookie: cookie },
  });
  assert.equal(unifiedRes.status, 200);
  const unifiedData = await unifiedRes.json();
  const foundTypes = new Set(unifiedData.resources.map(r => r.resourceType));
  assert.ok(foundTypes.has('classroom'), 'Unified search should find classroom');
  assert.ok(foundTypes.has('computer_lab'), 'Unified search should find labs');
  assert.ok(foundTypes.has('computer'), 'Unified search should find workstations');

  // 13. Student logout
  const logoutRes = await fetch(`${baseUrl}/api/logout`, {
    method: 'POST',
    headers: { Cookie: cookie },
  });
  assert.equal(logoutRes.status, 200);
});

test('E2E Admin Workflow: Login, manage faculty, manage timetable, approve/reject HPC requests, schedule & cancel maintenance', async () => {
  // 1. Admin login
  const loginRes = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@campusspace.local', password: 'Admin@123' }),
  });
  assert.equal(loginRes.status, 200);
  const cookie = loginRes.headers.get('set-cookie');

  // 2. Fetch admin dashboard stats
  const statsRes = await fetch(`${baseUrl}/api/admin/stats`, {
    headers: { Cookie: cookie },
  });
  assert.equal(statsRes.status, 200);
  const statsData = await statsRes.json();
  assert.ok(typeof statsData.totalTeachers === 'number');
  assert.ok(typeof statsData.totalClassrooms === 'number');

  // 3. Create a faculty member with linked user account
  const teacherEmail = `faculty.test.${Date.now()}@campusspace.local`;
  const teacherRes = await fetch(`${baseUrl}/api/admin/teachers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      fullName: 'Dr. Jane Quantum',
      email: teacherEmail,
      contactNumber: '555-0199',
      departmentId: 'dept-1',
      designation: 'Associate Professor',
      subjectsTaught: ['Quantum Physics'],
      password: 'FacultyPassword@123',
    }),
  });
  assert.equal(teacherRes.status, 201);
  const teacherData = await teacherRes.json();
  testTeacherId = teacherData.teacher.id;
  testTeacherUserId = teacherData.userId;
  assert.ok(testTeacherId);
  assert.ok(testTeacherUserId);

  // 4. Create a timetable entry for this teacher
  const ttRes = await fetch(`${baseUrl}/api/admin/timetable`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      teacherId: testTeacherId,
      subjectName: 'Quantum Mechanics',
      subjectCode: 'PHY401',
      departmentId: 'dept-1',
      classOrSemester: 'Semester 7',
      section: 'A',
      day: 'Monday',
      startTime: '09:00',
      endTime: '10:30',
      classroomId: testClassroomId,
    }),
  });
  assert.equal(ttRes.status, 201);

  // 5. Review and approve the student HPC request submitted in previous test
  assert.ok(testHpcRequestId, 'HPC request should exist from student test');
  const approveRes = await fetch(`${baseUrl}/api/admin/computer-lab-requests/${testHpcRequestId}/decision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      decision: 'approved',
      computerId: 'hpc-e2e-1',
    }),
  });
  assert.equal(approveRes.status, 200);
  const approveData = await approveRes.json();
  assert.equal(approveData.request.status, 'approved');
  assert.equal(approveData.request.computerId, 'hpc-e2e-1');

  // 6. Schedule maintenance for a computer
  const maintRes = await fetch(`${baseUrl}/api/admin/maintenance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      type: 'lab',
      labId: testLpcLabId,
      computerId: 'pc-e2e-2',
      date: futureDate,
      startTime: '08:00',
      endTime: '10:00',
      reason: 'Routine hardware memory diagnostic',
    }),
  });
  assert.equal(maintRes.status, 201);
  const maintData = await maintRes.json();
  testMaintenanceId = maintData.maintenance?.id || maintData.id;
  assert.ok(testMaintenanceId, 'Maintenance record ID must be present');

  // 7. Overlapping maintenance for the same workstation is rejected with 409
  const dupMaintRes = await fetch(`${baseUrl}/api/admin/maintenance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      type: 'lab',
      labId: testLpcLabId,
      computerId: 'pc-e2e-2',
      date: futureDate,
      startTime: '08:30',
      endTime: '09:30',
      reason: 'Redundant maintenance check',
    }),
  });
  assert.equal(dupMaintRes.status, 409);

  // 8. Cancel maintenance
  const cancelRes = await fetch(`${baseUrl}/api/admin/maintenance/${testMaintenanceId}/cancel`, {
    method: 'POST',
    headers: { Cookie: cookie },
  });
  assert.equal(cancelRes.status, 200);
  const cancelData = await cancelRes.json();
  assert.equal(cancelData.maintenance.status, 'cancelled');

  // 9. Admin logout
  await fetch(`${baseUrl}/api/logout`, { method: 'POST', headers: { Cookie: cookie } });
});

test('E2E Faculty Workflow: Login with teacher credentials, access timetable, role isolation, and deactivation', async () => {
  assert.ok(testTeacherId, 'Teacher ID must exist from admin test');

  // Find the created teacher user email
  const users = await db.read('users.json');
  const teacherUser = users.find(u => u.id === testTeacherUserId);
  assert.ok(teacherUser, 'Teacher user record must exist');

  // 1. Teacher login
  const teacherLoginRes = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: teacherUser.email, password: 'FacultyPassword@123' }),
  });
  assert.equal(teacherLoginRes.status, 200);
  const teacherData = await teacherLoginRes.json();
  assert.equal(teacherData.role, 'teacher');
  const teacherCookie = teacherLoginRes.headers.get('set-cookie');

  // 2. Fetch teacher's timetable
  const ttRes = await fetch(`${baseUrl}/api/teacher/timetable`, {
    headers: { Cookie: teacherCookie },
  });
  assert.equal(ttRes.status, 200);
  const ttData = await ttRes.json();
  assert.ok(Array.isArray(ttData));
  assert.ok(ttData.some(entry => entry.teacherId === testTeacherId && entry.subjectName === 'Quantum Mechanics'));

  // 3. Teacher cannot access admin endpoints
  const adminRes = await fetch(`${baseUrl}/api/admin/stats`, {
    headers: { Cookie: teacherCookie },
  });
  assert.equal(adminRes.status, 403);

  // 4. Student cannot access teacher timetable endpoint
  const studentLoginRes = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'student@campusspace.local', password: 'Student@123' }),
  });
  const studentCookie = studentLoginRes.headers.get('set-cookie');
  const studentTtRes = await fetch(`${baseUrl}/api/teacher/timetable`, {
    headers: { Cookie: studentCookie },
  });
  assert.equal(studentTtRes.status, 403);

  // 5. Admin deactivates teacher
  const adminLoginRes = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@campusspace.local', password: 'Admin@123' }),
  });
  const adminCookie = adminLoginRes.headers.get('set-cookie');
  const deactRes = await fetch(`${baseUrl}/api/admin/teachers/${testTeacherId}`, {
    method: 'DELETE',
    headers: { Cookie: adminCookie },
  });
  assert.equal(deactRes.status, 200);

  // 6. Deactivated teacher cannot log in (403 Deactivated)
  const deactLoginRes = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: teacherUser.email, password: 'FacultyPassword@123' }),
  });
  assert.equal(deactLoginRes.status, 403);
});
