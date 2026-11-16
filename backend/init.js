// backend/init.js

import db from './db.js';
import bcrypt from 'bcrypt';
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
  // Departments
  const dept = await db.add('departments.json', { name: 'Computer Science', code: 'CS' });

  // Subjects
  await db.add('subjects.json', { name: 'Data Structures', code: 'CS201', departmentId: dept.id, creditHours: 3 });
  await db.add('subjects.json', { name: 'Operating Systems', code: 'CS301', departmentId: dept.id, creditHours: 4 });

  // Classrooms
  await db.add('classrooms.json', { name: 'Room 101', building: 'Main', capacity: 40, resources: ['Projector', 'Whiteboard'] });

  // Laboratories
  await db.add('laboratories.json', { name: 'Lab A', building: 'Science Block', equipment: ['PCs', 'Arduino', 'Raspberry Pi'] });
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
