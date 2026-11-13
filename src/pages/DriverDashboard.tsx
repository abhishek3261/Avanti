import {
  ArrowDownRight, ArrowUpRight, BadgeCheck, Bell, CalendarDays, CarFront,
  Check, ChevronRight, CircleHelp, Clock3, Power, Settings2, ShieldCheck, Star, WalletCards, X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { listRides, updateRide, type Ride } from '../lib/rides'

export default function DriverDashboard() {
  const { user } = useAuth()
  const [online, setOnline] = useState(false)
  const [showSampleBanner, setShowSampleBanner] = useState(true)
  const [rides, setRides] = useState<Ride[]>([])
  const [rideBusy, setRideBusy] = useState<string | null>(null)
  const [rideError, setRideError] = useState('')
  const firstName = user?.name.split(' ')[0] || 'Driver'
  const activeRequestCount = rides.filter(ride => ride.status === 'requested').length

  useEffect(() => {
    let active = true
    const refreshRides = async () => {
      try {
        const latest = await listRides()
        if (active) setRides(latest)
      } catch (error) {
        if (active) setRideError(error instanceof Error ? error.message : 'Could not load ride requests.')
      }
    }
    void refreshRides()
    const timer = window.setInterval(() => { void refreshRides() }, 3000)
    return () => { active = false; window.clearInterval(timer) }
  }, [])

  const actOnRide = async (ride: Ride, action: 'accept' | 'decline' | 'cancel') => {
    if (rideBusy) return
    setRideBusy(ride.id)
    setRideError('')
    try {
      const updated = await updateRide(ride.id, action)
      if (action === 'decline' || action === 'cancel') setRides(current => current.filter(item => item.id !== updated.id))
      else setRides(current => current.map(item => item.id === updated.id ? updated : item))
    } catch (error) {
      setRideError(error instanceof Error ? error.message : 'Could not update this ride request.')
    } finally {
      setRideBusy(null)
    }
  }

  return <div className="driver-app">
    <aside className="driver-sidebar">
      <div className="driver-sidebar-brand"><span className="brand-mark">a<span>.</span></span><span className="brand-name">avanti</span><small>DRIVER</small></div>
      <div className="sidebar-driver"><div className="driver-avatar">{user?.name.slice(0, 1).toUpperCase()}</div><div><b>{user?.name || 'Driver'}</b><small><span className="status-mini" /> Driver partner</small></div></div>
      <nav className="driver-nav" aria-label="Driver dashboard">
        <span className="eyebrow">WORKSPACE</span>
        <a className="active" href="#overview"><span>▦</span> Overview</a>
        <a href="#requests"><CarFront size={17} /> Ride requests <i>{activeRequestCount}</i></a>
        <a href="#earnings"><WalletCards size={17} /> Earnings</a>
        <a href="#trips"><Clock3 size={17} /> Trip history</a>
        <span className="eyebrow nav-spacer">YOUR ACCOUNT</span>
        <a href="#profile"><span>◉</span> My profile</a>
        <a href="#settings"><Settings2 size={17} /> Settings</a>
        <a href="#help"><CircleHelp size={17} /> Help &amp; support</a>
      </nav>
      <div className="sidebar-bottom">
        <div className="sidebar-support"><span className="support-spark">✳</span><b>Here when you need us.</b><small>Driver support is always a tap away.</small><a href="mailto:support@avanti.example">Get support <ArrowUpRight size={12} /></a></div>
        <Link to="/" className="sidebar-home">← Back to Avanti</Link>
      </div>
    </aside>

    <main className="driver-main">
      <header className="driver-topbar">
        <div className="mobile-driver-brand"><Link to="/" className="brand"><span className="brand-mark">a<span>.</span></span><span className="brand-name">avanti</span></Link><span>DRIVER</span></div>
        <span className="topbar-date"><CalendarDays size={15} /> Thursday, November 12, 2026</span>
        <div className="topbar-actions"><span className="demo-chip">LIVE REQUESTS</span><button aria-label="Notifications" className="icon-button"><Bell size={17} /><i /></button><div className="topbar-avatar">{user?.name.slice(0, 1).toUpperCase()}</div></div>
      </header>

      <div className="driver-content" id="overview">
        <div className="driver-welcome">
          <div><span className="eyebrow">THURSDAY, NOVEMBER 12</span><h1>Good morning, <em>{firstName}.</em></h1><p>Ready when you are. Your day’s looking good.</p></div>
          <div className={`online-toggle ${online ? 'is-online' : ''}`}>
            <div><span className="status-dot" /><b>{online ? 'You’re online' : 'You’re offline'}</b><small>{online ? 'Available for ride requests' : 'Go online when you’re ready'}</small></div>
            <button onClick={() => setOnline(!online)} aria-label={online ? 'Go offline' : 'Go online'}><Power size={17} /><span>{online ? 'Go offline' : 'Go online'}</span></button>
          </div>
        </div>

        {showSampleBanner && <div className="sample-banner"><span>✳</span><div><b>Ride request board is live</b><p>Rider bookings appear here. Earnings and performance remain sample figures.</p></div><button aria-label="Dismiss sample data banner" onClick={() => setShowSampleBanner(false)}>×</button></div>}

        <section className="metric-grid" aria-label="Sample driver performance">
          <article className="metric-card"><div className="metric-label">TODAY’S EARNINGS <span className="metric-icon green"><WalletCards size={17} /></span></div><strong>₹2,480<span className="trend"><ArrowUpRight size={13} /> 12%</span></strong><small>vs. your sample daily average</small><div className="mini-chart"><i style={{ height: '34%' }} /><i style={{ height: '45%' }} /><i style={{ height: '39%' }} /><i style={{ height: '62%' }} /><i style={{ height: '51%' }} /><i style={{ height: '75%' }} /><i style={{ height: '68%' }} /><i style={{ height: '90%' }} /></div></article>
          <article className="metric-card"><div className="metric-label">COMPLETED RIDES <span className="metric-icon ochre"><CarFront size={17} /></span></div><strong>8<span className="metric-context">rides today</span></strong><small>2 more than your last Wednesday</small><div className="metric-progress"><span style={{ width: '68%' }} /></div><small className="progress-label">Daily goal <b>8 / 12 rides</b></small></article>
          <article className="metric-card"><div className="metric-label">DRIVER RATING <span className="metric-icon peach"><Star size={17} /></span></div><strong>4.92<span className="rating-stars">★★★★★</span></strong><small>From 126 sample ratings</small><div className="rating-line"><span><BadgeCheck size={13} /> Top driver this week</span></div></article>
        </section>

        <div className="driver-work-grid">
          <section className="requests-panel" id="requests">
            <div className="work-panel-header"><div><span className="eyebrow">YOUR NEXT OPPORTUNITY</span><h2>Ride requests <span className="request-count">{activeRequestCount}</span></h2></div><button className="subtle-action" onClick={() => document.getElementById('requests')?.scrollIntoView({ behavior: 'smooth' })}>See all <ChevronRight size={15} /></button></div>
            {!online && <div className="offline-overlay"><span><Power size={18} /></span><b>You’re offline right now</b><p>Go online when you’re ready to see nearby ride requests.</p><button onClick={() => setOnline(true)}>Go online <ArrowUpRight size={14} /></button></div>}
            {rides.length === 0 && <div className="no-ride-requests"><CarFront size={21} /><b>No ride requests yet</b><span>New rider bookings will appear here automatically.</span></div>}
            {rides.map(ride => {
              const accepted = ride.status === 'accepted'
              return <article className={'request-item ' + (accepted ? 'ride-accepted' : '')} key={ride.id}>
                <div className="request-top"><span className={'request-new ' + (accepted ? 'request-status' : '')}>{accepted ? 'RIDE ACCEPTED' : 'NEW REQUEST'}</span><span>{new Date(ride.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span></div>
                <div className="request-rider-name">{ride.riderName} requested a ride</div>
                <div className="request-route"><div><span className="route-from" /><div><b>{ride.pickup}</b><small>Pickup location</small></div></div><div className="request-route-line" /><div><span className="route-to" /><div><b>{ride.destination}</b><small>{ride.vehicle} ride</small></div></div></div>
                <div className="request-bottom"><span><CarFront size={14} /> {ride.vehicle} <span className="request-divider">/</span> Request #{ride.id.slice(0, 6)}</span>
                  <div className="request-actions">
                    {accepted ? <button className="request-cancel" disabled={!online || rideBusy === ride.id} onClick={() => actOnRide(ride, 'cancel')}><X size={14} /> {rideBusy === ride.id ? 'Updating...' : 'Cancel ride'}</button> : <>
                      <button className="request-cancel" disabled={!online || rideBusy === ride.id} onClick={() => actOnRide(ride, 'decline')}><X size={14} /> Decline</button>
                      <button className="request-accept" disabled={!online || rideBusy === ride.id} onClick={() => actOnRide(ride, 'accept')}><Check size={14} /> {rideBusy === ride.id ? 'Accepting...' : 'Accept ride'}</button>
                    </>}
                  </div>
                </div>
              </article>
            })}
            {rideError && <p className="ride-error" role="alert">{rideError}</p>}
            <p className="sample-action-note">Ride requests refresh automatically. Earnings and performance figures remain sample data.</p>
          </section>

          <aside className="earnings-panel" id="earnings">
            <div className="work-panel-header"><div><span className="eyebrow">KEEP IT GOING</span><h2>Weekly earnings</h2></div><button className="period-select">This week⌄</button></div>
            <div className="weekly-total">₹14,260 <span><ArrowUpRight size={13} /> 8.4%</span></div><span className="weekly-sub">A sample week that’s trending up</span>
            <div className="earnings-chart"><div className="chart-grid"><i /><i /><i /></div><div className="chart-bars"><div><i style={{ height: '38%' }} /><small>M</small></div><div><i style={{ height: '57%' }} /><small>T</small></div><div><i style={{ height: '47%' }} /><small>W</small></div><div><i style={{ height: '76%' }} /><small>T</small></div><div><i style={{ height: '62%' }} /><small>F</small></div><div><i style={{ height: '89%' }} /><small>S</small></div><div className="today-bar"><i style={{ height: '50%' }} /><small>S</small></div></div></div>
            <div className="earnings-chart-legend"><span><i /> SAMPLE EARNINGS</span><span>MON — SUN</span></div>
            <div className="next-payout"><div className="payout-icon"><ArrowDownRight size={17} /></div><div><span className="eyebrow">NEXT SAMPLE PAYOUT</span><b>Monday, Nov 16</b></div><span className="payout-amount">₹8,450</span></div>
          </aside>
        </div>

        <section className="driver-profile-card" id="profile"><div className="profile-icon"><ShieldCheck size={21} /></div><div><span className="eyebrow">YOUR AVANTI PROFILE</span><b>Everything’s looking good, {firstName}.</b><small>Your sample profile is complete and your vehicle is ready for the road.</small></div><div className="profile-tags"><span><BadgeCheck size={14} /> Verified</span><span><CarFront size={14} /> White Honda City</span><span><Star size={13} fill="currentColor" /> 4.92 rating</span></div><button className="profile-edit">View profile <ArrowUpRight size={14} /></button></section>
        <footer className="driver-footer"><span>© 2025 Avanti Mobility, Inc. <i>✳</i></span><span>Good roads ahead, {firstName}.</span></footer>
      </div>
    </main>

    <nav className="driver-mobile-nav" aria-label="Driver dashboard shortcuts">
      <a className="active" href="#overview"><span>▦</span><small>Overview</small></a>
      <a href="#requests"><CarFront size={17} /><small>Requests</small></a>
      <a href="#earnings"><WalletCards size={17} /><small>Earnings</small></a>
      <a href="#profile"><ShieldCheck size={17} /><small>Profile</small></a>
    </nav>
  </div>
}
