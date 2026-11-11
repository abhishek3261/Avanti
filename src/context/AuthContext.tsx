import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

export type UserRole = 'rider' | 'driver'
export type AuthUser = { id: string; email: string; name: string; phone: string | null; role: UserRole; createdAt: string }

type AuthContextValue = {
  user: AuthUser | null
  loading: boolean
  login: (role: UserRole, email: string, password: string) => Promise<void>
  register: (role: UserRole, data: { name: string; email: string; phone: string; password: string }) => Promise<void>
  googleLogin: (role: UserRole, mode: 'login' | 'register', credential: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'include',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (response.status === 204) return undefined as T
  const data = await response.json().catch(() => ({})) as { error?: string } & T
  if (!response.ok) throw new Error(data.error || 'Something went wrong. Please try again.')
  return data
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  const refreshUser = useCallback(async () => {
    try {
      const result = await request<{ user: AuthUser }>('/api/auth/me')
      setUser(result.user)
    } catch {
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refreshUser() }, [refreshUser])

  const login: AuthContextValue['login'] = async (role, email, password) => {
    const result = await request<{ user: AuthUser }>(`/api/auth/${role}/login`, { email, password })
    setUser(result.user)
  }
  const register: AuthContextValue['register'] = async (role, data) => {
    const result = await request<{ user: AuthUser }>(`/api/auth/${role}/register`, data)
    setUser(result.user)
  }
  const googleLogin: AuthContextValue['googleLogin'] = async (role, mode, credential) => {
    const result = await request<{ user: AuthUser }>('/api/auth/google', { role, mode, credential })
    setUser(result.user)
  }
  const logout = async () => {
    try { await request<void>('/api/auth/logout', {}) } catch { /* local state still clears if the API is unavailable */ } finally { setUser(null) }
  }

  return <AuthContext.Provider value={{ user, loading, login, register, googleLogin, logout }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}
