// script.js - Handles role card clicks and navigation

document.addEventListener('DOMContentLoaded', () => {
  const adminCard = document.getElementById('admin-card');
  const studentCard = document.getElementById('student-card');

  if (adminCard) {
    adminCard.addEventListener('click', () => {
      window.location.href = 'login.html';
    });
  }

  if (studentCard) {
    studentCard.addEventListener('click', () => {
      window.location.href = 'login-student.html';
    });
  }
});
