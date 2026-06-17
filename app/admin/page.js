'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Shield, LayoutDashboard, Gamepad2, AlertTriangle, Users, LogOut, Flame, Coins, Activity, CheckCircle2, XCircle, Ban, ShieldCheck, Crown, Wallet as WalletIcon, Image as ImageIcon, Video, Scale, MessageSquare, Landmark, ClipboardList, TrendingUp, ArrowDownLeft, ArrowUpRight, CreditCard, Smartphone, Copy, Send } from 'lucide-react'

const fmt = (cents) => `${((cents || 0) / 100).toFixed(2)}€`

function api(path, opts = {}) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('ff_admin_token') : null
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

const STATUS_COLORS = {
  ABERTA: 'bg-green-500/15 text-green-300 border-green-500/40',
  EMPARELHADA: 'bg-blue-500/15 text-blue-300 border-blue-500/40',
  EM_ANDAMENTO: 'bg-purple-500/15 text-purple-300 border-purple-500/40',
  FINALIZADA: 'bg-gray-500/15 text-gray-300 border-gray-500/40',
  EM_CONFLITO: 'bg-orange-500/15 text-orange-300 border-orange-500/40',
  EM_DISPUTA: 'bg-red-500/15 text-red-300 border-red-500/40',
  CANCELADA: 'bg-zinc-700/30 text-zinc-400 border-zinc-600',
  CRIADA: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/40',
}

const WITHDRAWAL_TYPE_LABELS = { IBAN: 'IBAN', MBWAY: 'MB WAY', TRANSFERENCIA: 'Transferência bancária' }
const WITHDRAWAL_STATUS_COLORS = {
  PENDENTE: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/40',
  EM_PROCESSAMENTO: 'bg-blue-500/15 text-blue-300 border-blue-500/40',
  PAGO: 'bg-green-500/15 text-green-300 border-green-500/40',
  REJEITADO: 'bg-red-500/15 text-red-300 border-red-500/40',
}

// -------- LOGIN --------
function AdminLogin({ onSuccess }) {
  const [form, setForm] = useState({ email: 'admin@ffarena.com', password: '' })
  const [loading, setLoading] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Erro')
      if (!data.user?.isAdmin) throw new Error('Esta conta não é de administrador')
      localStorage.setItem('ff_admin_token', data.token)
      toast.success('Bem-vindo, ' + data.user.name)
      onSuccess(data.user)
    } catch (e) { toast.error(e.message) }
    finally { setLoading(false) }
  }
  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950 px-4 relative overflow-hidden">
      <div className="absolute top-0 left-1/3 w-[500px] h-[500px] bg-purple-600/20 rounded-full blur-[100px]" />
      <Card className="relative w-full max-w-md p-8 bg-zinc-900 border-purple-500/30 shadow-2xl">
        <div className="flex items-center justify-center gap-2 mb-6">
          <Shield className="w-7 h-7 text-purple-400" />
          <span className="font-black text-xl text-white">PAINEL ADMIN</span>
        </div>
        <h2 className="text-xl font-bold mb-1 text-white text-center">Login Administrador</h2>
        <p className="text-sm text-zinc-400 mb-6 text-center">Acesso exclusivo para gestão da plataforma</p>
        <form onSubmit={submit} className="space-y-4">
          <div><Label className="text-zinc-200">Email</Label><Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} required className="bg-zinc-800 border-zinc-700 text-white" /></div>
          <div><Label className="text-zinc-200">Palavra-passe</Label><Input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} required className="bg-zinc-800 border-zinc-700 text-white" /></div>
          <Button type="submit" disabled={loading} className="w-full bg-gradient-to-r from-purple-600 to-blue-500 h-11 font-bold">
            {loading ? 'A entrar...' : 'Entrar'}
          </Button>
        </form>
        <div className="text-center mt-6">
          <a href="/" className="text-xs text-zinc-500 hover:text-zinc-300">← Voltar ao site público</a>
        </div>
      </Card>
    </div>
  )
}

