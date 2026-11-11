import { Outlet, useLocation } from 'react-router-dom'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'

export default function AppLayout() {
  const location = useLocation()
  const isDashboard = location.pathname.includes('dashboard')
  const isAuth = location.pathname.includes('/login') || location.pathname.includes('/register')
  return <><Navbar />{isDashboard ? <main className="app-main"><Outlet /></main> : <Outlet />}{!isDashboard && !isAuth && <Footer />}</>
}
