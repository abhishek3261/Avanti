import type { ReactNode } from 'react'

export default function SectionHeading({ eyebrow, title, body, light = false }: { eyebrow: string; title: ReactNode; body?: string; light?: boolean }) {
  return <div className={`section-heading ${light ? 'section-heading-light' : ''}`}><span className="eyebrow">{eyebrow}</span><h2>{title}</h2>{body && <p>{body}</p>}</div>
}
