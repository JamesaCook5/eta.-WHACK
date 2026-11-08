import fs from 'node:fs'
import path from 'node:path'
import type { ReactNode } from 'react'
import { ZoomImage } from './zoom-image'

const PUBLIC = path.join(process.cwd(), 'public')

/**
 * A picture from public/ with a one-line caption. Pictures not added yet are
 * skipped, so dropping a file in with the right name makes it appear.
 */
export function Picture({ src, alt, caption, children }: { src?: string; alt: string; caption?: ReactNode; children?: ReactNode }) {
  const exists = src ? fs.existsSync(path.join(PUBLIC, src.replace(/^\//, ''))) : false
  // A picture that hasn't been added yet is simply left out.
  if (!children && !exists) return null
  return (
    <figure className="my-8">
      {children ?? (
        <div className="overflow-hidden rounded-md bg-black/30">
          <ZoomImage src={src!} alt={alt} />
        </div>
      )}
      {caption && <figcaption className="mt-3 text-sm leading-relaxed text-white">{caption}</figcaption>}
    </figure>
  )
}
