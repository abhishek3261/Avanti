import { Link } from 'react-router-dom'

export default function Brand({ light = false }: { light?: boolean }) {
  return <Link to="/" className={`brand ${light ? 'brand-light' : ''}`} aria-label="Avanti home"><span className="brand-mark">a<span>.</span></span><span className="brand-name">avanti</span></Link>
}
