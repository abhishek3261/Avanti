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
  fitBounds: (bounds: unknown, padding?: number) => void
}

export type MapsCoreLibrary = {
  LatLngBounds: new () => { extend: (point: MapsPoint) => void }
}

export type GoogleGeocoder = {
  geocode: (request: { location?: MapsPoint; address?: string }) => Promise<{ results: Array<{ formatted_address: string; geometry: { location: { lat: () => number; lng: () => number } } }> }>
}

export type GoogleRoute = {
  distanceMeters?: number
  durationMillis?: number
  path?: unknown[]
  createPolylines: () => GooglePolyline[]
}

export type GooglePolyline = {
  setMap: (map: GoogleMapInstance | null) => void
}

export type GooglePolylineOptions = {
  map: GoogleMapInstance
  path: unknown[]
  strokeColor: string
  strokeOpacity: number
  strokeWeight: number
  geodesic: boolean
  zIndex: number
}

export type RoutesLibrary = {
  Route: {
    computeRoutes: (request: {
      origin: MapsPoint
      destination: MapsPoint
      travelMode: 'DRIVING'
      routingPreference: 'TRAFFIC_AWARE'
      fields: string[]
    }) => Promise<{ routes?: GoogleRoute[] }>
  }
}

export type DrivingRoute = { distanceMeters: number; durationMillis: number; path: unknown[] }

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
  Polyline: new (options: GooglePolylineOptions) => GooglePolyline
}

export type AdvancedMarkerInstance = {
  map: GoogleMapInstance | null
  position: MapsPoint
}

export type MarkerLibrary = {
  AdvancedMarkerElement: new (options: { map: GoogleMapInstance; position: MapsPoint; title: string; content?: HTMLElement }) => AdvancedMarkerInstance
}

export type GoogleMapsLibraries = { core: MapsCoreLibrary; maps: MapsLibrary; marker: MarkerLibrary; places: PlacesLibrary }

type ImportLibrary = (libraryName: string) => Promise<unknown>
type MapsNamespace = {
  importLibrary?: ImportLibrary
  __ib__?: () => void
}

type MapsWindow = { google?: { maps?: MapsNamespace } }

let requestedApiKey: string | undefined
let librariesPromise: Promise<GoogleMapsLibraries> | undefined
let routesLibraryPromise: Promise<RoutesLibrary> | undefined
const activeRouteRequests = new Map<string, Promise<DrivingRoute>>()

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
      mapsNamespace.importLibrary!('core'),
      mapsNamespace.importLibrary!('maps'),
      mapsNamespace.importLibrary!('marker'),
      mapsNamespace.importLibrary!('places'),
    ])
      .then(([core, maps, marker, places]) => ({ core: core as MapsCoreLibrary, maps: maps as MapsLibrary, marker: marker as MarkerLibrary, places: places as PlacesLibrary }))
      .catch(error => {
        librariesPromise = undefined
        throw error
      })
  }
  return librariesPromise
}

function loadRoutesLibrary(): Promise<RoutesLibrary> {
  return loadGoogleMaps().then(() => {
    const mapsNamespace = (window as unknown as MapsWindow).google?.maps
    if (!mapsNamespace?.importLibrary) throw new Error('Google Maps Routes library is unavailable.')
    routesLibraryPromise ??= mapsNamespace.importLibrary('routes')
      .then(library => library as RoutesLibrary)
      .catch(error => {
        routesLibraryPromise = undefined
        throw error
      })
    return routesLibraryPromise
  })
}

export function calculateDrivingRoute(origin: MapsPoint, destination: MapsPoint): Promise<DrivingRoute> {
  const key = `${origin.lat},${origin.lng}:${destination.lat},${destination.lng}`
  const existing = activeRouteRequests.get(key)
  if (existing) return existing

  const request = loadRoutesLibrary().then(async routes => {
    const response = await routes.Route.computeRoutes({
      origin,
      destination,
      travelMode: 'DRIVING',
      routingPreference: 'TRAFFIC_AWARE',
      fields: ['distanceMeters', 'durationMillis', 'path'],
    })
    const route = response.routes?.[0]
    if (!route) throw new Error('Google Maps could not find a driving route between these locations.')
    if (!Number.isFinite(route.distanceMeters) || !Number.isFinite(route.durationMillis) || !route.path?.length) {
      throw new Error('Google Maps returned incomplete route details. Please try different locations.')
    }
    return { distanceMeters: route.distanceMeters!, durationMillis: route.durationMillis!, path: route.path }
  })
  activeRouteRequests.set(key, request)
  void request.then(
    () => { if (activeRouteRequests.get(key) === request) activeRouteRequests.delete(key) },
    () => { if (activeRouteRequests.get(key) === request) activeRouteRequests.delete(key) },
  )
  return request
}
