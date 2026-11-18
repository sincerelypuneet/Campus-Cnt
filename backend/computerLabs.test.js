import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidDateKey, minuteOfDay, overlaps, reservationConflicts, reservesComputer } from './services/computerLabs.js';

test('validates date keys and strict 24-hour times', () => {
  assert.equal(isValidDateKey('2026-02-28'), true);
  assert.equal(isValidDateKey('2026-02-30'), false);
  assert.equal(minuteOfDay('23:59'), 1439);
  assert.equal(minuteOfDay('24:00'), null);
  assert.equal(minuteOfDay('9:00'), null);
});

test('computer reservations conflict only when date and time overlap', () => {
  const first = { date: '2026-11-23', startTime: '10:00', endTime: '11:00' };
  assert.equal(overlaps(first, { ...first, startTime: '10:30', endTime: '11:30' }), true);
  assert.equal(overlaps(first, { ...first, startTime: '11:00', endTime: '12:00' }), false);
  assert.equal(overlaps(first, { ...first, date: '2026-11-24' }), false);
});

test('pending requests do not reserve a computer until confirmed or approved', () => {
  assert.equal(reservesComputer({ status: 'pending', computerId: 'pc-1' }), false);
  assert.equal(reservesComputer({ status: 'confirmed', computerId: 'pc-1' }), true);
  assert.equal(reservesComputer({ status: 'approved', computerId: 'pc-1' }), true);
  assert.equal(reservesComputer({ status: 'approved' }), false);
});

test('double-booking checks match the same lab and computer and ignore pending requests', () => {
  const existing = {
    labId: 'lab-1',
    computerId: 'pc-1',
    status: 'confirmed',
    date: '2026-11-23',
    startTime: '10:00',
    endTime: '11:00',
  };
  const overlappingSlot = { ...existing, startTime: '10:30', endTime: '11:30' };
  assert.equal(reservationConflicts(existing, overlappingSlot), true);
  assert.equal(reservationConflicts(existing, { ...overlappingSlot, computerId: 'pc-2' }), false);
  assert.equal(reservationConflicts(existing, { ...overlappingSlot, labId: 'lab-2' }), false);
  assert.equal(reservationConflicts({ ...existing, status: 'pending' }, overlappingSlot), false);
});
