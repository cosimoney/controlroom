'use client'
import * as React from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Check, ChevronsUpDown, Search } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ComboboxOption {
  value: string
  label: string
  sublabel?: string
}

interface ComboboxProps {
  options: ComboboxOption[]
  value: string
  onValueChange: (value: string) => void
  placeholder?: string
  searchPlaceholder?: string
  className?: string
}

export function Combobox({
  options,
  value,
  onValueChange,
  placeholder = 'Seleziona...',
  searchPlaceholder = 'Cerca...',
  className,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false)
  const [search, setSearch] = React.useState('')

  const q = search.toLowerCase()
  const filtered = options.filter((o) =>
    o.label.toLowerCase().includes(q) ||
    (o.sublabel ? o.sublabel.toLowerCase().includes(q) : false)
  )

  const selected = options.find((o) => o.value === value)

  function handleSelect(optValue: string) {
    onValueChange(optValue === value ? '' : optValue)
    setOpen(false)
    setSearch('')
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          role="combobox"
          aria-expanded={open}
          className={cn(
            'flex h-9 w-full items-center justify-between rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100',
            'hover:bg-slate-700 cursor-pointer',
            'focus:outline-none focus:ring-2 focus:ring-indigo-500',
            !selected && 'text-slate-500',
            className,
          )}
        >
          <span className="truncate">{selected ? selected.label : placeholder}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 text-slate-400 shrink-0 ml-2" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="z-50 w-[var(--radix-popover-trigger-width)] rounded-md border border-slate-700 bg-slate-800 shadow-xl animate-fade-in"
          sideOffset={4}
          align="start"
        >
          {/* Search input */}
          <div className="flex items-center border-b border-slate-700 px-3">
            <Search className="h-3.5 w-3.5 text-slate-400 shrink-0 mr-2" />
            <input
              className="flex h-9 w-full bg-transparent py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none"
              placeholder={searchPlaceholder}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
          </div>
          {/* Options list */}
          <div className="max-h-[200px] overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <div className="py-6 text-center text-sm text-slate-500">Nessun risultato</div>
            ) : (
              filtered.map((opt) => (
                <button
                  key={opt.value}
                  className={cn(
                    'relative flex w-full cursor-pointer select-none items-center rounded px-2 py-1.5 text-sm outline-none',
                    'hover:bg-slate-700 hover:text-white text-slate-200',
                    value === opt.value && 'bg-slate-700 text-white',
                  )}
                  onClick={() => handleSelect(opt.value)}
                >
                  <Check
                    className={cn(
                      'mr-2 h-3.5 w-3.5 shrink-0',
                      value === opt.value ? 'opacity-100 text-indigo-400' : 'opacity-0',
                    )}
                  />
                  <span className="flex items-baseline gap-1.5 min-w-0">
                    <span className="truncate">{opt.label}</span>
                    {opt.sublabel && (
                      <span className="shrink-0 text-xs text-slate-500">{opt.sublabel}</span>
                    )}
                  </span>
                </button>
              ))
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
