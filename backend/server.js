// backend/server.js (updated with admin dashboard APIs)

import express from 'express';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
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
import {
  isValidDateKey as isValidComputerLabDate,
  minuteOfDay as computerLabMinuteOfDay,
  overlaps as computerLabOverlaps,
  reservationConflicts,
  reservesComputer,
} from './services/computerLabs.js';
import {
  isComputerUnderMaintenance,
  isLabUnderMaintenance,
  isClassroomUnderMaintenance,
  validateMaintenanceInput,
  getMaintenanceStatus,
  maintenanceConflictsWithReservation,
  maintenanceOverlapsWithExisting,
} from './services/labMaintenance.js';
import {
  validateUnifiedSearch,
  searchUnifiedResources,
} from './services/unifiedSearch.js';
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

/** Health check endpoint */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'CampusSpace API',
  });
});

/** Helper: generate JWT */
function generateToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

/** Middleware: verify JWT and attach user */
async function authenticate(req, res, next) {
  let token = req.cookies?.token;
  if (!token && typeof req.headers.authorization === 'string' && req.headers.authorization.startsWith('Bearer ')) {
    token = req.headers.authorization.slice(7).trim();
  }
  if (!token) return res.status(401).json({ message: 'Authentication required' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (!payload || !payload.id) {
      return res.status(401).json({ message: 'Invalid or expired token' });
    }
    const users = await db.read('users.json');
    const user = Array.isArray(users) ? users.find((u) => u && u.id === payload.id) : null;
    if (!user || user.active === false) {
      return res.status(401).json({ message: 'Account not found or deactivated' });
    }
    if (user.role === 'student') {
      const students = await db.read('students.json');
      const student = Array.isArray(students)
        ? students.find(
            (s) =>
              s &&
              (s.id === user.studentId ||
                s.userId === user.id ||
                (s.email && user.email && s.email.toLowerCase() === user.email.toLowerCase()))
          )
        : null;
      if (student && student.active === false) {
        return res.status(401).json({ message: 'Account not found or deactivated' });
      }
    }
    req.user = { id: user.id, role: user.role, email: user.email };
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

function validateComputerLabTime(input) {
  let { date, startTime, endTime, timeSlot } = input || {};
  if ((!startTime || !endTime) && typeof timeSlot === 'string') {
    const parts = timeSlot.split(/[-–]/).map(s => s.trim());
    if (parts.length === 2) {
      startTime = parts[0];
      endTime = parts[1];
    }
  }
  const start = computerLabMinuteOfDay(startTime);
  const end = computerLabMinuteOfDay(endTime);
  const now = new Date();
  const today = localDateKey(now);
  if (!isValidComputerLabDate(date) || date < today) {
    return { error: 'Choose a valid date that is today or later.' };
  }
  if (start === null || end === null || start >= end) {
    return { error: 'Enter valid 24-hour times, with the end time after the start time.' };
  }
  if (date === today && start <= now.getHours() * 60 + now.getMinutes()) {
    return { error: 'Choose a start time that has not passed.' };
  }
  return { value: { date, startTime, endTime } };
}

async function getComputerLabStudent(user) {
  const [students, users] = await Promise.all([db.read('students.json'), db.read('users.json')]);
  const account = users.find((item) => item.id === user.id);
  const student = students.find((item) =>
    item.id === account?.studentId ||
    item.userId === user.id ||
    (item.email && item.email.toLowerCase() === String(user.email || '').toLowerCase())
  );
  return {
    studentId: student?.studentId || student?.rollNumber || account?.studentId || user.id,
    name: student?.fullName || student?.name || '',
  };
}

function activeComputerLab(lab) {
  return lab.active !== false;
}

function isComputerLabBooking(booking) {
  return booking.active !== false && reservesComputer(booking);
}

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
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }
  const users = await db.read('users.json');
  if (!Array.isArray(users)) {
    return res.status(500).json({ message: 'User database unavailable' });
  }
  const cleanEmail = email.trim().toLowerCase();
  const user = users.find(u => u && typeof u.email === 'string' && u.email.toLowerCase() === cleanEmail);
  if (!user || typeof user.passwordHash !== 'string' || !user.passwordHash) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }
  if (user.active === false) {
    return res.status(403).json({ message: 'Account is deactivated' });
  }
  if (user.role === 'student') {
    const students = await db.read('students.json');
    if (Array.isArray(students)) {
      const student = students.find(
        (s) =>
          s &&
          (s.id === user.studentId ||
            s.userId === user.id ||
            (s.email && s.email.toLowerCase() === cleanEmail))
      );
      if (student && student.active === false) {
        return res.status(403).json({ message: 'Account is deactivated' });
      }
    }
  }
  let match = false;
  try {
    match = await bcrypt.compare(password, user.passwordHash);
  } catch (_) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }
  if (!match) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }
  const token = generateToken({ id: user.id, role: user.role, email: user.email });
  res.cookie('token', token, { httpOnly: true, sameSite: 'lax' });
  res.json({ message: 'Login successful', role: user.role, email: user.email });
});

