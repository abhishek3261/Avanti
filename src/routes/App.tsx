import { Route, Routes } from 'react-router-dom'
import LandingPage from '../pages/LandingPage'
import AuthPage from '../pages/AuthPage'
import RiderDashboard from '../pages/RiderDashboard'
import DriverDashboard from '../pages/DriverDashboard'
import AppLayout from '../layouts/AppLayout'
import RequireRole from './RequireRole'

export default function App() {
  return <Routes><Route element={<AppLayout />}>
    <Route path="/" element={<LandingPage />} />
    <Route path="/rider/login" element={<AuthPage role="rider" mode="login" />} />
    <Route path="/rider/register" element={<AuthPage role="rider" mode="register" />} />
    <Route path="/rider/dashboard" element={<RequireRole role="rider"><RiderDashboard /></RequireRole>} />
    <Route path="/driver/login" element={<AuthPage role="driver" mode="login" />} />
    <Route path="/driver/register" element={<AuthPage role="driver" mode="register" />} />
    <Route path="/driver/dashboard" element={<RequireRole role="driver"><DriverDashboard /></RequireRole>} />
    <Route path="*" element={<LandingPage />} />
  </Route></Routes>
}
