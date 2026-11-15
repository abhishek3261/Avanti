import { CarFront, Clock3, MapPin, Navigation, ShieldCheck, Star } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import GoogleMapView, { type GoogleMapViewHandle } from '../components/maps/GoogleMapView'
import { calculateDrivingRoute, type MapsPoint } from '../lib/googleMaps'
import { getSharedTrip, type SharedTrip } from '../lib/rides'
import { connectShareRealtime, disconnectRealtime } from '../lib/realtime'

const labels: Record<SharedTrip['status'], string> = {
  requested: 'Finding a driver', accepted: 'Driver assigned', driver_arriving: 'Driver heading to pickup',
  driver_arrived: 'Driver is at pickup', in_progress: 'Trip in progress', completed: 'Trip completed',
  rejected: 'Request expired', cancelled: 'Trip cancelled',
}

export default function SharedTripPage() {
  const { token = '' } = useParams()
  const mapRef = useRef<GoogleMapViewHandle>(null)
  const lastRouteAt = useRef(0)
  const [trip, setTrip] = useState<SharedTrip | null>(null)
  const [error, setError] = useState('')
  const [routeSummary, setRouteSummary] = useState<{ distance: number; duration: number } | null>(null)
  const [connectionWarning, setConnectionWarning] = useState('')

  const refreshTrip = useCallback(async () => {
    try {
      const result = await getSharedTrip(token)
      setTrip(result)
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'This shared trip is unavailable or has expired.')
    }
  }, [token])

  useEffect(() => {
    void refreshTrip()
    const socket = connectShareRealtime(token)
    const onUpdate = (update: Partial<SharedTrip>) => {
      setTrip(current => current ? { ...current, ...update } : current)
      if (update.status && ['completed', 'cancelled', 'rejected'].includes(update.status)) {
        setConnectionWarning('Trip sharing has ended.')
      }
    }
    const onLocation = (event: { location: NonNullable<SharedTrip['driverLocation']> }) => {
      setTrip(current => current ? { ...current, driverLocation: event.location } : current)
    }
    const onConnect = () => setConnectionWarning('')
    const onDisconnect = () => setConnectionWarning('Live updates disconnected. Showing the last received location.')
    socket.on('trip:updated', onUpdate)
    socket.on('trip:location', onLocation)
    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    socket.on('connect_error', onDisconnect)
    return () => {
      socket.off('trip:updated', onUpdate)
      socket.off('trip:location', onLocation)
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      socket.off('connect_error', onDisconnect)
      disconnectRealtime()
    }
  }, [refreshTrip, token])

  useEffect(() => {
    if (!trip?.pickupPoint || !trip.destinationPoint) return
    const approachingPickup = trip.status !== 'in_progress' && trip.driverLocation && !['completed', 'cancelled', 'rejected'].includes(trip.status)
    const origin: MapsPoint = (trip.status === 'in_progress' || approachingPickup) && trip.driverLocation
      ? { lat: trip.driverLocation.latitude, lng: trip.driverLocation.longitude }
      : trip.pickupPoint
    const destination = trip.status === 'in_progress' ? trip.destinationPoint : approachingPickup ? trip.pickupPoint : trip.destinationPoint
    if (Date.now() - lastRouteAt.current < 12_000) return
    lastRouteAt.current = Date.now()
    void calculateDrivingRoute(origin, destination).then(route => {
      mapRef.current?.showRoute(route, origin, destination)
      setRouteSummary({ distance: route.distanceMeters, duration: route.durationMillis })
    }).catch(() => undefined)
  }, [trip?.status, trip?.driverLocation?.recordedAt, trip?.driverLocation?.latitude, trip?.driverLocation?.longitude, trip?.pickupPoint?.lat, trip?.pickupPoint?.lng, trip?.destinationPoint?.lat, trip?.destinationPoint?.lng])

  useEffect(() => {
    if (!trip?.driverLocation) return
    mapRef.current?.showDriverLocation({ lat: trip.driverLocation.latitude, lng: trip.driverLocation.longitude }, trip.driverLocation.headingDegrees)
  }, [trip?.driverLocation?.recordedAt, trip?.driverLocation?.latitude, trip?.driverLocation?.longitude])

  return <main className="shared-trip-page">
    <header className="shared-trip-header"><Link to="/" className="brand"><span className="brand-mark">a<span>.</span></span><span className="brand-name">avanti</span></Link><span><ShieldCheck size={15} /> Private trip link</span></header>
    {error ? <section className="shared-trip-message"><span className="shared-trip-lock"><ShieldCheck size={23} /></span><h1>Trip link unavailable</h1><p>{error}</p><Link className="button button-dark" to="/">Go to Avanti</Link></section> : <>
      <section className="shared-trip-title"><span className="eyebrow">LIVE TRIP</span><h1>{trip ? labels[trip.status] : 'Loading shared trip…'}</h1><p>Trip details are read-only and only available while sharing is active.</p></section>
      <div className="shared-trip-layout">
        <section className="shared-trip-map"><GoogleMapView ref={mapRef} />
          {routeSummary && <div className="shared-route-summary"><span><MapPin size={14} />{(routeSummary.distance / 1000).toFixed(1)} km</span><span><Clock3 size={14} />{Math.ceil(routeSummary.duration / 60_000)} min estimated</span></div>}
        </section>
        <section className="shared-trip-details" aria-live="polite">
          {connectionWarning && <p className="driver-location-message">{connectionWarning}</p>}
          {trip?.driver && <div className="shared-driver-card">
            <span className="assigned-driver-avatar">{trip.driver.name.slice(0, 1).toUpperCase()}</span>
            <div><b>{trip.driver.name}</b><small>{trip.driver.rating != null ? <><Star size={12} fill="currentColor" /> {trip.driver.rating.toFixed(1)}{trip.driver.ratingCount ? ` · ${trip.driver.ratingCount} ratings` : ''}</> : 'Avanti driver'}</small></div>
          </div>}
          {trip?.driver && <div className="assigned-vehicle-row"><CarFront size={18} /><span><b>{trip.driver.vehicleColor} {trip.driver.vehicleModel}</b><small>{trip.driver.vehicleRegistration}</small></span></div>}
          <div className="shared-trip-route"><div><span className="route-from" /><div><b>Pickup</b><p>{trip?.pickup || 'Loading pickup…'}</p></div></div><div className="request-route-line" /><div><span className="route-to" /><div><b>Destination</b><p>{trip?.destination || 'Loading destination…'}</p></div></div></div>
          {trip?.driverLocation && <div className="shared-live-status"><Navigation size={16} /><span><b>Driver location updating</b><small>Last GPS update {new Date(trip.driverLocation.updatedAt).toLocaleTimeString()}</small></span></div>}
          <p className="shared-trip-privacy">This link does not provide access to the rider’s account or ride controls. The driver’s browser must remain active to share GPS.</p>
        </section>
      </div>
    </>}
  </main>
}
