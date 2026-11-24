// backend/services/labMaintenance.js

import { minuteOfDay, isValidDateKey, overlaps } from './computerLabs.js';

export function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function isMaintenanceActive(record) {
  return record && record.active !== false && String(record.status || '').toLowerCase() !== 'cancelled';
}

export function dateRangeOverlaps(firstStart, firstEnd, secondStart, secondEnd) {
  return firstStart <= secondEnd && firstEnd >= secondStart;
}

export function timeWindowOverlaps(firstStart, firstEnd, secondStart, secondEnd) {
  const fStart = minuteOfDay(firstStart);
  const fEnd = minuteOfDay(firstEnd);
  const sStart = minuteOfDay(secondStart);
  const sEnd = minuteOfDay(secondEnd);
  if (fStart === null || fEnd === null || sStart === null || sEnd === null) return false;
  return fStart < sEnd && fEnd > sStart;
}

export function validateMaintenanceInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'Provide maintenance details.' };
  }
  const { type, labId, computerId, classroomId, date, startDate, endDate, startTime, endTime, reason, description } = input;

  if (!['lab', 'classroom'].includes(type)) {
    return { error: 'Type must be lab or classroom.' };
  }
  if (type === 'lab' && (!labId || typeof labId !== 'string' || !labId.trim())) {
    return { error: 'Select a valid laboratory.' };
  }
  if (type === 'classroom' && (!classroomId || typeof classroomId !== 'string' || !classroomId.trim())) {
    return { error: 'Select a valid classroom.' };
  }

  const effectiveDate = date || startDate;
  if (!isValidDateKey(effectiveDate)) {
    return { error: 'Enter a valid date in YYYY-MM-DD format.' };
  }
  const effectiveEnd = endDate || effectiveDate;
  if (!isValidDateKey(effectiveEnd)) {
    return { error: 'Enter a valid end date in YYYY-MM-DD format.' };
  }
  if (effectiveDate > effectiveEnd) {
    return { error: 'End date must be on or after start date.' };
  }

  const start = minuteOfDay(startTime);
  const end = minuteOfDay(endTime);
  if (start === null || end === null || start >= end) {
    return { error: 'Enter valid 24-hour times, with the end time after the start time.' };
  }

  if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 120) {
    return { error: 'Enter a maintenance reason up to 120 characters.' };
  }
  if (description !== undefined && (typeof description !== 'string' || description.length > 500)) {
    return { error: 'Description must be up to 500 characters.' };
  }

  return {
    value: {
      type,
      labId: type === 'lab' ? labId.trim() : null,
      computerId: type === 'lab' && computerId && computerId !== 'all' ? computerId.trim() : null,
      classroomId: type === 'classroom' ? classroomId.trim() : null,
      date: effectiveDate,
      startDate: effectiveDate,
      endDate: effectiveEnd,
      startTime,
      endTime,
      reason: reason.trim(),
      description: String(description || '').trim(),
    },
  };
}

export function getMaintenanceStatus(record, now = new Date()) {
  if (record.active === false || String(record.status || '').toLowerCase() === 'cancelled') {
    return 'cancelled';
  }
  const todayKey = localDateKey(now);
  const nowMins = now.getHours() * 60 + now.getMinutes();

  const startDate = record.startDate || record.date;
  const endDate = record.endDate || record.date;
  const startMins = minuteOfDay(record.startTime);
  const endMins = minuteOfDay(record.endTime);

  if (endDate < todayKey || (endDate === todayKey && endMins !== null && nowMins >= endMins)) {
    return 'completed';
  }
  if (startDate > todayKey || (startDate === todayKey && startMins !== null && nowMins < startMins)) {
    return 'scheduled';
  }
  return 'active';
}

export function maintenanceAppliesToSlot(maintenance, slot) {
  if (!isMaintenanceActive(maintenance)) return false;
  const slotDate = slot.date || slot.startDate;
  if (!slotDate) return false;

  const mStart = maintenance.startDate || maintenance.date;
  const mEnd = maintenance.endDate || maintenance.date;
  if (slotDate < mStart || slotDate > mEnd) return false;

  if (maintenance.startTime && maintenance.endTime && slot.startTime && slot.endTime) {
    return timeWindowOverlaps(maintenance.startTime, maintenance.endTime, slot.startTime, slot.endTime);
  }
  return true;
}

