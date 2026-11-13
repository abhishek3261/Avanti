export type MapsPoint = { lat: number; lng: number }

export type GoogleMapOptions = {
  center?: MapsPoint
  zoom?: number
  mapId?: string
  mapTypeControl?: boolean
  streetViewControl?: boolean
  fullscreenControl?: boolean
  zoomControl?: boolean
  gestureHandling?: 'cooperative' | 'greedy' | 'none' | 'auto'
}

export type GoogleMapInstance = {
  setCenter: (center: MapsPoint) => void
  setZoom: (zoom: number) => void
}

export type GoogleGeocoder = {
  geocode: (request: { location: MapsPoint }) => Promise<{ results: Array<{ formatted_address: string }> }>
}

export type PlaceAutocompletePrediction = {
  text: { toString: () => string }
  toPlace: () => GooglePlace
}

export type GooglePlace = {
  displayName?: { toString: () => string } | string
  formattedAddress?: string
  location?: { lat: () => number; lng: () => number } | MapsPoint
  fetchFields: (request: { fields: string[] }) => Promise<void>
}

export type PlacesLibrary = {
  AutocompleteSessionToken: new () => object
  AutocompleteSuggestion: {
    fetchAutocompleteSuggestions: (request: { input: string; sessionToken: object; region?: string }) => Promise<{
      suggestions: Array<{ placePrediction?: PlaceAutocompletePrediction }>
    }>
  }
}

export type MapsLibrary = {
  Map: new (element: HTMLElement, options: GoogleMapOptions) => GoogleMapInstance
  Geocoder: new () => GoogleGeocoder
}

export type AdvancedMarkerInstance = {
  map: GoogleMapInstance | null
  position: MapsPoint
}

export type MarkerLibrary = {
  AdvancedMarkerElement: new (options: { map: GoogleMapInstance; position: MapsPoint; title: string }) => AdvancedMarkerInstance
}

export type GoogleMapsLibraries = { maps: MapsLibrary; marker: MarkerLibrary; places: PlacesLibrary }

type ImportLibrary = (libraryName: string) => Promise<unknown>
type MapsNamespace = {
  importLibrary?: ImportLibrary
  __ib__?: () => void
}

type MapsWindow = { google?: { maps?: MapsNamespace } }

let requestedApiKey: string | undefined
let librariesPromise: Promise<GoogleMapsLibraries> | undefined

function installImportLibraryBootstrap(apiKey: string): MapsNamespace {
  const mapsWindow = window as unknown as MapsWindow
  const googleNamespace = mapsWindow.google ?? (mapsWindow.google = {})
  const mapsNamespace = googleNamespace.maps ?? (googleNamespace.maps = {})

  if (mapsNamespace.importLibrary) return mapsNamespace

  const requestedLibraries = new Set<string>()
  let scriptPromise: Promise<void> | undefined

  const loadScript = () => {
    scriptPromise ??= Promise.resolve().then(() => new Promise<void>((resolve, reject) => {
      const params = new URLSearchParams({
        key: apiKey,
        v: 'weekly',
        loading: 'async',
        callback: 'google.maps.__ib__',
      })
      params.set('libraries', [...requestedLibraries].join(','))

      const script = document.createElement('script')
      script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`
      script.async = true
      script.onerror = () => {
        script.remove()
        scriptPromise = undefined
        reject(new Error('Google Maps could not be loaded. Check your key, billing, enabled APIs, and referrer restrictions.'))
      }
      mapsNamespace.__ib__ = resolve
      document.head.append(script)
    }))
    return scriptPromise
  }

  mapsNamespace.importLibrary = (libraryName: string) => {
    requestedLibraries.add(libraryName)
    return loadScript().then(() => {
      const importLibrary = mapsNamespace.importLibrary
      if (!importLibrary) throw new Error('Google Maps loaded without its importLibrary function.')
      return importLibrary(libraryName)
    })
  }

  return mapsNamespace
}

export function loadGoogleMaps(): Promise<GoogleMapsLibraries> {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim()
  if (!apiKey) return Promise.reject(new Error('missing-key'))
  if (requestedApiKey && requestedApiKey !== apiKey) {
    return Promise.reject(new Error('Google Maps has already been initialized with a different API key. Reload the page after changing .env.'))
  }

  requestedApiKey = apiKey
  if (!librariesPromise) {
    const mapsNamespace = installImportLibraryBootstrap(apiKey)
    librariesPromise = Promise.all([
      mapsNamespace.importLibrary!('maps'),
      mapsNamespace.importLibrary!('marker'),
      mapsNamespace.importLibrary!('places'),
    ])
      .then(([maps, marker, places]) => ({ maps: maps as MapsLibrary, marker: marker as MarkerLibrary, places: places as PlacesLibrary }))
      .catch(error => {
        librariesPromise = undefined
        throw error
      })
  }
  return librariesPromise
}
