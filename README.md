# SeatFlow

SeatFlow is a FastAPI + React app for managing venues, events, and seat assignments.

This repo contains:

- server/ — FastAPI backend (Python)
- client/ — Vite + React frontend (TypeScript)
- solver/ — Spring Boot seating solver (Java)
- server/seatflow.sql — database dump (schema + data)

Quick links:

- Web: http://localhost:5173
- Admin Login -
  email: admin@example.com
  password: Admin123456!

## Prerequisites (macOS)

- Python 3.9+
- Node.js 18+ and npm
- MySQL 8.0 (local)

Start MySQL (default port 3306). If using Homebrew:

```
brew services start mysql
```

## 1) Database setup (local MySQL, no Docker)

Create a user and database, then import the dump included in this repo.

```
mysql -u root -p
```

Inside MySQL:

```
CREATE DATABASE seatflow CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'seatflow'@'localhost' IDENTIFIED BY 'seatflow';
GRANT ALL PRIVILEGES ON seatflow.* TO 'seatflow'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

Import the data:

```
mysql -u seatflow -p seatflow < server/seatflow.sql
```

Verify:

```
mysql -u seatflow -p -e "SHOW TABLES;" seatflow
```

Reset DB (if needed):

```
mysql -u root -p -e "DROP DATABASE IF EXISTS seatflow; CREATE DATABASE seatflow CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -u seatflow -p seatflow < server/seatflow.sql
```

## 2) Backend (FastAPI)

From the server folder:

```
cd server
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Environment (copy `server/.env.example` to `server/.env` and adjust if needed):

Run the API:

```
uvicorn app.main:app --reload --port 8000
```

## 2b) Seating solver (Java / Spring Boot)

The seat-assignment algorithm runs in a separate Java service under `solver/`.
It runs the greedy heuristic 100 times in parallel on real threads, each with
different random noise, scores every plan, and returns the best one. The Python
backend calls it when you click **Run** on an event and saves the winning plan.

Requires Java 21+ (`java -version`). Maven is downloaded automatically by the wrapper.

```
cd solver
./mvnw spring-boot:run
```

Listens on http://localhost:8081. Stop with Ctrl+C.

The backend finds it via `SOLVER_URL` (default `http://localhost:8081`) and
`SOLVER_RUNS` (default 100) in `server/.env`. If the solver is not running, the
backend logs a warning and falls back to the built-in Python heuristic, so nothing
breaks. The run response says which one was used (`"solver": "java"` or `"python"`).

## 3) Frontend (Vite + React)

From the client folder:

```
cd client
npm install
```

Environment (copy `client/src/.env.example` to `client/src/.env`):

Run the web app:

```
npm run dev
```

Open the app:

- http://localhost:5173

## 4) Sign in (seeded admin)

- Email: admin@example.com
- Password: Admin123456!

## Common tasks

- Freeze Python deps:

```
cd server
source .venv/bin/activate
pip freeze > requirements.txt
```

- Verify you’re using the project venv:

```
which python
python -c "import sys; print(sys.executable)"
which uvicorn
```

- Run API with the venv explicitly:

```
server/.venv/bin/python -m uvicorn app.main:app --reload --port 8000
```

## Notes

- .env files are git-ignored; .env.example files show the expected variables.
- Manual seat moves in the UI are allowed even if they violate accessibility preferences; use the Issues panel to review such cases.
