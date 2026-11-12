# Avanti

Responsive cab booking web app built with React, TypeScript, Vite, Tailwind CSS 4, React Router, Express, and SQLite.

## Run locally

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

Vite runs the web app at `http://localhost:5173`; the API runs at `http://localhost:4000` and the Vite server proxies `/api` calls to it. The local SQLite file is created at `data/avanti.sqlite` on the first API start.

Create a production frontend bundle with `npm run build`. Set production environment values, then `npm start` runs the API and serves the built app.

## Pages

- `/` - Avanti landing page
- `/rider/login` and `/rider/register` - rider login and registration
- `/rider/dashboard` - rider booking preview with sample vehicle categories and fares (rider account required)
- `/driver/login` and `/driver/register` - driver login and registration
- `/driver/dashboard` - driver dashboard with sample ride requests and earnings (driver account required)

## Authentication setup

Registration and password login create real accounts in SQLite. Passwords use scrypt hashes. Session tokens are random, stored hashed in SQLite, and sent as HttpOnly, SameSite cookies. Every account has one role; the rider and driver APIs enforce that role on the server.

For Google sign-in, create a Web OAuth client in Google Cloud Console, add `http://localhost:5173` as an Authorized JavaScript origin, then set both `VITE_GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_ID` in `.env` to that client ID. The API verifies the Google ID token before creating a session. Restart the dev server after changing environment values. A first-time Google sign-in from either portal's login page automatically creates an account with that portal's role; users don't need to register separately first.

For production, set `NODE_ENV=production`, a random `SESSION_SECRET` of at least 32 characters, `APP_ORIGIN` to the deployed site origin, and `GOOGLE_CLIENT_ID`. Serve the app over HTTPS.

## Structure

```text
src/
  assets/       local visual assets
  components/   shared navigation and UI components
  context/      browser auth state backed by the API session
  layouts/      shared page layout
  pages/        landing, rider, driver, and auth screens
  routes/       React Router table and role guards
  styles/       responsive styles and Tailwind import
server/
  auth.mjs      password hashing, Google verification, and cookie sessions
  database.mjs  SQLite schema and initialization
  index.mjs     auth endpoints, validation, rate limits, and role checks
data/           local SQLite database (created on first API start)
```

The cab booking, maps, ride requests, and earnings remain sample UI and are not connected to the backend.
