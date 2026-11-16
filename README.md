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

The Express application serves the static frontend and exposes JSON endpoints under `/api`. Controllers handle HTTP concerns; services own reusable business and persistence logic. The file-storage service is the single boundary for JSON data files and restricts data filenames to simple `.json` names. The initial API includes only a health check; booking and resource features are intentionally not implemented yet.

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
