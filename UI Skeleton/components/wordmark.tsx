import { cn } from '@/lib/utils'

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('font-display font-semibold lowercase tracking-tight text-white', className)}>
      eta.
    </span>
  )
}
