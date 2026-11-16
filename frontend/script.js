// script.js - Handles role card clicks and navigation

document.addEventListener('DOMContentLoaded', () => {
  const adminCard = document.getElementById('admin-card');
  const studentCard = document.getElementById('student-card');

  if (adminCard) {
    adminCard.addEventListener('click', () => {
      // Redirect to admin login page (create admin.html if needed)
      window.location.href = 'admin.html';
    });
  }

  if (studentCard) {
    studentCard.addEventListener('click', () => {
      // Redirect to student login page (create student.html if needed)
      window.location.href = 'student.html';
    });
  }
});
