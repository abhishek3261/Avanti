import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './routes/App'
import { AuthProvider } from './context/AuthContext'
import './styles/index.css'
import './styles/premium-theme.css'
import './styles/premium-shell.css'
import './styles/premium-landing.css'
import './styles/premium-rider.css'
import './styles/premium-driver.css'
import './styles/premium-auth.css'
import './styles/google-maps.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter><AuthProvider><App /></AuthProvider></BrowserRouter>
  </React.StrictMode>,
)
