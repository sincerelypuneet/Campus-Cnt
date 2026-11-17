import test from 'node:test';
import assert from 'node:assert/strict';
import { findAvailableClassrooms, reservationOverlaps } from './services/classroomAvailability.js';

const request = {
  date: '2026-11-23',
  weekday: 'Monday',
  startTime: '10:00',
  endTime: '11:00',
  minCapacity: 20,
};

const rooms = [
  { id: 'scheduled', roomNumber: '101', building: 'Main', floorNumber: 1, capacity: 30, facilities: ['Projector'] },
  { id: 'free', roomNumber: '102', building: 'Main', floorNumber: 1, capacity: 40, facilities: ['Whiteboard'] },
  { id: 'maintenance', roomNumber: '103', building: 'Annex', floorNumber: 2, capacity: 50 },
];

test('excludes scheduled, reserved, and maintained rooms with overlapping times', () => {
  const available = findAvailableClassrooms({
    rooms,
    timetable: [{ classroomId: 'scheduled', day: 'Monday', startTime: '10:30', endTime: '11:30' }],
    reservations: [{ classroomId: 'free', date: request.date, startTime: '10:45', endTime: '11:15', status: 'confirmed' }],
    maintenance: [{ classroomId: 'maintenance', date: request.date }],
    ...request,
  });
  assert.deepEqual(available, []);
});

test('includes rooms whose class ends at the requested start and applies room filters', () => {
  const available = findAvailableClassrooms({
    rooms,
    timetable: [{ classroomId: 'free', day: 'Monday', startTime: '09:00', endTime: '10:00' }],
    reservations: [],
    maintenance: [],
    ...request,
    building: 'main',
    floor: '1',
    minCapacity: 35,
  });
  assert.equal(available.length, 1);
  assert.equal(available[0].roomNumber, '102');
  assert.deepEqual(available[0].availableTimeSlot, { startTime: '10:00', endTime: '11:00' });
  assert.deepEqual(available[0].facilities, ['Whiteboard']);
});

test('reservation overlap detection treats adjacent slots as non-conflicting', () => {
  const candidate = { classroomId: 'free', date: request.date, weekday: request.weekday, startTime: '10:00', endTime: '11:00' };
  assert.equal(reservationOverlaps({ classroomId: 'free', date: request.date, startTime: '11:00', endTime: '12:00' }, candidate), false);
  assert.equal(reservationOverlaps({ classroomId: 'free', date: request.date, startTime: '10:59', endTime: '12:00' }, candidate), true);
});
