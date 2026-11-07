import { Wordmark } from './wordmark'

const LINKS = [
  { href: '#about', label: 'About' },
  { href: '#map', label: 'Map' },
  { href: '#method', label: 'Method' },
]

export function SiteHeader() {
  return (
    <header className="sticky top-4 z-40 px-4">
      <div className="glass mx-auto flex h-14 max-w-3xl items-center justify-between gap-4 rounded-md pr-2 pl-5">
        <a href="#top" className="text-xl" aria-label="eta. home">
          <Wordmark />
        </a>
        <nav aria-label="Primary" className="hidden sm:block">
          <ul className="flex items-center gap-8 text-sm text-muted-foreground">
            {LINKS.map((link) => (
              <li key={link.href}>
                <a href={link.href} className="transition-colors hover:text-white">
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <a href="#map" className="btn btn-primary">
          Open map
        </a>
      </div>
    </header>
  )
}
