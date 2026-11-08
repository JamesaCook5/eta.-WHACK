import Link from 'next/link'
import { Wordmark } from './wordmark'

export function SiteFooter() {
  return (
    <footer className="px-4 pt-12 pb-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <Wordmark className="text-2xl" />
        <nav aria-label="Footer">
          <ul className="flex flex-wrap gap-6 text-sm text-muted-foreground">
            <li>
              <a href="/#top" className="hover:text-white">Home</a>
            </li>
            <li>
              <a href="/#map" className="hover:text-white">Map</a>
            </li>
            <li>
              <Link href="/methodology" scroll={false} className="hover:text-white">Methodology</Link>
            </li>
            <li>
              <a
                href="https://ssp.imcce.fr/webservices/ssodnet/"
                className="hover:text-white"
                target="_blank"
                rel="noreferrer"
              >
                Data: IMCCE SsODNet
              </a>
            </li>
          </ul>
        </nav>
      </div>
    </footer>
  )
}
