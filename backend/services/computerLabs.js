export function minuteOfDay(value) {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

export function isValidDateKey(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function overlaps(first, second) {
  if (first.date !== second.date) return false;
  const firstStart = minuteOfDay(first.startTime);
  const firstEnd = minuteOfDay(first.endTime);
  const secondStart = minuteOfDay(second.startTime);
  const secondEnd = minuteOfDay(second.endTime);
  return firstStart !== null && firstEnd !== null && secondStart !== null && secondEnd !== null &&
    firstStart < secondEnd && firstEnd > secondStart;
}

export function reservesComputer(booking) {
  return ['confirmed', 'approved'].includes(String(booking.status || '').toLowerCase()) &&
    typeof booking.computerId === 'string' &&
    booking.computerId.length > 0;
}

export function reservationConflicts(existing, candidate) {
  return reservesComputer(existing) &&
    existing.labId === candidate.labId &&
    existing.computerId === candidate.computerId &&
    overlaps(existing, candidate);
}