/** Current user endpoint */
app.get('/api/auth/me', authenticate, (req, res) => {
  res.json({ user: req.user });
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
  const createdUser = await db.add('users.json', userRecord);

  res.status(201).json({ teacher: newTeacher, userId: createdUser.id });
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

app.get('/api/student/computer-labs', authenticate, requireRole('student'), handleAsync(async (req, res) => {
  const hasTimeFilter = ['date', 'startTime', 'endTime'].some((key) => req.query[key] !== undefined);
  let slot = null;
  if (hasTimeFilter) {
    const validation = validateComputerLabTime(req.query);
    if (validation.error) return res.status(400).json({ message: validation.error });
    slot = validation.value;
  }
  const [laboratories, bookings, profile, maintenance] = await Promise.all([
    db.read('laboratories.json'),
    db.read('lab_bookings.json'),
    getComputerLabStudent(req.user),
    db.read('maintenance.json'),
  ]);
  const labs = laboratories.filter(activeComputerLab).map((lab) => {
    const computers = Array.isArray(lab.computers) ? lab.computers : Array.isArray(lab.pcs) ? lab.pcs : [];
    return {
      ...lab,
      category: lab.category || lab.type || 'LPC',
      computers: computers.filter((computer) => computer.active !== false).map((computer) => {
        const inMaintenance = slot && isComputerUnderMaintenance(computer.id, lab.id, slot, maintenance);
        const reservation = slot && !inMaintenance && bookings.find((booking) =>
          isComputerLabBooking(booking) &&
          booking.labId === lab.id &&
          booking.computerId === computer.id &&
          computerLabOverlaps(booking, slot)
        );
        return {
          ...computer,
          availability: slot ? (inMaintenance ? 'maintenance' : (reservation ? 'occupied' : 'available')) : 'unknown',
        };
      }),
    };
  });
  res.json({ labs, profile });
}));

app.get('/api/student/computer-lab-requests', authenticate, requireRole('student'), handleAsync(async (req, res) => {
  const [bookings, laboratories] = await Promise.all([
    db.read('lab_bookings.json'),
    db.read('laboratories.json'),
  ]);
  const labNames = new Map(laboratories.map((lab) => [lab.id, lab.name]));
  const records = bookings
    .filter((booking) => booking.userId === req.user.id)
    .map((booking) => ({ ...booking, labName: booking.labName || labNames.get(booking.labId) || 'Computer lab' }))
    .sort((first, second) => String(second.createdAt || '').localeCompare(String(first.createdAt || '')));
  res.json({ requests: records });
}));

app.post('/api/student/computer-lab-bookings', authenticate, requireRole('student'), handleAsync(async (req, res) => {
  const { labId, computerId } = req.body || {};
  const validation = validateComputerLabTime(req.body);
  if (validation.error) return res.status(400).json({ message: validation.error });
  if (typeof labId !== 'string' || !labId.trim() || typeof computerId !== 'string' || !computerId.trim()) {
    return res.status(400).json({ message: 'Choose a laboratory and an available computer.' });
  }
  const [laboratories, profile, maintenance] = await Promise.all([
    db.read('laboratories.json'),
    getComputerLabStudent(req.user),
    db.read('maintenance.json'),
  ]);
  const lab = laboratories.find((item) => item.id === labId && activeComputerLab(item));
  if (!lab) return res.status(404).json({ message: 'Computer laboratory not found.' });
  if ((lab.category || lab.type || 'LPC') !== 'LPC') {
    return res.status(400).json({ message: 'High Performance Computing Lab bookings must be submitted as a request.' });
  }
  const computers = Array.isArray(lab.computers) ? lab.computers : Array.isArray(lab.pcs) ? lab.pcs : [];
  const computer = computers.find((item) => item.id === computerId && item.active !== false);
  if (!computer) return res.status(404).json({ message: 'Computer not found in this laboratory.' });

  if (isComputerUnderMaintenance(computer.id, lab.id, validation.value, maintenance)) {
    return res.status(409).json({ message: 'That computer is currently scheduled for maintenance during the requested time.' });
  }
  const reservation = {
    labId: lab.id,
    labName: lab.name || 'Computer laboratory',
    category: 'LPC',
    computerId: computer.id,
    computerName: computer.name || computer.label || 'Computer',
    userId: req.user.id,
    studentId: profile.studentId,
    studentName: profile.name,
    ...validation.value,
    status: 'confirmed',
    createdAt: new Date().toISOString(),
  };
  const result = await db.addIf(
    'lab_bookings.json',
    reservation,
    (existing) => isComputerLabBooking(existing) && reservationConflicts(existing, reservation),
  );
  if (!result.inserted) return res.status(409).json({ message: 'That computer has already been booked for an overlapping time. Check availability again.' });
  res.status(201).json({ booking: result.record });
}));

app.post('/api/student/computer-lab-requests', authenticate, requireRole('student'), handleAsync(async (req, res) => {
  const { labId, studentId, name, purpose } = req.body || {};
  const validation = validateComputerLabTime(req.body);
  if (validation.error) return res.status(400).json({ message: validation.error });
  if (
    typeof labId !== 'string' || !labId.trim() ||
    typeof studentId !== 'string' || !studentId.trim() || studentId.length > 120 ||
    typeof name !== 'string' || !name.trim() || name.trim().length > 120 ||
    typeof purpose !== 'string' || !purpose.trim() || purpose.trim().length > 500
  ) {
    return res.status(400).json({ message: 'Student ID, name, laboratory, date, start and end times, and purpose are required.' });
  }
  const [laboratories, profile] = await Promise.all([
    db.read('laboratories.json'),
    getComputerLabStudent(req.user),
  ]);
  if (profile.studentId && studentId.trim() !== profile.studentId) {
    return res.status(403).json({ message: 'Student ID must match your CampusSpace profile.' });
  }
  if (profile.name && name.trim().toLowerCase() !== profile.name.trim().toLowerCase()) {
    return res.status(403).json({ message: 'Name must match your CampusSpace profile.' });
  }
  const lab = laboratories.find((item) => item.id === labId && activeComputerLab(item));
  if (!lab) return res.status(404).json({ message: 'Computer laboratory not found.' });
  if ((lab.category || lab.type) !== 'HPC') {
    return res.status(400).json({ message: 'Choose a High Performance Computing Lab for an approval request.' });
  }
  const request = await db.add('lab_bookings.json', {
    labId: lab.id,
    labName: lab.name || 'Computer laboratory',
    category: 'HPC',
    userId: req.user.id,
    studentId: profile.studentId || studentId.trim(),
    studentName: profile.name || name.trim(),
    ...validation.value,
    purpose: purpose.trim(),
    status: 'pending',
    sentTo: 'Lab Head/Admin',
    createdAt: new Date().toISOString(),
  });
  res.status(201).json({ request });
}));

app.get('/api/admin/computer-labs', authenticate, requireRole('admin'), handleAsync(async (req, res) => {
  const hasTimeFilter = ['date', 'startTime', 'endTime'].some((key) => req.query[key] !== undefined);
  let slot = null;
  if (hasTimeFilter) {
    const validation = validateComputerLabTime(req.query);
    if (validation.error) return res.status(400).json({ message: validation.error });
    slot = validation.value;
  }
  const [laboratories, bookings, maintenance] = await Promise.all([
    db.read('laboratories.json'),
    db.read('lab_bookings.json'),
    db.read('maintenance.json'),
  ]);
  const labs = laboratories.map((lab) => {
    const computers = Array.isArray(lab.computers) ? lab.computers : Array.isArray(lab.pcs) ? lab.pcs : [];
    const activeComputers = computers.filter((computer) => computer.active !== false).map((computer) => {
      const inMaintenance = slot && isComputerUnderMaintenance(computer.id, lab.id, slot, maintenance);
      const reservation = slot && !inMaintenance && bookings.find((booking) =>
        isComputerLabBooking(booking) &&
        booking.labId === lab.id &&
        booking.computerId === computer.id &&
        computerLabOverlaps(booking, slot)
      );
      return {
        ...computer,
        availability: slot ? (inMaintenance ? 'maintenance' : (reservation ? 'occupied' : 'available')) : 'unknown',
      };
    });
    const occupied = activeComputers.filter((computer) => computer.availability === 'occupied' || computer.availability === 'maintenance').length;
    return {
      ...lab,
      category: lab.category || lab.type || 'LPC',
      computers: activeComputers,
      utilization: slot ? { occupied, available: activeComputers.length - occupied, total: activeComputers.length } : null,
    };
  });
  const labNames = new Map(laboratories.map((lab) => [lab.id, lab.name]));
  const requests = bookings
    .filter((booking) => booking.category === 'HPC')
    .map((booking) => ({ ...booking, labName: booking.labName || labNames.get(booking.labId) || 'Computer lab' }))
    .sort((first, second) => String(second.createdAt || '').localeCompare(String(first.createdAt || '')));
  res.json({ labs, requests });
}));

app.post('/api/admin/computer-labs', authenticate, requireRole('admin'), handleAsync(async (req, res) => {
  const { name, category, building, room, description } = req.body || {};
  if (
    typeof name !== 'string' || !name.trim() || name.trim().length > 120 ||
    !['LPC', 'HPC'].includes(category) ||
    typeof building !== 'string' || !building.trim() || building.trim().length > 120 ||
    (room !== undefined && (typeof room !== 'string' || room.length > 80)) ||
    (description !== undefined && (typeof description !== 'string' || description.length > 500))
  ) {
    return res.status(400).json({ message: 'Enter a lab name, LPC/HPC category, and building. Optional details must be within the allowed length.' });
  }
  const laboratory = await db.add('laboratories.json', {
    name: name.trim(),
    category,
    building: building.trim(),
    room: String(room || '').trim(),
    description: String(description || '').trim(),
    computers: [],
    active: true,
    createdAt: new Date().toISOString(),
  });
  res.status(201).json({ lab: laboratory });
}));

app.put('/api/admin/computer-labs/:id', authenticate, requireRole('admin'), handleAsync(async (req, res) => {
  const { name, category, building, room, description } = req.body || {};
  if (
    typeof name !== 'string' || !name.trim() || name.trim().length > 120 ||
    !['LPC', 'HPC'].includes(category) ||
    typeof building !== 'string' || !building.trim() || building.trim().length > 120 ||
    (room !== undefined && (typeof room !== 'string' || room.length > 80)) ||
    (description !== undefined && (typeof description !== 'string' || description.length > 500))
  ) {
    return res.status(400).json({ message: 'Enter a lab name, LPC/HPC category, and building. Optional details must be within the allowed length.' });
  }
  const laboratory = await db.getById('laboratories.json', req.params.id);
  if (!laboratory) return res.status(404).json({ message: 'Computer laboratory not found.' });
  if (category !== (laboratory.category || laboratory.type || 'LPC')) {
    const bookings = await db.read('lab_bookings.json');
    if (bookings.some((booking) => booking.labId === laboratory.id && booking.status !== 'rejected')) {
      return res.status(409).json({ message: 'The lab category cannot change while it has booking history.' });
    }
  }
  const updated = await db.update('laboratories.json', laboratory.id, {
    name: name.trim(),
    category,
    building: building.trim(),
    room: String(room || '').trim(),
    description: String(description || '').trim(),
    updatedAt: new Date().toISOString(),
  });
  res.json({ lab: updated });
}));

app.delete('/api/admin/computer-labs/:id', authenticate, requireRole('admin'), handleAsync(async (req, res) => {
  const laboratory = await db.getById('laboratories.json', req.params.id);
  if (!laboratory) return res.status(404).json({ message: 'Computer laboratory not found.' });
  const bookings = await db.read('lab_bookings.json');
  const today = localDateKey(new Date());
  const hasUpcomingActivity = bookings.some((booking) =>
    booking.labId === laboratory.id && booking.date >= today &&
    (isComputerLabBooking(booking) || String(booking.status).toLowerCase() === 'pending')
  );
  if (hasUpcomingActivity) return res.status(409).json({ message: 'Resolve pending requests and future reservations before removing this lab.' });
  await db.update('laboratories.json', laboratory.id, { active: false, deletedAt: new Date().toISOString() });
  res.json({ message: 'Laboratory removed.' });
}));

app.post('/api/admin/computer-labs/:id/computers', authenticate, requireRole('admin'), handleAsync(async (req, res) => {
  const { name } = req.body || {};
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 80) {
    return res.status(400).json({ message: 'Enter a computer name up to 80 characters.' });
  }
  const lab = await db.getById('laboratories.json', req.params.id);
  if (!lab || !activeComputerLab(lab)) return res.status(404).json({ message: 'Computer laboratory not found.' });
  const computer = { id: db.generateId(), name: name.trim(), active: true };
  const updated = await db.mutate('laboratories.json', (laboratories) => {
    const current = laboratories.find((item) => item.id === lab.id);
    if (!current || !activeComputerLab(current)) return { changed: false, value: null };
    const computers = Array.isArray(current.computers) ? current.computers : Array.isArray(current.pcs) ? current.pcs : [];
    if (computers.some((item) => item.active !== false && item.name.toLowerCase() === computer.name.toLowerCase())) {
      return { changed: false, value: { duplicate: true } };
    }
    current.computers = [...computers, computer];
    delete current.pcs;
    return { changed: true, value: current };
  });
  if (!updated) return res.status(404).json({ message: 'Computer laboratory not found.' });
  if (updated.duplicate) return res.status(409).json({ message: 'A computer with that name already exists in this laboratory.' });
  res.status(201).json({ computer, lab: updated });
}));

app.delete('/api/admin/computer-labs/:id/computers/:computerId', authenticate, requireRole('admin'), handleAsync(async (req, res) => {
  const lab = await db.getById('laboratories.json', req.params.id);
  if (!lab) return res.status(404).json({ message: 'Computer laboratory not found.' });
  const computer = (Array.isArray(lab.computers) ? lab.computers : Array.isArray(lab.pcs) ? lab.pcs : [])
    .find((item) => item.id === req.params.computerId && item.active !== false);
  if (!computer) return res.status(404).json({ message: 'Computer not found.' });
  const bookings = await db.read('lab_bookings.json');
  const today = localDateKey(new Date());
  if (bookings.some((booking) => booking.labId === lab.id && booking.computerId === computer.id &&
      booking.date >= today && isComputerLabBooking(booking))) {
    return res.status(409).json({ message: 'This computer has a future reservation and cannot be removed yet.' });
  }
  const updated = await db.mutate('laboratories.json', (laboratories) => {
    const current = laboratories.find((item) => item.id === lab.id);
    const computers = current && (Array.isArray(current.computers) ? current.computers : Array.isArray(current.pcs) ? current.pcs : []);
    const index = computers ? computers.findIndex((item) => item.id === computer.id && item.active !== false) : -1;
    if (index < 0) return { changed: false, value: null };
    computers[index] = { ...computers[index], active: false };
    current.computers = computers;
    delete current.pcs;
    return { changed: true, value: current };
  });
  if (!updated) return res.status(404).json({ message: 'Computer not found.' });
  res.json({ lab: updated });
}));

app.post('/api/admin/computer-lab-requests/:id/decision', authenticate, requireRole('admin'), handleAsync(async (req, res) => {
  const { decision, computerId } = req.body || {};
  if (!['approved', 'rejected'].includes(decision)) {
    return res.status(400).json({ message: 'Choose approve or reject.' });
  }
  const request = await db.getById('lab_bookings.json', req.params.id);
  if (!request || request.category !== 'HPC') return res.status(404).json({ message: 'High Performance Lab request not found.' });
  if (String(request.status).toLowerCase() !== 'pending') {
    return res.status(409).json({ message: 'This request has already been reviewed.' });
  }
  if (decision === 'rejected') {
    const result = await db.mutate('lab_bookings.json', (bookings) => {
      const current = bookings.find((booking) => booking.id === request.id);
      if (!current || String(current.status).toLowerCase() !== 'pending') {
        return { changed: false, value: { error: 'This request has already been reviewed.' } };
      }
      Object.assign(current, { status: 'rejected', reviewedBy: req.user.id, reviewedAt: new Date().toISOString() });
      return { changed: true, value: { request: current } };
    });
    if (result.error) return res.status(409).json({ message: result.error });
    return res.json({ request: result.request });
  }
  const timeValidation = validateComputerLabTime(request);
  if (timeValidation.error) return res.status(409).json({ message: 'The requested time has passed and cannot be approved.' });
  const [lab, maintenance] = await Promise.all([
    db.getById('laboratories.json', request.labId),
    db.read('maintenance.json'),
  ]);
  if (!lab || !activeComputerLab(lab)) return res.status(409).json({ message: 'This laboratory is no longer active.' });
  if (isLabUnderMaintenance(lab.id, request, maintenance)) {
    return res.status(409).json({ message: 'This laboratory is under maintenance during the requested time.' });
  }
  const computers = Array.isArray(lab.computers) ? lab.computers : Array.isArray(lab.pcs) ? lab.pcs : [];
  const specifiedComputer = computerId ? computers.find((item) => item.id === computerId && item.active !== false) : null;
  if (computerId && !specifiedComputer) return res.status(400).json({ message: 'Choose an active computer in this laboratory.' });
  if (specifiedComputer && isComputerUnderMaintenance(specifiedComputer.id, lab.id, request, maintenance)) {
    return res.status(409).json({ message: 'That computer is under maintenance during the requested time.' });
  }
  const result = await db.mutate('lab_bookings.json', (bookings) => {
    const current = bookings.find((booking) => booking.id === request.id);
    if (!current || String(current.status).toLowerCase() !== 'pending') {
      return { changed: false, value: { error: 'This request has already been reviewed.' } };
    }
    const availableComputer = (specifiedComputer ? [specifiedComputer] : computers.filter((item) => item.active !== false))
      .find((computer) =>
        !isComputerUnderMaintenance(computer.id, lab.id, request, maintenance) &&
        !bookings.some((booking) =>
          booking.id !== current.id &&
          isComputerLabBooking(booking) &&
          reservationConflicts(booking, { ...current, computerId: computer.id })
        )
      );
    if (!availableComputer) {
      return { changed: false, value: { error: 'No computer is available for this request time due to reservations or maintenance.', conflict: true } };
    }
    Object.assign(current, {
      status: 'approved',
      computerId: availableComputer.id,
      computerName: availableComputer.name || availableComputer.label || 'Computer',
      reviewedBy: req.user.id,
      reviewedAt: new Date().toISOString(),
    });
    return { changed: true, value: { request: current } };
  });
  if (result.error) return res.status(409).json({ message: result.error });
  res.json({ request: result.request });
}));

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
  const [rooms, timetable, reservations, classroomMaintenance, generalMaintenance] = await Promise.all([
    db.read('classrooms.json'),
    db.read('timetable.json'),
    db.read('classroom_reservations.json'),
    db.read('classroom_maintenance.json'),
    db.read('maintenance.json'),
  ]);
  const maintenance = [
    ...(Array.isArray(classroomMaintenance) ? classroomMaintenance : []),
    ...(Array.isArray(generalMaintenance) ? generalMaintenance.filter(m => m.type === 'classroom') : []),
  ];
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
  const [rooms, timetable, classroomMaintenance, generalMaintenance] = await Promise.all([
    db.read('classrooms.json'),
    db.read('timetable.json'),
    db.read('classroom_maintenance.json'),
    db.read('maintenance.json'),
  ]);
  const maintenance = [
    ...(Array.isArray(classroomMaintenance) ? classroomMaintenance : []),
    ...(Array.isArray(generalMaintenance) ? generalMaintenance.filter(m => m.type === 'classroom') : []),
  ];
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

/** Unified Resource Search Options */
app.get('/api/student/resources/options', authenticate, handleAsync(async (req, res) => {
  const [classrooms, laboratories] = await Promise.all([
    db.read('classrooms.json'),
    db.read('laboratories.json'),
  ]);
  const buildings = new Set();
  const floors = new Set();
  const facilities = new Set();

  for (const room of classrooms) {
    if (room.building) buildings.add(room.building);
    const floor = room.floorNumber ?? room.floor;
    if (floor !== null && floor !== undefined) floors.add(String(floor));
    const facs = room.facilities || room.resources || [];
    for (const f of (Array.isArray(facs) ? facs : [facs]).filter(Boolean)) facilities.add(f);
  }

  for (const lab of laboratories) {
    if (lab.building) buildings.add(lab.building);
    const floor = lab.floor;
    if (floor !== null && floor !== undefined) floors.add(String(floor));
    const eq = lab.equipment || lab.resources || [];
    for (const e of (Array.isArray(eq) ? eq : [eq]).filter(Boolean)) facilities.add(e);
  }

  res.json({
    resourceTypes: [
      { id: 'all', label: 'All Resource Types' },
      { id: 'classroom', label: 'Classrooms' },
      { id: 'computer_lab', label: 'Computer Laboratories' },
      { id: 'computer', label: 'Individual Workstations' },
    ],
    buildings: [...buildings].sort((a, b) => a.localeCompare(b)),
    floors: [...floors].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    facilities: [...facilities].sort((a, b) => a.localeCompare(b)),
  });
}));

/** Unified Resource Search Handler */
async function handleUnifiedResourceSearch(req, res) {
  const input = req.method === 'GET' ? req.query : req.body;
  const validation = validateUnifiedSearch(input);
  if (validation.error) return res.status(400).json({ message: validation.error });

  const [classrooms, timetable, classroomReservations, classroomMaintenance, generalMaintenance, laboratories, labBookings] = await Promise.all([
    db.read('classrooms.json'),
    db.read('timetable.json'),
    db.read('classroom_reservations.json'),
    db.read('classroom_maintenance.json'),
    db.read('maintenance.json'),
    db.read('laboratories.json'),
    db.read('lab_bookings.json'),
  ]);

  const results = searchUnifiedResources({
    criteria: validation.value,
    classrooms,
    timetable,
    classroomReservations,
    classroomMaintenance,
    maintenance: generalMaintenance,
    laboratories,
    labBookings,
  });

  res.json({
    resources: results,
    total: results.length,
    criteria: validation.value,
  });
}

app.get('/api/student/resources/search', authenticate, handleAsync(handleUnifiedResourceSearch));
app.post('/api/student/resources/search', authenticate, handleAsync(handleUnifiedResourceSearch));

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

// ---------- Admin: Resource Maintenance APIs ----------

app.get('/api/admin/maintenance', authenticate, requireRole('admin'), handleAsync(async (req, res) => {
  const [maintenanceRecords, laboratories, classrooms] = await Promise.all([
    db.read('maintenance.json'),
    db.read('laboratories.json'),
    db.read('classrooms.json'),
  ]);
  const labById = new Map(laboratories.map((lab) => [lab.id, lab]));
  const classroomById = new Map(classrooms.map((c) => [c.id, c]));

  const now = new Date();
  const enriched = (Array.isArray(maintenanceRecords) ? maintenanceRecords : []).map((record) => {
    let resourceName = 'Unknown resource';
    let subResourceName = null;
    if (record.type === 'lab') {
      const lab = labById.get(record.labId);
      resourceName = lab?.name || 'Laboratory';
      if (record.computerId && record.computerId !== 'all') {
        const pcs = Array.isArray(lab?.computers) ? lab.computers : [];
        const pc = pcs.find((p) => p.id === record.computerId);
        subResourceName = pc ? pc.name : record.computerId;
      } else {
        subResourceName = 'Entire laboratory';
      }
    } else if (record.type === 'classroom') {
      const classroom = classroomById.get(record.classroomId);
      resourceName = classroom ? (classroom.name || `Room ${classroom.classroomNumber || classroom.roomNumber}`) : 'Classroom';
    }
    const computedStatus = getMaintenanceStatus(record, now);
    return {
      ...record,
      resourceName,
      subResourceName,
      status: computedStatus,
    };
  }).sort((a, b) => {
    const aDate = `${a.startDate || a.date} ${a.startTime || ''}`;
    const bDate = `${b.startDate || b.date} ${b.startTime || ''}`;
    return bDate.localeCompare(aDate);
  });

  res.json({ maintenance: enriched });
}));

app.post('/api/admin/maintenance', authenticate, requireRole('admin'), handleAsync(async (req, res) => {
  const validation = validateMaintenanceInput(req.body);
  if (validation.error) return res.status(400).json({ message: validation.error });
  const candidate = validation.value;

  const [laboratories, classrooms, labBookings, classroomReservations, existingMaintenance] = await Promise.all([
    db.read('laboratories.json'),
    db.read('classrooms.json'),
    db.read('lab_bookings.json'),
    db.read('classroom_reservations.json'),
    db.read('maintenance.json'),
  ]);

  let resourceName = '';
  if (candidate.type === 'lab') {
    const lab = laboratories.find((l) => l.id === candidate.labId && activeComputerLab(l));
    if (!lab) return res.status(404).json({ message: 'Computer laboratory not found.' });
    if (candidate.computerId) {
      const pcs = Array.isArray(lab.computers) ? lab.computers : Array.isArray(lab.pcs) ? lab.pcs : [];
      const pc = pcs.find((p) => p.id === candidate.computerId && p.active !== false);
      if (!pc) return res.status(404).json({ message: 'Computer not found in this laboratory.' });
      resourceName = `${lab.name} · ${pc.name}`;
    } else {
      resourceName = `${lab.name} (Entire lab)`;
    }

    const conflictBooking = labBookings.find((booking) =>
      isComputerLabBooking(booking) &&
      maintenanceConflictsWithReservation(candidate, booking)
    );
    if (conflictBooking) {
      return res.status(409).json({
        message: `Cannot schedule maintenance: existing confirmed booking for ${conflictBooking.studentName || 'student'} (${conflictBooking.date} ${conflictBooking.startTime}–${conflictBooking.endTime}) conflicts with this window.`,
        conflict: conflictBooking,
      });
    }
  } else {
    const classroom = classrooms.find((c) => c.id === candidate.classroomId && c.active !== false);
    if (!classroom) return res.status(404).json({ message: 'Classroom not found.' });
    resourceName = classroom.name || `Room ${classroom.classroomNumber || classroom.roomNumber}`;

    const conflictReservation = classroomReservations.find((resItem) =>
      maintenanceConflictsWithReservation(candidate, resItem)
    );
    if (conflictReservation) {
      return res.status(409).json({
        message: `Cannot schedule maintenance: classroom has a confirmed reservation on ${conflictReservation.date} (${conflictReservation.startTime}–${conflictReservation.endTime}).`,
        conflict: conflictReservation,
      });
    }
  }

  if (maintenanceOverlapsWithExisting(candidate, existingMaintenance)) {
    return res.status(409).json({ message: 'An overlapping maintenance record already exists for this resource.' });
  }

  const record = {
    ...candidate,
    resourceName,
    status: 'scheduled',
    active: true,
    createdBy: req.user.id,
    createdAt: new Date().toISOString(),
  };

  const created = await db.add('maintenance.json', record);
  res.status(201).json({ maintenance: created });
}));

app.put('/api/admin/maintenance/:id', authenticate, requireRole('admin'), handleAsync(async (req, res) => {
  const existing = await db.getById('maintenance.json', req.params.id);
  if (!existing) return res.status(404).json({ message: 'Maintenance record not found.' });
  const currentStatus = getMaintenanceStatus(existing, new Date());
  if (currentStatus === 'cancelled' || currentStatus === 'completed') {
    return res.status(409).json({ message: `Cannot modify a ${currentStatus} maintenance record.` });
  }

  const validation = validateMaintenanceInput({ ...existing, ...req.body });
  if (validation.error) return res.status(400).json({ message: validation.error });
  const candidate = validation.value;

  const [laboratories, classrooms, labBookings, classroomReservations, allMaintenance] = await Promise.all([
    db.read('laboratories.json'),
    db.read('classrooms.json'),
    db.read('lab_bookings.json'),
    db.read('classroom_reservations.json'),
    db.read('maintenance.json'),
  ]);

  if (candidate.type === 'lab') {
    const lab = laboratories.find((l) => l.id === candidate.labId && activeComputerLab(l));
    if (!lab) return res.status(404).json({ message: 'Computer laboratory not found.' });
    if (candidate.computerId) {
      const pcs = Array.isArray(lab.computers) ? lab.computers : Array.isArray(lab.pcs) ? lab.pcs : [];
      const pc = pcs.find((p) => p.id === candidate.computerId && p.active !== false);
      if (!pc) return res.status(404).json({ message: 'Computer not found in this laboratory.' });
    }
    const conflictBooking = labBookings.find((booking) =>
      isComputerLabBooking(booking) &&
      maintenanceConflictsWithReservation(candidate, booking)
    );
    if (conflictBooking) {
      return res.status(409).json({
        message: `Cannot update maintenance: conflicting confirmed booking exists on ${conflictBooking.date} (${conflictBooking.startTime}–${conflictBooking.endTime}).`,
      });
    }
  } else {
    const classroom = classrooms.find((c) => c.id === candidate.classroomId && c.active !== false);
    if (!classroom) return res.status(404).json({ message: 'Classroom not found.' });
    const conflictReservation = classroomReservations.find((resItem) =>
      maintenanceConflictsWithReservation(candidate, resItem)
    );
    if (conflictReservation) {
      return res.status(409).json({
        message: `Cannot update maintenance: classroom has a confirmed reservation on ${conflictReservation.date} (${conflictReservation.startTime}–${conflictReservation.endTime}).`,
      });
    }
  }

  if (maintenanceOverlapsWithExisting(candidate, allMaintenance, existing.id)) {
    return res.status(409).json({ message: 'An overlapping maintenance record already exists for this resource.' });
  }

  const updated = await db.update('maintenance.json', existing.id, {
    ...candidate,
    updatedAt: new Date().toISOString(),
    updatedBy: req.user.id,
  });

  res.json({ maintenance: updated });
}));

app.delete('/api/admin/maintenance/:id', authenticate, requireRole('admin'), handleAsync(async (req, res) => {
  const existing = await db.getById('maintenance.json', req.params.id);
  if (!existing) return res.status(404).json({ message: 'Maintenance record not found.' });
  if (existing.status === 'cancelled' || existing.active === false) {
    return res.status(409).json({ message: 'Maintenance record is already cancelled.' });
  }

  const updated = await db.update('maintenance.json', existing.id, {
    status: 'cancelled',
    active: false,
    cancelledAt: new Date().toISOString(),
    cancelledBy: req.user.id,
  });

  res.json({ message: 'Maintenance record cancelled.', maintenance: updated });
}));

app.post('/api/admin/maintenance/:id/cancel', authenticate, requireRole('admin'), handleAsync(async (req, res) => {
  const existing = await db.getById('maintenance.json', req.params.id);
  if (!existing) return res.status(404).json({ message: 'Maintenance record not found.' });
  if (existing.status === 'cancelled' || existing.active === false) {
    return res.status(409).json({ message: 'Maintenance record is already cancelled.' });
  }

  const updated = await db.update('maintenance.json', existing.id, {
    status: 'cancelled',
    active: false,
    cancelledAt: new Date().toISOString(),
    cancelledBy: req.user.id,
  });

  res.json({ message: 'Maintenance record cancelled.', maintenance: updated });
}));



export { app };
export default app;

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMainModule) {
  const server = app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`❌ Port ${PORT} is already in use. Please set PORT=<port> or stop the conflicting process.`);
    } else {
      console.error(`❌ Server startup error:`, err);
    }
    process.exit(1);
  });
}