// -------- DASHBOARD --------
function DashboardSection() {
  const [stats, setStats] = useState(null)
  const [bonusEligible, setBonusEligible] = useState([])
  const [creditingBonus, setCreditingBonus] = useState(null)
  const [topupsEnabled, setTopupsEnabled] = useState(true)
  const [togglingTopups, setTogglingTopups] = useState(false)
  const [stripeEnabled, setStripeEnabled] = useState(true)
  const [togglingStripe, setTogglingStripe] = useState(false)
  const [mbwayPhone, setMbwayPhone] = useState('')
  const [mbwayPhoneInput, setMbwayPhoneInput] = useState('')
  const [savingPhone, setSavingPhone] = useState(false)
  const [platformIban, setPlatformIban] = useState('')
  const [platformIbanInput, setPlatformIbanInput] = useState('')
  const [savingIban, setSavingIban] = useState(false)

  useEffect(() => {
    api('/admin/settings').then(s => {
      setTopupsEnabled(s.topupsEnabled)
      setStripeEnabled(s.stripeEnabled)
      setMbwayPhone(s.mbwayPhone || '')
      setMbwayPhoneInput(s.mbwayPhone || '')
      setPlatformIban(s.platformIban || '')
      setPlatformIbanInput(s.platformIban || '')
    }).catch(() => {})
  }, [])

  const toggleTopups = async () => {
    setTogglingTopups(true)
    try {
      const res = await api('/admin/settings', { method: 'POST', body: JSON.stringify({ topupsEnabled: !topupsEnabled }) })
      setTopupsEnabled(res.topupsEnabled)
      toast.success(res.topupsEnabled ? 'Carregamentos activados' : 'Carregamentos desactivados')
    } catch (e) { toast.error(e.message) }
    finally { setTogglingTopups(false) }
  }

  const toggleStripe = async () => {
    setTogglingStripe(true)
    try {
      const res = await api('/admin/settings', { method: 'POST', body: JSON.stringify({ stripeEnabled: !stripeEnabled }) })
      setStripeEnabled(res.stripeEnabled)
      toast.success(res.stripeEnabled ? 'Pagamento por cartão activado' : 'Pagamento por cartão desactivado')
    } catch (e) { toast.error(e.message) }
    finally { setTogglingStripe(false) }
  }

  const saveMbwayPhone = async () => {
    setSavingPhone(true)
    try {
      const res = await api('/admin/settings', { method: 'POST', body: JSON.stringify({ mbwayPhone: mbwayPhoneInput }) })
      setMbwayPhone(res.mbwayPhone || '')
      toast.success(res.mbwayPhone ? `Número MB WAY guardado: ${res.mbwayPhone}` : 'Número MB WAY removido')
    } catch (e) { toast.error(e.message) }
    finally { setSavingPhone(false) }
  }

  const saveIban = async () => {
    setSavingIban(true)
    try {
      const res = await api('/admin/settings', { method: 'POST', body: JSON.stringify({ platformIban: platformIbanInput }) })
      setPlatformIban(res.platformIban || '')
      toast.success(res.platformIban ? `IBAN guardado: ${res.platformIban}` : 'IBAN removido')
    } catch (e) { toast.error(e.message) }
    finally { setSavingIban(false) }
  }

  useEffect(() => { api('/admin/dashboard').then(setStats).catch(e => toast.error(e.message)); const i = setInterval(() => api('/admin/dashboard').then(setStats).catch(() => {}), 8000); return () => clearInterval(i) }, [])
  useEffect(() => { api('/admin/bonus-eligible').then(d => setBonusEligible(d.eligible || [])).catch(() => {}) }, [])
  const cards = [
    { label: 'Total Jogadores', v: stats?.totalUsers, I: Users, color: 'from-purple-500 to-blue-500' },
    { label: 'Salas em Jogo', v: stats?.inProgress, I: Activity, color: 'from-blue-500 to-cyan-500' },
    { label: 'Salas Finalizadas', v: stats?.finalized, I: CheckCircle2, color: 'from-green-500 to-emerald-500' },
    { label: 'Denúncias Pendentes', v: stats?.pendingReports, I: AlertTriangle, color: 'from-red-500 to-orange-500' },
    { label: 'Saques Pendentes', v: stats?.pendingWithdrawals, I: WalletIcon, color: 'from-yellow-500 to-amber-500' },
    { label: 'MB WAY Pendentes', v: stats?.pendingMbwayTopups, I: Smartphone, color: 'from-blue-400 to-cyan-500' },
    { label: 'Jogadores Banidos', v: stats?.banned, I: Ban, color: 'from-zinc-500 to-zinc-700' },
    { label: 'Resultados em Conflito', v: stats?.conflicts, I: Scale, color: 'from-orange-500 to-amber-600' },
    { label: 'Salas em Disputa', v: stats?.disputes, I: AlertTriangle, color: 'from-rose-500 to-pink-500' },
    { label: 'Receita Plataforma', v: fmt(stats?.revenueCents), I: Coins, color: 'from-amber-500 to-yellow-600' },
  ]
  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="text-3xl font-bold text-white">Dashboard</h1>
        <div className="flex flex-wrap gap-3">
          <Card className={`flex items-center gap-3 px-4 py-3 border ${topupsEnabled ? 'bg-green-500/10 border-green-500/40' : 'bg-red-500/10 border-red-500/40'}`}>
            <div>
              <div className="text-xs text-zinc-400">Carregamentos</div>
              <div className={`text-sm font-bold ${topupsEnabled ? 'text-green-300' : 'text-red-300'}`}>{topupsEnabled ? 'Activos' : 'Desactivados'}</div>
            </div>
            <Button size="sm" disabled={togglingTopups} onClick={toggleTopups} className={topupsEnabled ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'}>
              {togglingTopups ? '...' : topupsEnabled ? 'Desactivar' : 'Activar'}
            </Button>
          </Card>
          <Card className={`flex items-center gap-3 px-4 py-3 border ${stripeEnabled ? 'bg-green-500/10 border-green-500/40' : 'bg-red-500/10 border-red-500/40'}`}>
            <div>
              <div className="text-xs text-zinc-400">Cartão (Stripe)</div>
              <div className={`text-sm font-bold ${stripeEnabled ? 'text-green-300' : 'text-red-300'}`}>{stripeEnabled ? 'Activo' : 'Em Manutencao'}</div>
            </div>
            <Button size="sm" disabled={togglingStripe} onClick={toggleStripe} className={stripeEnabled ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'}>
              {togglingStripe ? '...' : stripeEnabled ? 'Desactivar' : 'Activar'}
            </Button>
          </Card>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c, i) => (
          <Card key={i} className="bg-zinc-900 border-zinc-800 p-5 relative overflow-hidden">
            <div className={`absolute -right-6 -top-6 w-24 h-24 rounded-full bg-gradient-to-br ${c.color} opacity-10 blur-2xl`} />
            <div className="relative">
              <c.I className="w-5 h-5 text-zinc-400 mb-3" />
              <div className="text-xs text-zinc-400 mb-1">{c.label}</div>
              <div className="text-3xl font-black text-white">{c.v ?? 0}</div>
            </div>
          </Card>
        ))}
      </div>

      {/* MB WAY + IBAN settings */}
      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="bg-zinc-900 border-blue-500/30 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Smartphone className="w-5 h-5 text-blue-400" />
            <span className="font-bold text-white text-sm">Configuração MB WAY</span>
          </div>
          <div className="flex gap-3 flex-wrap items-end">
            <div className="flex-1 min-w-[200px]">
              <label className="text-xs text-zinc-400 mb-1 block">Número MB WAY da plataforma</label>
              <input
                type="text"
                value={mbwayPhoneInput}
                onChange={e => setMbwayPhoneInput(e.target.value)}
                placeholder="9XX XXX XXX"
                className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-md px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
            <Button onClick={saveMbwayPhone} disabled={savingPhone} className="bg-blue-600 hover:bg-blue-700 shrink-0">
              {savingPhone ? 'A guardar...' : 'Guardar'}
            </Button>
            {mbwayPhone && (
              <div className="text-xs text-green-300 flex items-center gap-1 w-full">
                <CheckCircle2 className="w-3.5 h-3.5" /> Activo: {mbwayPhone}
              </div>
            )}
          </div>
        </Card>

        <Card className="bg-zinc-900 border-emerald-500/30 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Landmark className="w-5 h-5 text-emerald-400" />
            <span className="font-bold text-white text-sm">Configuração IBAN</span>
          </div>
          <div className="flex gap-3 flex-wrap items-end">
            <div className="flex-1 min-w-[200px]">
              <label className="text-xs text-zinc-400 mb-1 block">IBAN da plataforma</label>
              <input
                type="text"
                value={platformIbanInput}
                onChange={e => setPlatformIbanInput(e.target.value)}
                placeholder="PT50 XXXX XXXX XXXX XXXX XXXX X"
                className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-md px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
              />
            </div>
            <Button onClick={saveIban} disabled={savingIban} className="bg-emerald-600 hover:bg-emerald-700 shrink-0">
              {savingIban ? 'A guardar...' : 'Guardar'}
            </Button>
            {platformIban && (
              <div className="text-xs text-green-300 flex items-center gap-1 w-full">
                <CheckCircle2 className="w-3.5 h-3.5" /> Activo: {platformIban}
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Bonus eligible card */}
      <Card className="mt-4 bg-zinc-900 border-yellow-500/30 p-5">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-xl">🎁</span>
          <span className="font-bold text-white text-sm">Bónus de Boas-Vindas — Primeiros 3 Jogadores</span>
        </div>
        {bonusEligible.length === 0 ? (
          <div className="text-sm text-zinc-500">Ainda nenhuma partida finalizada.</div>
        ) : (
          <div className="space-y-2">
            {bonusEligible.map((e, i) => (
              <div key={e.userId} className="flex items-center justify-between gap-3 bg-zinc-800/60 rounded-lg px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center font-black text-sm ${i === 0 ? 'bg-yellow-500 text-black' : i === 1 ? 'bg-zinc-400 text-black' : 'bg-amber-700 text-white'}`}>{i + 1}º</div>
                  <div>
                    <div className="text-sm font-bold text-white">{e.user?.ffNickname || e.user?.name}</div>
                    <div className="text-xs text-zinc-500">{e.user?.email} · {new Date(e.finishedAt).toLocaleString('pt-PT')}</div>
                  </div>
                </div>
                <Button size="sm" disabled={creditingBonus === e.userId} onClick={async () => {
                  if (!window.confirm(`Creditar 1€ de bónus a ${e.user?.ffNickname}?`)) return
                  setCreditingBonus(e.userId)
                  try {
                    await api('/admin/bonus-credit', { method: 'POST', body: JSON.stringify({ userId: e.userId, amountCents: 100 }) })
                    toast.success(`1€ creditado a ${e.user?.ffNickname}!`)
                  } catch (err) { toast.error(err.message) }
                  finally { setCreditingBonus(null) }
                }} className="bg-yellow-500 hover:bg-yellow-600 text-black font-bold shrink-0">
                  {creditingBonus === e.userId ? '...' : 'Creditar 1€'}
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Profit breakdown card */}
      <Card className="mt-4 bg-zinc-900 border-emerald-500/30 p-5 relative overflow-hidden">
        <div className="absolute -right-10 -top-10 w-48 h-48 rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 opacity-5 blur-3xl" />
        <div className="relative">
          <div className="flex items-center gap-2 mb-5">
            <TrendingUp className="w-5 h-5 text-emerald-400" />
            <span className="font-bold text-white text-sm">Lucro Líquido da Plataforma</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-zinc-800/60 rounded-lg p-4">
              <div className="flex items-center gap-1.5 mb-2">
                <ArrowDownLeft className="w-3.5 h-3.5 text-blue-400" />
                <span className="text-xs text-zinc-400">Carregamentos (total)</span>
              </div>
              <div className="text-2xl font-black text-white">{fmt(stats?.totalTopupsCents)}</div>
              <div className="text-xs text-zinc-500 mt-1">{stats?.topupCount ?? 0} transações</div>
            </div>
            <div className="bg-zinc-800/60 rounded-lg p-4">
              <div className="flex items-center gap-1.5 mb-2">
                <ArrowUpRight className="w-3.5 h-3.5 text-red-400" />
                <span className="text-xs text-zinc-400">Saques pagos aos jogadores</span>
              </div>
              <div className="text-2xl font-black text-red-400">-{fmt(stats?.withdrawalsPaidCents)}</div>
              <div className="text-xs text-zinc-500 mt-1">Total pago</div>
            </div>
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-4">
              <div className="flex items-center gap-1.5 mb-2">
                <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-xs text-emerald-300 font-medium">Lucro Líquido</span>
              </div>
              <div className={`text-2xl font-black ${(stats?.netProfitCents ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {fmt(stats?.netProfitCents)}
              </div>
              <div className="text-xs text-zinc-500 mt-1">Carregamentos − Saques</div>
            </div>
          </div>
        </div>
      </Card>
    </div>
  )
}

// -------- ROOMS --------
function RoomsSection() {
  const [rooms, setRooms] = useState([])
  const [users, setUsers] = useState({})
  const [filter, setFilter] = useState('all')
  const load = useCallback(async () => {
    try {
      const [r, u] = await Promise.all([api('/admin/rooms'), api('/admin/users')])
      setRooms(r.rooms || [])
      setUsers(Object.fromEntries((u.users || []).map(x => [x.id, x])))
    } catch (e) { toast.error(e.message) }
  }, [])
  useEffect(() => { load() }, [load])
  const filtered = filter === 'all' ? rooms : rooms.filter(r => r.status === filter)
  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="text-3xl font-bold text-white">Salas ({rooms.length})</h1>
        <div className="flex gap-1 flex-wrap">
          {['all','ABERTA','EMPARELHADA','EM_ANDAMENTO','FINALIZADA','EM_CONFLITO','EM_DISPUTA','CANCELADA'].map(s => (
            <Button key={s} size="sm" variant={filter === s ? 'default' : 'outline'} onClick={() => setFilter(s)} className={filter === s ? 'bg-purple-600' : 'border-zinc-700 text-zinc-300'}>{s === 'all' ? 'Todas' : s}</Button>
          ))}
        </div>
      </div>
      <div className="space-y-3">
        {filtered.map(r => {
          const creator = users[r.creatorId]
          const opponent = r.opponentId ? users[r.opponentId] : null
          const winner = r.winnerId ? users[r.winnerId] : null
          const loser = r.loserId ? users[r.loserId] : null
          return (
            <Card key={r.id} className="bg-zinc-900 border-zinc-800 p-4">
              <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
                <div className="flex items-center gap-3">
                  <div className="text-xs text-zinc-500 font-mono">#{r.id.slice(0,8).toUpperCase()}</div>
                  <Badge variant="outline" className={STATUS_COLORS[r.status] || ''}>{r.status}</Badge>
                  <div className="text-sm text-zinc-400">{r.mode} · {r.platform} · {r.server || '-'}</div>
                </div>
                <div className="text-2xl font-black text-purple-300">{fmt(r.betAmountCents)}</div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                <div className="bg-zinc-800/60 rounded p-3 flex items-center gap-3">
                  <Avatar className="w-9 h-9"><AvatarImage src={creator?.photoUrl} /><AvatarFallback>{creator?.ffNickname?.[0]}</AvatarFallback></Avatar>
                  <div className="flex-1">
                    <div className="text-zinc-200 font-bold">{creator?.ffNickname || '?'}</div>
                    <div className="text-xs text-zinc-500">UID {creator?.ffUid} · {creator?.email}</div>
                  </div>
                  {r.winnerId === r.creatorId && <Crown className="w-5 h-5 text-yellow-400" title="Vencedor" />}
                  {r.loserId === r.creatorId && <XCircle className="w-5 h-5 text-red-400" title="Perdedor" />}
                </div>
                <div className="bg-zinc-800/60 rounded p-3 flex items-center gap-3">
                  {opponent ? (
                    <>
                      <Avatar className="w-9 h-9"><AvatarImage src={opponent?.photoUrl} /><AvatarFallback>{opponent?.ffNickname?.[0]}</AvatarFallback></Avatar>
                      <div className="flex-1">
                        <div className="text-zinc-200 font-bold">{opponent?.ffNickname}</div>
                        <div className="text-xs text-zinc-500">UID {opponent?.ffUid} · {opponent?.email}</div>
                      </div>
                      {r.winnerId === r.opponentId && <Crown className="w-5 h-5 text-yellow-400" />}
                      {r.loserId === r.opponentId && <XCircle className="w-5 h-5 text-red-400" />}
                    </>
                  ) : <div className="text-zinc-500 italic">Sem adversário</div>}
                </div>
              </div>
              {r.status === 'FINALIZADA' && (
                <div className="mt-3 text-sm flex flex-wrap gap-4 text-zinc-300">
                  <span><Crown className="w-4 h-4 inline mr-1 text-yellow-400" /> <b>Vencedor:</b> {winner?.ffNickname || '-'}</span>
                  <span><XCircle className="w-4 h-4 inline mr-1 text-red-400" /> <b>Perdedor:</b> {loser?.ffNickname || '-'}</span>
                  <span><Coins className="w-4 h-4 inline mr-1 text-green-400" /> <b>Prémio:</b> {fmt(r.prizeCents)}</span>
                  <span><span className="text-zinc-500">Comissão:</span> {fmt(r.commissionCents)}</span>
                </div>
              )}
              <div className="text-xs text-zinc-500 mt-2">Criada {new Date(r.createdAt).toLocaleString('pt-PT')}</div>
            </Card>
          )
        })}
        {!filtered.length && <Card className="bg-zinc-900 border-zinc-800 p-8 text-center text-zinc-500">Sem salas para mostrar.</Card>}
      </div>
    </div>
  )
}

// -------- REPORTS / DENÚNCIAS --------
function ReportsSection() {
  const [reports, setReports] = useState([])
  const [filter, setFilter] = useState('PENDENTE')
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    try { const d = await api('/admin/reports'); setReports(d.reports || []) }
    catch (e) { toast.error(e.message) }
  }, [])
  useEffect(() => { load() }, [load])
  const filtered = filter === 'all' ? reports : reports.filter(r => r.status === filter)

  const act = async (reportId, action) => {
    if (!confirm(action === 'accept' ? 'Aceitar denúncia? O denunciante passará a vencedor.' : 'Rejeitar denúncia?')) return
    setBusy(true)
    try {
      await api('/admin/report/' + reportId, { method: 'POST', body: JSON.stringify({ action }) })
      toast.success(action === 'accept' ? 'Denúncia aceite. Resultado atualizado.' : 'Denúncia rejeitada.')
      load()
    } catch (e) { toast.error(e.message) }
    finally { setBusy(false) }
  }

  const clearHistory = async () => {
    if (!window.confirm('Apagar todas as denúncias já processadas (aceites e rejeitadas)? Esta ação é irreversível.')) return
    setBusy(true)
    try {
      await api('/admin/reports/clear', { method: 'POST', body: '{}' })
      toast.success('Histórico de denúncias processadas apagado')
      load()
    } catch (e) { toast.error(e.message) }
    finally { setBusy(false) }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="text-3xl font-bold text-white">Denúncias ({reports.filter(r => r.status === 'PENDENTE').length} pendentes)</h1>
        <div className="flex gap-2 flex-wrap">
          <div className="flex gap-1">
            {[['PENDENTE','Pendentes'],['ACEITE','Aceites'],['REJEITADA','Rejeitadas'],['all','Todas']].map(([k, l]) => (
              <Button key={k} size="sm" variant={filter === k ? 'default' : 'outline'} onClick={() => setFilter(k)} className={filter === k ? 'bg-purple-600' : 'border-zinc-700 text-zinc-300'}>{l}</Button>
            ))}
          </div>
          <Button size="sm" variant="outline" onClick={clearHistory} disabled={busy} className="border-red-500/40 text-red-300 hover:bg-red-500/10">
            🗑️ Limpar Histórico
          </Button>
        </div>
      </div>
      <div className="space-y-4">
        {filtered.map(r => {
          const accused = r.reporter?.id === r.creator?.id ? r.opponent : r.creator
          return (
            <Card key={r.id} className={`bg-zinc-900 border ${r.status === 'PENDENTE' ? 'border-red-500/40' : 'border-zinc-800'} p-5`}>
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <div className="flex items-center gap-3">
                  <AlertTriangle className={`w-5 h-5 ${r.status === 'PENDENTE' ? 'text-red-400' : 'text-zinc-500'}`} />
                  <div>
                    <div className="text-sm font-bold text-white">Sala #{r.roomId?.slice(0,8).toUpperCase()} — {fmt(r.room?.betAmountCents)}</div>
                    <div className="text-xs text-zinc-500">{new Date(r.createdAt).toLocaleString('pt-PT')}</div>
                  </div>
                </div>
                <Badge className={
                  r.status === 'PENDENTE' ? 'bg-red-500/20 text-red-300' :
                  r.status === 'ACEITE' ? 'bg-green-500/20 text-green-300' :
                  'bg-zinc-700 text-zinc-400'
                }>{r.status}</Badge>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3 text-sm">
                <div className="bg-zinc-800/60 rounded p-3">
                  <div className="text-xs text-zinc-400 mb-1">🚨 Denunciante (alega vitória)</div>
                  <div className="flex items-center gap-2">
                    <Avatar className="w-8 h-8"><AvatarImage src={r.reporter?.photoUrl} /><AvatarFallback>{r.reporter?.ffNickname?.[0]}</AvatarFallback></Avatar>
                    <div>
                      <div className="font-bold text-white">{r.reporter?.ffNickname}</div>
                      <div className="text-xs text-zinc-500">UID {r.reporter?.ffUid}</div>
                    </div>
                  </div>
                </div>
                <div className="bg-zinc-800/60 rounded p-3">
                  <div className="text-xs text-zinc-400 mb-1">⚠️ Acusado</div>
                  <div className="flex items-center gap-2">
                    <Avatar className="w-8 h-8"><AvatarImage src={accused?.photoUrl} /><AvatarFallback>{accused?.ffNickname?.[0]}</AvatarFallback></Avatar>
                    <div>
                      <div className="font-bold text-white">{accused?.ffNickname}</div>
                      <div className="text-xs text-zinc-500">UID {accused?.ffUid}</div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-zinc-800/60 rounded p-3 mb-3 text-sm">
                <div className="text-xs text-zinc-400 mb-1">Motivo</div>
                <div className="text-zinc-200">{r.reason || '(sem motivo descrito)'}</div>
              </div>

              {(r.videoData || (r.screenshots && r.screenshots.length > 0)) && (
                <div className="mb-3">
                  <div className="text-xs text-zinc-400 mb-2">📸 Provas</div>
                  <div className="flex gap-2 flex-wrap">
                    {r.videoData && (
                      <video src={r.videoData} controls className="w-full max-w-sm rounded border border-zinc-700 max-h-48" />
                    )}
                    {(r.screenshots || []).map((s, i) => (
                      <a key={i} href={s} target="_blank" rel="noreferrer" className="block">
                        <img src={s} alt={`Print ${i+1}`} className="w-24 h-24 object-cover rounded border border-zinc-700 hover:border-purple-500" onError={(e) => { e.target.style.display='none' }} />
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {r.status === 'PENDENTE' && (
                <div className="flex gap-2 flex-wrap pt-2 border-t border-zinc-800">
                  <Button onClick={() => act(r.id, 'accept')} disabled={busy} className="bg-green-600 hover:bg-green-700">
                    <CheckCircle2 className="w-4 h-4 mr-2" /> Aceitar (denunciante vence)
                  </Button>
                  <Button onClick={() => act(r.id, 'reject')} disabled={busy} variant="destructive">
                    <XCircle className="w-4 h-4 mr-2" /> Rejeitar
                  </Button>
                </div>
              )}
            </Card>
          )
        })}
        {!filtered.length && <Card className="bg-zinc-900 border-zinc-800 p-8 text-center text-zinc-500">Sem denúncias.</Card>}
      </div>
    </div>
  )
}

// -------- DISPUTES / CONFLITOS --------
function DisputesSection() {
  const [disputes, setDisputes] = useState([])
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    try { const d = await api('/admin/disputes'); setDisputes(d.disputes || []) }
    catch (e) { toast.error(e.message) }
  }, [])
  useEffect(() => { load(); const i = setInterval(load, 8000); return () => clearInterval(i) }, [load])

  const resolve = async (roomId, action, winnerId, label) => {
    if (!confirm(action === 'cancel' ? 'Cancelar a partida e reembolsar ambos os jogadores?' : `Declarar "${label}" vencedor e distribuir o prémio?`)) return
    setBusy(true)
    try {
      await api('/admin/dispute/' + roomId, { method: 'POST', body: JSON.stringify({ action, winnerId }) })
      toast.success('Disputa resolvida.')
      load()
    } catch (e) { toast.error(e.message) }
    finally { setBusy(false) }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="text-3xl font-bold text-white">Disputas ({disputes.length})</h1>
      </div>
      <div className="space-y-4">
        {disputes.map(d => {
          const cA = d.claims?.[d.creatorId]
          const cB = d.claims?.[d.opponentId]
          const potentialPrize = (d.betAmountCents || 0) * 2 * 0.9
          return (
            <Card key={d.id} className="bg-zinc-900 border border-orange-500/40 p-5">
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <div className="flex items-center gap-3">
                  <Scale className="w-5 h-5 text-orange-400" />
                  <div>
                    <div className="text-sm font-bold text-white">Sala #{d.id.slice(0,8).toUpperCase()} — {fmt(d.betAmountCents)} (prémio {fmt(potentialPrize)})</div>
                    <div className="text-xs text-zinc-500">{new Date(d.createdAt).toLocaleString('pt-PT')}{d.previousStatus === 'EM_CONFLITO' && ' · Resultados em conflito'}</div>
                  </div>
                </div>
                <Badge className="bg-orange-500/20 text-orange-300">{d.status}</Badge>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3 text-sm">
                <div className="bg-zinc-800/60 rounded p-3">
                  <div className="flex items-center gap-2">
                    <Avatar className="w-8 h-8"><AvatarImage src={d.creator?.photoUrl} /><AvatarFallback>{d.creator?.ffNickname?.[0]}</AvatarFallback></Avatar>
                    <div>
                      <div className="font-bold text-white">{d.creator?.ffNickname} <span className="text-xs text-zinc-500">(Criador)</span></div>
                      <div className="text-xs text-zinc-500">UID {d.creator?.ffUid}</div>
                    </div>
                  </div>
                  <div className="text-xs text-zinc-400 mt-2">Resultado declarado: <b className={cA === 'win' ? 'text-green-400' : cA === 'loss' ? 'text-red-400' : 'text-zinc-500'}>{cA === 'win' ? 'Ganhei' : cA === 'loss' ? 'Perdi' : '—'}</b></div>
                </div>
                <div className="bg-zinc-800/60 rounded p-3">
                  <div className="flex items-center gap-2">
                    <Avatar className="w-8 h-8"><AvatarImage src={d.opponent?.photoUrl} /><AvatarFallback>{d.opponent?.ffNickname?.[0]}</AvatarFallback></Avatar>
                    <div>
                      <div className="font-bold text-white">{d.opponent?.ffNickname} <span className="text-xs text-zinc-500">(Adversário)</span></div>
                      <div className="text-xs text-zinc-500">UID {d.opponent?.ffUid}</div>
                    </div>
                  </div>
                  <div className="text-xs text-zinc-400 mt-2">Resultado declarado: <b className={cB === 'win' ? 'text-green-400' : cB === 'loss' ? 'text-red-400' : 'text-zinc-500'}>{cB === 'win' ? 'Ganhei' : cB === 'loss' ? 'Perdi' : '—'}</b></div>
                </div>
              </div>

              {d.reports?.map(r => (
                <div key={r.id} className="bg-zinc-800/60 rounded p-3 mb-2 text-sm">
                  <div className="text-xs text-zinc-400 mb-1">Análise enviada por {r.reporterId === d.creatorId ? d.creator?.ffNickname : d.opponent?.ffNickname}</div>
                  <div className="text-zinc-200 mb-2">{r.reason || '(sem descrição)'}</div>
                  {(r.videoUrl || (r.screenshots && r.screenshots.length > 0)) && (
                    <div className="flex gap-2 flex-wrap">
                      {r.videoUrl && (
                        <a href={r.videoUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 rounded px-3 py-2 text-sm text-blue-300">
                          <Video className="w-4 h-4" /> Ver vídeo
                        </a>
                      )}
                      {(r.screenshots || []).map((s, i) => (
                        <a key={i} href={s} target="_blank" rel="noreferrer" className="block">
                          <img src={s} alt={`Print ${i+1}`} className="w-24 h-24 object-cover rounded border border-zinc-700 hover:border-purple-500" onError={(e) => { e.target.style.display='none' }} />
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {!d.reports?.length && (
                <div className="bg-zinc-800/60 rounded p-3 mb-2 text-sm text-zinc-500 italic">Sem análise enviada ainda.</div>
              )}

              <div className="bg-zinc-800/60 rounded p-3 mb-2 text-sm">
                <div className="text-xs text-zinc-400 mb-2 flex items-center gap-1"><MessageSquare className="w-3 h-3" /> Chat da partida ({d.messages?.length || 0})</div>
                {d.messages?.length ? (
                  <div className="max-h-48 overflow-y-auto space-y-1.5">
                    {d.messages.map(m => (
                      <div key={m.id} className="text-xs text-zinc-300">
                        <b className="text-zinc-100">{m.userId === d.creatorId ? d.creator?.ffNickname : d.opponent?.ffNickname}:</b>{' '}
                        {m.message}
                        <span className="text-zinc-500 ml-2">{new Date(m.createdAt).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' })}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-zinc-500 italic">Sem mensagens.</div>
                )}
              </div>

              <div className="flex gap-2 flex-wrap pt-2 border-t border-zinc-800">
                <Button onClick={() => resolve(d.id, 'approve_winner', d.creatorId, d.creator?.ffNickname)} disabled={busy} className="bg-green-600 hover:bg-green-700">
                  <Crown className="w-4 h-4 mr-2" /> Vencedor: {d.creator?.ffNickname}
                </Button>
                <Button onClick={() => resolve(d.id, 'approve_winner', d.opponentId, d.opponent?.ffNickname)} disabled={busy} className="bg-green-600 hover:bg-green-700">
                  <Crown className="w-4 h-4 mr-2" /> Vencedor: {d.opponent?.ffNickname}
                </Button>
                <Button onClick={() => resolve(d.id, 'cancel')} disabled={busy} variant="destructive">
                  <XCircle className="w-4 h-4 mr-2" /> Cancelar e Reembolsar
                </Button>
              </div>
            </Card>
          )
        })}
        {!disputes.length && <Card className="bg-zinc-900 border-zinc-800 p-8 text-center text-zinc-500">Sem disputas pendentes.</Card>}
      </div>
    </div>
  )
}

// -------- PLAYERS --------
function PlayersSection() {
  const [users, setUsers] = useState([])
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [banTarget, setBanTarget] = useState(null)
  const [banReason, setBanReason] = useState('')
  const load = useCallback(async () => {
    try { const d = await api('/admin/users'); setUsers(d.users || []) }
    catch (e) { toast.error(e.message) }
  }, [])
  useEffect(() => { load() }, [load])

  const filtered = users.filter(u => {
    const q = search.toLowerCase()
    return !q || u.ffNickname?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q) || u.ffUid?.toLowerCase().includes(q)
  })

  const openBanDialog = (userId) => { setBanReason(''); setBanTarget(userId) }
  const confirmBan = async () => {
    if (!banReason.trim()) { toast.error('Indica o motivo do bloqueio'); return }
    setBusy(true)
    try {
      await api('/admin/ban', { method: 'POST', body: JSON.stringify({ userId: banTarget, reason: banReason.trim() }) })
      toast.success('Jogador bloqueado')
      setBanTarget(null)
      load()
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }
  const unban = async (userId) => {
    setBusy(true)
    try { await api('/admin/unban', { method: 'POST', body: JSON.stringify({ userId }) }); toast.success('Jogador desbloqueado'); load() }
    catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="text-3xl font-bold text-white">Jogadores ({users.length})</h1>
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Pesquisar por nick, email ou UID..." className="bg-zinc-800 border-zinc-700 text-white max-w-sm" />
      </div>
      <div className="space-y-2">
        {filtered.map(u => (
          <Card key={u.id} className="bg-zinc-900 border-zinc-800 p-4 flex items-center gap-4 flex-wrap">
            <Avatar className="w-12 h-12 ring-2 ring-zinc-700"><AvatarImage src={u.photoUrl} /><AvatarFallback>{u.ffNickname?.[0]}</AvatarFallback></Avatar>
            <div className="flex-1 min-w-[180px]">
              <div className="flex items-center gap-2">
                <div className="font-bold text-white">{u.ffNickname}</div>
                {u.banned && <Badge variant="destructive">BLOQUEADO</Badge>}
              </div>
              <div className="text-xs text-zinc-500">{u.email} · UID {u.ffUid}</div>
              {u.banReason && <div className="text-xs text-red-400 mt-1">Motivo: {u.banReason}</div>}
            </div>
            <div className="grid grid-cols-3 gap-3 text-center text-xs">
              <div>
                <div className="text-zinc-500">Saldo</div>
                <div className="text-green-300 font-bold text-base">{fmt(u.balanceCents)}</div>
              </div>
              <div>
                <div className="text-zinc-500">V/D</div>
                <div className="text-white font-bold text-base">{u.wins || 0}/{u.losses || 0}</div>
              </div>
              <div>
                <div className="text-zinc-500">Ganhos</div>
                <div className="text-purple-300 font-bold text-base">{fmt(u.totalEarningsCents)}</div>
              </div>
            </div>
            {u.banned ? (
              <Button onClick={() => unban(u.id)} disabled={busy} className="bg-green-600 hover:bg-green-700">
                <ShieldCheck className="w-4 h-4 mr-2" /> Desbloquear
              </Button>
            ) : (
              <Button onClick={() => openBanDialog(u.id)} disabled={busy} variant="destructive">
                <Ban className="w-4 h-4 mr-2" /> Bloquear
              </Button>
            )}
          </Card>
        ))}
        {!filtered.length && <Card className="bg-zinc-900 border-zinc-800 p-8 text-center text-zinc-500">Sem jogadores.</Card>}
      </div>

      <Dialog open={!!banTarget} onOpenChange={(open) => !open && setBanTarget(null)}>
        <DialogContent className="bg-zinc-900 border-zinc-800 text-white">
          <DialogHeader>
            <DialogTitle>Bloquear jogador</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="banReason">Motivo do bloqueio</Label>
            <Input id="banReason" value={banReason} onChange={e => setBanReason(e.target.value)}
              placeholder="hack, fraude, manipulação, abuso..." className="bg-zinc-800 border-zinc-700 text-white" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBanTarget(null)} className="border-zinc-700">Cancelar</Button>
            <Button onClick={confirmBan} disabled={busy} variant="destructive">
              <Ban className="w-4 h-4 mr-2" /> Bloquear
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// -------- WITHDRAWALS / LEVANTAMENTOS --------
function WithdrawalsSection() {
  const [list, setList] = useState([])
  const [filter, setFilter] = useState('PENDENTE')
  const [busy, setBusy] = useState(false)
  const [rejectTarget, setRejectTarget] = useState(null)
  const [rejectReason, setRejectReason] = useState('')

  const load = useCallback(async () => {
    try {
      const q = filter === 'all' ? '' : `?status=${filter}`
      const d = await api('/admin/withdrawals' + q)
      setList(d.withdrawals || [])
    } catch (e) { toast.error(e.message) }
  }, [filter])
  useEffect(() => { load(); const i = setInterval(load, 8000); return () => clearInterval(i) }, [load])

  const setProcessing = async (id) => {
    setBusy(true)
    try { await api(`/admin/withdrawal/${id}/processing`, { method: 'POST', body: '{}' }); toast.success('Marcado como em processamento'); load() }
    catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }

  const markPaid = async (id) => {
    if (!confirm('Confirma que já efetuaste o pagamento manualmente? Isto marca o pedido como Pago.')) return
    setBusy(true)
    try { await api(`/admin/withdrawal/${id}/paid`, { method: 'POST', body: '{}' }); toast.success('Marcado como pago'); load() }
    catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }

  const openReject = (id) => { setRejectReason(''); setRejectTarget(id) }
  const confirmReject = async () => {
    if (!rejectReason.trim()) { toast.error('Indica o motivo da rejeição'); return }
    setBusy(true)
    try {
      await api(`/admin/withdrawal/${rejectTarget}/reject`, { method: 'POST', body: JSON.stringify({ reason: rejectReason.trim() }) })
      toast.success('Pedido rejeitado e saldo devolvido')
      setRejectTarget(null)
      load()
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="text-3xl font-bold text-white">Pedidos de Levantamento ({list.length})</h1>
        <div className="flex gap-1 flex-wrap">
          {[['PENDENTE','Pendentes'],['EM_PROCESSAMENTO','Em Processamento'],['PAGO','Pagos'],['REJEITADO','Rejeitados'],['all','Todos']].map(([k, l]) => (
            <Button key={k} size="sm" variant={filter === k ? 'default' : 'outline'} onClick={() => setFilter(k)} className={filter === k ? 'bg-purple-600' : 'border-zinc-700 text-zinc-300'}>{l}</Button>
          ))}
        </div>
      </div>
      <div className="space-y-3">
        {list.map(w => {
          const methodLabel = w.withdrawalType === 'MBWAY'
            ? `MB WAY: ${w.mbway || '-'}`
            : `${WITHDRAWAL_TYPE_LABELS[w.withdrawalType] || w.withdrawalType || '-'} · IBAN: ${w.iban || '-'}`
          return (
            <Card key={w.id} className="bg-zinc-900 border-zinc-800 p-4">
              <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
                <div>
                  <div className="text-white font-bold">{w.user?.ffNickname || w.user?.name || w.fullName}</div>
                  <div className="text-xs text-zinc-500">{w.user?.email}</div>
                </div>
                <div className="text-2xl font-black text-purple-300">{fmt(w.amountCents)}</div>
                <Badge variant="outline" className={WITHDRAWAL_STATUS_COLORS[w.status] || ''}>{w.status}</Badge>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm mb-3">
                <div className="bg-zinc-800/60 rounded p-3">
                  <div className="text-xs text-zinc-400 mb-1">Data do pedido</div>
                  <div className="text-zinc-200">{new Date(w.createdAt).toLocaleString('pt-PT')}</div>
                </div>
                <div className="bg-zinc-800/60 rounded p-3">
                  <div className="text-xs text-zinc-400 mb-1">Método de levantamento</div>
                  <div className="text-zinc-200">{methodLabel}</div>
                  <div className="text-xs text-zinc-500">Titular: {w.fullName}</div>
                  {w.bank && <div className="text-xs text-zinc-500">Banco: {w.bank}</div>}
                  {w.notes && <div className="text-xs text-zinc-500">Obs: {w.notes}</div>}
                </div>
              </div>
              {w.status === 'PAGO' && w.paidAt && (
                <div className="text-xs text-green-300 mb-2">Pago em {new Date(w.paidAt).toLocaleString('pt-PT')} por {w.processedByName}</div>
              )}
              {w.status === 'REJEITADO' && (
                <div className="text-xs text-red-300 mb-2">Rejeitado por {w.processedByName}: {w.rejectionReason}</div>
              )}
              {['PENDENTE','EM_PROCESSAMENTO'].includes(w.status) && (
                <div className="flex gap-2 flex-wrap pt-2 border-t border-zinc-800">
                  {w.status === 'PENDENTE' && (
                    <Button onClick={() => setProcessing(w.id)} disabled={busy} variant="outline" className="border-blue-500/40 text-blue-300">
                      <Activity className="w-4 h-4 mr-2" /> Marcar Em Processamento
                    </Button>
                  )}
                  <Button onClick={() => markPaid(w.id)} disabled={busy} className="bg-green-600 hover:bg-green-700">
                    <CheckCircle2 className="w-4 h-4 mr-2" /> Pagar
                  </Button>
                  <Button onClick={() => openReject(w.id)} disabled={busy} variant="destructive">
                    <XCircle className="w-4 h-4 mr-2" /> Rejeitar
                  </Button>
                </div>
              )}
            </Card>
          )
        })}
        {!list.length && <Card className="bg-zinc-900 border-zinc-800 p-8 text-center text-zinc-500">Sem pedidos para mostrar.</Card>}
      </div>

      <Dialog open={!!rejectTarget} onOpenChange={(open) => !open && setRejectTarget(null)}>
        <DialogContent className="bg-zinc-900 border-zinc-800 text-white">
          <DialogHeader>
            <DialogTitle>Rejeitar pedido de levantamento</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="rejectReason">Motivo da rejeição</Label>
            <Input id="rejectReason" value={rejectReason} onChange={e => setRejectReason(e.target.value)}
              placeholder="Dados bancários inválidos, conta inexistente, ..." className="bg-zinc-800 border-zinc-700 text-white" />
          </div>
          <p className="text-xs text-zinc-500">O valor solicitado regressa automaticamente ao saldo do jogador.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)} className="border-zinc-700">Cancelar</Button>
            <Button onClick={confirmReject} disabled={busy} variant="destructive">
              <XCircle className="w-4 h-4 mr-2" /> Rejeitar e devolver saldo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// -------- AUDIT LOG / AUDITORIA --------
function AuditSection() {
  const [log, setLog] = useState([])
  const load = useCallback(async () => {
    try { const d = await api('/admin/audit-log'); setLog(d.log || []) }
    catch (e) { toast.error(e.message) }
  }, [])
  useEffect(() => { load(); const i = setInterval(load, 15000); return () => clearInterval(i) }, [load])

  return (
    <div>
      <h1 className="text-3xl font-bold text-white mb-6">Registo de Auditoria</h1>
      <div className="space-y-2">
        {log.map(l => (
          <Card key={l.id} className="bg-zinc-900 border-zinc-800 p-3">
            <div className="flex items-center justify-between flex-wrap gap-2 text-sm">
              <div className="text-zinc-200">
                <b className="text-white">{l.adminName}</b> · {l.action} · {l.targetType}
                {l.targetId && <span className="text-zinc-500 font-mono"> #{l.targetId.slice(0,8)}</span>}
              </div>
              <div className="text-xs text-zinc-500">{new Date(l.createdAt).toLocaleString('pt-PT')}</div>
            </div>
            {l.details && <div className="text-xs text-zinc-500 mt-1">{l.details}</div>}
          </Card>
        ))}
        {!log.length && <Card className="bg-zinc-900 border-zinc-800 p-8 text-center text-zinc-500">Sem registos de auditoria.</Card>}
      </div>
    </div>
  )
}

// -------- MB WAY TOP-UPS --------
function MbwayTopupsSection() {
  const [list, setList] = useState([])
  const [filter, setFilter] = useState('PENDENTE')
  const [busy, setBusy] = useState(false)
  const [rejectTarget, setRejectTarget] = useState(null)
  const [rejectReason, setRejectReason] = useState('')
  const [proofOpen, setProofOpen] = useState(null)

  const load = useCallback(async () => {
    try {
      const q = filter === 'all' ? '' : `?status=${filter}`
      const d = await api('/admin/mbway-topups' + q)
      setList(d.topups || [])
    } catch (e) { toast.error(e.message) }
  }, [filter])
  useEffect(() => { load(); const i = setInterval(load, 8000); return () => clearInterval(i) }, [load])

  const confirm = async (id) => {
    if (!window.confirm('Confirmar que recebeste este pagamento e creditar o saldo do jogador?')) return
    setBusy(true)
    try { await api(`/admin/mbway-topup/${id}/confirm`, { method: 'POST', body: '{}' }); toast.success('Carregamento confirmado e saldo creditado'); load() }
    catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }

  const openReject = (id) => { setRejectReason(''); setRejectTarget(id) }
  const submitReject = async () => {
    setBusy(true)
    try {
      await api(`/admin/mbway-topup/${rejectTarget}/reject`, { method: 'POST', body: JSON.stringify({ reason: rejectReason.trim() }) })
      toast.success('Pedido rejeitado')
      setRejectTarget(null)
      load()
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }

  const clearMbwayHistory = async () => {
    if (!window.confirm('Apagar todos os comprovativos MB WAY já processados (confirmados e rejeitados)? Esta ação é irreversível.')) return
    setBusy(true)
    try {
      await api('/admin/mbway-topups/clear', { method: 'POST', body: '{}' })
      toast.success('Histórico de comprovativos MB WAY apagado')
      load()
    } catch (e) { toast.error(e.message) }
    finally { setBusy(false) }
  }

  const MBWAY_STATUS_COLORS = {
    PENDENTE: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/40',
    CONFIRMADO: 'bg-green-500/15 text-green-300 border-green-500/40',
    REJEITADO: 'bg-red-500/15 text-red-300 border-red-500/40',
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="text-3xl font-bold text-white">Carregamentos MB WAY ({list.length})</h1>
        <div className="flex gap-2 flex-wrap">
          <div className="flex gap-1 flex-wrap">
            {[['PENDENTE','Pendentes'],['CONFIRMADO','Confirmados'],['REJEITADO','Rejeitados'],['all','Todos']].map(([k, l]) => (
              <Button key={k} size="sm" variant={filter === k ? 'default' : 'outline'} onClick={() => setFilter(k)} className={filter === k ? 'bg-purple-600' : 'border-zinc-700 text-zinc-300'}>{l}</Button>
            ))}
          </div>
          <Button size="sm" variant="outline" onClick={clearMbwayHistory} disabled={busy} className="border-red-500/40 text-red-300 hover:bg-red-500/10">
            🗑️ Limpar Histórico
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        {list.map(t => (
          <Card key={t.id} className={`bg-zinc-900 p-4 border ${t.status === 'PENDENTE' ? 'border-yellow-500/40' : 'border-zinc-800'}`}>
            <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
              <div>
                <div className="text-white font-bold">{t.user?.ffNickname || t.user?.name}</div>
                <div className="text-xs text-zinc-500">{t.user?.email}</div>
              </div>
              <div className="text-2xl font-black text-blue-300">{fmt(t.amountCents)}</div>
              <Badge variant="outline" className={MBWAY_STATUS_COLORS[t.status] || ''}>{t.status}</Badge>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm mb-3">
              <div className="bg-zinc-800/60 rounded p-3">
                <div className="text-xs text-zinc-400 mb-1">Data do pedido</div>
                <div className="text-zinc-200">{new Date(t.createdAt).toLocaleString('pt-PT')}</div>
              </div>
              <div className="bg-zinc-800/60 rounded p-3">
                <div className="text-xs text-zinc-400 mb-1">Comprovativo</div>
                {t.proofImage ? (
                  <button onClick={() => setProofOpen(t.proofImage)} className="block">
                    <img src={t.proofImage} alt="Comprovativo" className="w-24 h-24 object-cover rounded border border-zinc-700 hover:border-blue-500 cursor-pointer" />
                  </button>
                ) : <div className="text-zinc-500 text-xs">Sem imagem</div>}
              </div>
            </div>

            {t.status === 'CONFIRMADO' && t.confirmedAt && (
              <div className="text-xs text-green-300 mb-2">Confirmado em {new Date(t.confirmedAt).toLocaleString('pt-PT')} por {t.confirmedByName}</div>
            )}
            {t.status === 'REJEITADO' && (
              <div className="text-xs text-red-300 mb-2">Rejeitado por {t.confirmedByName}{t.rejectionReason ? `: ${t.rejectionReason}` : ''}</div>
            )}

            {t.status === 'PENDENTE' && (
              <div className="flex gap-2 flex-wrap pt-2 border-t border-zinc-800">
                <Button onClick={() => confirm(t.id)} disabled={busy} className="bg-green-600 hover:bg-green-700">
                  <CheckCircle2 className="w-4 h-4 mr-2" /> Confirmar e Creditar
                </Button>
                <Button onClick={() => openReject(t.id)} disabled={busy} variant="destructive">
                  <XCircle className="w-4 h-4 mr-2" /> Rejeitar
                </Button>
              </div>
            )}
          </Card>
        ))}
        {!list.length && <Card className="bg-zinc-900 border-zinc-800 p-8 text-center text-zinc-500">Sem pedidos para mostrar.</Card>}
      </div>

      {/* Proof image lightbox */}
      {proofOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={() => setProofOpen(null)}>
          <img src={proofOpen} alt="Comprovativo" className="max-w-full max-h-full rounded-lg shadow-2xl" />
        </div>
      )}

      <Dialog open={!!rejectTarget} onOpenChange={(open) => !open && setRejectTarget(null)}>
        <DialogContent className="bg-zinc-900 border-zinc-800 text-white">
          <DialogHeader><DialogTitle>Rejeitar carregamento MB WAY</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label>Motivo da rejeição (opcional)</Label>
            <Input value={rejectReason} onChange={e => setRejectReason(e.target.value)}
              placeholder="Comprovativo inválido, valor incorreto..." className="bg-zinc-800 border-zinc-700 text-white" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)} className="border-zinc-700">Cancelar</Button>
            <Button onClick={submitReject} disabled={busy} variant="destructive">
              <XCircle className="w-4 h-4 mr-2" /> Rejeitar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// -------- SUPPORT --------
function SupportSection() {
  const [chats, setChats] = useState([])
  const [active, setActive] = useState(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const bottomRef = useRef(null)

  const load = useCallback(async () => {
    try { const d = await api('/admin/support'); setChats(d.chats || []) } catch (e) {}
  }, [])

  useEffect(() => { load(); const i = setInterval(load, 4000); return () => clearInterval(i) }, [load])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [active, chats])

  const activeChat = chats.find(c => c.user?.id === active)
  const totalUnread = chats.reduce((s, c) => s + (c.unread || 0), 0)

  const send = async () => {
    if (!text.trim() || !active) return
    setBusy(true)
    try {
      await api(`/admin/support/${active}`, { method: 'POST', body: JSON.stringify({ message: text.trim() }) })
      setText('')
      load()
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }

  const clearChat = async (userId) => {
    if (!window.confirm('Apagar esta conversa?')) return
    try {
      await api('/admin/support/clear', { method: 'POST', body: JSON.stringify({ userId }) })
      if (active === userId) setActive(null)
      load()
    } catch (e) { toast.error(e.message) }
  }

  return (
    <div className="h-[calc(100vh-8rem)] flex gap-4">
      {/* Conversation list */}
      <div className="w-72 shrink-0 bg-zinc-900 rounded-xl border border-zinc-800 flex flex-col">
        <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
          <h2 className="font-bold text-white flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-purple-400" /> Suporte
            {totalUnread > 0 && <span className="bg-red-500 text-white text-xs px-1.5 py-0.5 rounded-full">{totalUnread}</span>}
          </h2>
        </div>
        <div className="flex-1 overflow-y-auto">
          {chats.length === 0 && <div className="p-4 text-sm text-zinc-500 text-center">Sem conversas ainda</div>}
          {chats.map(c => (
            <button key={c.user?.id} onClick={() => setActive(c.user?.id)}
              className={`w-full p-3 text-left border-b border-zinc-800/60 hover:bg-zinc-800/60 transition ${active === c.user?.id ? 'bg-purple-600/20 border-l-2 border-l-purple-500' : ''}`}>
              <div className="flex items-center justify-between">
                <div className="font-medium text-sm text-white truncate">{c.user?.ffNickname || c.user?.name}</div>
                {c.unread > 0 && <span className="bg-red-500 text-white text-[10px] px-1.5 rounded-full shrink-0">{c.unread}</span>}
              </div>
              <div className="text-xs text-zinc-500 truncate mt-0.5">
                {c.messages[c.messages.length - 1]?.message || ''}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Chat area */}
      <div className="flex-1 bg-zinc-900 rounded-xl border border-zinc-800 flex flex-col">
        {!activeChat ? (
          <div className="flex-1 flex items-center justify-center text-zinc-500">
            <div className="text-center"><MessageSquare className="w-10 h-10 mx-auto mb-2 opacity-30" /><p>Seleciona uma conversa</p></div>
          </div>
        ) : (
          <>
            <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
              <div>
                <div className="font-bold text-white">{activeChat.user?.ffNickname || activeChat.user?.name}</div>
                <div className="text-xs text-zinc-500">{activeChat.user?.email}</div>
              </div>
              <Button size="sm" variant="outline" onClick={() => clearChat(active)} className="border-red-500/40 text-red-300 hover:bg-red-500/10 text-xs">
                🗑️ Limpar
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {activeChat.messages.map(m => (
                <div key={m.id} className={`flex ${m.sender === 'admin' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[75%] rounded-xl px-3 py-2 text-sm ${m.sender === 'admin' ? 'bg-purple-600/40 text-white' : 'bg-zinc-800 text-zinc-100'}`}>
                    {m.message}
                    <div className="text-[10px] text-zinc-400 mt-0.5 text-right">{new Date(m.createdAt).toLocaleString('pt-PT')}</div>
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
            <div className="p-3 border-t border-zinc-800 flex gap-2">
              <input
                value={text}
                onChange={e => setText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                placeholder="Responder..."
                className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500"
              />
              <Button onClick={send} disabled={busy || !text.trim()} className="bg-purple-600 hover:bg-purple-700">
                <Send className="w-4 h-4" />
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// -------- LAYOUT --------
function AdminLayout({ admin, onLogout }) {
  const [section, setSection] = useState('dashboard')
  const nav = [
    ['dashboard', 'Dashboard', LayoutDashboard],
    ['rooms', 'Salas', Gamepad2],
    ['disputes', 'Disputas', Scale],
    ['reports', 'Denúncias', AlertTriangle],
    ['withdrawals', 'Levantamentos', Landmark],
    ['mbway-topups', 'MB WAY', Smartphone],
    ['players', 'Jogadores', Users],
    ['audit', 'Auditoria', ClipboardList],
    ['support', 'Suporte', MessageSquare],
  ]
  return (
    <div className="min-h-screen bg-zinc-950 text-white flex">
      {/* Sidebar */}
      <aside className="w-64 bg-zinc-900 border-r border-zinc-800 flex flex-col shrink-0 hidden md:flex">
        <div className="p-6 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <Shield className="w-6 h-6 text-purple-400" />
            <span className="font-black text-lg">ADMIN</span>
          </div>
          <div className="text-xs text-zinc-500 mt-1">FF Arena</div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {nav.map(([k, l, I]) => (
            <button key={k} onClick={() => setSection(k)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition ${section === k ? 'bg-purple-600 text-white' : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'}`}>
              <I className="w-4 h-4" />{l}
            </button>
          ))}
        </nav>
        <div className="p-3 border-t border-zinc-800">
          <div className="px-3 py-2 mb-2">
            <div className="text-xs text-zinc-500">Sessão</div>
            <div className="text-sm font-bold truncate">{admin.name}</div>
            <div className="text-xs text-zinc-500 truncate">{admin.email}</div>
          </div>
          <Button onClick={onLogout} variant="outline" className="w-full border-zinc-700 text-zinc-300 hover:bg-zinc-800">
            <LogOut className="w-4 h-4 mr-2" /> Terminar sessão
          </Button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-10 bg-zinc-900 border-b border-zinc-800 p-3 flex items-center gap-2 overflow-x-auto">
        <Shield className="w-5 h-5 text-purple-400 shrink-0" />
        {nav.map(([k, l, I]) => (
          <button key={k} onClick={() => setSection(k)} className={`shrink-0 px-3 py-1.5 rounded text-xs ${section === k ? 'bg-purple-600' : 'bg-zinc-800 text-zinc-400'}`}>
            <I className="w-3.5 h-3.5 inline mr-1" />{l}
          </button>
        ))}
        <Button size="sm" onClick={onLogout} variant="ghost"><LogOut className="w-4 h-4" /></Button>
      </div>

      {/* Main */}
      <main className="flex-1 p-4 md:p-8 mt-14 md:mt-0 overflow-x-auto">
        {section === 'dashboard' && <DashboardSection />}
        {section === 'rooms' && <RoomsSection />}
        {section === 'disputes' && <DisputesSection />}
        {section === 'reports' && <ReportsSection />}
        {section === 'withdrawals' && <WithdrawalsSection />}
        {section === 'mbway-topups' && <MbwayTopupsSection />}
        {section === 'players' && <PlayersSection />}
        {section === 'audit' && <AuditSection />}
        {section === 'support' && <SupportSection />}
      </main>
    </div>
  )
}

// -------- ROOT --------
export default function AdminPage() {
  const [admin, setAdmin] = useState(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    const t = typeof window !== 'undefined' ? localStorage.getItem('ff_admin_token') : null
    if (!t) { setLoading(false); return }
    fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + t } })
      .then(r => r.json()).then(d => {
        if (d.user?.isAdmin) setAdmin(d.user)
        else localStorage.removeItem('ff_admin_token')
      }).catch(() => localStorage.removeItem('ff_admin_token'))
      .finally(() => setLoading(false))
  }, [])

  const logout = () => { localStorage.removeItem('ff_admin_token'); setAdmin(null) }

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-zinc-950 text-zinc-400">A carregar...</div>
  if (!admin) return <AdminLogin onSuccess={setAdmin} />
  return <AdminLayout admin={admin} onLogout={logout} />
}
