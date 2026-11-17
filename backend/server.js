// backend/server.js (updated with admin dashboard APIs)

import express from 'express';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import db from './db.js';
import {
  findAvailableClassrooms,
  isValidDateKey,
  minuteOfDay,
  reservationOverlaps,
} from './services/classroomAvailability.js';
import {
  calculateAvailability,
  currentAvailability,
  formatTime as formatTeacherTime,
  minuteOfDay as teacherMinuteOfDay,
  validDateKey as validTeacherDateKey,
  weekdayForDate,
} from './services/teacherAvailability.js';
import { getDashboard, createLabRequest, markNotificationRead } from './controllers/studentController.js';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret';
const JWT_EXPIRES_IN = '2h';

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '..', 'frontend')));

/** Helper: generate JWT */
function generateToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

/** Middleware: verify JWT and attach user */
function authenticate(req, res, next) {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ message: 'Authentication required' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload; // { id, role, email }
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
}

/** Middleware: role check */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: 'Unauthenticated' });
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Forbidden: insufficient privileges' });
    }
    next();
  };
}

const handleAsync = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function validateClassroomSearch(input, minCapacityRequired = true) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'Enter a date, start and end time, and minimum seating capacity.' };
  }
  const { date, startTime, endTime } = input;
  const minCapacity = Number(input.minCapacity);
  if (!isValidDateKey(date) || date < localDateKey(new Date())) {
    return { error: 'Choose a valid date that is today or later.' };
  }
  if (minuteOfDay(startTime) === null || minuteOfDay(endTime) === null || minuteOfDay(startTime) >= minuteOfDay(endTime)) {
    return { error: 'Enter valid 24-hour times, with the end time after the start time.' };
  }
  if ((minCapacityRequired && (!Number.isInteger(minCapacity) || minCapacity < 1 || minCapacity > 10000)) ||
      (!minCapacityRequired && input.minCapacity !== undefined && (!Number.isInteger(minCapacity) || minCapacity < 1 || minCapacity > 10000))) {
    return { error: 'Minimum seating capacity must be a whole number from 1 to 10000.' };
  }
  for (const field of ['building', 'floor']) {
    if (input[field] !== undefined && typeof input[field] !== 'string' && typeof input[field] !== 'number') {
      return { error: `Invalid ${field} filter.` };
    }
    if (input[field] !== undefined && String(input[field]).length > 100) {
      return { error: `The ${field} filter is too long.` };
    }
  }
  return {
    value: {
      date,
      startTime,
      endTime,
      minCapacity: minCapacityRequired ? minCapacity : (Number.isInteger(minCapacity) ? minCapacity : 1),
      building: String(input.building || '').trim(),
      floor: String(input.floor ?? '').trim(),
      weekday: new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00.000Z`)),
    },
  };
}

function teacherSubjects(teacher, schedule, subjectById) {
  const names = new Set();
  const assigned = Array.isArray(teacher.subjectsTaught) ? teacher.subjectsTaught : [teacher.subjectsTaught];
  for (const subject of assigned) {
    if (subject) names.add(subjectById.get(subject) || subject);
  }
  for (const entry of schedule) {
    const name = entry.subjectName || subjectById.get(entry.subjectId);
    if (name) names.add(name);
  }
  return [...names];
}

function publicTeacher(teacher, departments, subjectById, schedule) {
  const department = departments.find((item) => item.id === teacher.departmentId);
  const taught = schedule.filter((entry) => entry.teacherId === teacher.id && entry.active !== false);
  return {
    id: teacher.id,
    teacherId: teacher.id,
    fullName: teacher.fullName || teacher.name || 'Faculty member',
    departmentId: teacher.departmentId || '',
    department: teacher.department || department?.name || 'Department not listed',
    designation: teacher.designation || 'Not listed',
    subjectsTaught: teacherSubjects(teacher, taught, subjectById),
    assignedClassrooms: Array.isArray(teacher.assignedClassrooms)
      ? teacher.assignedClassrooms
      : teacher.assignedClassrooms ? [teacher.assignedClassrooms] : [],
  };
}

function scheduleEntryDetails(entry, subjectById, classrooms) {
  const room = classrooms.find((item) => item.id === entry.classroomId);
  return {
    id: entry.id,
    day: entry.day || '',
    date: entry.date || '',
    startTime: entry.startTime || '',
    endTime: entry.endTime || '',
    subjectName: entry.subjectName || subjectById.get(entry.subjectId) || entry.activity || 'Scheduled activity',
    building: entry.building || room?.building || '',
    classroom: entry.classroomNumber || room?.roomNumber || room?.classroomNumber || room?.name || '',
    departmentId: entry.departmentId || '',
  };
}

function intervalsBetweenClasses(schedule) {
  const result = [];
  for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']) {
    const entries = schedule.filter((entry) => String(entry.day).toLowerCase() === day.toLowerCase())
      .map((entry) => ({
        start: teacherMinuteOfDay(entry.startTime),
        end: teacherMinuteOfDay(entry.endTime),
      }))
      .filter((entry) => entry.start !== null && entry.end !== null && entry.end > entry.start)
      .sort((a, b) => a.start - b.start);
    let cursor = null;
    for (const entry of entries) {
      if (cursor !== null && entry.start > cursor) {
        result.push({ day, startTime: formatTeacherTime(cursor), endTime: formatTeacherTime(entry.start), confirmed: false });
      }
      cursor = cursor === null ? entry.end : Math.max(cursor, entry.end);
    }
  }
  return result;
}

/** Login endpoint */
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }
  const users = await db.read('users.json');
  const user = users.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (!user) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }
  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }
  const token = generateToken({ id: user.id, role: user.role, email: user.email });
  res.cookie('token', token, { httpOnly: true, sameSite: 'lax' });
  res.json({ message: 'Login successful', role: user.role });
});

/** Logout endpoint */
app.post('/api/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ message: 'Logged out' });
});

/** Admin stats endpoint */
app.get('/api/admin/stats', authenticate, requireRole('admin'), async (req, res) => {
  const [teachers, students, classrooms, labs, timetable, labBookings] = await Promise.all([
    db.read('teachers.json'),
    db.read('students.json'),
    db.read('classrooms.json'),
    db.read('laboratories.json'),
    db.read('timetable.json'),
    db.read('lab_bookings.json'),
  ]);

  // Simple today filter based on day name (Mon‑Sun). For demo, we just return all entries.
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long' }); // e.g., "Monday"
  const todaysClasses = timetable.filter(entry => entry.day === today);

  // Determine free classrooms (those not used in today's classes)
  const occupiedIds = new Set(todaysClasses.map(c => c.classroomId));
  const freeClassrooms = classrooms.filter(c => !occupiedIds.has(c.id));

  // Pending lab bookings – assume any booking without a "status" field is pending
  const pendingBookings = labBookings.filter(b => !b.status || b.status === 'pending');

  res.json({
    totalTeachers: teachers.length,
    totalStudents: students.length,
    totalClassrooms: classrooms.length,
    totalLaboratories: labs.length,
    todaysClasses,
    freeClassrooms,
    pendingLabBookings: pendingBookings,
  });
});

/** Example protected routes */

/** Teacher Management APIs (Admin only) */

/** Teacher Management APIs (Admin only) */

app.get('/api/student/faculty/options', authenticate, requireRole('student'), handleAsync(async (req, res) => {
  const [teachers, departments, subjects, timetable] = await Promise.all([
    db.read('teachers.json'),
    db.read('departments.json'),
    db.read('subjects.json'),
    db.read('timetable.json'),
  ]);
  const subjectNames = new Map(subjects.map((subject) => [subject.id, subject.name]));
  const subjectOptions = new Map(subjects.filter((subject) => subject.active !== false).map((subject) => [subject.id, subject.name]));
  for (const teacher of teachers.filter((item) => item.active !== false)) {
    const assigned = Array.isArray(teacher.subjectsTaught) ? teacher.subjectsTaught : [teacher.subjectsTaught];
    for (const value of assigned.filter(Boolean)) {
      const name = subjectNames.get(value) || value;
      if (![...subjectOptions.values()].some((item) => item.toLowerCase() === String(name).toLowerCase())) {
        subjectOptions.set(String(name), String(name));
      }
    }
  }
  for (const entry of timetable.filter((item) => item.active !== false)) {
    const name = entry.subjectName || subjectNames.get(entry.subjectId);
    if (name && ![...subjectOptions.values()].some((item) => item.toLowerCase() === String(name).toLowerCase())) {
      subjectOptions.set(String(name), String(name));
    }
  }
  res.json({
    departments: departments.filter((item) => item.active !== false).map(({ id, name }) => ({ id, name })),
    subjects: [...subjectOptions].map(([id, name]) => ({ id, name })),
    designations: [...new Set(teachers.filter((item) => item.active !== false).map((item) => item.designation).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b)),
  });
}));

app.get('/api/student/faculty/search', authenticate, requireRole('student'), handleAsync(async (req, res) => {
  const filters = {};
  for (const field of ['name', 'department', 'subject', 'teacherId', 'designation']) {
    const value = req.query[field];
    if (value !== undefined && (typeof value !== 'string' || value.length > 120)) {
      return res.status(400).json({ message: `Invalid ${field} search filter.` });
    }
    filters[field] = String(value || '').trim().toLowerCase();
  }
  const [teachers, departments, subjects, timetable] = await Promise.all([
    db.read('teachers.json'),
    db.read('departments.json'),
    db.read('subjects.json'),
    db.read('timetable.json'),
  ]);
  const subjectById = new Map(subjects.map((subject) => [subject.id, subject.name]));
  const profiles = teachers.filter((teacher) => teacher.active !== false).map((teacher) =>
    publicTeacher(teacher, departments, subjectById, timetable)
  ).filter((teacher) => {
    if (filters.name && !teacher.fullName.toLowerCase().includes(filters.name)) return false;
    if (filters.teacherId && !teacher.teacherId.toLowerCase().includes(filters.teacherId)) return false;
    if (filters.department && !teacher.department.toLowerCase().includes(filters.department) &&
        !teacher.departmentId.toLowerCase().includes(filters.department)) return false;
    if (filters.designation && !teacher.designation.toLowerCase().includes(filters.designation)) return false;
    if (filters.subject && !teacher.subjectsTaught.some((subject) => subject.toLowerCase().includes(filters.subject))) return false;
    return true;
  }).sort((a, b) => a.fullName.localeCompare(b.fullName));
  res.json({ teachers: profiles });
}));

app.get('/api/student/faculty/:id', authenticate, requireRole('student'), handleAsync(async (req, res) => {
  const [teachers, departments, subjects, timetable, classrooms, availabilityRecords] = await Promise.all([
    db.read('teachers.json'),
    db.read('departments.json'),
    db.read('subjects.json'),
    db.read('timetable.json'),
    db.read('classrooms.json'),
    db.read('teacher_availability.json'),
  ]);
  const teacher = teachers.find((item) => item.id === req.params.id && item.active !== false);
  if (!teacher) return res.status(404).json({ message: 'Teacher not found.' });
  const subjectById = new Map(subjects.map((subject) => [subject.id, subject.name]));
  const schedule = timetable.filter((entry) => entry.teacherId === teacher.id && entry.active !== false)
    .map((entry) => scheduleEntryDetails(entry, subjectById, classrooms));
  const profile = publicTeacher(teacher, departments, subjectById, timetable);
  profile.subjectsTaught = teacherSubjects(teacher, timetable.filter((entry) => entry.teacherId === teacher.id && entry.active !== false), subjectById);
  profile.assignedClassrooms = profile.assignedClassrooms.map((assigned) => {
    const room = classrooms.find((item) => item.id === assigned);
    return room ? (room.roomNumber || room.classroomNumber || room.name) : assigned;
  });
  const now = new Date();
  const today = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(now);
  const todayDate = localDateKey(now);
  const todaySchedule = schedule.filter((entry) =>
    entry.date ? entry.date === todayDate : entry.day.toLowerCase() === today.toLowerCase()
  ).sort((a, b) => (teacherMinuteOfDay(a.startTime) ?? 0) - (teacherMinuteOfDay(b.startTime) ?? 0));
  const weekdayIndex = new Map(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((day, index) => [day.toLowerCase(), index]));
  const upcomingClasses = schedule.filter((entry) => {
    if (entry.date && entry.date < todayDate) return false;
    const entryDay = entry.date
      ? new Date(`${entry.date}T00:00:00.000Z`).getUTCDay()
      : weekdayIndex.get(entry.day.toLowerCase());
    if (entryDay === undefined) return false;
    const delta = (entryDay - now.getDay() + 7) % 7;
    return delta > 0 || (delta === 0 && (teacherMinuteOfDay(entry.startTime) ?? -1) > now.getHours() * 60 + now.getMinutes());
  }).sort((a, b) => {
    const aDay = a.date ? new Date(`${a.date}T00:00:00.000Z`).getUTCDay() : weekdayIndex.get(a.day.toLowerCase());
    const bDay = b.date ? new Date(`${b.date}T00:00:00.000Z`).getUTCDay() : weekdayIndex.get(b.day.toLowerCase());
    const aDelta = (aDay - now.getDay() + 7) % 7;
    const bDelta = (bDay - now.getDay() + 7) % 7;
    return aDelta - bDelta || (teacherMinuteOfDay(a.startTime) ?? 0) - (teacherMinuteOfDay(b.startTime) ?? 0);
  });
  const current = currentAvailability({ teacher, timetable, availabilityRecords, now });
  profile.currentAvailability = {
    ...current,
    message: current.confirmed
      ? 'This time is covered by a confirmed availability record.'
      : 'No confirmed availability is recorded for this time.',
  };
  res.json({
    teacher: profile,
    weeklyTimetable: schedule.sort((a, b) =>
      (weekdayIndex.get(a.day.toLowerCase()) ?? 7) - (weekdayIndex.get(b.day.toLowerCase()) ?? 7) ||
      (teacherMinuteOfDay(a.startTime) ?? 0) - (teacherMinuteOfDay(b.startTime) ?? 0)
    ),
    todaySchedule,
    upcomingClasses,
    freePeriods: intervalsBetweenClasses(schedule),
  });
}));

app.post('/api/student/faculty/:id/availability', authenticate, requireRole('student'), handleAsync(async (req, res) => {
  const input = req.body;
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return res.status(400).json({ message: 'Enter a date, day, start time, and end time.' });
  }
  const { date, day, startTime, endTime } = input;
  const minDate = localDateKey(new Date());
  if (!validTeacherDateKey(date) || date < minDate) {
    return res.status(400).json({ message: 'Choose a valid date that is today or later.' });
  }
  if (typeof day !== 'string' || day !== weekdayForDate(date)) {
    return res.status(400).json({ message: 'The selected day must match the selected date.' });
  }
  const start = teacherMinuteOfDay(startTime);
  const end = teacherMinuteOfDay(endTime);
  if (start === null || end === null || end <= start) {
    return res.status(400).json({ message: 'Enter valid 24-hour times, with the end time after the start time.' });
  }
  if (input.department !== undefined && (typeof input.department !== 'string' || input.department.length > 120)) {
    return res.status(400).json({ message: 'Invalid department filter.' });
  }
  const teacher = await db.getById('teachers.json', req.params.id);
  if (!teacher || teacher.active === false) return res.status(404).json({ message: 'Teacher not found.' });
  const [timetable, availabilityRecords, subjects, classrooms] = await Promise.all([
    db.read('timetable.json'),
    db.read('teacher_availability.json'),
    db.read('subjects.json'),
    db.read('classrooms.json'),
  ]);
  const subjectById = new Map(subjects.map((subject) => [subject.id, subject.name]));
  const result = calculateAvailability({
    teacher,
    timetable,
    availabilityRecords,
    date,
    day,
    startTime,
    endTime,
    department: input.department || '',
  });
  res.json({
    ...result,
    overlappingClasses: result.overlappingClasses.map((entry) => scheduleEntryDetails(entry, subjectById, classrooms)),
  });
}));

// Get all teachers (optionally filter by department or search query)
// ---------- Student API: Find a Teacher ----------
// Search teachers with various filters (read‑only for students)
app.get('/api/student/teachers', authenticate, requireRole('student', 'admin'), async (req, res) => {
  const { name, department, subject, teacherId, designation, q } = req.query;
  const teachers = await db.read('teachers.json');
  let result = teachers;
  if (teacherId) result = result.filter(t => t.id === teacherId);
  if (name) {
    const lc = name.toLowerCase();
    result = result.filter(t => t.fullName && t.fullName.toLowerCase().includes(lc));
  }
  if (designation) {
    const lc = designation.toLowerCase();
    result = result.filter(t => t.designation && t.designation.toLowerCase().includes(lc));
  }
  if (department) result = result.filter(t => t.departmentId === department);
  if (subject) result = result.filter(t => (t.subjectsTaught || []).includes(subject));
  if (q) {
    const lc = q.toLowerCase();
    result = result.filter(t =>
      (t.fullName && t.fullName.toLowerCase().includes(lc)) ||
      (t.email && t.email.toLowerCase().includes(lc))
    );
  }
  res.json(result);
});

// Get full teacher profile with timetable info (read‑only)
app.get('/api/student/teacher/:id', authenticate, requireRole('student', 'admin'), async (req, res) => {
  const { id } = req.params;
  const teacher = await db.getById('teachers.json', id);
  if (!teacher) return res.status(404).json({ message: 'Teacher not found' });
  const timetable = await db.read('timetable.json');
  const teacherSchedule = timetable.filter(entry => entry.teacherId === id);
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long' });
  const todays = teacherSchedule.filter(e => e.day === today);
  const upcoming = teacherSchedule.filter(e => {
    const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
    const idx = days.indexOf(e.day);
    const todayIdx = days.indexOf(today);
    return idx > todayIdx;
  });
  res.json({ teacher, schedule: teacherSchedule, todays, upcoming });
});

// Availability check for a teacher
app.post('/api/student/teacher/:id/availability', authenticate, requireRole('student', 'admin'), async (req, res) => {
  const { id } = req.params;
  const { date, day, startTime, endTime, department } = req.body; // HH:MM 24h format
  const teacher = await db.getById('teachers.json', id);
  if (!teacher) return res.status(404).json({ message: 'Teacher not found' });
  const timetable = await db.read('timetable.json');
  const entries = timetable.filter(e => e.teacherId === id && (!department || e.departmentId === department));

  const toMins = t => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  const queryStart = toMins(startTime);
  const queryEnd = toMins(endTime);

  const overlapping = entries.filter(e => {
    if (day && e.day !== day) return false;
    const clsStart = toMins(e.startTime);
    const clsEnd = toMins(e.endTime);
    return !(clsEnd <= queryStart || clsStart >= queryEnd);
  });

  let status = 'Not scheduled';
  if (overlapping.length) status = 'Busy';

  // Compute free intervals
  const occupied = overlapping.map(e => ({ start: toMins(e.startTime), end: toMins(e.endTime) }));
  occupied.sort((a, b) => a.start - b.start);
  const freeIntervals = [];
  let cursor = queryStart;
  for (const occ of occupied) {
    if (occ.start > cursor) freeIntervals.push({ start: cursor, end: occ.start });
    cursor = Math.max(cursor, occ.end);
  }
  if (cursor < queryEnd) freeIntervals.push({ start: cursor, end: queryEnd });

  const fmt = mins => {
    const h = String(Math.floor(mins / 60)).padStart(2, '0');
    const m = String(mins % 60).padStart(2, '0');
    return `${h}:${m}`;
  };
  const freeSlots = freeIntervals.map(i => ({ start: fmt(i.start), end: fmt(i.end) }));

  res.json({ status, overlapping, freeSlots });
});

// Teacher Management APIs (Admin only)
app.get('/api/admin/teachers', authenticate, requireRole('admin'), async (req, res) => {
  const { department, q } = req.query;
  const teachers = await db.read('teachers.json');
  let result = teachers;
  if (department) {
    result = result.filter(t => t.departmentId === department);
  }
  if (q) {
    const lc = q.toLowerCase();
    result = result.filter(t =>
      (t.fullName && t.fullName.toLowerCase().includes(lc)) ||
      (t.email && t.email.toLowerCase().includes(lc))
    );
  }
  res.json(result);
});
// Get all teachers (optionally filter by department or search query)
// ---------- Student API: Find a Teacher ----------
// Search teachers with various filters (read‑only for students)
app.get('/api/student/teachers', authenticate, requireRole('student', 'admin'), async (req, res) => {
  const { name, department, subject, teacherId, designation, q } = req.query;
  const teachers = await db.read('teachers.json');
  let result = teachers;
  if (teacherId) result = result.filter(t => t.id === teacherId);
  if (name) {
    const lc = name.toLowerCase();
    result = result.filter(t => t.fullName && t.fullName.toLowerCase().includes(lc));
  }
  if (designation) {
    const lc = designation.toLowerCase();
    result = result.filter(t => t.designation && t.designation.toLowerCase().includes(lc));
  }
  if (department) result = result.filter(t => t.departmentId === department);
  if (subject) result = result.filter(t => (t.subjectsTaught || []).includes(subject));
  if (q) {
    const lc = q.toLowerCase();
    result = result.filter(t =>
      (t.fullName && t.fullName.toLowerCase().includes(lc)) ||
      (t.email && t.email.toLowerCase().includes(lc))
    );
  }
  res.json(result);
});

// Get full teacher profile with timetable info (read‑only)
app.get('/api/student/teacher/:id', authenticate, requireRole('student', 'admin'), async (req, res) => {
  const { id } = req.params;
  const teacher = await db.getById('teachers.json', id);
  if (!teacher) return res.status(404).json({ message: 'Teacher not found' });
  const timetable = await db.read('timetable.json');
  const teacherSchedule = timetable.filter(entry => entry.teacherId === id);
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long' });
  const todays = teacherSchedule.filter(e => e.day === today);
  const upcoming = teacherSchedule.filter(e => {
    const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
    const idx = days.indexOf(e.day);
    const todayIdx = days.indexOf(today);
    return idx > todayIdx;
  });
  res.json({ teacher, schedule: teacherSchedule, todays, upcoming });
});

// Availability check for a teacher
app.post('/api/student/teacher/:id/availability', authenticate, requireRole('student', 'admin'), async (req, res) => {
  const { id } = req.params;
  const { date, day, startTime, endTime, department } = req.body; // HH:MM 24h format
  const teacher = await db.getById('teachers.json', id);
  if (!teacher) return res.status(404).json({ message: 'Teacher not found' });
  const timetable = await db.read('timetable.json');
  const entries = timetable.filter(e => e.teacherId === id && (!department || e.departmentId === department));

  const toMins = t => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  const queryStart = toMins(startTime);
  const queryEnd = toMins(endTime);

  const overlapping = entries.filter(e => {
    if (day && e.day !== day) return false;
    const clsStart = toMins(e.startTime);
    const clsEnd = toMins(e.endTime);
    return !(clsEnd <= queryStart || clsStart >= queryEnd);
  });

  let status = 'Not scheduled';
  if (overlapping.length) status = 'Busy';

  // Compute free intervals
  const occupied = overlapping.map(e => ({ start: toMins(e.startTime), end: toMins(e.endTime) }));
  occupied.sort((a, b) => a.start - b.start);
  const freeIntervals = [];
  let cursor = queryStart;
  for (const occ of occupied) {
    if (occ.start > cursor) freeIntervals.push({ start: cursor, end: occ.start });
    cursor = Math.max(cursor, occ.end);
  }
  if (cursor < queryEnd) freeIntervals.push({ start: cursor, end: queryEnd });

  const fmt = mins => {
    const h = String(Math.floor(mins / 60)).padStart(2, '0');
    const m = String(mins % 60).padStart(2, '0');
    return `${h}:${m}`;
  };
  const freeSlots = freeIntervals.map(i => ({ start: fmt(i.start), end: fmt(i.end) }));

  res.json({ status, overlapping, freeSlots });
});

// Teacher Management APIs (Admin only)
app.get('/api/admin/teachers', authenticate, requireRole('admin'), async (req, res) => {
  const { department, q } = req.query;
  const teachers = await db.read('teachers.json');
  let result = teachers;
  if (department) {
    result = result.filter(t => t.departmentId === department);
  }
  if (q) {
    const lc = q.toLowerCase();
    result = result.filter(t =>
      (t.fullName && t.fullName.toLowerCase().includes(lc)) ||
      (t.email && t.email.toLowerCase().includes(lc))
    );
  }
  res.json(result);
});

// Add a new teacher and associated user account
app.post('/api/admin/teachers', authenticate, requireRole('admin'), async (req, res) => {
  const {
    fullName,
    email,
    contactNumber,
    departmentId,
    designation,
    subjectsTaught,
    assignedClassrooms,
    profileImage,
    password,
  } = req.body;

  // Basic validation
  if (!fullName || !email || !departmentId || !designation) {
    return res.status(400).json({ message: 'Missing required teacher fields' });
  }
  // Ensure email uniqueness across users
  const users = await db.read('users.json');
  if (users.some(u => u.email.toLowerCase() === email.toLowerCase())) {
    return res.status(409).json({ message: 'Email already in use' });
  }

  // Create teacher record (ID generated by db.add)
  const teacherRecord = {
    fullName,
    email,
    contactNumber: contactNumber || '',
    departmentId,
    designation,
    subjectsTaught: subjectsTaught || [],
    assignedClassrooms: assignedClassrooms || [],
    profileImage: profileImage || null,
    active: true,
    createdAt: new Date().toISOString(),
  };
  const newTeacher = await db.add('teachers.json', teacherRecord);

  // Create linked user account (role: teacher)
  const passwordHash = await bcrypt.hash(password || 'ChangeMe123', 12);
  const userRecord = {
    email,
    passwordHash,
    role: 'teacher',
    teacherId: newTeacher.id,
    active: true,
    createdAt: new Date().toISOString(),
  };
  await db.add('users.json', userRecord);

  res.status(201).json({ teacher: newTeacher, userId: userRecord.id });
});

// Update teacher details (admin only)
app.put('/api/admin/teachers/:id', authenticate, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const patch = req.body;

  // Prevent email change that would duplicate another user email
  if (patch.email) {
    const users = await db.read('users.json');
    const conflict = users.find(u => u.email.toLowerCase() === patch.email.toLowerCase() && u.teacherId !== id);
    if (conflict) {
      return res.status(409).json({ message: 'Email already in use by another account' });
    }
  }

  const updatedTeacher = await db.update('teachers.json', id, patch);
  if (!updatedTeacher) return res.status(404).json({ message: 'Teacher not found' });

  // Keep user email in sync if changed
  if (patch.email) {
    const users = await db.read('users.json');
    const user = users.find(u => u.teacherId === id);
    if (user) {
      await db.update('users.json', user.id, { email: patch.email });
    }
  }

  res.json(updatedTeacher);
});

// Deactivate (soft delete) a teacher – keep record for historical data
app.delete('/api/admin/teachers/:id', authenticate, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const teacher = await db.getById('teachers.json', id);
  if (!teacher) return res.status(404).json({ message: 'Teacher not found' });

  // Mark as inactive
  await db.update('teachers.json', id, { active: false });

  // Optionally deactivate linked user account (prevent login)
  const users = await db.read('users.json');
  const user = users.find(u => u.teacherId === id);
  if (user) {
    await db.update('users.json', user.id, { active: false });
  }

  res.json({ message: 'Teacher deactivated' });
});

app.get('/api/teacher/timetable', authenticate, requireRole('teacher'), async (req, res) => {
  const { id: userId } = req.user;
  const users = await db.read('users.json');
  const user = users.find(u => u.id === userId);
  if (!user || !user.teacherId) return res.status(404).json({ message: 'Teacher profile not found' });
  const teacherId = user.teacherId;
  const tt = await db.find('timetable.json', r => r.teacherId === teacherId && r.active !== false);
  res.json(tt);
});

app.get('/api/student/dashboard', authenticate, requireRole('student'), handleAsync(getDashboard));

app.post('/api/student/lab-requests', authenticate, requireRole('student'), handleAsync(createLabRequest));

app.patch('/api/student/notifications/:id', authenticate, requireRole('student'), handleAsync(markNotificationRead));

app.get('/api/student/classrooms/options', authenticate, requireRole('student'), handleAsync(async (req, res) => {
  const rooms = await db.read('classrooms.json');
  const activeRooms = rooms.filter((room) => room.active !== false);
  const buildings = [...new Set(activeRooms.map((room) => String(room.building || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  const floors = [...new Set(activeRooms
    .map((room) => room.floorNumber ?? room.floor)
    .filter((floor) => floor !== undefined && floor !== null && String(floor).trim() !== '')
    .map(String))].sort((a, b) => Number(a) - Number(b));
  res.json({ buildings, floors });
}));

app.post('/api/student/classrooms/search', authenticate, requireRole('student'), handleAsync(async (req, res) => {
  const validation = validateClassroomSearch(req.body);
  if (validation.error) return res.status(400).json({ message: validation.error });
  const filters = validation.value;
  const [rooms, timetable, reservations, maintenance] = await Promise.all([
    db.read('classrooms.json'),
    db.read('timetable.json'),
    db.read('classroom_reservations.json'),
    db.read('classroom_maintenance.json'),
  ]);
  const available = findAvailableClassrooms({ rooms, timetable, reservations, maintenance, ...filters });
  res.json({ classrooms: available });
}));

app.post('/api/student/classroom-reservations', authenticate, requireRole('student'), handleAsync(async (req, res) => {
  const { classroomId } = req.body || {};
  if (typeof classroomId !== 'string' || !classroomId.trim() || classroomId.length > 120) {
    return res.status(400).json({ message: 'Choose a valid classroom.' });
  }
  const validation = validateClassroomSearch({ ...req.body, minCapacity: 1 });
  if (validation.error) return res.status(400).json({ message: validation.error });
  const filters = validation.value;
  const [rooms, timetable, maintenance] = await Promise.all([
    db.read('classrooms.json'),
    db.read('timetable.json'),
    db.read('classroom_maintenance.json'),
  ]);
  const available = findAvailableClassrooms({
    rooms,
    timetable,
    reservations: [],
    maintenance,
    ...filters,
  }).some((room) => room.id === classroomId);
  if (!available) return res.status(409).json({ message: 'This classroom is no longer available for that time.' });

  const reservation = {
    classroomId,
    studentId: req.user.id,
    date: filters.date,
    startTime: filters.startTime,
    endTime: filters.endTime,
    status: 'confirmed',
    createdAt: new Date().toISOString(),
  };
  const result = await db.addIf(
    'classroom_reservations.json',
    reservation,
    (existing) => reservationOverlaps(existing, { ...reservation, weekday: filters.weekday }),
  );
  if (!result.inserted) return res.status(409).json({ message: 'Another student has reserved this classroom for an overlapping time.' });
  res.status(201).json(result.record);
}));

app.get('/api/student/free-classrooms', authenticate, requireRole('student'), async (req, res) => {
  const rooms = await db.read('classrooms.json');
  res.json(rooms);
});

// Get list of departments (admin use – also needed for teacher form dropdown)
app.get('/api/admin/departments', authenticate, requireRole('admin'), async (req, res) => {
  const departments = await db.read('departments.json');
  res.json(departments);
});

app.get('/api/admin/classrooms', authenticate, requireRole('admin'), async (req, res) => {
  const classrooms = await db.read('classrooms.json');
  res.json(classrooms);
});

// Admin: Manage any teacher's timetable (full CRUD)
app.get('/api/admin/timetable', authenticate, requireRole('admin'), async (req, res) => {
  const all = await db.read('timetable.json');
  res.json(all);
});

app.post('/api/admin/timetable', authenticate, requireRole('admin'), async (req, res) => {
  const {
    teacherId,
    subjectName,
    subjectCode,
    departmentId,
    classOrSemester,
    section,
    day,
    startTime,
    endTime,
    building,
    floor,
    classroomNumber,
    classroomId,
  } = req.body;
  if (!teacherId || !subjectName || !subjectCode || !departmentId || !day || !startTime || !endTime || !classroomId) {
    return res.status(400).json({ message: 'Missing required fields' });
  }
  if (new Date(`1970-01-01T${endTime}`) <= new Date(`1970-01-01T${startTime}`)) {
    return res.status(400).json({ message: 'End time must be after start time' });
  }
  const allEntries = await db.read('timetable.json');
  const overlap = allEntries.some(e => {
    if (e.active === false) return false;
    const sameDay = e.day === day;
    const timeOverlap =
      (new Date(`1970-01-01T${e.startTime}`) < new Date(`1970-01-01T${endTime}`)) &&
      (new Date(`1970-01-01T${e.endTime}`) > new Date(`1970-01-01T${startTime}`));
    if (!sameDay || !timeOverlap) return false;
    if (e.teacherId === teacherId) return true;
    if (e.classroomId === classroomId) return true;
    return false;
  });
  if (overlap) return res.status(409).json({ message: 'Schedule conflict' });
  const record = {
    teacherId,
    subjectName,
    subjectCode,
    departmentId,
    classOrSemester,
    section,
    day,
    startTime,
    endTime,
    building,
    floor,
    classroomNumber,
    classroomId,
    active: true,
    createdAt: new Date().toISOString(),
  };
  const newEntry = await db.add('timetable.json', record);
  res.status(201).json(newEntry);
});

app.put('/api/admin/timetable/:entryId', authenticate, requireRole('admin'), async (req, res) => {
  const { entryId } = req.params;
  const existing = await db.getById('timetable.json', entryId);
  if (!existing) return res.status(404).json({ message: 'Entry not found' });
  const {
    teacherId,
    subjectName,
    subjectCode,
    departmentId,
    classOrSemester,
    section,
    day,
    startTime,
    endTime,
    building,
    floor,
    classroomNumber,
    classroomId,
  } = req.body;
  if (startTime && endTime && new Date(`1970-01-01T${endTime}`) <= new Date(`1970-01-01T${startTime}`)) {
    return res.status(400).json({ message: 'End time must be after start time' });
  }
  const allEntries = await db.read('timetable.json');
  const overlap = allEntries.some(e => {
    if (e.id === entryId || e.active === false) return false;
    const sameDay = (day || e.day) === e.day;
    const s = startTime || e.startTime;
    const eTime = endTime || e.endTime;
    const timeOverlap =
      (new Date(`1970-01-01T${e.startTime}`) < new Date(`1970-01-01T${eTime}`)) &&
      (new Date(`1970-01-01T${e.endTime}`) > new Date(`1970-01-01T${s}`));
    if (!sameDay || !timeOverlap) return false;
    if ((teacherId && e.teacherId === teacherId) || (classroomId && e.classroomId === classroomId)) return true;
    return false;
  });
  if (overlap) return res.status(409).json({ message: 'Schedule conflict' });

  const patch = {
    teacherId,
    subjectName,
    subjectCode,
    departmentId,
    classOrSemester,
    section,
    day,
    startTime,
    endTime,
    building,
    floor,
    classroomNumber,
    classroomId,
    updatedAt: new Date().toISOString(),
  };
  const updated = await db.update('timetable.json', entryId, patch);
  res.json(updated);
});

app.delete('/api/admin/timetable/:entryId', authenticate, requireRole('admin'), async (req, res) => {
  const { entryId } = req.params;
  const existing = await db.getById('timetable.json', entryId);
  if (!existing) return res.status(404).json({ message: 'Entry not found' });
  await db.update('timetable.json', entryId, { active: false, deletedAt: new Date().toISOString() });
  res.json({ message: 'Entry deactivated' });
});



app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
