import { ArrowUpRight, Menu, X } from 'lucide-react'
import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Brand from './Brand'

export default function Navbar() {
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const portal = user?.role || (pathname.startsWith('/driver') ? 'driver' : 'rider')
  const closeMenu = () => setOpen(false)
  const handleLogout = async () => {
    closeMenu()
    await logout()
    navigate('/')
  }

  return <header className="site-header"><div className="nav-wrap"><Brand /><nav className={open ? 'nav-links open' : 'nav-links'} aria-label="Main navigation">
    <a href="/#how-it-works" onClick={closeMenu}>How it works</a><a href="/#why-avanti" onClick={closeMenu}>Why Avanti</a>
    {!user && <Link to="/driver/register" onClick={closeMenu}>Drive with us</Link>}
    <div className="mobile-nav-actions">{user ? <><Link className="button button-outline" to={`/${portal}/dashboard`} onClick={closeMenu}>My account</Link><button className="button button-dark" onClick={handleLogout}>Log out</button></> : <><Link className="button button-outline" to={`/${portal}/login`} onClick={closeMenu}>Log in</Link><Link className="button button-dark" to="/rider/dashboard" onClick={closeMenu}>Book a ride <ArrowUpRight size={16}/></Link></>}</div>
  </nav><div className="desktop-nav-actions">{user ? <><Link className="nav-login" to={`/${portal}/dashboard`}>{user.name.split(' ')[0]}</Link><button className="nav-login nav-logout" onClick={handleLogout}>Log out</button></> : <><Link className="nav-login" to={`/${portal}/login`}>Log in</Link><Link className="button button-dark nav-cta" to="/rider/dashboard">Book a ride <ArrowUpRight size={15}/></Link></>}</div>
  <button className="menu-toggle" aria-label={open ? 'Close menu' : 'Open menu'} onClick={() => setOpen(!open)}>{open ? <X/> : <Menu/>}</button></div></header>
}
