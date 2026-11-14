import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Quick Tunnel hostnames change between runs. Allow only the exact host supplied
// for this Vite process instead of trusting every public trycloudflare.com host.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  // Quick Tunnel hostnames change between runs. Allow only the exact host supplied
  // for this Vite process instead of trusting every public trycloudflare.com host.
  const additionalAllowedHosts = (env.AVANTI_VITE_ALLOWED_HOSTS ?? 'days-meets-imaging-shoppers.trycloudflare.com')
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean)

  return {
    plugins: [react(), tailwindcss()],
    server: {
      host: '0.0.0.0',
      port: 5173,
      strictPort: true,
      allowedHosts: additionalAllowedHosts,
      proxy: { '/api': 'http://localhost:4000' },
    },
  }
})
