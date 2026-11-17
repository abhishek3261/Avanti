// Production routes through the same-origin Vercel proxy so browser session
// cookies remain first-party. Local development may still target an explicit
// API origin, or leave this blank to use Vite's local proxy.
const rawApiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').trim()
let validatedApiBaseUrl = ''

if (rawApiBaseUrl) {
  let parsedApiBaseUrl: URL
  try { parsedApiBaseUrl = new URL(rawApiBaseUrl) } catch {
    throw new Error('VITE_API_BASE_URL must be an absolute API origin, such as https://avanti-api.onrender.com.')
  }
  if (!['http:', 'https:'].includes(parsedApiBaseUrl.protocol) || parsedApiBaseUrl.username || parsedApiBaseUrl.password
    || parsedApiBaseUrl.pathname !== '/' || parsedApiBaseUrl.search || parsedApiBaseUrl.hash) {
    throw new Error('VITE_API_BASE_URL must contain only the API origin, without credentials, a path, query, or fragment.')
  }
  if (import.meta.env.PROD && parsedApiBaseUrl.protocol !== 'https:') {
    throw new Error('VITE_API_BASE_URL must use HTTPS in production.')
  }
  validatedApiBaseUrl = parsedApiBaseUrl.origin
}

// REST stays same-origin in production for first-party session cookies. The
// Socket.IO client uses the configured Render origin directly to avoid trying
// to tunnel a long-lived WebSocket through Vercel's external rewrite.
const configuredApiBaseUrl = import.meta.env.PROD ? '' : validatedApiBaseUrl

/**
 * Resolves API paths against the optional production API origin.
 * An empty origin keeps local development on the Vite same-origin proxy.
 */
export function apiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${configuredApiBaseUrl}${normalizedPath}`
}

export const apiBaseUrl = configuredApiBaseUrl
export const realtimeBaseUrl = validatedApiBaseUrl
