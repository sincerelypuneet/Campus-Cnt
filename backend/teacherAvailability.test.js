import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateAvailability, weekdayForDate } from './services/teacherAvailability.js';

const date = '2026-11-17';
const day = weekdayForDate(date);
const teacher = { id: 'teacher-1' };
const classes = [
  { teacherId: 'teacher-1', day, startTime: '09:00', endTime: '10:00', subjectName: 'Class A' },
  { teacherId: 'teacher-1', day, startTime: '11:00', endTime: '12:00', subjectName: 'Class B' },
];

test('returns exact class-free intervals without treating them as confirmed availability', () => {
  const result = calculateAvailability({
    teacher, timetable: classes, availabilityRecords: [], date, day,
    startTime: '09:00', endTime: '12:00',
  });
  assert.equal(result.status, 'Busy');
  assert.equal(result.confirmedAvailability, false);
  assert.deepEqual(result.freeIntervals, [{ start: '10:00', end: '11:00' }]);
  assert.deepEqual(result.confirmedAvailableIntervals, []);
});

test('returns Available only when a confirmed record covers the requested interval', () => {
  const result = calculateAvailability({
    teacher,
    timetable: [],
    availabilityRecords: [{
      teacherId: teacher.id, date, startTime: '10:00', endTime: '11:00', status: 'confirmed',
    }],
    date, day, startTime: '10:00', endTime: '11:00',
  });
  assert.equal(result.status, 'Available');
  assert.equal(result.confirmedAvailability, true);
  assert.deepEqual(result.confirmedAvailableIntervals, [{ start: '10:00', end: '11:00' }]);
});

test('reports Not scheduled rather than assuming an unrecorded gap is available', () => {
  const result = calculateAvailability({
    teacher, timetable: [], availabilityRecords: [], date, day,
    startTime: '10:00', endTime: '11:00',
  });
  assert.equal(result.status, 'Not scheduled');
  assert.equal(result.confirmedAvailability, false);
  assert.deepEqual(result.freeIntervals, [{ start: '10:00', end: '11:00' }]);
});

test('does not present an explicitly busy interval as confirmed availability', () => {
  const result = calculateAvailability({
    teacher,
    timetable: [],
    availabilityRecords: [
      { teacherId: teacher.id, date, startTime: '09:00', endTime: '12:00', status: 'confirmed' },
      { teacherId: teacher.id, date, startTime: '10:00', endTime: '11:00', status: 'busy' },
    ],
    date, day, startTime: '09:00', endTime: '12:00',
  });
  assert.equal(result.status, 'Busy');
  assert.equal(result.confirmedAvailability, false);
  assert.deepEqual(result.confirmedAvailableIntervals, [
    { start: '09:00', end: '10:00' },
    { start: '11:00', end: '12:00' },
  ]);
});

test('distinguishes current teaching from other scheduled conflicts', () => {
  const result = calculateAvailability({
    teacher, timetable: classes, availabilityRecords: [], date, day,
    startTime: '09:00', endTime: '10:00',
    now: new Date(`${date}T09:30:00`),
  });
  assert.equal(result.status, 'Currently teaching');
});

test('returns unavailable outside configured working hours', () => {
  const result = calculateAvailability({
    teacher: { ...teacher, workingHours: { Tuesday: { start: '08:00', end: '17:00' } } },
    timetable: [], availabilityRecords: [], date, day,
    startTime: '17:00', endTime: '18:00',
  });
  assert.equal(result.status, 'Unavailable or outside working hours');
});
