'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { ArrowLeft, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export default function NewClientPage() {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    name: '',
    client_code: '',
    company: '',
    pm_assigned: '',
    contract_type: '',
    modules_active: '',
    market: '',
    status: 'active',
    notes: '',
  })

  function set(key: string, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) { toast.error('Il nome è obbligatorio'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          modules_active: form.modules_active
            ? form.modules_active.split(',').map((s) => s.trim()).filter(Boolean)
            : [],
        }),
      })
      if (!res.ok) throw new Error()
      const newClient = await res.json()
      toast.success('Cliente creato!')
      router.push(`/clients/${newClient.id}`)
    } catch {
      toast.error('Errore nella creazione')
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen" style={{ background: '#020617' }}>
      <header className="border-b sticky top-0 z-40" style={{ borderColor: '#1e293b', background: 'rgba(2,6,23,0.9)', backdropFilter: 'blur(8px)' }}>
        <div className="max-w-[800px] mx-auto px-4 py-3 flex items-center gap-3">
          <Link href="/">
            <button className="h-8 w-8 flex items-center justify-center rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors">
              <ArrowLeft className="h-4 w-4" />
            </button>
          </Link>
          <span className="text-slate-500 text-sm">/</span>
          <span className="text-white font-semibold">Nuovo cliente</span>
        </div>
      </header>

      <main className="max-w-[800px] mx-auto px-4 py-8">
        <form onSubmit={handleSubmit} className="rounded-lg border p-6 space-y-5" style={{ borderColor: '#1e293b', background: '#0f172a' }}>
          <h1 className="text-xl font-bold text-white">Aggiungi cliente</h1>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="Nome cliente *">
              <Input required placeholder="Es. Barilla" value={form.name} onChange={(e) => set('name', e.target.value)} />
            </FormField>

            <FormField label="Codice cliente (es. BARIL)">
              <Input
                placeholder="BARIL"
                value={form.client_code}
                onChange={(e) => set('client_code', e.target.value.toUpperCase())}
                className="font-mono uppercase"
                maxLength={10}
              />
            </FormField>

            <FormField label="Azienda madre">
              <Input
                placeholder="Es. Barilla G. e R. Fratelli"
                value={form.company}
                onChange={(e) => set('company', e.target.value)}
              />
            </FormField>

            <FormField label="PM assegnato">
              <Input
                placeholder="Es. Sara Conti"
                value={form.pm_assigned}
                onChange={(e) => set('pm_assigned', e.target.value)}
              />
            </FormField>

            <FormField label="Tipo contratto">
              <Input
                placeholder="Full service, Studio only, Add-on..."
                value={form.contract_type}
                onChange={(e) => set('contract_type', e.target.value)}
              />
            </FormField>

            <FormField label="Mercato">
              <Input
                placeholder="IT, DE, FR, UK..."
                value={form.market}
                onChange={(e) => set('market', e.target.value)}
              />
            </FormField>

            <FormField label="Moduli attivi">
              <Input
                placeholder="Sales, Media, DSP, Analytics (separati da virgola)"
                value={form.modules_active}
                onChange={(e) => set('modules_active', e.target.value)}
              />
            </FormField>

            <FormField label="Status">
              <Select value={form.status} onValueChange={(v) => set('status', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="onboarding">Onboarding</SelectItem>
                  <SelectItem value="paused">Paused</SelectItem>
                  <SelectItem value="churned">Churned</SelectItem>
                </SelectContent>
              </Select>
            </FormField>

            <div className="sm:col-span-2">
              <FormField label="Note">
                <Textarea
                  rows={4}
                  placeholder="Note libere sul cliente..."
                  value={form.notes}
                  onChange={(e) => set('notes', e.target.value)}
                />
              </FormField>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <Button type="submit" disabled={saving}>
              <Save className="h-4 w-4" />
              {saving ? 'Salvataggio...' : 'Crea cliente'}
            </Button>
            <Link href="/">
              <Button type="button" variant="ghost">Annulla</Button>
            </Link>
          </div>
        </form>
      </main>
    </div>
  )
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-slate-400 block mb-1.5 font-medium">{label}</label>
      {children}
    </div>
  )
}
