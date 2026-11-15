import {
  ArrowUpRight, BadgeCheck, CalendarDays, CarFront, Check, Clock3,
  MapPin, Navigation, Power, RefreshCw, Save, ShieldCheck, Star, WalletCards, X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import GoogleMapView, { type GoogleMapViewHandle } from '../components/maps/GoogleMapView'
import RideChat from '../components/chat/RideChat'
import { calculateDrivingRoute, type DrivingRoute, type MapsPoint } from '../lib/googleMaps'
import {
  driverGoOffline, driverGoOnline, getDriverLocation, getDriverProfile, listRides,
  saveDriverProfile, sendDriverLocation, updateRide, type DriverLocation,
  type DriverProfile, type Ride, type RideAction,
} from '../lib/rides'
import { connectSessionRealtime } from '../lib/realtime'

const activeStatuses = ['accepted', 'driver_arriving', 'driver_arrived', 'in_progress']
const currency = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })
const rideStatusOrder: Record<Ride['status'], number> = {
  requested: 0,
  accepted: 1,
  driver_arriving: 2,
  driver_arrived: 3,
  in_progress: 4,
  rejected: 5,
  cancelled: 5,
  completed: 5,
}

function mergeRideSnapshots(current: Ride[], incoming: Ride[]) {
  const merged = new Map(current.map(ride => [ride.id, ride]))
  for (const ride of incoming) {
    const existing = merged.get(ride.id)
    if (!existing) {
      merged.set(ride.id, ride)
      continue
    }
    const existingTime = Date.parse(existing.updatedAt)
    const incomingTime = Date.parse(ride.updatedAt)
    if (incomingTime > existingTime || (incomingTime === existingTime && rideStatusOrder[ride.status] >= rideStatusOrder[existing.status])) {
      merged.set(ride.id, ride)
    }
  }
  return [...merged.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
}

function reconcileDriverRides(current: Ride[], incoming: Ride[], requestedAt: number) {
  const incomingIds = new Set(incoming.map(ride => ride.id))
  return mergeRideSnapshots(current, incoming).filter(ride => {
    if (ride.status !== 'requested') return true
    if (ride.requestExpiresAt != null && ride.requestExpiresAt <= Date.now()) return false
    return incomingIds.has(ride.id) || Date.parse(ride.updatedAt) > requestedAt
  })
}

function fromPosition(position: GeolocationPosition) {
  const { coords } = position
  return {
    latitude: coords.latitude,
    longitude: coords.longitude,
    accuracyMeters: Number.isFinite(coords.accuracy) ? coords.accuracy : undefined,
    headingDegrees: Number.isFinite(coords.heading) ? coords.heading : null,
    speedMetersPerSecond: Number.isFinite(coords.speed) ? coords.speed : null,
    recordedAt: position.timestamp || Date.now(),
  }
}

function statusLabel(status: Ride['status']) {
  return ({
    requested: 'New request', accepted: 'Ride accepted', driver_arriving: 'Heading to pickup',
    driver_arrived: 'At pickup', in_progress: 'Trip in progress', completed: 'Completed',
    rejected: 'Request expired', cancelled: 'Cancelled',
  } as const)[status]
}

export default function DriverDashboard() {
  const { user } = useAuth()
  const mapRef = useRef<GoogleMapViewHandle>(null)
  const watchRef = useRef<number | null>(null)
  const gpsHeartbeatRef = useRef<number | null>(null)
  const trackingActiveRef = useRef(false)
  const lastSentRef = useRef<{ time: number; point: MapsPoint } | null>(null)
  const cleanupGenerationRef = useRef(0)
  const [online, setOnline] = useState(false)
  const [presenceBusy, setPresenceBusy] = useState(false)
  const [location, setLocation] = useState<DriverLocation | null>(null)
  const [profile, setProfile] = useState<DriverProfile | null>(null)
  const [profileOpen, setProfileOpen] = useState(false)
  const [profileBusy, setProfileBusy] = useState(false)
  const [profileForm, setProfileForm] = useState({ vehicleModel: '', vehicleColor: '', vehicleRegistration: '' })
  const [rides, setRides] = useState<Ride[]>([])
  const [rideRefreshBusy, setRideRefreshBusy] = useState(false)
  const [rideRefreshMessage, setRideRefreshMessage] = useState('')
  const [rideBusy, setRideBusy] = useState<string | null>(null)
  const [rideError, setRideError] = useState('')
  const [gpsError, setGpsError] = useState('')
  const [gpsMessage, setGpsMessage] = useState('')
  const [pickupRoute, setPickupRoute] = useState<DrivingRoute | null>(null)
  const [pickupRouteBusy, setPickupRouteBusy] = useState(false)
  const [requestClock, setRequestClock] = useState(Date.now())
  const refreshSequenceRef = useRef(0)
  const manualRefreshInFlightRef = useRef(false)
  const pendingRideCountRef = useRef(0)
  const firstName = user?.name.split(' ')[0] || 'Driver'

  const incomingRides = useMemo(() => rides.filter(ride => ride.status === 'requested'), [rides])
  pendingRideCountRef.current = incomingRides.length
  const activeRide = useMemo(() => rides.find(ride => activeStatuses.includes(ride.status)) || null, [rides])
  const targetRide = activeRide || incomingRides[0] || null

  const refreshRides = useCallback(async (manual = false) => {
    if (!manual && manualRefreshInFlightRef.current) return
    const requestId = ++refreshSequenceRef.current
    const requestedAt = Date.now()
    const pendingBeforeRefresh = pendingRideCountRef.current
    if (manual) {
      manualRefreshInFlightRef.current = true
      setRideRefreshBusy(true)
      setRideRefreshMessage('Refreshing ride requests…')
      setRideError('')
    }
    try {
      const latest = await listRides()
      if (requestId !== refreshSequenceRef.current) return
      setRides(current => reconcileDriverRides(current, latest, requestedAt))
      if (manual) {
        const pendingCount = latest.filter(ride => ride.status === 'requested').length
        const removedCount = Math.max(0, pendingBeforeRefresh - pendingCount)
        const refreshedAt = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })
        setRideRefreshMessage(`Updated ${refreshedAt} · ${pendingCount} pending request${pendingCount === 1 ? '' : 's'}${removedCount ? ` · ${removedCount} expired, cancelled, or claimed request${removedCount === 1 ? '' : 's'} removed` : ''}`)
      }
    } catch (error) {
      if (requestId === refreshSequenceRef.current) {
        setRideError(error instanceof Error ? error.message : 'Could not refresh ride requests.')
        if (manual) setRideRefreshMessage('Refresh failed. Check your connection and try again.')
      }
    } finally {
      if (manual) {
        manualRefreshInFlightRef.current = false
        setRideRefreshBusy(false)
      }
    }
  }, [])

  useEffect(() => {
    let active = true
    void Promise.all([getDriverProfile(), getDriverLocation(), listRides()])
      .then(([savedProfile, gps, rideList]) => {
        if (!active) return
        setProfile(savedProfile)
        if (savedProfile) setProfileForm({
          vehicleModel: savedProfile.vehicleModel || '',
          vehicleColor: savedProfile.vehicleColor || '',
          vehicleRegistration: savedProfile.vehicleRegistration || '',
        })
        setOnline(gps.online)
        setLocation(gps.location)
        setRides(rideList)
        if (!savedProfile) setProfileOpen(true)
      })
      .catch(error => { if (active) setRideError(error instanceof Error ? error.message : 'Could not load your driver workspace.') })
    return () => { active = false }
  }, [])

  useEffect(() => {
    const socket = connectSessionRealtime()
    const upsertRide = (ride: Ride) => setRides(current => mergeRideSnapshots(current, [ride]))
    const onLocation = (event: { rideId: string; location: DriverLocation }) => {
      if (activeRide?.id !== event.rideId) return
      setRides(current => current.map(ride => ride.id === event.rideId ? { ...ride, driverLocation: event.location } : ride))
    }
    socket.on('ride:request', upsertRide)
    socket.on('ride:updated', upsertRide)
    socket.on('driver:location', onLocation)
    socket.on('connect', () => { void refreshRides() })
    return () => {
      socket.off('ride:request', upsertRide)
      socket.off('ride:updated', upsertRide)
      socket.off('driver:location', onLocation)
    }
  }, [activeRide?.id, refreshRides])

  useEffect(() => {
    const timer = window.setInterval(() => { void refreshRides() }, 15_000)
    return () => window.clearInterval(timer)
  }, [refreshRides])

  useEffect(() => {
    const timer = window.setInterval(() => setRequestClock(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!location) return
    mapRef.current?.showDriverLocation({ lat: location.latitude, lng: location.longitude }, location.headingDegrees)
  }, [location])

  useEffect(() => {
    let cancelled = false
    if (!targetRide?.pickupPoint || !location) {
      setPickupRoute(null)
      return () => { cancelled = true }
    }
    const origin = { lat: location.latitude, lng: location.longitude }
    const destination = targetRide.status === 'in_progress' && targetRide.destinationPoint
      ? targetRide.destinationPoint
      : targetRide.pickupPoint
    setPickupRouteBusy(true)
    void calculateDrivingRoute(origin, destination)
      .then(route => {
        if (cancelled) return
        setPickupRoute(route)
        mapRef.current?.showRoute(route, origin, destination)
      })
      .catch(() => { if (!cancelled) setPickupRoute(null) })
      .finally(() => { if (!cancelled) setPickupRouteBusy(false) })
    return () => { cancelled = true }
  }, [targetRide?.id, targetRide?.status, location?.latitude, location?.longitude])

  useEffect(() => {
    const generation = ++cleanupGenerationRef.current
    return () => {
      if (watchRef.current !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchRef.current)
      if (gpsHeartbeatRef.current !== null) window.clearInterval(gpsHeartbeatRef.current)
      trackingActiveRef.current = false
      watchRef.current = null
      gpsHeartbeatRef.current = null
      lastSentRef.current = null
      // StrictMode runs a development-only cleanup immediately after mount.
      // Defer offlining so the next setup can cancel that cleanup.
      window.setTimeout(() => {
        if (cleanupGenerationRef.current === generation) void driverGoOffline().catch(() => undefined)
      }, 0)
    }
  }, [])

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setProfileBusy(true)
    setRideError('')
    try {
      const saved = await saveDriverProfile(profileForm)
      setProfile(saved)
      setProfileOpen(false)
      setGpsMessage('Vehicle details saved to your driver profile.')
    } catch (error) {
      setRideError(error instanceof Error ? error.message : 'Could not save your vehicle details.')
    } finally {
      setProfileBusy(false)
    }
  }

  const stopGpsWatch = () => {
    trackingActiveRef.current = false
    if (watchRef.current !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchRef.current)
    if (gpsHeartbeatRef.current !== null) window.clearInterval(gpsHeartbeatRef.current)
    watchRef.current = null
    gpsHeartbeatRef.current = null
    lastSentRef.current = null
  }

  const setOffline = async () => {
    if (presenceBusy) return
    setPresenceBusy(true)
    const wasTracking = trackingActiveRef.current
    trackingActiveRef.current = false
    setGpsError('')
    try {
      await driverGoOffline()
      stopGpsWatch()
      setOnline(false)
      setGpsMessage('You are offline. Location sharing has stopped.')
    } catch (error) {
      trackingActiveRef.current = wasTracking
      setGpsError(error instanceof Error ? error.message : 'Could not go offline.')
    } finally {
      setPresenceBusy(false)
    }
  }

  const setOnlineWithGps = async () => {
    if (presenceBusy) return
    if (!profile?.vehicleModel || !profile.vehicleColor || !profile.vehicleRegistration) {
      setProfileOpen(true)
      setGpsError('Add your vehicle details before going online.')
      return
    }
    if (!navigator.geolocation) {
      setGpsError('This browser does not support location tracking. Open Avanti over HTTPS and allow location access.')
      return
    }
    setPresenceBusy(true)
    setGpsError('')
    setGpsMessage('Requesting permission to use your GPS…')
    navigator.geolocation.getCurrentPosition(async position => {
      try {
        const firstLocation = await driverGoOnline(fromPosition(position))
        setLocation(firstLocation)
        setOnline(true)
        setGpsMessage('You are online. GPS updates are sent while this page is active.')
        stopGpsWatch()
        trackingActiveRef.current = true
        lastSentRef.current = { time: Date.now(), point: { lat: firstLocation.latitude, lng: firstLocation.longitude } }
        watchRef.current = navigator.geolocation.watchPosition(async nextPosition => {
          if (!trackingActiveRef.current) return
          const next = fromPosition(nextPosition)
          const point = { lat: next.latitude, lng: next.longitude }
          setLocation(current => current
            ? { ...current, ...next, accuracyMeters: next.accuracyMeters ?? current.accuracyMeters, updatedAt: Date.now() }
            : { ...next, accuracyMeters: next.accuracyMeters ?? null, updatedAt: Date.now() })
          const previous = lastSentRef.current
          const elapsed = Date.now() - (previous?.time || 0)
          const movedMeters = previous ? Math.hypot(point.lat - previous.point.lat, point.lng - previous.point.lng) * 111_000 : Number.POSITIVE_INFINITY
          if (elapsed < 5_000 || (movedMeters < 8 && elapsed < 12_000)) return
          try {
            const sent = await sendDriverLocation(next)
            setLocation(sent)
            lastSentRef.current = { time: Date.now(), point }
            setGpsError('')
          } catch (error) {
            if (trackingActiveRef.current && error instanceof Error && error.message === 'Go online before sending driver location.') {
              try {
                const restored = await driverGoOnline(next)
                setLocation(restored)
                setOnline(true)
                lastSentRef.current = { time: Date.now(), point }
                setGpsError('')
                setGpsMessage('GPS connection restored. You are online again.')
              } catch (recoveryError) {
                setGpsError(recoveryError instanceof Error ? recoveryError.message : 'GPS updates are not reaching the server. Check your network.')
              }
            } else if (trackingActiveRef.current) {
              setGpsError(error instanceof Error ? error.message : 'GPS updates are not reaching the server. Check your network.')
            }
          }
        }, error => {
          if (trackingActiveRef.current) setGpsError(`GPS tracking stopped: ${error.message}. Move to a location with GPS reception or go offline.`)
        }, { enableHighAccuracy: true, maximumAge: 2_000, timeout: 15_000 })
        gpsHeartbeatRef.current = window.setInterval(() => {
          if (!trackingActiveRef.current) return
          navigator.geolocation.getCurrentPosition(async freshPosition => {
            if (!trackingActiveRef.current) return
            const fresh = fromPosition(freshPosition)
            const point = { lat: fresh.latitude, lng: fresh.longitude }
            try {
              const sent = await sendDriverLocation(fresh)
              if (!trackingActiveRef.current) return
              setLocation(sent)
              lastSentRef.current = { time: Date.now(), point }
              setGpsError('')
            } catch (error) {
              if (!trackingActiveRef.current) return
              if (error instanceof Error && error.message === 'Go online before sending driver location.') {
                try {
                  const restored = await driverGoOnline(fresh)
                  if (!trackingActiveRef.current) return
                  setLocation(restored)
                  setOnline(true)
                  lastSentRef.current = { time: Date.now(), point }
                  setGpsError('')
                  setGpsMessage('GPS connection restored. You are online again.')
                } catch (recoveryError) {
                  setGpsError(recoveryError instanceof Error ? recoveryError.message : 'GPS updates are not reaching the server. Check your network.')
                }
              } else {
                setGpsError(error instanceof Error ? error.message : 'GPS updates are not reaching the server. Check your network.')
              }
            }
          }, error => {
            if (trackingActiveRef.current) setGpsError(`Could not refresh GPS: ${error.message}. Keep Avanti open and check location permission.`)
          }, { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 })
        }, 15_000)
        setPresenceBusy(false)
      } catch (error) {
        stopGpsWatch()
        await driverGoOffline().catch(() => undefined)
        setOnline(false)
        setGpsMessage('')
        setGpsError(error instanceof Error ? error.message : 'Could not go online.')
        setPresenceBusy(false)
      }
    }, error => {
      setGpsMessage('')
      setGpsError(`Location permission is required to go online: ${error.message}`)
      setPresenceBusy(false)
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 })
  }

  const actOnRide = async (ride: Ride, action: RideAction) => {
    if (rideBusy) return
    setRideBusy(ride.id)
    setRideError('')
    try {
      const updated = await updateRide(ride.id, action)
      setRides(current => mergeRideSnapshots(current, [updated]))
      if (updated.status === 'completed' || updated.status === 'cancelled' || updated.status === 'rejected') mapRef.current?.clearRoute()
    } catch (error) {
      setRideError(error instanceof Error ? error.message : 'Could not update this ride.')
      void refreshRides()
    } finally {
      setRideBusy(null)
    }
  }

  const minutesLeft = (ride: Ride) => ride.requestExpiresAt == null
    ? 0
    : Math.max(0, Math.ceil((ride.requestExpiresAt - requestClock) / 1_000))

  return <div className="driver-app">
    <aside className="driver-sidebar">
      <div className="driver-sidebar-brand"><span className="brand-mark">a<span>.</span></span><span className="brand-name">avanti</span><small>DRIVER</small></div>
      <div className="sidebar-driver"><div className="driver-avatar">{user?.name.slice(0, 1).toUpperCase()}</div><div><b>{user?.name}</b><small><span className="status-mini" /> Driver partner</small></div></div>
      <nav className="driver-nav" aria-label="Driver dashboard">
        <span className="eyebrow">WORKSPACE</span>
        <a className="active" href="#overview"><CarFront size={17} /> Overview</a>
        <a href="#requests"><Navigation size={17} /> Ride requests <i>{incomingRides.length}</i></a>
        <a href="#live-map"><MapPin size={17} /> Live location</a>
        <a href="#profile"><ShieldCheck size={17} /> Vehicle profile</a>
      </nav>
      <div className="sidebar-bottom"><Link to="/" className="sidebar-home">â† Back to Avanti</Link></div>
    </aside>

    <main className="driver-main">
      <header className="driver-topbar">
        <div className="mobile-driver-brand"><Link to="/" className="brand"><span className="brand-mark">a<span>.</span></span><span className="brand-name">avanti</span></Link><span>DRIVER</span></div>
        <span className="topbar-date"><CalendarDays size={15} /> Driver workspace</span>
        <div className="topbar-actions"><span className={`driver-presence-chip ${online ? 'is-online' : ''}`}>{online ? 'ONLINE · GPS ACTIVE' : 'OFFLINE'}</span><div className="topbar-avatar">{user?.name.slice(0, 1).toUpperCase()}</div></div>
      </header>

      <div className="driver-content" id="overview">
        <div className="driver-welcome">
          <div><span className="eyebrow">AVANTI DRIVER</span><h1>Good roads, <em>{firstName}.</em></h1><p>Ride requests and your active trip appear here.</p></div>
          <div className={`online-toggle ${online ? 'is-online' : ''}`}>
            <div><span className="status-dot" /><b>{online ? 'You’re online' : 'You’re offline'}</b><small>{online ? 'Sharing GPS while this page is active' : 'Location is not being shared'}</small></div>
            <button disabled={presenceBusy} onClick={() => online ? void setOffline() : void setOnlineWithGps()} aria-label={online ? 'Go offline' : 'Go online'}><Power size={17} /><span>{presenceBusy ? (online ? 'Going offline…' : 'Connecting…') : online ? 'Go offline' : 'Go online'}</span></button>
          </div>
        </div>

        {!profile?.vehicleModel && <section className="driver-profile-setup" id="profile">
          <div><span className="eyebrow">BEFORE YOUR FIRST RIDE</span><h2>Add your vehicle details</h2><p>These details are shown to riders after you accept a request.</p></div>
          <DriverProfileForm profileForm={profileForm} setProfileForm={setProfileForm} busy={profileBusy} onSubmit={saveProfile} />
        </section>}
        {profile?.vehicleModel && <section className="driver-vehicle-summary" id="profile">
          <span className="driver-vehicle-icon"><CarFront size={22} /></span>
          <div><span className="eyebrow">YOUR REGISTERED VEHICLE</span><b>{profile.vehicleColor} {profile.vehicleModel}</b><small>{profile.vehicleRegistration}</small></div>
          {profile.rating != null && <span className="driver-real-rating"><Star size={13} fill="currentColor" /> {profile.rating.toFixed(1)}{profile.ratingCount > 0 ? ` · ${profile.ratingCount} rides` : ''}</span>}
          <button className="subtle-action" onClick={() => setProfileOpen(value => !value)}>{profileOpen ? 'Close' : 'Edit vehicle'}</button>
          {profileOpen && <DriverProfileForm profileForm={profileForm} setProfileForm={setProfileForm} busy={profileBusy} onSubmit={saveProfile} />}
        </section>}

        <section className="metric-grid driver-live-metrics" aria-label="Live driver status">
          <article className="metric-card"><div className="metric-label">AVAILABILITY <span className="metric-icon green"><Power size={17} /></span></div><strong>{online ? 'Online' : 'Offline'}</strong><small>{online ? 'Your location is updating' : 'Tap Go online to receive requests'}</small></article>
          <article className="metric-card"><div className="metric-label">ACTIVE RIDE <span className="metric-icon ochre"><CarFront size={17} /></span></div><strong>{activeRide ? statusLabel(activeRide.status) : 'None'}</strong><small>{activeRide ? `${activeRide.pickup} → ${activeRide.destination}` : `${incomingRides.length} pending request${incomingRides.length === 1 ? '' : 's'}`}</small></article>
          <article className="metric-card"><div className="metric-label">GPS UPDATE <span className="metric-icon peach"><MapPin size={17} /></span></div><strong>{location ? `${Math.round(location.accuracyMeters || 0)} m` : 'Waiting'}</strong><small>{location ? `Updated ${new Date(location.updatedAt).toLocaleTimeString()}` : 'No location received yet'}</small></article>
        </section>

        {(gpsError || gpsMessage) && <p className={`driver-location-message ${gpsError ? 'is-error' : ''}`} role={gpsError ? 'alert' : 'status'}>{gpsError || gpsMessage}</p>}
        {rideError && <p className="ride-error" role="alert">{rideError}</p>}

        <div className="driver-work-grid">
          <section className="requests-panel" id="requests">
            <div className="work-panel-header"><div><span className="eyebrow">LIVE DISPATCH</span><h2>{activeRide ? 'Your active ride' : 'Ride requests'} <span className="request-count">{activeRide ? '1' : incomingRides.length}</span></h2></div><button className="subtle-action driver-refresh-button" disabled={rideRefreshBusy} onClick={() => void refreshRides(true)}><RefreshCw size={13} className={rideRefreshBusy ? 'is-spinning' : undefined} />{rideRefreshBusy ? 'Refreshing…' : 'Refresh'}</button></div>
            {rideRefreshMessage && <p className="driver-refresh-status" role="status" aria-live="polite">{rideRefreshMessage}</p>}
            {!online && !activeRide && <div className="offline-overlay"><span><Power size={18} /></span><b>You’re offline</b><p>Allow location and go online to receive requests.</p><button onClick={setOnlineWithGps}>Go online <ArrowUpRight size={14} /></button></div>}
            {!activeRide && incomingRides.length === 0 && <div className="no-ride-requests"><CarFront size={21} /><b>No ride requests yet</b><span>New requests are delivered to online drivers.</span></div>}
            {activeRide && <RideCard ride={activeRide} online={online} busy={rideBusy === activeRide.id} pickupRoute={pickupRoute} routeBusy={pickupRouteBusy} countdown={null} onAction={action => void actOnRide(activeRide, action)} />}
            {!activeRide && incomingRides.map(ride => <RideCard key={ride.id} ride={ride} online={online} busy={rideBusy === ride.id} pickupRoute={targetRide?.id === ride.id ? pickupRoute : null} routeBusy={targetRide?.id === ride.id && pickupRouteBusy} countdown={minutesLeft(ride)} onAction={action => void actOnRide(ride, action)} />)}
            <p className="driver-data-note">Only rider bookings and GPS updates are live. Earnings and ratings appear when real trip/payment data is available.</p>
          </section>

          <section className="earnings-panel driver-map-panel" id="live-map">
            <div className="work-panel-header"><div><span className="eyebrow">{online ? 'LIVE GPS' : 'LAST LOCATION'}</span><h2>Driver map</h2></div><span className="driver-map-state">{online ? 'Updating' : 'Not sharing'}</span></div>
            <GoogleMapView ref={mapRef} />
            {targetRide && <div className="driver-map-caption"><Navigation size={15} /><span>{targetRide.status === 'in_progress' ? `Route to ${targetRide.destination}` : `Route to ${targetRide.pickup}`}</span>{pickupRoute && <b>{(pickupRoute.distanceMeters / 1000).toFixed(1)} km · {Math.ceil(pickupRoute.durationMillis / 60_000)} min</b>}</div>}
            <p className="driver-background-note">GPS updates require this page to remain active. A browser/PWA cannot guarantee location tracking while closed or suspended.</p>
          </section>
        </div>

        <footer className="driver-footer"><span>â© 2026 Avanti Mobility, Inc.</span><span>Location sharing ends when you go offline.</span></footer>
      </div>
    </main>
    <nav className="driver-mobile-nav" aria-label="Driver dashboard shortcuts">
      <a className="active" href="#overview"><CarFront size={17} /><small>Overview</small></a>
      <a href="#requests"><Navigation size={17} /><small>Requests</small></a>
      <a href="#live-map"><MapPin size={17} /><small>Map</small></a>
      <a href="#profile"><ShieldCheck size={17} /><small>Vehicle</small></a>
    </nav>
  </div>
}

