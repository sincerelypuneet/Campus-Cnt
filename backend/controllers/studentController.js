import db from '../db.js';

const active = (record) => record.active !== false;
const asList = (value) => Array.isArray(value) ? value : value ? [value] : [];
const minuteOfDay = (value) => {
  const match = /^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i.exec(String(value || '').trim());
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  if (minute > 59 || hour > 24 || hour < 0 || (match[3] && (hour < 1 || hour > 12))) return null;
  if (match[3]) {
    hour %= 12;
    if (match[3].toUpperCase() === 'PM') hour += 12;
  }
  if (hour === 24 && minute !== 0) return null;
  return hour * 60 + minute;
};

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function matchesCurrentTime(entry, day, nowMinutes) {
  if (entry.day !== day) return false;
  const start = minuteOfDay(entry.startTime);
  const end = minuteOfDay(entry.endTime);
  return start !== null && end !== null && start <= nowMinutes && nowMinutes < end;
}

async function getStudentContext(user) {
  const [students, users] = await Promise.all([
    db.read('students.json'),
    db.read('users.json'),
  ]);
  const account = users.find((item) => item.id === user.id);
  const student = students.find((item) =>
    item.id === account?.studentId ||
    item.userId === user.id ||
    (item.email && item.email.toLowerCase() === user.email.toLowerCase())
  );
  const studentId = student?.id || account?.studentId || user.id;
  return { student, studentId };
}

function publicProfile(student, user) {
  return {
    fullName: student?.fullName || student?.name || '',
    studentId: student?.studentId || student?.rollNumber || student?.id || '',
    email: student?.email || user.email || '',
    program: student?.program || student?.course || '',
    semester: student?.semester || '',
    department: student?.department || student?.departmentName || '',
    section: student?.section || '',
    phone: student?.phone || student?.contactNumber || '',
  };
}

export async function getDashboard(request, response) {
  const [teachers, departments, subjects, timetableRecords, classrooms, labs, announcements, bookings, notifications] = await Promise.all([
    db.read('teachers.json'),
    db.read('departments.json'),
    db.read('subjects.json'),
    db.read('timetable.json'),
    db.read('classrooms.json'),
    db.read('laboratories.json'),
    db.read('announcements.json'),
    db.read('lab_bookings.json'),
    db.read('notifications.json'),
  ]);
  const { student, studentId } = await getStudentContext(request.user);
  const departmentById = new Map(departments.map((item) => [item.id, item.name]));
  const subjectById = new Map(subjects.map((item) => [item.id, item.name]));
  const visibleTeachers = teachers.filter(active);
  const teacherById = new Map(visibleTeachers.map((teacher) => [teacher.id, teacher]));
  const timetable = timetableRecords
    .filter((entry) => active(entry) && teacherById.has(entry.teacherId))
    .map((entry) => {
      const room = classrooms.find((item) => item.id === entry.classroomId);
      return {
        ...entry,
        subjectName: entry.subjectName || subjectById.get(entry.subjectId) || '',
        teacherName: teacherById.get(entry.teacherId).fullName,
        classroomName: room?.name || entry.classroomNumber || '',
      };
    });
  const now = new Date();
  const day = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(now);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const publicClassrooms = classrooms.filter(active).map((room) => {
    const schedule = timetableRecords.filter((entry) => active(entry) && entry.classroomId === room.id);
    const hasSchedule = schedule.length > 0;
    const busy = schedule.some((entry) => matchesCurrentTime(entry, day, nowMinutes));
    return {
      ...room,
      availability: !hasSchedule ? 'unknown' : busy ? 'busy' : 'free',
      resources: asList(room.resources || room.amenities),
    };
  });
  const relevantNotifications = notifications.filter((item) =>
    item.studentId === studentId || item.userId === request.user.id
  );
  const requests = bookings
    .filter((item) => item.userId === request.user.id || item.studentId === studentId)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

  response.json({
    profile: publicProfile(student, request.user),
    teachers: visibleTeachers.map((teacher) => ({
      ...teacher,
      fullName: teacher.fullName || teacher.name || '',
      department: teacher.department || departmentById.get(teacher.departmentId) || '',
      subjectsTaught: asList(teacher.subjectsTaught).map((subject) => subjectById.get(subject) || subject),
    })),
    timetable,
    classrooms: publicClassrooms,
    labs: labs.filter(active).map((lab) => ({
      ...lab,
      equipment: asList(lab.equipment || lab.resources),
    })),
    announcements: announcements.filter(active).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))),
    requests,
    notifications: relevantNotifications,
    date: localDateKey(now),
  });
}

export async function createLabRequest(request, response) {
  const { labId, date, startTime, endTime, purpose } = request.body;
  if (
    typeof labId !== 'string' || !labId ||
    typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    typeof startTime !== 'string' || minuteOfDay(startTime) === null ||
    typeof endTime !== 'string' || minuteOfDay(endTime) === null ||
    minuteOfDay(startTime) >= minuteOfDay(endTime) ||
    typeof purpose !== 'string' || !purpose.trim() || purpose.trim().length > 500
  ) {
    return response.status(400).json({ message: 'Enter a lab, valid date and time, and a purpose up to 500 characters.' });
  }
  const requestedDate = new Date(`${date}T00:00:00`);
  if (Number.isNaN(requestedDate.getTime()) || localDateKey(requestedDate) !== date || date < localDateKey(new Date())) {
    return response.status(400).json({ message: 'Choose a valid date that is today or later.' });
  }
  const [labs, context] = await Promise.all([
    db.read('laboratories.json'),
    getStudentContext(request.user),
  ]);
  const lab = labs.find((item) => item.id === labId && active(item));
  if (!lab) return response.status(404).json({ message: 'Computer lab not found.' });

  const record = await db.add('lab_bookings.json', {
    labId,
    labName: lab.name || 'Computer lab',
    studentId: context.studentId,
    userId: request.user.id,
    date,
    timeSlot: `${startTime} - ${endTime}`,
    purpose: purpose.trim(),
    status: 'Pending',
    createdAt: new Date().toISOString(),
  });
  response.status(201).json(record);
}

export async function markNotificationRead(request, response) {
  const [{ studentId }, notifications] = await Promise.all([
    getStudentContext(request.user),
    db.read('notifications.json'),
  ]);
  const notification = notifications.find((item) =>
    item.id === request.params.id &&
    (item.userId === request.user.id || item.studentId === studentId)
  );
  if (!notification) return response.status(404).json({ message: 'Notification not found.' });
  const updated = await db.update('notifications.json', notification.id, { read: true });
  response.json(updated);
}
