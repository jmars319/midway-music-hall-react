# Midway Music Hall

Project scaffold created from `01_project_structure.md`.

Run backend:

```bash
cd backend
npm install
npm run dev
```

Run frontend:

```bash
cd frontend
npm install
npm start
```

Midway Music Hall is a small demo application comprising a React frontend and a Node.js/Express backend with a MySQL database. It includes an admin layout editor and a seating/seat-request workflow.

Quick start (development)

1. Backend

	```bash
	cd backend
	npm install
	# create backend/.env from .env.example and set DB credentials
	npm run dev # or `node server.js`
	```

2. Frontend

	```bash
	cd frontend
	npm install
	npm start
	```

Repository layout

- `backend/` — Express server and API handlers
- `frontend/` — React UI with components and admin modules
- `database/` — SQL schema and helpers
- `copilot-instructions/` — project guidance (ignored by default)

Notes

- Do not commit secrets. Use `backend/.env` for local environment values.
- `node_modules/` and logs are ignored by `.gitignore`.
- After major changes, run `git gc` at a convenient time to keep the local repo tidy.

If you want me to add CI (GitHub Actions) or deployment scripts, say so and I will scaffold them.
