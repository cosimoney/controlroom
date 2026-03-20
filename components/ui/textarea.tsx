import * as React from 'react'
import { cn } from '@/lib/utils'

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, ...props }, ref) => (
  <textarea
    className={cn(
      'flex w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100',
      'placeholder:text-slate-500 resize-none',
      'focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent',
      'disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    ref={ref}
    {...props}
  />
))
Textarea.displayName = 'Textarea'

export { Textarea }
