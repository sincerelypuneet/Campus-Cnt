// backend/reset-admin-password.js
import db from './db.js';
import bcrypt from 'bcryptjs';

const email = process.env.ADMIN_EMAIL || process.argv[2] || 'admin@campusspace.local';
const newPassword = process.env.ADMIN_PASSWORD || process.argv[3];

if (!newPassword || newPassword.trim().length < 6) {
  console.error('Usage: node backend/reset-admin-password.js [email] <newPassword>');
  console.error('Or: ADMIN_PASSWORD=<password> node backend/reset-admin-password.js');
  console.error('Password must be at least 6 characters.');
  process.exit(1);
}

const users = await db.read('users.json');
const userIndex = users.findIndex(u => u && u.email && u.email.toLowerCase() === email.toLowerCase());
const passwordHash = await bcrypt.hash(newPassword, 12);

if (userIndex >= 0) {
  users[userIndex].passwordHash = passwordHash;
  users[userIndex].active = true;
  await db.write('users.json', users);
  console.log(`✅ Password successfully updated for admin account: ${email}`);
} else {
  const newAdmin = {
    id: db.generateId(),
    email,
    passwordHash,
    role: 'admin',
    active: true,
    createdAt: new Date().toISOString(),
  };
  users.push(newAdmin);
  await db.write('users.json', users);
  console.log(`✅ New admin account created: ${email}`);
}
