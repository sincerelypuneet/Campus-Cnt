// backend/server.js (updated with admin dashboard APIs)

import express from 'express';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import db from './db.js';
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

// Get all teachers (optionally filter by department or search query)
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

app.get('/api/student/free-classrooms', authenticate, requireRole('student'), async (req, res) => {
  const rooms = await db.read('classrooms.json');
  res.json(rooms);
});

// Get list of departments (admin use – also needed for teacher form dropdown)
app.get('/api/admin/departments', authenticate, requireRole('admin'), async (req, res) => {
  const departments = await db.read('departments.json');
  res.json(departments);
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
