# CampusSpace

CampusSpace is the foundation for a web-based campus resource management and booking system. It uses HTML, CSS, and vanilla JavaScript in the browser, with Node.js, Express, and JSON files for the backend.

## Architecture

```text
frontend/                 Static welcome page and separate portal entry pages
  css/                    Shared styles
  js/                     Browser-side vanilla JavaScript
backend/
  config/                 Centralized server and filesystem paths
  controllers/            HTTP request handlers
  database/data/          JSON persistence files (created as features are added)
  middleware/             Not-found and centralized error handling
  routes/                 Versionable API route modules
  services/               File-storage and domain logic
  utils/                  Shared backend utilities
  app.js                  Express middleware and route composition
  server.js               HTTP server entry point
```

The Express application serves the static frontend and exposes JSON endpoints under `/api`. The student portal uses the authenticated student role to read faculty, timetable, classroom, lab, announcement, and student-specific notification/request records from the JSON data store. Students can view faculty profiles and timetables but cannot edit them. Lab access requests are stored with the signed-in student's account ID.

The classroom finder checks `classrooms.json`, `timetable.json`, `classroom_reservations.json`, and `classroom_maintenance.json` for each search. Searching never reserves a room; a student must explicitly choose **Reserve this room**, and the backend rechecks availability before saving the reservation.

The teacher finder reads faculty, department, subject, and timetable records from their JSON files, plus `teacher_availability.json` for explicit confirmations. Timetable gaps are reported as free from classes, not as confirmed availability; a teacher is marked available only when a matching availability record confirms the requested interval. Optional `workingHours` on a teacher record can define the hours in which availability may be confirmed.

## Requirements

- Node.js 18 or newer
- npm

## Setup

```sh
npm install
npm run dev
```

For a normal start without the development watcher:

```sh
npm start
```

The application listens on `http://localhost:3000` by default. Set the `PORT` environment variable to use a different port.

## Verify

- Visit `http://localhost:3000` to choose the Admin / Teacher or Student portal.
- Visit `http://localhost:3000/api/health` to verify the JSON API.
- Open the Student portal and sign in with a student account. Student accounts and campus resource records must already exist in the backend data files; the portal does not populate demo records.
