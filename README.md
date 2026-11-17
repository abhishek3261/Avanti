# Avanti

Responsive cab booking web app built with React, TypeScript, Vite, Tailwind CSS 4, React Router, Express, and PostgreSQL.

## Run locally

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

Vite runs the web app at `http://localhost:5173`; the API runs at `http://localhost:4000` and the Vite server proxies `/api` and Socket.IO calls to it. The API requires PostgreSQL through `DATABASE_URL` and creates its schema at startup.

Before starting the API, configure `DATABASE_URL` in `.env`. For local PostgreSQL, create an empty database named `avanti` and set a URL such as `postgresql://postgres:YOUR_PASSWORD@localhost:5432/avanti`. Keep credentials only in the ignored `.env`; never put them in a `VITE_` variable. Set `DATABASE_SSL=true` for a TLS-required provider, or use the provider's connection URL with `sslmode=require`. The API uses a bounded connection pool (`DATABASE_POOL_MAX`, default 10), and `/api/health` reports whether PostgreSQL is reachable.

### SQLite to PostgreSQL data transfer

The app no longer uses SQLite at runtime. To move the existing local database:

1. Stop the API and make sure the SQLite source is at `data/avanti.sqlite` (or set `DATABASE_PATH` in `.env` to its path).
2. Configure `DATABASE_URL` for a **new, empty PostgreSQL database**. The transfer utility refuses to write into a PostgreSQL database that already has application rows.
3. Run:

   ```powershell
   npm run migrate:postgres
   ```

The command creates a consistent SQLite backup under `data/backups/`, then transfers users, sessions, rides, driver profiles and locations, share links, and chat messages in one PostgreSQL transaction. It checks table counts and foreign-key relationships before committing. The original SQLite file and backup are preserved and ignored by Git. If the transfer fails, the PostgreSQL transaction rolls back; investigate the reported issue and rerun against the still-empty target. Keep the backup until the PostgreSQL app has been exercised and verified.

Rollback means redeploying the prior SQLite-backed app version and restoring its original SQLite path/backup; the new PostgreSQL-backed server does not support SQLite as a runtime option. Do not point it at production until the transferred records and workflows have been verified.

To run the real-time chat integration test against a separate PostgreSQL test database, set `TEST_DATABASE_URL` to an isolated database account allowed to create and drop a temporary schema, then run `npm run test:chat`. The test is skipped when `TEST_DATABASE_URL` is absent.

### Google Maps setup

Set `VITE_GOOGLE_MAPS_API_KEY` in `.env`, then restart Vite. Enable billing and the Maps JavaScript API, Places API (New), Routes API, and Geocoding API in the same Google Cloud project. Restrict the browser key by website referrer and allow the local `localhost:5173` origin plus the laptop LAN origin when testing from a phone. The key is used by browser Maps APIs, so protect it with those restrictions; do not put a server key in a `VITE_` variable.

### Open the development app on a phone over Wi-Fi

1. Connect the phone and laptop to the same Wi-Fi network.
2. On Windows, run `ipconfig` and find the laptop's IPv4 address under the active Wi-Fi adapter.
3. Set `APP_ORIGIN` in the local, Git-ignored `.env` to `http://<laptop-ip>:5173` (for example, `http://192.168.1.40:5173`).
4. Restart the development server with `npm run dev`.
5. Open `http://<laptop-ip>:5173` on the phone. The API remains behind Vite's `/api` proxy on the laptop.

If Windows Firewall prompts, allow Node.js/Vite on the **Private** network. The plain HTTP LAN URL is useful for layout checks, but iPhone browsers require a secure HTTPS page for GPS. Use the temporary HTTPS tunnel below when testing location.

### Temporary HTTPS tunnel for iPhone GPS

Cloudflare Quick Tunnels give the local Vite app a temporary HTTPS URL without changing the Maps key or adding a tunnel secret to the project. Anyone who has the generated URL can reach the development app, so use test accounts and data only. The URL stops working when the tunnel process exits and changes when a new tunnel is started. [Cloudflare Quick Tunnel documentation](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)

1. Install `cloudflared` once from PowerShell:

   ```powershell
   winget install --id Cloudflare.cloudflared
   ```

   Open a new PowerShell window after installation if `cloudflared` is not found.

2. Stop any existing Avanti dev processes with **Ctrl+C** so ports 5173 and 4000 are free.

3. In PowerShell terminal 1, start the temporary tunnel:

   ```powershell
   cloudflared tunnel --url http://localhost:5173
   ```

   Keep this terminal open. Copy the generated URL, for example `https://random-words.trycloudflare.com`.

