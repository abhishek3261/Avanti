import {
  ArrowDownUp, ArrowRight, ArrowUpRight, CarFront, Clock3, LocateFixed, MapPin,
  Plus, ShieldCheck, Sparkles, Star, Users, WalletCards,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import GoogleMapView, { type GoogleMapViewHandle } from '../components/maps/GoogleMapView'
import { createRide, listRides, updateRide, type Ride, type VehicleCategory } from '../lib/rides'
import { loadGoogleMaps, type MapsPoint, type PlaceAutocompletePrediction } from '../lib/googleMaps'

const vehicles = [
  { name: 'Mini', detail: 'Affordable everyday rides', price: '₹149', eta: '3 min', icon: CarFront },
  { name: 'Sedan', detail: 'A little more room to relax', price: '₹229', eta: '5 min', icon: CarFront },
  { name: 'SUV', detail: 'Space for everyone & everything', price: '₹349', eta: '7 min', icon: CarFront },
]

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
  const [selected, setSelected] = useState('Mini')
  const [pickup, setPickup] = useState('')
  const [pickupPoint, setPickupPoint] = useState<MapsPoint | null>(null)
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

  const activeRide = rides.find(ride => ride.status === 'requested' || ride.status === 'accepted')

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
    const timer = window.setInterval(() => { void refreshRides() }, 3000)
    return () => { active = false; window.clearInterval(timer) }
  }, [])

  const requestRide = async () => {
    if (!pickup.trim() || !destination.trim() || activeRide || bookingBusy) return
    setBookingBusy(true)
    setRideError('')
    try {
      const ride = await createRide({ pickup: pickup.trim(), destination: destination.trim(), vehicle: selected as VehicleCategory })
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

  const useCurrentLocation = () => {
    locationRequestId.current += 1
    const requestId = locationRequestId.current
    setLocationError('')
    setLocationMessage('')

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
    setPickup(value)
    setPickupPoint(null)
    setLocating(false)
    setLocationError('')
    setLocationMessage('')
    mapRef.current?.clearCurrentLocation()
  }

  const swapLocations = () => {
    locationRequestId.current += 1
    setLocating(false)
    setLocationError('')
    setLocationMessage('')
    setPickup(destination)
    setPickupPoint(destinationPoint)
    setDestination(pickup)
    setDestinationPoint(pickupPoint)
    if (destinationPoint) mapRef.current?.showCurrentLocation(destinationPoint)
    else mapRef.current?.clearCurrentLocation()
  }

  return <div className="rider-app rider-dashboard">
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

    <div className="rider-grid">
      <div className="rider-booking-stack">
        <GoogleMapView ref={mapRef} />

        <section className="booking-panel glass-panel" id="ride-booking">
          <div className="panel-heading">
            <div><span className="eyebrow">PLAN A RIDE</span><h2>Let’s get you there.</h2></div>
            <span className="panel-number">01 / BOOK</span>
          </div>

          <div className="location-fields">
            <div className="location-rail"><span className="rail-dot pickup-dot" /><span className="rail-dash" /><span className="rail-destination" /></div>
            <div className="pickup-location-wrap">
              <label className="location-field pickup-location-field">
                <span>Pickup location</span>
                <input aria-label="Pickup location" value={pickup} onChange={event => handlePickupChange(event.target.value)} placeholder="Enter pickup or use GPS" />
              </label>
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
          {pickupPoint && <p className="pickup-coordinate-note">GPS: {pickupPoint.lat.toFixed(5)}, {pickupPoint.lng.toFixed(5)}</p>}

        </section>

        <section className="vehicle-panel" id="ride-options">
          <div className="vehicle-heading"><span>Choose your ride</span><small>Sample fares · Estimates only</small></div>
          <div className="vehicle-list">
            {vehicles.map(vehicle => {
              const Icon = vehicle.icon
              return <button key={vehicle.name} onClick={() => setSelected(vehicle.name)} className={`vehicle-card ${selected === vehicle.name ? 'selected' : ''}`} aria-pressed={selected === vehicle.name}>
                <span className="vehicle-icon"><Icon size={27} /></span>
                <span className="vehicle-info"><b>{vehicle.name}</b><small>{vehicle.detail}</small><span className="vehicle-meta"><Clock3 size={12} /> {vehicle.eta} away <span className="seat-meta"><Users size={12} /> {vehicle.name === 'Mini' ? '3' : '4'} seats</span></span></span>
                <span className="vehicle-price">{vehicle.price}<small>est.</small></span>
                {selected === vehicle.name && <span className="selected-check" aria-label="Selected">✓</span>}
              </button>
            })}
          </div>
          <button className="button button-dark book-button" onClick={requestRide} disabled={!pickup.trim() || !destination.trim() || bookingBusy || Boolean(activeRide)}>{bookingBusy ? 'Sending request…' : activeRide ? 'Request sent' : `Request ${selected}`} {!bookingBusy && !activeRide && <ArrowRight size={16} />}</button>
          {activeRide && <div className="booking-confirm" role="status"><Sparkles size={16} /><span><b>{activeRide.status === 'accepted' ? 'Ride accepted' : 'Finding your driver'}</b> {activeRide.status === 'accepted' ? `Your driver${activeRide.driverName ? `, ${activeRide.driverName},` : ''} accepted your ${activeRide.vehicle} ride.` : 'Your request is visible in the driver portal.'}</span><button className="rider-cancel-ride" disabled={rideActionBusy} onClick={cancelRide}>{rideActionBusy ? 'Cancelling…' : 'Cancel'}</button></div>}
          {rideError && <p className="ride-error" role="alert">{rideError}</p>}
          {!activeRide && rides[0]?.status === 'declined' && <div className="booking-confirm ride-declined" role="status"><span><b>Request declined</b> Try another ride request.</span></div>}
          {!activeRide && rides[0]?.status === 'cancelled' && <div className="booking-confirm ride-declined" role="status"><span><b>Ride cancelled</b> You can request another ride whenever you are ready.</span></div>}
          <p className="booking-fineprint"><ShieldCheck size={13} /> Sample fares only. Your ride request is shared with drivers; payment is not available yet.</p>
        </section>
      </div>

      <aside className="rider-side">
        <div className="side-greeting">
          <span className="eyebrow">A NOTE FOR THE ROAD</span><span className="side-flower">✳</span>
          <h3>Good days<br />are <em>ahead.</em></h3><p>Take a breath. We’ll take it from here.</p>
        </div>
        <div className="side-offer"><span className="offer-icon"><WalletCards size={21} /></span><div><b>Simple, upfront pricing.</b><p>Your sample fare is shown before you ride.</p><a href="#ride-options">See ride options <ArrowUpRight size={12} /></a></div></div>
        <div className="side-driver"><div className="driver-mini-avatar">A</div><div className="driver-mini-info"><span className="eyebrow">SAMPLE DRIVER PROFILE</span><b>Alex M. <span className="rating"><Star size={11} fill="currentColor" /> 4.9</span></b><small>Avanti partner · Sample profile</small></div><div className="car-mini">✳</div></div>
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
