import * as React from 'react'
import { cn } from '@/lib/utils'

type BadgeVariant = 'active' | 'churned' | 'onboarding' | 'paused' | 'default'

const variantClasses: Record<BadgeVariant, string> = {
  active:     'bg-green-500/15 text-green-400 border-green-500/30',
  onboarding: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  paused:     'bg-slate-500/15 text-slate-400 border-slate-500/30',
  churned:    'bg-red-500/15 text-red-400 border-red-500/30',
  default:    'bg-slate-700/40 text-slate-300 border-slate-600',
}

const statusLabels: Record<string, string> = {
  active:     'Active',
  onboarding: 'Onboarding',
  paused:     'Paused',
  churned:    'Churned',
}

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant
  status?: string
}

export function Badge({ variant, status, className, children, ...props }: BadgeProps) {
  const v: BadgeVariant = variant ?? (status as BadgeVariant) ?? 'default'
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium',
        variantClasses[v] ?? variantClasses.default,
        className,
      )}
      {...props}
    >
      {children ?? statusLabels[status ?? ''] ?? status}
    </span>
  )
}