4. Add the exact HTTPS origin to `APP_ORIGIN` in your Git-ignored `.env`, keeping any origins you still use separated by commas. For the current tunnel and laptop LAN address, set:

   ```dotenv
   APP_ORIGIN=http://192.168.1.40:5173,https://days-meets-imaging-shoppers.trycloudflare.com
   ```

   Edit the `.env` line without quotes. If the tunnel hostname changes, replace the HTTPS origin with the new one. The API allows only the exact listed origins. Keep `TRUST_PROXY=loopback` in `.env`; API requests arrive through the local Vite proxy, and this lets rate limiting use forwarded client addresses without trusting arbitrary network hosts.

5. Add the tunnel hostname (without `https://`) to `AVANTI_VITE_ALLOWED_HOSTS` in `.env`, then start both services:

   ```powershell
   AVANTI_VITE_ALLOWED_HOSTS=days-meets-imaging-shoppers.trycloudflare.com
   ```

   Then run:

   ```powershell
   npm.cmd run dev
   ```

   `npm.cmd run dev` starts both services. `AVANTI_VITE_ALLOWED_HOSTS` allows only the active tunnel hostname. Vite's existing `/api` proxy forwards requests to the API on port 4000. Restart both services after changing the tunnel hostname. [Vite server options](https://vite.dev/config/server-options#server-allowedhosts)

6. In Google Cloud Console, update the existing credentials:

   - OAuth 2.0 Web client: add `https://days-meets-imaging-shoppers.trycloudflare.com` under **Authorized JavaScript origins**.
   - Maps browser API key: add `https://days-meets-imaging-shoppers.trycloudflare.com/*` under website referrers. Confirm billing is enabled, **Routes API** is enabled in the same project, and the key's API restrictions permit Routes API as well as the Maps, Places, and Geocoding APIs used by the app.

   Update both entries if Cloudflare gives you a different hostname.

6. On the iPhone, open the generated **HTTPS** URL in Safari, sign in, open the rider dashboard, and tap **My location**. When Safari asks, allow location access while using the site. If permission was denied earlier, use Safari's **aA → Website Settings → Location → Allow**, then reload the page. The iOS Location Services setting for Safari Websites must also be enabled.

Stop the app and tunnel with **Ctrl+C** in their respective terminals. The `.env` file is local and Git-ignored; it contains origins only, not API credentials.

Create a production frontend bundle with `npm run build`. Set production environment values, then `npm start` runs the API and serves the built app.

## Production deployment: Vercel + Render + Neon

The project uses PostgreSQL at runtime already. The SQLite dependency is retained only as a development dependency for the one-time SQLite-to-PostgreSQL transfer utility; the production API does not open SQLite. Do not rerun the transfer utility against the existing Neon database.

The Vercel frontend proxies `/api/*` and `/socket.io/*` through its own domain to Render. This keeps the browser session first-party on iPhone and other browsers that restrict cross-site cookies. Production builds use these same-origin paths even if `VITE_API_BASE_URL` remains configured; remove that old Vercel variable to avoid confusion. Locally, leave it empty so Vite proxies those paths to `localhost:4000`.

### 1. Deploy the API on Render

Create a **Web Service** from this repository in Render. Use the repository root as the root directory, `npm ci --omit=dev` as the build command, and `npm start` as the start command. Set the health-check path to `/api/health`. Render supplies `PORT`; the server binds to `0.0.0.0` and does not need a manually assigned port.

Add these variables under the Render service's **Environment** settings:

| Name | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Neon pooled connection string, including TLS parameters such as `sslmode=require` |
| `SESSION_SECRET` | A new random secret of at least 32 characters; do not reuse a Google or database credential |
| `GOOGLE_CLIENT_ID` | The existing Google Web OAuth client ID (not its secret) |
| `APP_ORIGIN` | Exact frontend HTTPS origin, e.g. `https://avanti.vercel.app`, with no path or trailing slash |
| `TRUST_PROXY` | `1` for the Render web service proxy |
| `SERVE_FRONTEND` | `false` because Vercel serves the frontend |
| `SESSION_COOKIE_SAME_SITE` | `lax` (recommended with the Vercel same-origin proxy) |
| `DATABASE_POOL_MAX` | Optional; defaults to `10` |

