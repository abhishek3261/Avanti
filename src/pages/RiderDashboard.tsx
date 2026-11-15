import {
  ArrowDownUp, ArrowRight, ArrowUpRight, CarFront, Clock3, LocateFixed, MapPin,
  Plus, ShieldCheck, Sparkles, Star, Users, WalletCards, Copy, PhoneCall, Share2, Navigation,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import GoogleMapView, { type GoogleMapViewHandle } from '../components/maps/GoogleMapView'
import { createRide, createShareLink, listRides, revokeShareLink, updateRide, type Ride, type VehicleCategory } from '../lib/rides'
import { calculateDrivingRoute, loadGoogleMaps, type DrivingRoute, type MapsPoint, type PlaceAutocompletePrediction } from '../lib/googleMaps'
import { calculateFare, fareConfig } from '../lib/fares'
import { connectSessionRealtime } from '../lib/realtime'

const vehicles = [
  { name: 'Mini', detail: 'Affordable everyday rides', icon: CarFront },
  { name: 'Sedan', detail: 'A little more room to relax', icon: CarFront },
  { name: 'SUV', detail: 'Space for everyone & everything', icon: CarFront },
]

const currency = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })
const currencyExact = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 })

function googleErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const detail = error as { message?: unknown; code?: unknown; status?: unknown; name?: unknown }
    const message = typeof detail.message === 'string' ? detail.message : ''
    const code = typeof detail.code === 'string' || typeof detail.code === 'number' ? String(detail.code) : ''
    const status = typeof detail.status === 'string' ? detail.status : ''
    return [message || (typeof detail.name === 'string' ? detail.name : ''), status, code && `code ${code}`]
      .filter(Boolean)
      .join(' — ') || 'Google returned an error without details.'
  }
  return 'Google returned an error without details.'
}

