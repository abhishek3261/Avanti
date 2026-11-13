import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { loadGoogleMaps, type AdvancedMarkerInstance, type GoogleMapInstance, type MapsPoint, type MarkerLibrary } from '../../lib/googleMaps'

type MapState = 'loading' | 'ready' | 'error'
type MapsAuthWindow = Window & { gm_authFailure?: () => void }

export type GoogleMapViewHandle = {
  showCurrentLocation: (point: MapsPoint) => void
  clearCurrentLocation: () => void
}

const GoogleMapView = forwardRef<GoogleMapViewHandle>(function GoogleMapView(_props, ref) {
  const mapElement = useRef<HTMLDivElement>(null)
  const mapInstance = useRef<GoogleMapInstance | null>(null)
  const AdvancedMarker = useRef<MarkerLibrary['AdvancedMarkerElement'] | null>(null)
  const locationMarker = useRef<AdvancedMarkerInstance | null>(null)
  const currentLocation = useRef<MapsPoint | null>(null)
  const [state, setState] = useState<MapState>('loading')
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const hasApiKey = Boolean(import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim())

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
      .then(({ maps, marker }) => {
        if (!mounted || authenticationFailed || !mapElement.current) return
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
      AdvancedMarker.current = null
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
