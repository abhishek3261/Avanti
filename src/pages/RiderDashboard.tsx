import {
  ArrowDownUp, ArrowRight, ArrowUpRight, CarFront, Clock3, MapPin,
  Minus, Plus, ShieldCheck, Sparkles, Star, Users, WalletCards,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { createRide, listRides, updateRide, type Ride, type VehicleCategory } from '../lib/rides'

const vehicles = [
  { name: 'Mini', detail: 'Affordable everyday rides', price: '₹149', eta: '3 min', icon: CarFront },
  { name: 'Sedan', detail: 'A little more room to relax', price: '₹229', eta: '5 min', icon: CarFront },
  { name: 'SUV', detail: 'Space for everyone & everything', price: '₹349', eta: '7 min', icon: CarFront },
]

const recentDestinations = [
  { title: 'MG Road', detail: 'Central Bengaluru' },
  { title: 'Cubbon Park', detail: 'Kasturba Road' },
  { title: 'Kempegowda Airport', detail: 'Devanahalli' },
]

function IllustrativeMap() {
  return <div className="map-placeholder map-stage" aria-label="Illustrative map of Bengaluru">
    <div className="map-gridlines" />
    <svg viewBox="0 0 600 250" preserveAspectRatio="none" aria-hidden="true">
      <path d="M-20 204c76-9 76-70 165-70 69 0 43 56 131 56s94-75 174-75 70 35 177 15" fill="none" stroke="#bfcbb7" strokeWidth="2" strokeDasharray="5 7" />
      <path d="M50-20c7 82 68 63 74 130s-36 92 4 162M265-20c-15 78 55 76 39 146s-50 63-33 142M492-25c-12 90 54 95 31 155s-33 82-10 145" fill="none" stroke="#dedbcc" strokeWidth="2" />
      <path d="M-20 58c66 15 128-21 194-8s70 36 128 27 70-31 117-29 112 46 201 14" fill="none" stroke="#e6e2d7" strokeWidth="2" />
    </svg>
    <div className="map-water">ULSOOR<br />LAKE</div>
    <span className="map-place place-a">Indiranagar</span>
    <span className="map-place place-b">HAL 2nd Stage</span>
    <span className="map-place place-c">Domlur</span>
    <div className="map-current"><span /></div>
    <div className="map-tag"><span className="tag-pin"><MapPin size={13} /></span> BENGALURU, IN</div>
    <div className="map-controls" aria-label="Illustrative map controls">
      <button className="zoom-controls" aria-label="Zoom in"><Plus size={14} /></button>
      <button className="zoom-controls" aria-label="Zoom out"><Minus size={14} /></button>
    </div>
    <span className="map-disclaimer">Illustrative map · Not for navigation</span>
  </div>
}

export default function RiderDashboard() {
  const { user } = useAuth()
  const [selected, setSelected] = useState('Mini')
  const [pickup, setPickup] = useState('Indiranagar, Bengaluru')
  const [destination, setDestination] = useState('')
  const [rides, setRides] = useState<Ride[]>([])
  const [bookingBusy, setBookingBusy] = useState(false)
  const [rideActionBusy, setRideActionBusy] = useState(false)
  const [rideError, setRideError] = useState('')

  const activeRide = rides.find(ride => ride.status === 'requested' || ride.status === 'accepted')

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
        <IllustrativeMap />

        <section className="booking-panel glass-panel" id="ride-booking">
          <div className="panel-heading">
            <div><span className="eyebrow">PLAN A RIDE</span><h2>Let’s get you there.</h2></div>
            <span className="panel-number">01 / BOOK</span>
          </div>

          <div className="location-fields">
            <div className="location-rail"><span className="rail-dot pickup-dot" /><span className="rail-dash" /><span className="rail-destination" /></div>
            <label className="location-field">
              <span>Pickup location</span>
              <input aria-label="Pickup location" value={pickup} onChange={event => setPickup(event.target.value)} placeholder="Add pickup location" />
              <MapPin size={17} />
            </label>
            <button className="swap-locations" aria-label="Swap pickup and destination" onClick={() => { const oldPickup = pickup; setPickup(destination); setDestination(oldPickup) }}><ArrowDownUp size={15} /></button>
            <label className="location-field">
              <span>Destination</span>
              <input aria-label="Destination" value={destination} onChange={event => setDestination(event.target.value)} placeholder="Where are you going?" />
              <span className="field-add"><Plus size={14} /></span>
            </label>
          </div>

          <div className="recent-destinations">
            <div className="recent-heading"><span>Recent destinations</span><small>SAMPLE PLACES</small></div>
            <div className="recent-destination-list">
              {recentDestinations.map(place => <button key={place.title} className="recent-destination" onClick={() => setDestination(place.title)}>
                <span className="recent-pin"><MapPin size={15} /></span><span><b>{place.title}</b><small>{place.detail}</small></span>
              </button>)}
            </div>
          </div>
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
          <button className="button button-dark book-button" onClick={requestRide} disabled={!destination.trim() || bookingBusy || Boolean(activeRide)}>{bookingBusy ? 'Sending request…' : activeRide ? 'Request sent' : `Request ${selected}`} {!bookingBusy && !activeRide && <ArrowRight size={16} />}</button>
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
