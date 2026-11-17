const inactiveStatuses = new Set(['cancelled', 'canceled', 'rejected', 'denied', 'expired']);
const unavailableStatuses = new Set(['unavailable', 'out of office', 'leave', 'outside working hours']);
const availableStatuses = new Set(['available', 'confirmed']);
const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function minuteOfDay(value) {
  const match = /^(\d{1,2}):([0-5]\d)(?:\s*(AM|PM))?$/i.exec(String(value || '').trim());
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 24 || (match[3] && (hour < 1 || hour > 12)) || (hour === 24 && minute !== 0)) return null;
  if (match[3]) {
    hour %= 12;
    if (match[3].toUpperCase() === 'PM') hour += 12;
  }
  return hour * 60 + minute;
}

export function validDateKey(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function weekdayForDate(date) {
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' })
    .format(new Date(`${date}T00:00:00.000Z`));
}

export function formatTime(minutes) {
  const hour = String(Math.floor(minutes / 60)).padStart(2, '0');
  const minute = String(minutes % 60).padStart(2, '0');
  return `${hour}:${minute}`;
}

function isActive(record) {
  return record.active !== false && !inactiveStatuses.has(String(record.status || '').toLowerCase());
}

function appliesToDate(record, date, day) {
  if (record.date) return record.date === date;
  if (record.startDate || record.endDate) {
    return (!record.startDate || record.startDate <= date) && (!record.endDate || record.endDate >= date);
  }
  return Boolean(record.day && String(record.day).toLowerCase() === day.toLowerCase());
}

function normalizeInterval(record, queryStart, queryEnd) {
  const start = minuteOfDay(record.startTime ?? record.start);
  const end = minuteOfDay(record.endTime ?? record.end);
  if (start === null || end === null || end <= start) return { start: queryStart, end: queryEnd };
  return { start: Math.max(start, queryStart), end: Math.min(end, queryEnd) };
}

function overlaps(interval, start, end) {
  return interval.start < end && interval.end > start;
}

function mergeIntervals(intervals) {
  const ordered = intervals.filter((item) => item.end > item.start).sort((a, b) => a.start - b.start);
  const merged = [];
  for (const interval of ordered) {
    const last = merged[merged.length - 1];
    if (!last || interval.start > last.end) merged.push({ ...interval });
    else last.end = Math.max(last.end, interval.end);
  }
  return merged;
}

function subtractIntervals(start, end, occupied) {
  const gaps = [];
  let cursor = start;
  for (const interval of mergeIntervals(occupied)) {
    if (interval.start > cursor) gaps.push({ start: cursor, end: interval.start });
    cursor = Math.max(cursor, interval.end);
    if (cursor >= end) break;
  }
  if (cursor < end) gaps.push({ start: cursor, end });
  return gaps;
}

function toDisplayIntervals(intervals) {
  return intervals.map((item) => ({ start: formatTime(item.start), end: formatTime(item.end) }));
}

function workingIntervals(workingHours, day) {
  if (!workingHours || typeof workingHours !== 'object') return null;
  let daily = null;
  if (Array.isArray(workingHours)) {
    if (workingHours.length === 0) return null;
    daily = workingHours.filter((item) => String(item.day || '').toLowerCase() === day.toLowerCase());
  } else {
    if (Object.keys(workingHours).length === 0) return null;
    const key = Object.keys(workingHours).find((name) => name.toLowerCase() === day.toLowerCase());
    if (key) daily = workingHours[key];
    else return [];
  }
  if (daily == null) return [];
  const entries = Array.isArray(daily) ? daily : [daily];
  return entries.map((item) => ({
    start: minuteOfDay(item.startTime ?? item.start),
    end: minuteOfDay(item.endTime ?? item.end),
  })).filter((item) => item.start !== null && item.end !== null && item.end > item.start);
}

function withinWorkingHours(working, start, end) {
  return working === null || mergeIntervals(working).some((interval) => interval.start <= start && interval.end >= end);
}

function confirmedAvailability(record) {
  if (record.available === false || unavailableStatuses.has(String(record.status || '').toLowerCase())) return false;
  return record.confirmed === true || record.available === true ||
    availableStatuses.has(String(record.status || '').toLowerCase());
}

function unavailableRecord(record) {
  return record.available === false || unavailableStatuses.has(String(record.status || '').toLowerCase());
}

function busyRecord(record) {
  return String(record.status || '').toLowerCase() === 'busy';
}

function dayRecords(records, teacherId, date, day, department) {
  return records.filter((record) =>
    isActive(record) &&
    record.teacherId === teacherId &&
    appliesToDate(record, date, day) &&
    (!department || !record.departmentId || record.departmentId === department)
  );
}

function scheduleForDay(timetable, teacherId, date, day, department) {
  return timetable.filter((entry) =>
    isActive(entry) &&
    entry.teacherId === teacherId &&
    appliesToDate(entry, date, day) &&
    (!department || !entry.departmentId || entry.departmentId === department)
  );
}

export function calculateAvailability({
  teacher,
  timetable,
  availabilityRecords,
  date,
  day,
  startTime,
  endTime,
  department = '',
  now = new Date(),
}) {
  const queryStart = minuteOfDay(startTime);
  const queryEnd = minuteOfDay(endTime);
  const schedule = scheduleForDay(timetable, teacher.id, date, day, department);
  const availability = dayRecords(availabilityRecords, teacher.id, date, day, department);
  const classes = mergeIntervals(schedule.map((entry) => normalizeInterval(entry, queryStart, queryEnd)));
  const unavailable = mergeIntervals(availability.filter(unavailableRecord)
    .map((record) => normalizeInterval(record, queryStart, queryEnd)));
  const busy = mergeIntervals(availability.filter(busyRecord)
    .map((record) => normalizeInterval(record, queryStart, queryEnd)));
  const confirmed = mergeIntervals(availability.filter(confirmedAvailability)
    .map((record) => normalizeInterval(record, queryStart, queryEnd)));
  const working = workingIntervals(teacher.workingHours, day);
  const outsideWorkingHours = !withinWorkingHours(working, queryStart, queryEnd);
  const classOverlap = classes.some((interval) => overlaps(interval, queryStart, queryEnd));
  const unavailableOverlap = unavailable.some((interval) => overlaps(interval, queryStart, queryEnd));
  const busyOverlap = busy.some((interval) => overlaps(interval, queryStart, queryEnd));
  const currentDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const currentMinute = now.getHours() * 60 + now.getMinutes();
  const currentlyTeaching = date === currentDate &&
    queryStart <= currentMinute && currentMinute < queryEnd &&
    classes.some((interval) => interval.start <= currentMinute && interval.end > currentMinute);
  const confirmedForRequest = confirmed.some((interval) => interval.start <= queryStart && interval.end >= queryEnd);
  let status = 'Not scheduled';
  if (outsideWorkingHours || unavailableOverlap) status = 'Unavailable or outside working hours';
  else if (currentlyTeaching) status = 'Currently teaching';
  else if (classOverlap || busyOverlap) status = 'Busy';
  else if (confirmedForRequest) status = 'Available';

  const freeIntervals = subtractIntervals(queryStart, queryEnd, classes);
  const confirmedFree = [];
  for (const interval of confirmed) {
    const start = Math.max(queryStart, interval.start);
    const end = Math.min(queryEnd, interval.end);
    if (end > start) {
      confirmedFree.push(...subtractIntervals(start, end, [...classes, ...unavailable, ...busy]));
    }
  }

  return {
    status,
    freeIntervals: toDisplayIntervals(freeIntervals),
    confirmedAvailableIntervals: toDisplayIntervals(mergeIntervals(confirmedFree)),
    overlappingClasses: schedule.filter((entry) => classes.some((interval) => overlaps(
      interval,
      minuteOfDay(entry.startTime) ?? queryStart,
      minuteOfDay(entry.endTime) ?? queryEnd,
    ))),
    confirmedAvailability: confirmedForRequest && !classOverlap && !busyOverlap && !unavailableOverlap && !outsideWorkingHours,
  };
}

export function currentAvailability({ teacher, timetable, availabilityRecords, now = new Date() }) {
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const day = weekdays[now.getDay()];
  const currentMinute = now.getHours() * 60 + now.getMinutes();
  const schedule = scheduleForDay(timetable, teacher.id, date, day, '');
  const availability = dayRecords(availabilityRecords, teacher.id, date, day, '');
  const working = workingIntervals(teacher.workingHours, day);
  if (working !== null && !working.some((interval) => interval.start <= currentMinute && interval.end > currentMinute)) {
    return { status: 'Unavailable or outside working hours', confirmed: false };
  }
  if (availability.some((record) => unavailableRecord(record) && overlaps(normalizeInterval(record, currentMinute, currentMinute + 1), currentMinute, currentMinute + 1))) {
    return { status: 'Unavailable or outside working hours', confirmed: false };
  }
  if (availability.some((record) => busyRecord(record) && overlaps(normalizeInterval(record, currentMinute, currentMinute + 1), currentMinute, currentMinute + 1))) {
    return { status: 'Busy', confirmed: false };
  }
  const teaching = schedule.some((entry) => {
    const start = minuteOfDay(entry.startTime);
    const end = minuteOfDay(entry.endTime);
    return start === null || end === null || (start <= currentMinute && end > currentMinute);
  });
  if (teaching) return { status: 'Currently teaching', confirmed: false };
  const confirmed = availability.some((record) => confirmedAvailability(record) &&
    overlaps(normalizeInterval(record, currentMinute, currentMinute + 1), currentMinute, currentMinute + 1));
  if (confirmed) return { status: 'Available', confirmed: true };
  return { status: 'Not scheduled', confirmed: false };
}
