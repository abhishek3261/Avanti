import { ArrowUpRight, Instagram, Linkedin } from 'lucide-react'
import Brand from './Brand'

export default function Footer() {
  return <footer className="site-footer"><div className="footer-top"><div><Brand light/><p>Good journeys start here.<br/>Wherever you’re going.</p></div><div className="footer-links"><div><span>Explore</span><a href="/#how-it-works">How it works</a><a href="/#why-avanti">Why Avanti</a></div><div><span>Get moving</span><a href="/rider/dashboard">Book a ride</a><a href="/driver/register">Become a driver</a></div><div><span>Say hello</span><a href="mailto:hello@avanti.example">Contact us <ArrowUpRight size={13}/></a><div className="socials"><a href="https://instagram.com" aria-label="Instagram"><Instagram size={16}/></a><a href="https://linkedin.com" aria-label="LinkedIn"><Linkedin size={16}/></a></div></div></div></div><div className="footer-bottom"><span>© 2025 Avanti Mobility, Inc.</span><div><a href="#privacy">Privacy</a><a href="#terms">Terms</a></div><span>Made for the way you move <span className="footer-star">✳</span></span></div></footer>
}
