import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth, type UserRole } from '../context/AuthContext'

export default function RequireRole({ role, children }: { role: UserRole; children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <main className="auth-loading"><span className="loading-mark">a.</span><p>Checking your Avanti account…</p></main>
  if (!user) return <Navigate to={`/${role}/login`} replace />
  if (user.role !== role) return <Navigate to={`/${user.role}/dashboard`} replace />
  return children
}
