import Link from 'next/link'
import { Wordmark } from './wordmark'

// Absolute paths so the links also work from /methodology.
const LINKS = [
  { href: '/#top', label: 'Home' },
  { href: '/#map', label: 'Map' },
]

export function SiteHeader({ current }: { current?: 'methodology' }) {
  return (
    <header className="relative z-40 px-4 pt-4">
      <div className="glass mx-auto grid h-14 max-w-3xl grid-cols-[1fr_auto_1fr] items-center gap-4 rounded-md px-5">
        <Link href="/" className="justify-self-start text-xl" aria-label="eta. home">
          <Wordmark />
        </Link>
        <nav aria-label="Primary" className="hidden sm:block">
          <ul className="flex items-center gap-8 text-sm text-white">
            {LINKS.map((link) => (
              <li key={link.href}>
                <a href={link.href} className="transition-opacity hover:opacity-70">
                  {link.label}
                </a>
              </li>
            ))}
            <li>
              {/* scroll={false}: the methodology page resets to the top itself. */}
              <Link
                href="/methodology"
                scroll={false}
                aria-current={current === 'methodology' ? 'page' : undefined}
                className="transition-opacity hover:opacity-70 aria-[current=page]:underline aria-[current=page]:underline-offset-8"
              >
                Methodology
              </Link>
            </li>
          </ul>
        </nav>
        <span aria-hidden="true" />
      </div>
    </header>
  )
}