Do not set `PORT` manually. Keep `DATABASE_URL`, `SESSION_SECRET`, and any other server credentials on Render only. The API's `/api/health` endpoint checks database connectivity and is suitable for Render's health check. Render supports public WebSocket connections, which the existing Socket.IO server uses for live updates and chat. [Render Web Services](https://render.com/docs/web-services), [Render WebSockets](https://render.com/docs/websocket), [Render health checks](https://render.com/docs/health-checks)

### 2. Choose the session-cookie domain arrangement

The cookie remains `HttpOnly` and `Secure` in production. With the Vercel same-origin proxy, set `SESSION_COOKIE_SAME_SITE=lax`; browsers no longer need to send the cookie directly from the Vercel site to the unrelated Render domain.

For more reliable browser authentication, use custom HTTPS domains under the same registrable domain, such as `app.example.com` on Vercel and `api.example.com` on Render, then set `SESSION_COOKIE_SAME_SITE=lax`. The API still uses credentialed CORS because these are different origins, even though they are same-site. Set `APP_ORIGIN` to the exact app origin. Do not use wildcard origins. If you want Vercel Preview deployments to call the API, add each stable preview origin explicitly to `APP_ORIGIN`; arbitrary Vercel preview URLs are not accepted.

### 3. Configure the Vercel frontend

Import the same GitHub repository into Vercel. Set the project root to `.`, framework preset to **Vite**, build command to `npm run build`, and output directory to `dist`. The checked-in `vercel.json` rewrites frontend routes to `index.html` so direct links such as `/rider/dashboard` work. [Vercel Vite deployment](https://vercel.com/docs/frameworks/frontend/vite)

Add these Vercel **Production** environment variables:

| Name | Value |
| --- | --- |
| `VITE_API_BASE_URL` | Not used in production; remove the old Vercel value. Vercel proxies API and Socket.IO paths to Render |
| `VITE_GOOGLE_CLIENT_ID` | The same Google Web OAuth client ID configured on Render |
| `VITE_GOOGLE_MAPS_API_KEY` | Browser Maps key restricted by website referrer and required Maps APIs |
| `VITE_GOOGLE_MAPS_MAP_ID` | Optional map ID if configured |

Vite embeds every `VITE_` variable in the browser build. Only use the public OAuth client ID and a referrer-restricted browser Maps key here. Never add `DATABASE_URL`, `SESSION_SECRET`, the Google OAuth client secret, or a server Maps key to Vercel frontend variables. Redeploy after changing Vercel environment variables. [Vercel environment variables](https://vercel.com/docs/environment-variables)

### 4. Update Google Cloud origins and referrers

For the OAuth Web client, add the exact Vercel production origin (for example, `https://avanti.vercel.app`) under **Authorized JavaScript origins**. Add a separate stable custom domain if you use one. For the browser Maps key, add `https://avanti.vercel.app/*` under website referrers and allow the Maps JavaScript, Places, Routes, and Geocoding APIs that the app uses. Keep the key's API and referrer restrictions enabled.

### 5. Verify the deployment

1. Open `https://<render-service>.onrender.com/api/health`; expect HTTP 200 and `database: "connected"`.
2. Open the Vercel production URL and check the browser Network tab: `/api/...` requests and `/socket.io` connections must go to the Render hostname.
3. Test rider and driver password login, Google login, ride creation and acceptance, location updates, chat, and a direct page refresh on a nested route.
4. If requests fail with a CORS error, confirm the browser's exact `https://...vercel.app` origin is in Render's `APP_ORIGIN`. If login succeeds but the next request is unauthenticated, check the cookie's `SameSite` setting and browser third-party-cookie policy.

## Pages

- `/` - Avanti landing page
- `/rider/login` and `/rider/register` - rider login and registration
- `/rider/dashboard` - rider booking with Google driving-route previews and configurable sample fare estimates (rider account required)
- `/driver/login` and `/driver/register` - driver login and registration
- `/driver/dashboard` - driver dashboard with sample ride requests and earnings (driver account required)

## Authentication setup

Registration and password login create real accounts in PostgreSQL. Passwords use scrypt hashes. Session tokens are random, stored hashed in PostgreSQL, and sent as HttpOnly, SameSite cookies. Every account has one role; the rider and driver APIs enforce that role on the server.

For Google sign-in, create a Web OAuth client in Google Cloud Console, add `http://localhost:5173` as an Authorized JavaScript origin, then set both `VITE_GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_ID` in `.env` to that client ID. The API verifies the Google ID token before creating a session. Restart the dev server after changing environment values. A first-time Google sign-in from either portal's login page automatically creates an account with that portal's role; users don't need to register separately first.

For production, set `NODE_ENV=production`, a random `SESSION_SECRET` of at least 32 characters, `APP_ORIGIN` to the deployed site origin, `GOOGLE_CLIENT_ID`, and a PostgreSQL `DATABASE_URL` with TLS (`DATABASE_SSL=true` or `sslmode=require`). Serve the app over HTTPS.

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
  database.mjs  PostgreSQL pool, schema and initialization
  migrate-sqlite-to-postgres.mjs  one-time SQLite backup and data transfer utility
  index.mjs     auth endpoints, validation, rate limits, and role checks
data/           local SQLite source/backups for migration only; kept out of git
```

The rider dashboard calculates real Google Maps driving routes and displays configurable sample fare estimates. Fare rates are in `src/lib/fares.ts`. Ride requests continue to use the existing backend contract; fares are estimates and are not stored or charged. Driver earnings and ride history remain sample UI.