export function isComputerUnderMaintenance(computerId, labId, slot, maintenanceRecords = []) {
  if (!Array.isArray(maintenanceRecords)) return false;
  return maintenanceRecords.some((item) => {
    if (item.type !== 'lab' || item.labId !== labId) return false;
    const targetsComputer = !item.computerId || item.computerId === 'all' || item.computerId === computerId;
    if (!targetsComputer) return false;
    return maintenanceAppliesToSlot(item, slot);
  });
}

export function isLabUnderMaintenance(labId, slot, maintenanceRecords = []) {
  if (!Array.isArray(maintenanceRecords)) return false;
  return maintenanceRecords.some((item) => {
    if (item.type !== 'lab' || item.labId !== labId) return false;
    const isEntireLab = !item.computerId || item.computerId === 'all';
    if (!isEntireLab) return false;
    return maintenanceAppliesToSlot(item, slot);
  });
}

export function isClassroomUnderMaintenance(classroomId, slot, maintenanceRecords = []) {
  if (!Array.isArray(maintenanceRecords)) return false;
  return maintenanceRecords.some((item) => {
    const isTarget = item.classroomId === classroomId || item.roomId === classroomId;
    if (!isTarget) return false;
    return maintenanceAppliesToSlot(item, slot);
  });
}

export function maintenanceConflictsWithReservation(maintenance, reservation) {
  if (!isMaintenanceActive(maintenance)) return false;
  const resStatus = String(reservation.status || '').toLowerCase();
  if (['cancelled', 'canceled', 'rejected'].includes(resStatus)) return false;

  const slot = {
    date: reservation.date,
    startTime: reservation.startTime,
    endTime: reservation.endTime,
  };

  if (maintenance.type === 'lab') {
    if (maintenance.labId !== reservation.labId) return false;
    if (resStatus !== 'confirmed' && resStatus !== 'approved') return false;
    const targetsComputer = !maintenance.computerId || maintenance.computerId === 'all' || maintenance.computerId === reservation.computerId;
    if (!targetsComputer) return false;
    return maintenanceAppliesToSlot(maintenance, slot);
  }

  if (maintenance.type === 'classroom') {
    const isTarget = maintenance.classroomId === (reservation.classroomId || reservation.roomId);
    if (!isTarget) return false;
    if (resStatus !== 'confirmed' && resStatus !== 'approved') return false;
    return maintenanceAppliesToSlot(maintenance, slot);
  }

  return false;
}

export function maintenanceOverlapsWithExisting(candidate, existingRecords = [], excludeId = null) {
  if (!Array.isArray(existingRecords)) return false;
  return existingRecords.some((record) => {
    if (excludeId && record.id === excludeId) return false;
    if (!isMaintenanceActive(record)) return false;
    if (record.type !== candidate.type) return false;

    // Check resource matching
    if (candidate.type === 'classroom') {
      if (record.classroomId !== candidate.classroomId) return false;
    } else if (candidate.type === 'lab') {
      if (record.labId !== candidate.labId) return false;
      const recEntire = !record.computerId || record.computerId === 'all';
      const candEntire = !candidate.computerId || candidate.computerId === 'all';
      if (!recEntire && !candEntire && record.computerId !== candidate.computerId) {
        return false;
      }
    }

    // Check date range
    const candStart = candidate.startDate || candidate.date;
    const candEnd = candidate.endDate || candidate.date;
    const recStart = record.startDate || record.date;
    const recEnd = record.endDate || record.date;
    if (!dateRangeOverlaps(candStart, candEnd, recStart, recEnd)) return false;

    // Check time window (adjacent times do not overlap)
    return timeWindowOverlaps(candidate.startTime, candidate.endTime, record.startTime, record.endTime);
  });
}
