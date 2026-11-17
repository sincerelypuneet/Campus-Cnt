const inactiveStatuses = new Set(['cancelled', 'canceled', 'rejected', 'denied', 'expired', 'completed', 'resolved']);
const unavailableStatuses = new Set(['unavailable', 'maintenance', 'closed', 'out of service', 'out-of-service']);

export function minuteOfDay(value) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value || ''));
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export function isValidDateKey(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isActive(record) {
  return record.active !== false && !inactiveStatuses.has(String(record.status || '').toLowerCase());
}

function overlaps(startTime, endTime, queryStart, queryEnd) {
  const start = minuteOfDay(startTime);
  const end = minuteOfDay(endTime);
  if (start === null || end === null || end <= start) return true;
  return start < queryEnd && end > queryStart;
}

function overlapsRecord(record, queryStart, queryEnd) {
  let startTime = record.startTime;
  let endTime = record.endTime;
  if ((!startTime || !endTime) && typeof record.timeSlot === 'string') {
    const match = /^\s*(\d{2}:\d{2})\s*[-–]\s*(\d{2}:\d{2})\s*$/.exec(record.timeSlot);
    if (match) [, startTime, endTime] = match;
  }
  if (!startTime || !endTime) return true;
  return overlaps(startTime, endTime, queryStart, queryEnd);
}

function appliesToDate(record, date, weekday, fallbackToAllDays = false) {
  if (record.date) return record.date === date;
  if (record.startDate || record.endDate) {
    return (!record.startDate || record.startDate <= date) && (!record.endDate || record.endDate >= date);
  }
  if (record.day) return String(record.day).toLowerCase() === weekday.toLowerCase();
  return fallbackToAllDays;
}

function matchesRoom(record, roomId) {
  return (record.classroomId || record.roomId) === roomId;
}

function roomIsUnavailable(room) {
  const status = room.availabilityStatus || room.availability || room.status;
  return room.active === false || unavailableStatuses.has(String(status || '').toLowerCase());
}

function roomDetails(room) {
  const capacity = Number(room.seatingCapacity ?? room.capacity);
  const facilities = room.facilities || room.resources || room.amenities || [];
  return {
    id: room.id,
    roomNumber: room.roomNumber || room.classroomNumber || room.name || 'Room',
    building: room.building || 'Not specified',
    floor: room.floorNumber ?? room.floor ?? null,
    seatingCapacity: Number.isFinite(capacity) ? capacity : 0,
    roomType: room.roomType || 'Classroom',
    availabilityStatus: room.availabilityStatus || room.availability || room.status || 'available',
    facilities: Array.isArray(facilities) ? facilities : [facilities].filter(Boolean),
  };
}

export function findAvailableClassrooms({
  rooms,
  timetable,
  reservations,
  maintenance,
  date,
  weekday,
  startTime,
  endTime,
  minCapacity,
  building = '',
  floor = '',
}) {
  const queryStart = minuteOfDay(startTime);
  const queryEnd = minuteOfDay(endTime);
  return rooms.filter((room) => {
    const details = roomDetails(room);
    if (!room.id || roomIsUnavailable(room) || details.seatingCapacity < minCapacity) return false;
    if (building && String(details.building).toLowerCase() !== building.toLowerCase()) return false;
    if (floor && String(details.floor ?? '').toLowerCase() !== floor.toLowerCase()) return false;
    if (timetable.some((entry) =>
      isActive(entry) &&
      matchesRoom(entry, room.id) &&
      appliesToDate(entry, date, weekday) &&
      overlapsRecord(entry, queryStart, queryEnd)
    )) return false;
    if (reservations.some((reservation) =>
      isActive(reservation) &&
      matchesRoom(reservation, room.id) &&
      appliesToDate(reservation, date, weekday) &&
      overlapsRecord(reservation, queryStart, queryEnd)
    )) return false;
    if (maintenance.some((record) =>
      isActive(record) &&
      matchesRoom(record, room.id) &&
      appliesToDate(record, date, weekday, true) &&
      overlapsRecord(record, queryStart, queryEnd)
    )) return false;
    return true;
  }).map((room) => ({
    ...roomDetails(room),
    availableTimeSlot: { startTime, endTime },
  }));
}

export function reservationOverlaps(existing, candidate) {
  if (!isActive(existing) || !matchesRoom(existing, candidate.classroomId)) return false;
  if (!appliesToDate(existing, candidate.date, candidate.weekday)) return false;
  const queryStart = minuteOfDay(candidate.startTime);
  const queryEnd = minuteOfDay(candidate.endTime);
  return overlapsRecord(existing, queryStart, queryEnd);
}
