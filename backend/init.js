// backend/init.js

import db from './db.js';
import bcrypt from 'bcryptjs';
import path from 'path';
import { promises as fs } from 'fs';

// List of data files and their default empty structure
const files = [
  'users.json',
  'teachers.json',
  'students.json',
  'departments.json',
  'subjects.json',
  'classrooms.json',
  'timetable.json',
  'classroom_reservations.json',
  'classroom_maintenance.json',
  'teacher_availability.json',
  'laboratories.json',
  'lab_bookings.json',
  'notifications.json',
  'announcements.json',
  'settings.json',
];

async function ensureFiles() {
  for (const file of files) {
    const data = await db.read(file); // read will auto‑create if missing
    // No further action needed – just ensure existence
  }
}

async function createInitialAdmin() {
  const users = await db.read('users.json');
  const adminExists = users.some(u => u.role === 'admin');
  if (adminExists) return;

  const password = 'Admin@123'; // In real setup, change after first login
  const passwordHash = await bcrypt.hash(password, 12);
  const adminUser = {
    email: 'admin@campusspace.local',
    passwordHash,
    role: 'admin',
    createdAt: new Date().toISOString(),
  };
  await db.add('users.json', adminUser);
  console.log('✅ Initial admin user created (email: admin@campusspace.local, password: Admin@123)');
}

async function seedSampleData() {
  async function ensureRecord(fileName, matches, record) {
    const records = await db.read(fileName);
    return records.find(matches) || db.add(fileName, record);
  }

  const departmentNames = ['Computer Science', 'Mathematics', 'Physics', 'English', 'Electronics'];
  const departments = {};
  for (const name of departmentNames) {
    const code = name === 'Computer Science' ? 'CS' : name.slice(0, 2).toUpperCase();
    departments[name] = await ensureRecord(
      'departments.json',
      department => department.name === name,
      { name, code },
    );
  }

  await ensureRecord(
    'subjects.json',
    subject => subject.code === 'CS201',
    { name: 'Data Structures', code: 'CS201', departmentId: departments['Computer Science'].id, creditHours: 3 },
  );
  await ensureRecord(
    'subjects.json',
    subject => subject.code === 'CS301',
    { name: 'Operating Systems', code: 'CS301', departmentId: departments['Computer Science'].id, creditHours: 4 },
  );
  await ensureRecord(
    'classrooms.json',
    classroom => classroom.name === 'Room 101',
    { name: 'Room 101', building: 'Main', capacity: 40, resources: ['Projector', 'Whiteboard'] },
  );
  await ensureRecord(
    'laboratories.json',
    laboratory => laboratory.name === 'Lab A',
    { name: 'Lab A', building: 'Science Block', equipment: ['PCs', 'Arduino', 'Raspberry Pi'] },
  );

  const demoTeachers = [
    {
      fullName: 'Dr. Arjun Mehta',
      email: 'arjun.mehta@college.edu',
      departmentId: departments['Computer Science'].id,
      designation: 'Professor',
      subjectsTaught: ['Data Structures', 'AI'],
      assignedClassrooms: ['B-101', 'B-102'],
      active: true,
    },
    {
      fullName: 'Dr. Neha Sharma',
      email: 'neha.sharma@college.edu',
      departmentId: departments.Mathematics.id,
      designation: 'Associate Professor',
      subjectsTaught: ['Calculus', 'Linear Algebra'],
      assignedClassrooms: ['A-201', 'A-202'],
      active: true,
    },
    {
      fullName: 'Prof. Rohan Das',
      email: 'rohan.das@college.edu',
      departmentId: departments.Physics.id,
      designation: 'Assistant Professor',
      subjectsTaught: ['Mechanics', 'Optics'],
      assignedClassrooms: ['C-301', 'C-302'],
      active: true,
    },
    {
      fullName: 'Dr. Priya Nair',
      email: 'priya.nair@college.edu',
      departmentId: departments.English.id,
      designation: 'Associate Professor',
      subjectsTaught: ['Communication Skills', 'Literature'],
      assignedClassrooms: ['D-101', 'D-102'],
      active: true,
    },
    {
      fullName: 'Prof. Sameer Khan',
      email: 'sameer.khan@college.edu',
      departmentId: departments.Electronics.id,
      designation: 'Assistant Professor',
      subjectsTaught: ['Digital Electronics', 'Microprocessors'],
      assignedClassrooms: ['E-201', 'E-202'],
      active: false,
    },
  ];

  for (const teacher of demoTeachers) {
    await ensureRecord('teachers.json', existing => existing.email === teacher.email, {
      ...teacher,
      contactNumber: '',
      profileImage: null,
      createdAt: new Date().toISOString(),
    });
  }
}

async function main() {
  await ensureFiles();
  await createInitialAdmin();
  await seedSampleData();
  console.log('✅ Database initialized');
}

main().catch(err => {
  console.error('❌ Initialization failed:', err);
  process.exit(1);
});
