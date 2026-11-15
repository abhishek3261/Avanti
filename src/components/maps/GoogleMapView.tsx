import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { loadGoogleMaps, type AdvancedMarkerInstance, type DrivingRoute, type GoogleMapInstance, type MapsCoreLibrary, type MapsLibrary, type MapsPoint, type MarkerLibrary, type GooglePolyline } from '../../lib/googleMaps'

type MapState = 'loading' | 'ready' | 'error'
type MapsAuthWindow = Window & { gm_authFailure?: () => void }

export type GoogleMapViewHandle = {
  showCurrentLocation: (point: MapsPoint) => void
  clearCurrentLocation: () => void
  showDriverLocation: (point: MapsPoint, headingDegrees?: number | null) => void
  clearDriverLocation: () => void
  showRoute: (route: DrivingRoute, origin: MapsPoint, destination: MapsPoint) => void
  clearRoute: () => void
}

const GoogleMapView = forwardRef<GoogleMapViewHandle>(function GoogleMapView(_props, ref) {
  const mapElement = useRef<HTMLDivElement>(null)
  const mapInstance = useRef<GoogleMapInstance | null>(null)
  const coreLibrary = useRef<MapsCoreLibrary | null>(null)
  const AdvancedMarker = useRef<MarkerLibrary['AdvancedMarkerElement'] | null>(null)
  const mapsLibrary = useRef<MapsLibrary | null>(null)
  const locationMarker = useRef<AdvancedMarkerInstance | null>(null)
  const driverMarker = useRef<AdvancedMarkerInstance | null>(null)
  const driverMarkerContent = useRef<HTMLElement | null>(null)
  const driverAnimation = useRef<number | null>(null)
  const routeMarkers = useRef<AdvancedMarkerInstance[]>([])
  const routePolylines = useRef<GooglePolyline[]>([])
  const currentRoute = useRef<{ route: DrivingRoute; origin: MapsPoint; destination: MapsPoint } | null>(null)
  const currentLocation = useRef<MapsPoint | null>(null)
  const [state, setState] = useState<MapState>('loading')
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const hasApiKey = Boolean(import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim())

  const clearRoute = () => {
    currentRoute.current = null
    routePolylines.current.forEach(polyline => polyline.setMap(null))
    routePolylines.current = []
    routeMarkers.current.forEach(marker => { marker.map = null })
    routeMarkers.current = []
  }

  const drawRoute = (route: DrivingRoute, origin: MapsPoint, destination: MapsPoint) => {
    currentRoute.current = { route, origin, destination }
    const map = mapInstance.current
    const maps = mapsLibrary.current
    const Marker = AdvancedMarker.current
    const core = coreLibrary.current
    if (!map || !maps || !core || !Marker) return
    routePolylines.current.forEach(polyline => polyline.setMap(null))
    routeMarkers.current.forEach(marker => { marker.map = null })
    routePolylines.current = [new maps.Polyline({ map, path: route.path, strokeColor: '#315340', strokeOpacity: 0.92, strokeWeight: 6, geodesic: true, zIndex: 2 })]
    const createPin = (kind: 'pickup' | 'destination') => {
      const pin = document.createElement('span')
      pin.className = `avanti-route-pin avanti-route-pin-${kind}`
      pin.setAttribute('aria-hidden', 'true')
      return pin
    }
    routeMarkers.current = [
      new Marker({ map, position: origin, title: 'Pickup location', content: createPin('pickup') }),
      new Marker({ map, position: destination, title: 'Destination', content: createPin('destination') }),
    ]
    const bounds = new core.LatLngBounds()
    bounds.extend(origin)
    bounds.extend(destination)
    for (const value of route.path) {
      if (!value || typeof value !== 'object') continue
      const candidate = value as { lat?: number | (() => number); lng?: number | (() => number) }
      const lat = typeof candidate.lat === 'function' ? candidate.lat() : candidate.lat
      const lng = typeof candidate.lng === 'function' ? candidate.lng() : candidate.lng
      if (Number.isFinite(lat) && Number.isFinite(lng)) bounds.extend({ lat: lat as number, lng: lng as number })
    }
    map.fitBounds(bounds, 56)
  }

  useImperativeHandle(ref, () => ({
    showCurrentLocation(point) {
      currentLocation.current = point
      const map = mapInstance.current
      const Marker = AdvancedMarker.current
      if (!map || !Marker) return
      map.setCenter(point)
      map.setZoom(16)
      if (locationMarker.current) {
        locationMarker.current.position = point
        locationMarker.current.map = map
      } else {
        locationMarker.current = new Marker({ map, position: point, title: 'Your current pickup location' })
      }
    },
    clearCurrentLocation() {
      currentLocation.current = null
      if (locationMarker.current) locationMarker.current.map = null
      locationMarker.current = null
    },
    showDriverLocation(point, headingDegrees) {
      const map = mapInstance.current
      const Marker = AdvancedMarker.current
      if (!map || !Marker) return
      if (!driverMarker.current) {
        const content = document.createElement('span')
        content.className = 'avanti-live-car-marker'
        content.textContent = '▲'
        driverMarkerContent.current = content
        map.setCenter(point)
        map.setZoom(15)
        driverMarker.current = new Marker({ map, position: point, title: 'Driver live GPS location', content })
      } else {
        if (driverAnimation.current !== null) cancelAnimationFrame(driverAnimation.current)
        const from = driverMarker.current.position
        const beganAt = performance.now()
        const duration = 700
        const update = (now: number) => {
          const progress = Math.min(1, (now - beganAt) / duration)
          const eased = 1 - (1 - progress) ** 3
          driverMarker.current!.position = {
            lat: from.lat + (point.lat - from.lat) * eased,
            lng: from.lng + (point.lng - from.lng) * eased,
          }
          if (progress < 1) driverAnimation.current = requestAnimationFrame(update)
          else driverAnimation.current = null
        }
        driverAnimation.current = requestAnimationFrame(update)
      }
      if (typeof headingDegrees === 'number' && Number.isFinite(headingDegrees) && driverMarkerContent.current) {
        driverMarkerContent.current.style.transform = `rotate(${headingDegrees}deg)`
      }
    },
    clearDriverLocation() {
      if (driverAnimation.current !== null) cancelAnimationFrame(driverAnimation.current)
      driverAnimation.current = null
      if (driverMarker.current) driverMarker.current.map = null
      driverMarker.current = null
      driverMarkerContent.current = null
    },
    showRoute(route, origin, destination) { drawRoute(route, origin, destination) },
    clearRoute,
  }), [])

  useEffect(() => {
    let mounted = true
    let authenticationFailed = false
    const mapsWindow = window as MapsAuthWindow
    const previousAuthFailure = mapsWindow.gm_authFailure
    const handleAuthFailure = () => {
      authenticationFailed = true
      if (mounted) {
        setError(`Google rejected this Maps key for ${window.location.origin}. Allow this website in the key's HTTP referrer restrictions, and check billing and Maps JavaScript API access.`)
        setState('error')
      }
      previousAuthFailure?.()
    }
    mapsWindow.gm_authFailure = handleAuthFailure

    if (!hasApiKey) {
      setError('Add VITE_GOOGLE_MAPS_API_KEY to your .env file, then restart the Vite server.')
      setState('error')
      return () => {
        mounted = false
        if (mapsWindow.gm_authFailure === handleAuthFailure) mapsWindow.gm_authFailure = previousAuthFailure
      }
    }

    setState('loading')
    setError('')
    void loadGoogleMaps()
      .then(({ core, maps, marker }) => {
        if (!mounted || authenticationFailed || !mapElement.current) return
        coreLibrary.current = core
        mapsLibrary.current = maps
        AdvancedMarker.current = marker.AdvancedMarkerElement
        mapInstance.current = new maps.Map(mapElement.current, {
          zoom: 2,
          mapId: import.meta.env.VITE_GOOGLE_MAPS_MAP_ID?.trim() || 'DEMO_MAP_ID',
          gestureHandling: 'greedy',
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          zoomControl: true,
        })
        if (currentLocation.current) {
          mapInstance.current.setCenter(currentLocation.current)
          mapInstance.current.setZoom(16)
          locationMarker.current = new marker.AdvancedMarkerElement({
            map: mapInstance.current,
            position: currentLocation.current,
            title: 'Your current pickup location',
          })
        }
        if (currentRoute.current) drawRoute(currentRoute.current.route, currentRoute.current.origin, currentRoute.current.destination)
        setState('ready')
      })
      .catch(cause => {
        if (!mounted) return
        const reason = cause instanceof Error ? cause.message : 'Google Maps could not be loaded.'
        setError(`${reason} Website origin: ${window.location.origin}. For a phone, allow this exact origin in Google Cloud's Maps key restrictions.`)
        setState('error')
      })

    return () => {
      mounted = false
      if (locationMarker.current) locationMarker.current.map = null
      locationMarker.current = null
      if (driverAnimation.current !== null) cancelAnimationFrame(driverAnimation.current)
      driverAnimation.current = null
      if (driverMarker.current) driverMarker.current.map = null
      driverMarker.current = null
      driverMarkerContent.current = null
      routePolylines.current.forEach(polyline => polyline.setMap(null))
      routePolylines.current = []
      routeMarkers.current.forEach(routeMarker => { routeMarker.map = null })
      routeMarkers.current = []
      AdvancedMarker.current = null
      coreLibrary.current = null
      mapsLibrary.current = null
      mapInstance.current = null
      if (mapsWindow.gm_authFailure === handleAuthFailure) mapsWindow.gm_authFailure = previousAuthFailure
    }
  }, [hasApiKey, retry])

  return <div className="map-placeholder map-stage google-map-stage" aria-label="Interactive Google Map">
    <div className="google-map-canvas" ref={mapElement} />
    {state === 'loading' && <div className="google-map-message" role="status"><span className="map-loading-spinner" />Loading Google Maps…</div>}
    {state === 'error' && <div className="google-map-message google-map-error" role="alert">
      <b>{hasApiKey ? 'Google Maps is unavailable' : 'Google Maps needs configuration'}</b>
      <span>{error}</span>
      {hasApiKey && <button type="button" onClick={() => setRetry(value => value + 1)}>Retry map</button>}
    </div>}
    {state === 'ready' && <span className="map-disclaimer google-map-disclaimer">Map preview · Use “My location” to set your pickup</span>}
  </div>
})

export default GoogleMapView
