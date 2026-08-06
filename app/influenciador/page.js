'use client'

import { useEffect, useState, useCallback } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Copy, LogOut, Sparkles, Wallet, Users, TrendingUp, Send, LayoutDashboard, Landmark, Settings, Flame } from 'lucide-react'

const fmt = (cents) => `${((cents || 0) / 100).toFixed(2)}€`

function api(path, opts = {}) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('ff_influencer_token') : null
  return fetch('/api' + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(opts.headers || {}),
    },
  }).then(async (r) => {
    const data = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(data.error || 'Erro')
    return data
  })
}

const WITHDRAWAL_STATUS_COLORS = {
  PENDENTE: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/40',
  EM_PROCESSAMENTO: 'bg-blue-500/15 text-blue-300 border-blue-500/40',
  PAGO: 'bg-green-500/15 text-green-300 border-green-500/40',
  REJEITADO: 'bg-red-500/15 text-red-300 border-red-500/40',
}

function InfluencerLogin({ onSuccess }) {
  const [form, setForm] = useState({ email: '', password: '' })
  const [loading, setLoading] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      const r = await fetch('/api/influencer/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Erro')
      localStorage.setItem('ff_influencer_token', data.token)
      onSuccess(data.influencer)
    } catch (e) { toast.error(e.message) }
    finally { setLoading(false) }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950 px-4 relative overflow-hidden">
      <div className="absolute top-0 left-1/3 w-[500px] h-[500px] bg-purple-600/20 rounded-full blur-[100px]" />
      <Card className="relative w-full max-w-md p-8 bg-zinc-900 border-purple-500/30 shadow-2xl">
        <div className="flex items-center justify-center gap-2 mb-2">
          <Flame className="w-6 h-6 text-purple-400" />
          <span className="font-extrabold gradient-text text-lg">FF ARENA</span>
        </div>
        <div className="flex items-center justify-center gap-2 mb-6">
          <Sparkles className="w-7 h-7 text-purple-400" />
          <span className="font-black text-xl text-white">ÁREA DE PARCEIROS</span>
        </div>
        <h2 className="text-xl font-bold mb-1 text-white text-center">Login de Influenciador</h2>
        <p className="text-sm text-zinc-400 mb-6 text-center">Acompanha as tuas comissões de referência</p>
        <form onSubmit={submit} className="space-y-4">
          <div><Label className="text-zinc-200">Email</Label><Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} required className="bg-zinc-800 border-zinc-700 text-white" /></div>
          <div><Label className="text-zinc-200">Palavra-passe</Label><Input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} required className="bg-zinc-800 border-zinc-700 text-white" /></div>
          <Button type="submit" disabled={loading} className="w-full bg-gradient-to-r from-purple-600 to-blue-500 h-11 font-bold">
            {loading ? 'A entrar...' : 'Entrar'}
          </Button>
        </form>
        <div className="text-center mt-6">
          <a href="/" className="text-xs text-zinc-500 hover:text-zinc-300">← Voltar ao site</a>
        </div>
      </Card>
    </div>
  )
}

