import { useEffect, useRef, useState } from 'react'

type GoogleCredentialResponse = { credential?: string }
type GoogleIdClient = {
  initialize: (options: { client_id: string; callback: (response: GoogleCredentialResponse) => void }) => void
  renderButton: (element: HTMLElement, options: { theme: 'outline'; size: 'large'; shape: 'rectangular'; text: 'continue_with'; width: number }) => void
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleIdClient } }
  }
}

const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID

export default function GoogleSignInButton({ onCredential }: { onCredential: (credential: string) => void }) {
  const buttonRef = useRef<HTMLDivElement>(null)
  const onCredentialRef = useRef(onCredential)
  const [loadError, setLoadError] = useState(false)
  onCredentialRef.current = onCredential

  useEffect(() => {
    if (!clientId || !buttonRef.current) return

    const renderGoogleButton = () => {
      if (!window.google || !buttonRef.current) return
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: response => {
          if (response.credential) onCredentialRef.current(response.credential)
        },
      })
      window.google.accounts.id.renderButton(buttonRef.current, {
        theme: 'outline', size: 'large', shape: 'rectangular', text: 'continue_with',
        width: Math.min(370, buttonRef.current.clientWidth || 320),
      })
    }

    if (window.google) {
      renderGoogleButton()
      return
    }

    let script = document.querySelector<HTMLScriptElement>('script[data-google-identity]')
    if (!script) {
      script = document.createElement('script')
      script.src = 'https://accounts.google.com/gsi/client'
      script.async = true
      script.defer = true
      script.dataset.googleIdentity = 'true'
      script.onerror = () => setLoadError(true)
      document.head.appendChild(script)
    }
    script.addEventListener('load', renderGoogleButton)
    if (window.google) renderGoogleButton()
    return () => script?.removeEventListener('load', renderGoogleButton)
  }, [])

  if (!clientId) return <p className="google-config-note">Add <code>VITE_GOOGLE_CLIENT_ID</code> to <code>.env.local</code> to enable Google sign-in.</p>
  if (loadError) return <p className="google-config-note">Google sign-in could not load. Check your connection and try again.</p>
  return <div className="google-signin-slot" ref={buttonRef} aria-label="Continue with Google" />
}
