# Avanti

Responsive cab booking web app built with React, TypeScript, Vite, Tailwind CSS 4, React Router, Express, and SQLite.

## Run locally

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

Vite runs the web app at `http://localhost:5173`; the API runs at `http://localhost:4000` and the Vite server proxies `/api` calls to it. The local SQLite file is created at `data/avanti.sqlite` on the first API start.

### Open the development app on a phone over Wi-Fi

1. Connect the phone and laptop to the same Wi-Fi network.
2. On Windows, run `ipconfig` and find the laptop's IPv4 address under the active Wi-Fi adapter.
3. Set `APP_ORIGIN` in the local, Git-ignored `.env` to `http://<laptop-ip>:5173` (for example, `http://192.168.1.40:5173`).
4. Restart the development server with `npm run dev`.
5. Open `http://<laptop-ip>:5173` on the phone. The API remains behind Vite's `/api` proxy on the laptop.

If Windows Firewall prompts, allow Node.js/Vite on the **Private** network. For Google Maps, add the phone-access origin to the Maps browser key's website restrictions. Browser GPS requires a secure context: a phone opening the LAN URL over plain HTTP may be blocked from location access. Use a trusted HTTPS development tunnel or install/trust a local development certificate on the phone for GPS. Google Sign-In may reject a raw LAN IP as an OAuth JavaScript origin; use an HTTPS development URL if Google login is needed on the phone.

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
