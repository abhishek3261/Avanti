import { ArrowLeft, ArrowRight, Eye, EyeOff, LockKeyhole, Mail, Phone, UserRound } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import GoogleSignInButton from '../components/GoogleSignInButton'
import { useAuth, type UserRole } from '../context/AuthContext'
import '../styles/google-auth.css'

type Props = { role: UserRole; mode: 'login' | 'register' }

export default function AuthPage({ role, mode }: Props) {
  const { login, register, googleLogin } = useAuth()
  const navigate = useNavigate()
  const [showPassword, setShowPassword] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const finishLogin = () => navigate(`/${role}/dashboard`, { replace: true })
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      if (mode === 'login') await login(role, email, password)
      else await register(role, { name, email, phone, password })
      finishLogin()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to sign in. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const handleGoogleCredential = async (credential: string) => {
    setBusy(true)
    setError('')
    try {
      await googleLogin(role, mode, credential)
      finishLogin()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Google sign-in failed. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return <main className="auth-shell">
    <aside className={`auth-aside ${role === 'driver' ? 'driver-aside' : ''}`}>
      <Link to="/" className="auth-back"><ArrowLeft size={16}/> Back to Avanti</Link>
      <div className="auth-aside-content">
        <span className="eyebrow">{role === 'rider' ? 'THE CITY IS YOURS' : 'YOUR NEXT CHAPTER'}</span>
        <h2>{role === 'rider' ? <>A better ride<br/>is just <em>ahead.</em></> : <>The road looks<br/>good from <em>here.</em></>}</h2>
        <p>{role === 'rider' ? 'Your plans, your people, your city. Get where you’re going with Avanti.' : 'Your time. Your terms. A little more freedom in every mile.'}</p>
        <div className="auth-art-mark">{role === 'rider' ? 'a.' : '✳'}</div>
      </div>
      <span className="auth-aside-footer">MADE FOR THE WAY YOU MOVE</span>
    </aside>
    <section className="auth-form-side"><div className="auth-form-wrap">
      <span className="eyebrow">{role.toUpperCase()} {mode === 'login' ? 'PORTAL' : 'REGISTRATION'}</span>
      <h1>{mode === 'login' ? 'Welcome back.' : 'Let’s get moving.'}</h1>
      <p className="auth-intro">{mode === 'login' ? 'Enter your details to pick up where you left off.' : `Create your ${role} account to get started.`}</p>
      <form onSubmit={submit}>
        {mode === 'register' && <>
          <label className="field-label">Full name<div className="field-wrap"><UserRound size={17}/><input required minLength={2} maxLength={100} placeholder="Your name" autoComplete="name" value={name} onChange={event => setName(event.target.value)}/></div></label>
          <label className="field-label">Phone number<div className="field-wrap"><Phone size={17}/><input required type="tel" minLength={7} maxLength={30} placeholder="+91 98765 43210" autoComplete="tel" value={phone} onChange={event => setPhone(event.target.value)}/></div></label>
        </>}
        <label className="field-label">Email address<div className="field-wrap"><Mail size={17}/><input required type="email" maxLength={254} placeholder="you@example.com" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)}/></div></label>
        <label className="field-label">Password<div className="field-wrap"><LockKeyhole size={17}/><input required type={showPassword ? 'text' : 'password'} placeholder={mode === 'register' ? 'At least 10 characters' : 'Enter your password'} minLength={mode === 'register' ? 10 : undefined} maxLength={128} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={event => setPassword(event.target.value)}/><button className="password-toggle" type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={17}/> : <Eye size={17}/>}</button></div></label>
        <button className="button button-dark auth-submit" type="submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Log in' : `Create ${role} account`} <ArrowRight size={16}/></button>
      </form>
      <div className="auth-divider"><span>OR CONTINUE WITH</span></div>
      <GoogleSignInButton onCredential={handleGoogleCredential}/>
      {error && <p className="auth-error" role="alert">{error}</p>}
      <p className="auth-switch">{mode === 'login' ? 'New to Avanti?' : 'Already have an account?'} <Link to={`/${role}/${mode === 'login' ? 'register' : 'login'}`}>{mode === 'login' ? 'Create an account' : 'Log in'}</Link></p>
      <div className="demo-note"><span>ACCOUNT SECURITY</span> Passwords are hashed on the server. Sessions use secure, HTTP-only cookies.</div>
    </div></section>
  </main>
}