export default function RiderDashboard() {
  const { user } = useAuth()
  const mapRef = useRef<GoogleMapViewHandle>(null)
  const locationRequestId = useRef(0)
  const pickupResolveId = useRef(0)
  const [selected, setSelected] = useState('Mini')
  const [pickup, setPickup] = useState('')
  const [pickupPoint, setPickupPoint] = useState<MapsPoint | null>(null)
  const [pickupSuggestions, setPickupSuggestions] = useState<PlaceAutocompletePrediction[]>([])
  const [pickupSearchBusy, setPickupSearchBusy] = useState(false)
  const [pickupSearchError, setPickupSearchError] = useState('')
  const pickupPlacesSession = useRef<object | null>(null)
  const pickupRequestId = useRef(0)
  const [destination, setDestination] = useState('')
  const [destinationPoint, setDestinationPoint] = useState<MapsPoint | null>(null)
  const [destinationSuggestions, setDestinationSuggestions] = useState<PlaceAutocompletePrediction[]>([])
  const [destinationSearchBusy, setDestinationSearchBusy] = useState(false)
  const [destinationSearchError, setDestinationSearchError] = useState('')
  const placesSession = useRef<object | null>(null)
  const destinationRequestId = useRef(0)
  const [rides, setRides] = useState<Ride[]>([])
  const [bookingBusy, setBookingBusy] = useState(false)
  const [rideActionBusy, setRideActionBusy] = useState(false)
  const [rideError, setRideError] = useState('')
  const [locating, setLocating] = useState(false)
  const [locationMessage, setLocationMessage] = useState('')
  const [locationError, setLocationError] = useState('')
  const [pickupResolveBusy, setPickupResolveBusy] = useState(false)
  const [pickupResolveError, setPickupResolveError] = useState('')
  const [route, setRoute] = useState<DrivingRoute | null>(null)
  const [routeBusy, setRouteBusy] = useState(false)
  const [routeError, setRouteError] = useState('')
  const [driverRoute, setDriverRoute] = useState<DrivingRoute | null>(null)
  const [driverRouteBusy, setDriverRouteBusy] = useState(false)
  const [driverRouteError, setDriverRouteError] = useState('')
  const [shareUrl, setShareUrl] = useState('')
  const [shareBusy, setShareBusy] = useState(false)
  const [shareMessage, setShareMessage] = useState('')
  const [shareError, setShareError] = useState('')
  const lastDriverRouteRequestAt = useRef(0)

  const activeRide = rides.find(ride => ['requested', 'accepted', 'driver_arriving', 'driver_arrived', 'in_progress'].includes(ride.status))
  const selectedFare = route ? calculateFare(selected as VehicleCategory, route.distanceMeters, route.durationMillis) : null

  useEffect(() => {
    let active = true
    mapRef.current?.clearRoute()
    setRoute(null)
    setRouteError('')
    if (!pickupPoint || !destinationPoint) {
      setRouteBusy(false)
      return () => { active = false }
    }

    setRouteBusy(true)
    void calculateDrivingRoute(pickupPoint, destinationPoint)
      .then(result => {
        if (!active) return
        setRoute(result)
        mapRef.current?.showRoute(result, pickupPoint, destinationPoint)
      })
      .catch(error => {
        if (active) setRouteError(googleErrorMessage(error))
      })
      .finally(() => { if (active) setRouteBusy(false) })
    return () => { active = false }
  }, [pickupPoint, destinationPoint])

  useEffect(() => {
    const query = destination.trim()
    const requestId = ++destinationRequestId.current
    if (destinationPoint || query.length < 3) {
      setDestinationSuggestions([])
      setDestinationSearchBusy(false)
      setDestinationSearchError('')
      return
    }

    const timer = window.setTimeout(() => {
      setDestinationSearchBusy(true)
      setDestinationSearchError('')
      void loadGoogleMaps()
        .then(({ places }) => {
          placesSession.current ??= new places.AutocompleteSessionToken()
          return places.AutocompleteSuggestion.fetchAutocompleteSuggestions({ input: query, sessionToken: placesSession.current, region: 'in' })
        })
        .then(({ suggestions }) => {
          if (requestId === destinationRequestId.current) {
            setDestinationSuggestions(suggestions.flatMap(item => item.placePrediction ? [item.placePrediction] : []))
          }
        })
        .catch(error => {
          if (requestId === destinationRequestId.current) {
            const detail = googleErrorMessage(error)
            console.error('Google Places destination autocomplete failed:', error)
            setDestinationSuggestions([])
            setDestinationSearchError(`Google Places error: ${detail}`)
          }
        })
        .finally(() => {
          if (requestId === destinationRequestId.current) setDestinationSearchBusy(false)
        })
    }, 250)

    return () => window.clearTimeout(timer)
  }, [destination, destinationPoint])

  useEffect(() => {
    const query = pickup.trim()
    const requestId = ++pickupRequestId.current
    if (pickupPoint || query.length < 3) {
      setPickupSuggestions([])
      setPickupSearchBusy(false)
      setPickupSearchError('')
      return () => { pickupRequestId.current += 1 }
    }

    const timer = window.setTimeout(() => {
      setPickupSearchBusy(true)
      setPickupSearchError('')
      void loadGoogleMaps()
        .then(({ places }) => {
          pickupPlacesSession.current ??= new places.AutocompleteSessionToken()
          return places.AutocompleteSuggestion.fetchAutocompleteSuggestions({ input: query, sessionToken: pickupPlacesSession.current, region: 'in' })
        })
        .then(({ suggestions }) => {
          if (requestId === pickupRequestId.current) {
            setPickupSuggestions(suggestions.flatMap(item => item.placePrediction ? [item.placePrediction] : []))
          }
        })
        .catch(error => {
          if (requestId === pickupRequestId.current) {
            console.error('Google Places pickup autocomplete failed:', error)
            setPickupSuggestions([])
            setPickupSearchError(`Google Places error: ${googleErrorMessage(error)}`)
          }
        })
        .finally(() => {
          if (requestId === pickupRequestId.current) setPickupSearchBusy(false)
        })
    }, 250)

    return () => {
      window.clearTimeout(timer)
      pickupRequestId.current += 1
    }
  }, [pickup, pickupPoint])

  const selectPickup = async (prediction: PlaceAutocompletePrediction) => {
    const requestId = ++pickupRequestId.current
    pickupResolveId.current += 1
    setPickupSearchBusy(true)
    setPickupSearchError('')
    setPickupSuggestions([])
    setPickupResolveError('')
    try {
      const place = prediction.toPlace()
      await place.fetchFields({ fields: ['formattedAddress', 'location'] })
      if (requestId !== pickupRequestId.current) return
      const location = place.location
      const point = location && typeof (location as { lat?: unknown }).lat === 'function'
        ? { lat: (location as { lat: () => number }).lat(), lng: (location as { lng: () => number }).lng() }
        : location as MapsPoint | undefined
      if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) throw new Error('Place has no usable location')
      setPickupPoint(point)
      setPickup(place.formattedAddress || prediction.text.toString())
      pickupPlacesSession.current = null
    } catch (error) {
      if (requestId === pickupRequestId.current) {
        console.error('Google Places pickup details failed:', error)
        setPickupSearchError(`Could not load pickup details: ${googleErrorMessage(error)}`)
      }
    } finally {
      if (requestId === pickupRequestId.current) setPickupSearchBusy(false)
    }
  }

  const selectDestination = async (prediction: PlaceAutocompletePrediction) => {
    const requestId = ++destinationRequestId.current
    setDestinationSearchBusy(true)
    setDestinationSearchError('')
    setDestinationSuggestions([])
    try {
      const place = prediction.toPlace()
      await place.fetchFields({ fields: ['formattedAddress', 'location'] })
      if (requestId !== destinationRequestId.current) return
      const location = place.location
      let point: MapsPoint | undefined
      if (location && typeof (location as { lat?: unknown }).lat === 'function') {
        const latLng = location as { lat: () => number; lng: () => number }
        point = { lat: latLng.lat(), lng: latLng.lng() }
      } else {
        point = location as MapsPoint | undefined
      }
      if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) throw new Error('Place has no usable location')
      setDestinationPoint(point)
      setDestination(place.formattedAddress || prediction.text.toString())
      placesSession.current = null
    } catch (error) {
      if (requestId === destinationRequestId.current) {
        console.error('Google Places destination details failed:', error)
        setDestinationSearchError(`Could not load destination details: ${googleErrorMessage(error)}`)
      }
    } finally {
      if (requestId === destinationRequestId.current) setDestinationSearchBusy(false)
    }
  }

  useEffect(() => {
    let active = true
    const refreshRides = async () => {
      try {
        const latest = await listRides()
        if (active) setRides(latest)
      } catch {
        // Keep the last known ride status visible during temporary network loss.
      }
    }
    void refreshRides()
    const timer = window.setInterval(() => { void refreshRides() }, 15000)
    return () => { active = false; window.clearInterval(timer) }
  }, [])

  useEffect(() => {
    const socket = connectSessionRealtime()
    const applyRide = (ride: Ride) => setRides(current => [ride, ...current.filter(item => item.id !== ride.id)])
    const applyDriverLocation = (event: { rideId: string; location: NonNullable<Ride['driverLocation']> }) => {
      setRides(current => current.map(ride => ride.id === event.rideId ? { ...ride, driverLocation: event.location } : ride))
    }
    socket.on('ride:updated', applyRide)
    socket.on('driver:location', applyDriverLocation)
    socket.on('connect', () => { void listRides().then(setRides).catch(() => undefined) })
    return () => {
      socket.off('ride:updated', applyRide)
      socket.off('driver:location', applyDriverLocation)
    }
  }, [])

  useEffect(() => {
    const activeLocation = activeRide?.driverLocation
    const pickupPointForRide = activeRide?.pickupPoint
    const destinationForRide = activeRide?.destinationPoint
    if (!activeRide || !activeLocation) {
      mapRef.current?.clearDriverLocation()
      setDriverRoute(null)
      return
    }

    const origin = { lat: activeLocation.latitude, lng: activeLocation.longitude }
    mapRef.current?.showDriverLocation(origin, activeLocation.headingDegrees)
    const isTripInProgress = activeRide.status === 'in_progress'
    const target = isTripInProgress ? destinationForRide : pickupPointForRide
    if (!target) return
    const now = Date.now()
    if (now - lastDriverRouteRequestAt.current < 12_000) return
    lastDriverRouteRequestAt.current = now
    let current = true
    const timer = window.setTimeout(() => {
      setDriverRouteBusy(true)
      setDriverRouteError('')
      void calculateDrivingRoute(origin, target)
        .then(result => {
          if (!current) return
          setDriverRoute(result)
          mapRef.current?.showRoute(result, origin, target)
        })
        .catch(error => {
          if (current) setDriverRouteError(error instanceof Error ? error.message : 'Could not update the driver route.')
        })
        .finally(() => { if (current) setDriverRouteBusy(false) })
    }, 400)
    return () => { current = false; window.clearTimeout(timer) }
  }, [activeRide?.id, activeRide?.status, activeRide?.driverLocation?.recordedAt, activeRide?.driverLocation?.latitude, activeRide?.driverLocation?.longitude])

  const requestRide = async () => {
    if (!pickup.trim() || !destination.trim() || !route || !selectedFare || activeRide || bookingBusy) return
    setBookingBusy(true)
    setRideError('')
    try {
      if (!pickupPoint || !destinationPoint) throw new Error('Select pickup and destination places before requesting a ride.')
      const ride = await createRide({
        pickup: pickup.trim(), destination: destination.trim(), vehicle: selected as VehicleCategory,
        pickupLat: pickupPoint.lat, pickupLng: pickupPoint.lng,
        destinationLat: destinationPoint.lat, destinationLng: destinationPoint.lng,
        routeDistanceMeters: route.distanceMeters,
        routeDurationSeconds: Math.max(1, Math.round(route.durationMillis / 1000)),
      })
      setRides(current => [ride, ...current.filter(item => item.id !== ride.id)])
    } catch (error) {
      setRideError(error instanceof Error ? error.message : 'Could not send your ride request.')
    } finally {
      setBookingBusy(false)
    }
  }

  const cancelRide = async () => {
    if (!activeRide || rideActionBusy) return
    setRideActionBusy(true)
    setRideError('')
    try {
      const updated = await updateRide(activeRide.id, 'cancel')
      setRides(current => current.map(ride => ride.id === updated.id ? updated : ride))
    } catch (error) {
      setRideError(error instanceof Error ? error.message : 'Could not cancel this ride.')
    } finally {
      setRideActionBusy(false)
    }
  }

  const shareTrip = async () => {
    if (!activeRide || !['accepted', 'driver_arriving', 'driver_arrived', 'in_progress'].includes(activeRide.status) || shareBusy) return
    setShareBusy(true)
    setShareError('')
    setShareMessage('')
    try {
      const link = await createShareLink(activeRide.id)
      setShareUrl(link.url)
      if (navigator.share) {
        await navigator.share({ title: 'My Avanti trip', text: `Track my ride from ${activeRide.pickup} to ${activeRide.destination}.`, url: link.url })
      } else {
        await navigator.clipboard.writeText(link.url)
        setShareMessage('Trip link copied. It expires when the trip ends or in 6 hours.')
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return
      setShareError(error instanceof Error ? error.message : 'Could not create the trip link.')
    } finally {
      setShareBusy(false)
    }
  }

  const copyShareLink = async () => {
    if (!shareUrl) return
    try {
      await navigator.clipboard.writeText(shareUrl)
      setShareMessage('Trip link copied to clipboard.')
    } catch {
      setShareError('Copy is unavailable in this browser. Use Share Trip or select and copy the link.')
    }
  }

  const revokeShare = async () => {
    if (!activeRide) return
    try {
      await revokeShareLink(activeRide.id)
      setShareUrl('')
      setShareMessage('Trip sharing revoked.')
    } catch (error) {
      setShareError(error instanceof Error ? error.message : 'Could not revoke this trip link.')
    }
  }

  const useCurrentLocation = () => {
    locationRequestId.current += 1
    pickupResolveId.current += 1
    const requestId = locationRequestId.current
    setLocationError('')
    setLocationMessage('')
    setPickupResolveBusy(false)
    setPickupResolveError('')

    if (!window.isSecureContext) {
      setLocationError('Phone GPS needs a secure HTTPS page. This Wi-Fi address uses HTTP; use a trusted HTTPS development URL to enable location.')
      return
    }
    if (!navigator.geolocation) {
      setLocationError('Location is not available in this browser. You can enter the pickup address manually.')
      return
    }

    setLocating(true)
    navigator.geolocation.getCurrentPosition(position => {
      if (requestId !== locationRequestId.current) return
      const point = { lat: position.coords.latitude, lng: position.coords.longitude }
      const coordinateLabel = `Current location (${point.lat.toFixed(5)}, ${point.lng.toFixed(5)})`
      setPickupPoint(point)
      mapRef.current?.showCurrentLocation(point)

      void loadGoogleMaps()
        .then(({ maps }) => new maps.Geocoder().geocode({ location: point }))
        .then(({ results }) => {
          if (requestId !== locationRequestId.current) return
          const address = results[0]?.formatted_address
          setPickup(address || coordinateLabel)
          setLocationMessage(address ? 'Your current location is set as the pickup.' : `Pickup set to GPS coordinates: ${coordinateLabel}`)
        })
        .catch(() => {
          if (requestId !== locationRequestId.current) return
          setPickup(coordinateLabel)
          setLocationMessage('GPS location found. Address lookup is unavailable, so pickup is set to the actual coordinates.')
        })
        .finally(() => {
          if (requestId === locationRequestId.current) setLocating(false)
        })
    }, error => {
      if (requestId !== locationRequestId.current) return
      setLocating(false)
      setLocationError(error.code === error.PERMISSION_DENIED
        ? 'Location permission was denied. Allow location access in your browser settings or enter the pickup manually.'
        : error.code === error.POSITION_UNAVAILABLE
          ? 'Your device could not determine its location. Check that device location services are on and try again.'
          : 'Getting your location timed out. Try again or enter the pickup manually.')
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 })
  }

  const handlePickupChange = (value: string) => {
    locationRequestId.current += 1
    pickupResolveId.current += 1
    pickupPlacesSession.current = null
    setPickup(value)
    setPickupPoint(null)
    setLocating(false)
    setLocationError('')
    setLocationMessage('')
    setPickupResolveBusy(false)
    setPickupResolveError('')
    mapRef.current?.clearCurrentLocation()
  }

  const resolvePickupAddress = () => {
    const address = pickup.trim()
    if (!address || pickupPoint || pickupResolveBusy) return
    const requestId = ++pickupResolveId.current
    setPickupResolveBusy(true)
    setPickupResolveError('')
    void loadGoogleMaps()
      .then(({ maps }) => new maps.Geocoder().geocode({ address }))
      .then(({ results }) => {
        if (requestId !== pickupResolveId.current) return
        const match = results[0]
        if (!match) throw new Error('No matching pickup address was found. Try a more specific address or use My location.')
        const point = { lat: match.geometry.location.lat(), lng: match.geometry.location.lng() }
        setPickupPoint(point)
        if (match.formatted_address) setPickup(match.formatted_address)
      })
      .catch(error => {
        if (requestId === pickupResolveId.current) setPickupResolveError(googleErrorMessage(error))
      })
      .finally(() => { if (requestId === pickupResolveId.current) setPickupResolveBusy(false) })
  }

  const swapLocations = () => {
    locationRequestId.current += 1
    pickupResolveId.current += 1
    setLocating(false)
    setLocationError('')
    setLocationMessage('')
    setPickupResolveBusy(false)
    setPickupResolveError('')
    setPickup(destination)
    setPickupPoint(destinationPoint)
    setDestination(pickup)
    setDestinationPoint(pickupPoint)
    if (destinationPoint) mapRef.current?.showCurrentLocation(destinationPoint)
    else mapRef.current?.clearCurrentLocation()
  }

  return <div className="rider-app rider-dashboard">
    <div className="rider-grid">
      <div className="rider-map-column">
        <GoogleMapView ref={mapRef} />
      </div>

      <div className="dashboard-topline">
        <div>
          <span className="eyebrow">YOUR NEXT GOOD JOURNEY</span>
          <h1>Where to, <em>friend?</em></h1>
          <p>Let’s find a ride that fits your day.</p>
        </div>
        <div className="rider-user rider-profile-card">
          <div className="user-avatar">{user?.name.slice(0, 1).toUpperCase()}</div>
          <div><b>{user?.name}</b><small>{user?.email}</small></div>
          <span className="profile-role">RIDER</span>
        </div>
      </div>

      <section className="booking-panel glass-panel" id="ride-booking">
          <div className="panel-heading">
            <div><span className="eyebrow">PLAN A RIDE</span><h2>Let’s get you there.</h2></div>
            <span className="panel-number">01 / BOOK</span>
          </div>

          <div className="location-fields">
            <div className="location-rail"><span className="rail-dot pickup-dot" /><span className="rail-dash" /><span className="rail-destination" /></div>
            <div className="pickup-location-wrap">
              <div className="pickup-field-wrap">
                <label className="location-field pickup-location-field">
                  <span>Pickup location</span>
                  <input aria-label="Pickup location" aria-autocomplete="list" aria-controls="pickup-suggestions" aria-expanded={pickupSuggestions.length > 0} value={pickup} onChange={event => handlePickupChange(event.target.value)} onBlur={resolvePickupAddress} placeholder="Enter pickup or use GPS" />
                </label>
                {(pickupSuggestions.length > 0 || pickupSearchBusy || pickupSearchError) && <div className="destination-suggestions" id="pickup-suggestions" role="listbox" aria-label="Pickup suggestions">
                  {pickupSuggestions.map((suggestion, index) => <button key={`${suggestion.text.toString()}-${index}`} type="button" role="option" className="destination-suggestion" onMouseDown={event => event.preventDefault()} onClick={() => void selectPickup(suggestion)}>
                    <MapPin size={15} /><span>{suggestion.text.toString()}</span>
                  </button>)}
                  {pickupSearchBusy && <p className="destination-search-status" role="status">Searching places…</p>}
                  {pickupSearchError && <p className="destination-search-error" role="alert">{pickupSearchError}</p>}
                  {!pickupSearchBusy && !pickupSearchError && pickupSuggestions.length === 0 && pickup.trim().length >= 3 && <p className="destination-search-status">No matching places found.</p>}
                </div>}
              </div>
              <button className="pickup-current-location" type="button" onClick={useCurrentLocation} disabled={locating} aria-label="Use current location as pickup">
                <LocateFixed size={15} /><span>{locating ? 'Locating…' : 'My location'}</span>
              </button>
            </div>
            <button className="swap-locations" aria-label="Swap pickup and destination" onClick={swapLocations}><ArrowDownUp size={15} /></button>
            <div className="destination-field-wrap">
            <label className="location-field">
              <span>Destination</span>
              <input aria-label="Destination" aria-autocomplete="list" aria-controls="destination-suggestions" aria-expanded={destinationSuggestions.length > 0} value={destination} onChange={event => { setDestination(event.target.value); setDestinationPoint(null) }} placeholder="Where are you going?" />
              <span className="field-add"><Plus size={14} /></span>
            </label>
            {(destinationSuggestions.length > 0 || destinationSearchBusy || destinationSearchError) && <div className="destination-suggestions" id="destination-suggestions" role="listbox" aria-label="Destination suggestions">
              {destinationSuggestions.map((suggestion, index) => <button key={`${suggestion.text.toString()}-${index}`} type="button" role="option" className="destination-suggestion" onClick={() => void selectDestination(suggestion)}>
                <MapPin size={15} /><span>{suggestion.text.toString()}</span>
              </button>)}
              {destinationSearchBusy && <p className="destination-search-status" role="status">Searching places…</p>}
              {destinationSearchError && <p className="destination-search-error" role="alert">{destinationSearchError}</p>}
              {!destinationSearchBusy && !destinationSearchError && destinationSuggestions.length === 0 && destination.trim().length >= 3 && <p className="destination-search-status">No matching places found.</p>}
            </div>}
            </div>
          </div>
          {(locationMessage || locationError) && <p className={`location-feedback ${locationError ? 'is-error' : ''}`} role={locationError ? 'alert' : 'status'}>{locationError || locationMessage}</p>}
          {pickupResolveBusy && <p className="route-state" role="status">Finding pickup coordinates…</p>}
          {pickupResolveError && <p className="route-error" role="alert">Pickup address: {pickupResolveError}</p>}
          {pickupPoint && <p className="pickup-coordinate-note">Pickup coordinates: {pickupPoint.lat.toFixed(5)}, {pickupPoint.lng.toFixed(5)}</p>}
          {routeBusy && <p className="route-state" role="status">Calculating the driving route…</p>}
          {routeError && <p className="route-error" role="alert">Route unavailable: {routeError}</p>}
          {route && <div className="route-summary" role="status">
            <span><MapPin size={15} />{(route.distanceMeters / 1000).toFixed(1)} km by road</span>
            <span><Clock3 size={15} />About {Math.max(1, Math.ceil(route.durationMillis / 60_000))} min</span>
          </div>}

          {activeRide && activeRide.status !== 'requested' && activeRide.driver && <section className="assigned-driver-card" aria-live="polite">
            <div className="assigned-driver-heading"><span className="eyebrow">{activeRide.status === 'in_progress' ? 'ON YOUR WAY' : 'DRIVER ASSIGNED'}</span><b>{activeRide.status.replace(/_/g, ' ')}</b></div>
            <div className="assigned-driver-main">
              <span className="assigned-driver-avatar">{activeRide.driver.name.slice(0, 1).toUpperCase()}</span>
              <div className="assigned-driver-info"><b>{activeRide.driver.name}</b><small>{activeRide.driver.rating != null ? <><Star size={12} fill="currentColor" /> {activeRide.driver.rating.toFixed(1)}{activeRide.driver.ratingCount ? ` · ${activeRide.driver.ratingCount} rides` : ''}</> : 'Avanti driver'}</small></div>
              {activeRide.driver.phone && <a className="driver-call-button" href={`tel:${activeRide.driver.phone}`} aria-label={`Call driver ${activeRide.driver.name}`}><PhoneCall size={16} /></a>}
            </div>
            <div className="assigned-vehicle-row"><CarFront size={17} /><span><b>{activeRide.driver.vehicleColor} {activeRide.driver.vehicleModel}</b><small>{activeRide.driver.vehicleRegistration}</small></span></div>
            <div className="driver-approach-summary">
              {driverRouteBusy ? <span><Navigation size={14} />Updating live route…</span> : driverRoute ? <>
                <span><MapPin size={14} />{(driverRoute.distanceMeters / 1000).toFixed(1)} km {activeRide.status === 'in_progress' ? 'remaining' : 'to pickup'}</span>
                <span><Clock3 size={14} />{Math.max(1, Math.ceil(driverRoute.durationMillis / 60_000))} min ETA</span>
              </> : <span><Navigation size={14} />ETA will appear when the route is available</span>}
              {activeRide.driverLocation && Date.now() - activeRide.driverLocation.updatedAt > 45_000 && <span className="driver-stale-warning">Last GPS update {new Date(activeRide.driverLocation.updatedAt).toLocaleTimeString()}</span>}
            </div>
            {driverRouteError && <p className="route-error">Live route unavailable: {driverRouteError}</p>}
            <div className="trip-sharing-actions">
              <button className="button button-dark" onClick={() => void shareTrip()} disabled={shareBusy}>{shareBusy ? 'Preparing link…' : <><Share2 size={15} /> Share trip</>}</button>
              {shareUrl && <>
                <button className="button button-outline" onClick={() => void copyShareLink()}><Copy size={14} /> Copy link</button>
                <a className="button button-outline" target="_blank" rel="noreferrer" href={`https://wa.me/?text=${encodeURIComponent(`Track my Avanti trip: ${shareUrl}`)}`}>WhatsApp</a>
                <button className="trip-share-revoke" onClick={() => void revokeShare()}>Revoke</button>
              </>}
            </div>
            {(shareMessage || shareError) && <p className={shareError ? 'route-error' : 'trip-share-message'} role={shareError ? 'alert' : 'status'}>{shareError || shareMessage}</p>}
          </section>}

      </section>

      <section className="vehicle-panel" id="ride-options">
          <div className="vehicle-heading"><span>Choose your ride</span><small>Sample fares · Estimates only</small></div>
          <div className="vehicle-list">
            {vehicles.map(vehicle => {
              const Icon = vehicle.icon
              return <button key={vehicle.name} onClick={() => setSelected(vehicle.name)} className={`vehicle-card ${selected === vehicle.name ? 'selected' : ''}`} aria-pressed={selected === vehicle.name}>
                <span className="vehicle-icon"><Icon size={27} /></span>
                <span className="vehicle-info"><b>{vehicle.name}</b><small>{vehicle.detail}</small><span className="vehicle-meta"><Users size={12} /> {vehicle.name === 'Mini' ? '3' : '4'} seats</span></span>
                <span className="vehicle-price">{route ? currency.format(calculateFare(vehicle.name as VehicleCategory, route.distanceMeters, route.durationMillis).total) : '—'}<small>{route ? 'est.' : 'route needed'}</small></span>
                {selected === vehicle.name && <span className="selected-check" aria-label="Selected">✓</span>}
              </button>
            })}
          </div>
          {route && selectedFare && <div className="fare-breakdown" aria-label="Estimated fare breakdown">
            <div className="fare-breakdown-heading"><div><b>{selected} estimated fare</b><small>Configurable Avanti demo rates</small></div><strong>{currency.format(selectedFare.total)}</strong></div>
            <dl>
              <div><dt>Base fare</dt><dd>{currencyExact.format(selectedFare.baseFare)}</dd></div>
              <div><dt>Distance · {(route.distanceMeters / 1000).toFixed(1)} km × {currencyExact.format(fareConfig[selected as VehicleCategory].perKmRate)}/km</dt><dd>{currencyExact.format(selectedFare.distanceCharge)}</dd></div>
              <div><dt>Time · {(route.durationMillis / 60_000).toFixed(1)} min × {currencyExact.format(fareConfig[selected as VehicleCategory].perMinuteRate)}/min</dt><dd>{currencyExact.format(selectedFare.timeCharge)}</dd></div>
              <div><dt>Booking fee</dt><dd>{currencyExact.format(selectedFare.bookingFee)}</dd></div>
              {selectedFare.adjustment !== 0 && <div><dt>{selectedFare.minimumFareApplied ? 'Minimum fare adjustment' : 'Rounding adjustment'}</dt><dd>{currencyExact.format(selectedFare.adjustment)}</dd></div>}
            </dl>
          </div>}
          <button className="button button-dark book-button" onClick={requestRide} disabled={!pickup.trim() || !destination.trim() || !route || routeBusy || bookingBusy || Boolean(activeRide)}>{bookingBusy ? "Sending request…" : activeRide ? "Request sent" : routeBusy ? "Calculating route…" : routeError ? "Route unavailable" : selectedFare ? "Request " + selected + " · " + currency.format(selectedFare.total) + " est." : "Set route to estimate fare"} {!bookingBusy && !activeRide && !routeBusy && route && selectedFare && <ArrowRight size={16} />}</button>
          {activeRide && <div className="booking-confirm" role="status"><Sparkles size={16} /><span><b>{activeRide.status === 'requested' ? 'Finding your driver' : activeRide.status.replace(/_/g, ' ')}</b> {activeRide.status === 'requested' ? 'Your request is visible to online drivers.' : activeRide.status === 'in_progress' ? 'Your ride is in progress.' : `Your ${activeRide.vehicle} driver is on the way.`}</span>{activeRide.status !== 'in_progress' && <button className="rider-cancel-ride" disabled={rideActionBusy} onClick={cancelRide}>{rideActionBusy ? 'Cancelling…' : 'Cancel'}</button>}</div>}
          {rideError && <p className="ride-error" role="alert">{rideError}</p>}
          {!activeRide && rides[0]?.status === 'rejected' && <div className="booking-confirm ride-declined" role="status"><span><b>Request expired or rejected</b> You can request another ride.</span></div>}
          {!activeRide && rides[0]?.status === 'cancelled' && <div className="booking-confirm ride-declined" role="status"><span><b>Ride cancelled</b> You can request another ride whenever you are ready.</span></div>}
          <p className="booking-fineprint"><ShieldCheck size={13} /> Sample fares only. Your ride request is shared with drivers; payment is not available yet.</p>
      </section>

      <aside className="rider-side">
        <div className="side-greeting">
          <span className="eyebrow">A NOTE FOR THE ROAD</span><span className="side-flower">✳</span>
          <h3>Good days<br />are <em>ahead.</em></h3><p>Take a breath. We’ll take it from here.</p>
        </div>
        <div className="side-offer"><span className="offer-icon"><WalletCards size={21} /></span><div><b>Simple, upfront pricing.</b><p>Your sample fare is shown before you ride.</p><a href="#ride-options">See ride options <ArrowUpRight size={12} /></a></div></div>
        <Link className="switch-portal" to="/driver/login">Drive with Avanti <ArrowUpRight size={13} /></Link>
      </aside>
    </div>
    <div className="dash-bottom-note"><span>✳</span> A little more joy in every journey. <span>— AVANTI</span></div>

    <nav className="rider-mobile-nav" aria-label="Rider shortcuts">
      <a className="active" href="#ride-booking"><MapPin size={17} /><span>Book</span></a>
      <a href="#ride-options"><CarFront size={17} /><span>Ride options</span></a>
      <Link to="/driver/login"><Users size={17} /><span>Drive</span></Link>
    </nav>
  </div>
}