function DriverProfileForm({ profileForm, setProfileForm, busy, onSubmit }: {
  profileForm: { vehicleModel: string; vehicleColor: string; vehicleRegistration: string }
  setProfileForm: (value: (current: { vehicleModel: string; vehicleColor: string; vehicleRegistration: string }) => { vehicleModel: string; vehicleColor: string; vehicleRegistration: string }) => void
  busy: boolean
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  return <form className="driver-profile-form" onSubmit={onSubmit}>
    <label>Vehicle model<input required minLength={2} maxLength={80} placeholder="e.g. Honda City" value={profileForm.vehicleModel} onChange={event => setProfileForm(current => ({ ...current, vehicleModel: event.target.value }))} /></label>
    <label>Vehicle colour<input required minLength={2} maxLength={40} placeholder="e.g. White" value={profileForm.vehicleColor} onChange={event => setProfileForm(current => ({ ...current, vehicleColor: event.target.value }))} /></label>
    <label>Registration number<input required minLength={4} maxLength={20} autoCapitalize="characters" placeholder="e.g. DL 01 AB 1234" value={profileForm.vehicleRegistration} onChange={event => setProfileForm(current => ({ ...current, vehicleRegistration: event.target.value.toUpperCase() }))} /></label>
    <button className="button button-dark" disabled={busy}><Save size={15} />{busy ? 'Saving…' : 'Save vehicle'}</button>
  </form>
}

function RideCard({ ride, online, busy, pickupRoute, routeBusy, countdown, onAction }: {
  ride: Ride
  online: boolean
  busy: boolean
  pickupRoute: DrivingRoute | null
  routeBusy: boolean
  countdown: number | null
  onAction: (action: RideAction) => void
}) {
  const active = activeStatuses.includes(ride.status)
  const estimatedFare = ride.estimatedFarePaise == null ? '—' : currency.format(ride.estimatedFarePaise / 100)
  return <article className={`request-item live-request-item ${active ? 'ride-accepted' : ''}`}>
    <div className="request-top"><span className={`request-new ${active ? 'request-status' : ''}`}>{statusLabel(ride.status)}</span><span>{countdown == null ? new Date(ride.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : countdown ? `${countdown}s to respond` : 'Request expired'}</span></div>
    <div className="request-rider-name">{ride.riderName} · {ride.vehicle} request</div>
    <div className="request-route">
      <div><span className="route-from" /><div><b>{ride.pickup}</b><small>Pickup</small></div></div>
      <div className="request-route-line" />
      <div><span className="route-to" /><div><b>{ride.destination}</b><small>Destination</small></div></div>
    </div>
    <div className="driver-ride-facts">
      <span><MapPin size={14} />{routeBusy ? 'Finding pickup route…' : pickupRoute ? `${(pickupRoute.distanceMeters / 1000).toFixed(1)} km to pickup` : 'Pickup distance unavailable'}</span>
      <span><Navigation size={14} />{ride.routeDistanceMeters ? `${(ride.routeDistanceMeters / 1000).toFixed(1)} km trip` : 'Trip distance unavailable'}</span>
      <span><WalletCards size={14} />{estimatedFare} estimated</span>
    </div>
    {countdown === 0 && <p className="driver-location-message is-error">This request has expired. Refresh for current requests.</p>}
    <div className="request-actions live-request-actions">
      {ride.status === 'requested' ? <>
        <button className="request-cancel" disabled={!online || busy || countdown === 0} onClick={() => onAction('reject')}><X size={14} /> Reject</button>
        <button className="request-accept" disabled={!online || busy || countdown === 0} onClick={() => onAction('accept')}><Check size={14} />{busy ? 'Accepting…' : 'Accept ride'}</button>
      </> : ride.status === 'accepted' ? <>
        <button className="request-cancel" disabled={busy} onClick={() => onAction('cancel')}><X size={14} /> Cancel</button>
        <button className="request-accept" disabled={busy} onClick={() => onAction('arriving')}><Navigation size={14} /> I’m heading there</button>
      </> : ride.status === 'driver_arriving' ? <>
        <button className="request-cancel" disabled={busy} onClick={() => onAction('cancel')}><X size={14} /> Cancel</button>
        <button className="request-accept" disabled={busy} onClick={() => onAction('arrived')}><MapPin size={14} /> I’ve arrived</button>
      </> : ride.status === 'driver_arrived' ? <>
        <span className="driver-arrived-label"><BadgeCheck size={15} /> Rider pickup confirmed</span>
        <button className="request-accept" disabled={busy} onClick={() => onAction('start')}><CarFront size={14} /> Start ride</button>
      </> : ride.status === 'in_progress' ? <>
        <span className="driver-arrived-label"><Navigation size={15} /> Trip underway</span>
        <button className="request-accept" disabled={busy} onClick={() => onAction('complete')}><Check size={14} /> Complete ride</button>
      </> : <span className="driver-arrived-label"><Clock3 size={15} />{statusLabel(ride.status)}</span>}
    </div>
    {active && <div className="driver-chat-action"><RideChat rideId={ride.id} rideStatus={ride.status} otherPartyName={ride.riderName} otherPartyDetail="Rider" /></div>}
  </article>
}
