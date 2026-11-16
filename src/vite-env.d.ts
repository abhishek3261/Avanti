/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional deployed API origin. Leave empty locally to use the Vite proxy. */
  readonly VITE_API_BASE_URL?: string
  readonly VITE_GOOGLE_MAPS_API_KEY?: string
  readonly VITE_GOOGLE_MAPS_MAP_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