function Stat({ label, value, I, color }) {
  return (
    <Card className="bg-zinc-900 border-zinc-800 p-4">
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${color} flex items-center justify-center`}>
          <I className="w-4 h-4 text-white" />
        </div>
        <span className="text-xs text-zinc-400">{label}</span>
      </div>
      <div className="text-2xl font-black text-white">{value}</div>
    </Card>
  )
}

function DashboardView({ data }) {
  const referralLink = typeof window !== 'undefined' && data ? `${window.location.origin}/?ref=${data.referralCode}` : ''
  const copyLink = () => { navigator.clipboard.writeText(referralLink); toast.success('Link copiado!') }
  return (
    <div className="space-y-6">
      <Card className="bg-gradient-to-br from-purple-600/20 to-blue-500/20 border-purple-500/40 p-5">
        <div className="text-sm text-zinc-300 mb-2">O teu link de referência (comissão de {data.commissionPercent}% sobre a receita da plataforma, vitalícia)</div>
        <div className="flex gap-2 flex-wrap">
          <div className="flex-1 min-w-[200px] bg-zinc-900/60 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white font-mono truncate">{referralLink}</div>
          <Button onClick={copyLink} className="bg-purple-600 hover:bg-purple-700"><Copy className="w-4 h-4 mr-2" /> Copiar</Button>
        </div>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Saldo Disponível" value={fmt(data.balanceCents)} I={Wallet} color="from-green-500 to-emerald-500" />
        <Stat label="Pendente" value={fmt(data.pendingCents)} I={Wallet} color="from-yellow-500 to-amber-500" />
        <Stat label="Total Ganho" value={fmt(data.totalEarnedCents)} I={TrendingUp} color="from-purple-500 to-blue-500" />
        <Stat label="Jogadores Referidos" value={data.referredCount} I={Users} color="from-blue-500 to-cyan-500" />
      </div>

      {data.milestoneStep && (() => {
        const step = data.milestoneStep
        const active = data.activeReferredCount || 0
        const inStep = active % step
        const nextAt = Math.floor(active / step) * step + step
        const pct = Math.round((inStep / step) * 100)
        return (
          <Card className="bg-zinc-900 border-zinc-800 p-5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 mb-2">
              <h3 className="font-bold text-white">🎯 Bónus por Marcos</h3>
              <span className="text-xs text-zinc-400">a cada {step} jogadores ativos → +{fmt(data.milestoneBonusCents)}</span>
            </div>
            <div className="text-sm text-zinc-300 mb-2">{active} jogadores ativos · faltam {nextAt - active} para o próximo bónus ({nextAt})</div>
            <div className="w-full bg-zinc-800 rounded-full h-3 overflow-hidden">
              <div className="h-full bg-gradient-to-r from-purple-600 to-blue-500 transition-all" style={{ width: `${pct}%` }} />
            </div>
          </Card>
        )
      })()}

      <Card className="bg-zinc-900 border-zinc-800 p-5">
        <h3 className="font-bold text-white mb-4">Histórico de Comissões</h3>
        <div className="space-y-2">
          {data.transactions.map(t => (
            <div key={t.id} className="flex items-center justify-between bg-zinc-800/60 rounded-lg px-4 py-2.5 text-sm">
              <div>
                <div className="text-zinc-200">{t.description}</div>
                <div className="text-xs text-zinc-500">{new Date(t.createdAt).toLocaleString('pt-PT')}</div>
              </div>
              <div className={`font-bold ${t.amountCents >= 0 ? 'text-green-400' : 'text-red-400'}`}>{t.amountCents >= 0 ? '+' : ''}{fmt(t.amountCents)}</div>
            </div>
          ))}
          {!data.transactions.length && <div className="text-sm text-zinc-500 text-center py-4">Ainda sem comissões — partilha o teu link para começar a ganhar.</div>}
        </div>
      </Card>
    </div>
  )
}

function WithdrawalsView({ data, reload }) {
  const [busy, setBusy] = useState(false)
  const [method, setMethod] = useState(null)
  const [methodForm, setMethodForm] = useState({ fullName: '', type: 'MBWAY', iban: '', mbway: '' })
  const [amountEuros, setAmountEuros] = useState('10')

  const loadMethod = useCallback(async () => {
    try {
      const m = await api('/influencer/withdrawal-method')
      setMethod(m.method)
      if (m.method) setMethodForm({ fullName: m.method.fullName || '', type: m.method.type || 'MBWAY', iban: m.method.iban || '', mbway: m.method.mbway || '' })
    } catch (e) { toast.error(e.message) }
  }, [])
  useEffect(() => { loadMethod() }, [loadMethod])

  const saveMethod = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      await api('/influencer/withdrawal-method', { method: 'POST', body: JSON.stringify(methodForm) })
      toast.success('Método de levantamento guardado')
      loadMethod()
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }

  const requestWithdraw = async () => {
    setBusy(true)
    try {
      await api('/influencer/withdraw', { method: 'POST', body: JSON.stringify({ amountEuros }) })
      toast.success('Pedido de levantamento enviado')
      reload()
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }

  return (
    <div className="space-y-6">
      <Card className="bg-zinc-900 border-zinc-800 p-5">
        <h3 className="font-bold text-white mb-4">Levantar Saldo</h3>
        <div className="flex gap-3 flex-wrap items-end mb-4">
          <div>
            <Label className="text-zinc-300 text-xs">Valor (€)</Label>
            <input type="number" min="2" step="0.5" value={amountEuros} onChange={e => setAmountEuros(e.target.value)} className="mt-1 bg-zinc-800 border border-zinc-700 text-white rounded-md px-3 py-2 text-sm w-32" />
          </div>
          <Button onClick={requestWithdraw} disabled={busy || !method} className="bg-blue-600 hover:bg-blue-700">
            <Send className="w-4 h-4 mr-2" /> Pedir Levantamento
          </Button>
          {!method && <div className="text-xs text-yellow-300">Configura primeiro o teu método de pagamento abaixo</div>}
        </div>

        <form onSubmit={saveMethod} className="border-t border-zinc-800 pt-4 space-y-3">
          <div className="text-xs text-zinc-400 mb-1">Método de levantamento</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-zinc-300 text-xs">Nome completo</Label>
              <input value={methodForm.fullName} onChange={e => setMethodForm({ ...methodForm, fullName: e.target.value })} required className="mt-1 w-full bg-zinc-800 border border-zinc-700 text-white rounded-md px-3 py-2 text-sm" />
            </div>
            <div>
              <Label className="text-zinc-300 text-xs">Tipo</Label>
              <select value={methodForm.type} onChange={e => setMethodForm({ ...methodForm, type: e.target.value })} className="mt-1 w-full bg-zinc-800 border border-zinc-700 text-white rounded-md px-3 py-2 text-sm">
                <option value="MBWAY">MB WAY</option>
                <option value="IBAN">IBAN</option>
                <option value="TRANSFERENCIA">Transferência</option>
              </select>
            </div>
            {methodForm.type === 'MBWAY' ? (
              <div className="sm:col-span-2">
                <Label className="text-zinc-300 text-xs">Número MB WAY</Label>
                <input value={methodForm.mbway} onChange={e => setMethodForm({ ...methodForm, mbway: e.target.value })} required className="mt-1 w-full bg-zinc-800 border border-zinc-700 text-white rounded-md px-3 py-2 text-sm" />
              </div>
            ) : (
              <div className="sm:col-span-2">
                <Label className="text-zinc-300 text-xs">IBAN</Label>
                <input value={methodForm.iban} onChange={e => setMethodForm({ ...methodForm, iban: e.target.value })} required className="mt-1 w-full bg-zinc-800 border border-zinc-700 text-white rounded-md px-3 py-2 text-sm" />
              </div>
            )}
          </div>
          <Button type="submit" disabled={busy} size="sm" variant="outline" className="border-zinc-700 text-zinc-300">Guardar Método</Button>
        </form>
      </Card>

      <Card className="bg-zinc-900 border-zinc-800 p-5">
        <h3 className="font-bold text-white mb-4">Levantamentos</h3>
        <div className="space-y-2">
          {data.withdrawals.map(w => (
            <div key={w.id} className="flex items-center justify-between bg-zinc-800/60 rounded-lg px-4 py-2.5 text-sm">
              <div>
                <div className="text-white font-bold">{fmt(w.amountCents)}</div>
                <div className="text-xs text-zinc-500">{new Date(w.createdAt).toLocaleString('pt-PT')}</div>
              </div>
              <Badge variant="outline" className={WITHDRAWAL_STATUS_COLORS[w.status] || ''}>{w.status}</Badge>
            </div>
          ))}
          {!data.withdrawals.length && <div className="text-sm text-zinc-500 text-center py-4">Sem levantamentos ainda.</div>}
        </div>
      </Card>
    </div>
  )
}

function SettingsView({ influencer, onUpdated }) {
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState(influencer?.name || '')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const saveName = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      const r = await api('/influencer/settings', { method: 'POST', body: JSON.stringify({ name }) })
      toast.success('Nome atualizado')
      onUpdated(r.influencer)
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }

  const savePassword = async (e) => {
    e.preventDefault()
    if (newPassword !== confirmPassword) { toast.error('As passwords novas não coincidem'); return }
    setBusy(true)
    try {
      await api('/influencer/settings', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) })
      toast.success('Password alterada')
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('')
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }

  return (
    <div className="space-y-6 max-w-lg">
      <Card className="bg-zinc-900 border-zinc-800 p-5">
        <h3 className="font-bold text-white mb-4">Nome</h3>
        <form onSubmit={saveName} className="space-y-3">
          <div>
            <Label className="text-zinc-300 text-xs">Nome de exibição</Label>
            <input value={name} onChange={e => setName(e.target.value)} required className="mt-1 w-full bg-zinc-800 border border-zinc-700 text-white rounded-md px-3 py-2 text-sm" />
          </div>
          <Button type="submit" disabled={busy} size="sm" className="bg-purple-600 hover:bg-purple-700">Guardar Nome</Button>
        </form>
      </Card>

      <Card className="bg-zinc-900 border-zinc-800 p-5">
        <h3 className="font-bold text-white mb-4">Mudar Password</h3>
        <form onSubmit={savePassword} className="space-y-3">
          <div>
            <Label className="text-zinc-300 text-xs">Password atual</Label>
            <input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} required className="mt-1 w-full bg-zinc-800 border border-zinc-700 text-white rounded-md px-3 py-2 text-sm" />
          </div>
          <div>
            <Label className="text-zinc-300 text-xs">Nova password</Label>
            <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} required minLength={6} className="mt-1 w-full bg-zinc-800 border border-zinc-700 text-white rounded-md px-3 py-2 text-sm" />
          </div>
          <div>
            <Label className="text-zinc-300 text-xs">Confirmar nova password</Label>
            <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required minLength={6} className="mt-1 w-full bg-zinc-800 border border-zinc-700 text-white rounded-md px-3 py-2 text-sm" />
          </div>
          <Button type="submit" disabled={busy} size="sm" className="bg-purple-600 hover:bg-purple-700">Alterar Password</Button>
        </form>
      </Card>
    </div>
  )
}

function InfluencerDashboard({ influencer, setInfluencer, onLogout }) {
  const [data, setData] = useState(null)
  const [view, setView] = useState('dashboard')

  const load = useCallback(async () => {
    try { setData(await api('/influencer/dashboard')) } catch (e) { toast.error(e.message) }
  }, [])

  useEffect(() => { load(); const i = setInterval(load, 15000); return () => clearInterval(i) }, [load])

  if (!data) return <div className="min-h-screen flex items-center justify-center text-zinc-400">A carregar...</div>

  const nav = [
    ['dashboard', 'Dashboard', LayoutDashboard],
    ['levantamentos', 'Levantamentos', Landmark],
    ['definicoes', 'Definições', Settings],
  ]

  return (
    <div className="min-h-screen bg-zinc-950 p-4 sm:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center gap-2">
          <Flame className="w-5 h-5 text-purple-400" />
          <span className="font-extrabold gradient-text text-base">FF ARENA</span>
          <span className="text-zinc-600">·</span>
          <span className="text-xs text-zinc-500">Área de Parceiros</span>
        </div>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-purple-400" />
            <div>
              <div className="font-black text-white text-lg">{influencer?.name}</div>
              <div className="text-xs text-zinc-500">{influencer?.email}</div>
            </div>
          </div>
          <Button variant="outline" onClick={onLogout} className="border-zinc-700 text-zinc-300">
            <LogOut className="w-4 h-4 mr-2" /> Sair
          </Button>
        </div>

        <div className="grid grid-cols-3 sm:flex sm:gap-1 gap-1 border-b border-zinc-800 pb-1">
          {nav.map(([k, l, I]) => (
            <button key={k} onClick={() => setView(k)}
              className={`flex items-center justify-center sm:justify-start gap-1.5 px-2 sm:px-3 py-2 rounded-t-lg text-xs sm:text-sm font-medium transition ${view === k ? 'bg-zinc-900 text-purple-300 border border-zinc-800 border-b-zinc-900' : 'text-zinc-500 hover:text-zinc-300'}`}>
              <I className="w-4 h-4 shrink-0" /><span className="truncate">{l}</span>
            </button>
          ))}
        </div>

        {view === 'dashboard' && <DashboardView data={data} />}
        {view === 'levantamentos' && <WithdrawalsView data={data} reload={load} />}
        {view === 'definicoes' && <SettingsView influencer={influencer} onUpdated={setInfluencer} />}
      </div>
    </div>
  )
}

export default function InfluencerPage() {
  const [influencer, setInfluencer] = useState(null)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('ff_influencer_token')
    if (!token) { setChecking(false); return }
    api('/influencer/me').then(d => setInfluencer(d.influencer)).catch(() => localStorage.removeItem('ff_influencer_token')).finally(() => setChecking(false))
  }, [])

  const logout = () => {
    localStorage.removeItem('ff_influencer_token')
    setInfluencer(null)
  }

  if (checking) return <div className="min-h-screen flex items-center justify-center text-zinc-400 bg-zinc-950">A carregar...</div>
  if (!influencer) return <InfluencerLogin onSuccess={setInfluencer} />
  return <InfluencerDashboard influencer={influencer} setInfluencer={setInfluencer} onLogout={logout} />
}
