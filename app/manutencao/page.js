'use client'

import { useEffect, useState, useCallback } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Wrench, LogOut, Flame, Users, Wallet, TrendingUp, Landmark, Search, Ban, ShieldCheck, ArrowDownLeft, ArrowUpRight, Sparkles } from 'lucide-react'

const fmt = (cents) => `${((cents || 0) / 100).toFixed(2)}€`

function api(path, opts = {}) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('ff_maintenance_token') : null
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

function MaintenanceLogin({ onSuccess }) {
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      const data = await api('/maintenance/login', { method: 'POST', body: JSON.stringify({ password }) })
      localStorage.setItem('ff_maintenance_token', data.token)
      onSuccess()
    } catch (e) { toast.error(e.message) }
    finally { setLoading(false) }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950 px-4 relative overflow-hidden">
      <div className="absolute top-0 left-1/3 w-[500px] h-[500px] bg-purple-600/20 rounded-full blur-[100px]" />
      <Card className="relative w-full max-w-sm p-8 bg-zinc-900 border-purple-500/30 shadow-2xl">
        <div className="flex items-center justify-center gap-2 mb-2">
          <Flame className="w-6 h-6 text-purple-400" />
          <span className="font-extrabold gradient-text text-lg">FF ARENA</span>
        </div>
        <div className="flex items-center justify-center gap-2 mb-6">
          <Wrench className="w-6 h-6 text-purple-400" />
          <span className="font-black text-lg text-white">MANUTENÇÃO</span>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label className="text-zinc-200">Password</Label>
            <Input type="password" value={password} onChange={e => setPassword(e.target.value)} required autoFocus className="bg-zinc-800 border-zinc-700 text-white" />
          </div>
          <Button type="submit" disabled={loading} className="w-full bg-gradient-to-r from-purple-600 to-blue-500 h-11 font-bold">
            {loading ? 'A entrar...' : 'Entrar'}
          </Button>
        </form>
      </Card>
    </div>
  )
}

function Stat({ label, value, I, color, sub }) {
  return (
    <Card className="bg-zinc-900 border-zinc-800 p-4">
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${color} flex items-center justify-center shrink-0`}>
          <I className="w-4 h-4 text-white" />
        </div>
        <span className="text-xs text-zinc-400">{label}</span>
      </div>
      <div className="text-xl sm:text-2xl font-black text-white">{value}</div>
      {sub && <div className="text-xs text-zinc-500 mt-1">{sub}</div>}
    </Card>
  )
}

function RevenueChart({ dailyStats }) {
  const max = Math.max(1, ...dailyStats.map(d => d.revenueCents))
  return (
    <Card className="bg-zinc-900 border-zinc-800 p-5">
      <h3 className="font-bold text-white mb-4">Receita por Dia (últimos 30 dias)</h3>
      <div className="flex items-end gap-[3px] h-32 overflow-x-auto">
        {dailyStats.map(d => (
          <div key={d.date} className="flex-1 min-w-[6px] flex flex-col items-center justify-end h-full group relative">
            <div
              className="w-full bg-gradient-to-t from-purple-600 to-blue-500 rounded-sm min-h-[2px] transition-all"
              style={{ height: `${Math.max(2, (d.revenueCents / max) * 100)}%` }}
              title={`${d.date}: ${fmt(d.revenueCents)} · ${d.bets} salas`}
            />
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-zinc-600 mt-2">
        <span>{dailyStats[0]?.date}</span>
        <span>{dailyStats[dailyStats.length - 1]?.date}</span>
      </div>
    </Card>
  )
}

function InfluencersTable({ influencers }) {
  return (
    <Card className="bg-zinc-900 border-zinc-800 p-5">
      <h3 className="font-bold text-white mb-4">Influencers ({influencers.length})</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[600px]">
          <thead>
            <tr className="text-left text-zinc-500 text-xs border-b border-zinc-800">
              <th className="pb-2 pr-3">Nome</th>
              <th className="pb-2 pr-3">Email</th>
              <th className="pb-2 pr-3">%</th>
              <th className="pb-2 pr-3">Saldo</th>
              <th className="pb-2 pr-3">Ganho Total</th>
              <th className="pb-2 pr-3">Referidos</th>
              <th className="pb-2">Estado</th>
            </tr>
          </thead>
          <tbody>
            {influencers.map(inf => (
              <tr key={inf.id} className="border-b border-zinc-800/60">
                <td className="py-2 pr-3 text-white font-medium">{inf.name}</td>
                <td className="py-2 pr-3 text-zinc-400">{inf.email}</td>
                <td className="py-2 pr-3 text-zinc-300">{inf.commissionPercent}%</td>
                <td className="py-2 pr-3 text-green-400 font-bold">{fmt(inf.balanceCents)}</td>
                <td className="py-2 pr-3 text-zinc-300">{fmt(inf.totalEarnedCents)}</td>
                <td className="py-2 pr-3 text-zinc-300">{inf.referredCount}</td>
                <td className="py-2">
                  {inf.banned
                    ? <Badge variant="outline" className="bg-red-500/15 text-red-300 border-red-500/40"><Ban className="w-3 h-3 mr-1" />Banido</Badge>
                    : <Badge variant="outline" className="bg-green-500/15 text-green-300 border-green-500/40"><ShieldCheck className="w-3 h-3 mr-1" />Ativo</Badge>}
                </td>
              </tr>
            ))}
            {!influencers.length && <tr><td colSpan={7} className="py-4 text-center text-zinc-500">Sem influencers ainda.</td></tr>}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function PlayersSection() {
  const [q, setQ] = useState('')
  const [players, setPlayers] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (query) => {
    setLoading(true)
    try {
      const data = await api('/maintenance/players' + (query ? `?q=${encodeURIComponent(query)}` : ''))
      setPlayers(data.players)
      setTotal(data.total)
    } catch (e) { toast.error(e.message) } finally { setLoading(false) }
  }, [])

  useEffect(() => { load('') }, [load])

  const submit = (e) => { e.preventDefault(); load(q) }

  return (
    <Card className="bg-zinc-900 border-zinc-800 p-5">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <h3 className="font-bold text-white">Jogadores ({total}{total > 200 ? ', mostrando 200' : ''})</h3>
        <form onSubmit={submit} className="flex gap-2">
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Nome, email ou UID..." className="bg-zinc-800 border-zinc-700 text-white h-9 w-56" />
          <Button type="submit" size="sm" className="bg-purple-600 hover:bg-purple-700"><Search className="w-4 h-4" /></Button>
        </form>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[700px]">
          <thead>
            <tr className="text-left text-zinc-500 text-xs border-b border-zinc-800">
              <th className="pb-2 pr-3">Nome</th>
              <th className="pb-2 pr-3">Email</th>
              <th className="pb-2 pr-3">UID</th>
              <th className="pb-2 pr-3">Saldo</th>
              <th className="pb-2 pr-3">V/D</th>
              <th className="pb-2 pr-3">Ganhos</th>
              <th className="pb-2">Estado</th>
            </tr>
          </thead>
          <tbody>
            {players.map(p => (
              <tr key={p.id} className="border-b border-zinc-800/60">
                <td className="py-2 pr-3 text-white font-medium">{p.name}</td>
                <td className="py-2 pr-3 text-zinc-400">{p.email}</td>
                <td className="py-2 pr-3 text-zinc-500">{p.ffUid}</td>
                <td className="py-2 pr-3 text-green-400 font-bold">{fmt(p.balanceCents)}</td>
                <td className="py-2 pr-3 text-zinc-300">{p.wins}/{p.losses}</td>
                <td className="py-2 pr-3 text-zinc-300">{fmt(p.totalEarningsCents)}</td>
                <td className="py-2">
                  {p.banned
                    ? <Badge variant="outline" className="bg-red-500/15 text-red-300 border-red-500/40">Banido</Badge>
                    : <Badge variant="outline" className="bg-zinc-700/30 text-zinc-400 border-zinc-600">Ativo</Badge>}
                </td>
              </tr>
            ))}
            {!loading && !players.length && <tr><td colSpan={7} className="py-4 text-center text-zinc-500">Nenhum jogador encontrado.</td></tr>}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function MaintenanceDashboard({ onLogout }) {
  const [data, setData] = useState(null)

  const load = useCallback(async () => {
    try { setData(await api('/maintenance/overview')) } catch (e) { toast.error(e.message) }
  }, [])

  useEffect(() => { load(); const i = setInterval(load, 30000); return () => clearInterval(i) }, [load])

  if (!data) return <div className="min-h-screen flex items-center justify-center text-zinc-400 bg-zinc-950">A carregar...</div>

  const netProfitCents = data.totalRevenueCents - data.totalInfluencerPayoutCents

  return (
    <div className="min-h-screen bg-zinc-950 p-4 sm:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center gap-2">
          <Flame className="w-5 h-5 text-purple-400" />
          <span className="font-extrabold gradient-text text-base">FF ARENA</span>
          <span className="text-zinc-600">·</span>
          <span className="text-xs text-zinc-500">Manutenção</span>
        </div>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <Wrench className="w-6 h-6 text-purple-400" />
            <div className="font-black text-white text-lg">Visão Geral da Plataforma</div>
          </div>
          <Button variant="outline" onClick={onLogout} className="border-zinc-700 text-zinc-300">
            <LogOut className="w-4 h-4 mr-2" /> Sair
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Jogadores" value={data.totalPlayers} I={Users} color="from-blue-500 to-cyan-500" />
          <Stat label="Saldo Total em Jogo" value={fmt(data.totalPlayerBalanceCents)} I={Wallet} color="from-green-500 to-emerald-500" />
          <Stat label="Influencers" value={data.totalInfluencers} I={Sparkles} color="from-purple-500 to-pink-500" />
          <Stat label="Saldo dos Influencers" value={fmt(data.totalInfluencerBalanceCents)} I={Wallet} color="from-purple-500 to-blue-500" />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Receita Total (comissão)" value={fmt(data.totalRevenueCents)} I={TrendingUp} color="from-green-500 to-emerald-500" sub={`Hoje: ${fmt(data.revenueToday)}`} />
          <Stat label="Receita 30 dias" value={fmt(data.revenueLast30)} I={TrendingUp} color="from-blue-500 to-cyan-500" sub={`7 dias: ${fmt(data.revenueLast7)}`} />
          <Stat label="Pago a Influencers" value={fmt(data.totalInfluencerPayoutCents)} I={ArrowUpRight} color="from-orange-500 to-amber-500" />
          <Stat label="Lucro Líquido (comissão)" value={fmt(netProfitCents)} I={TrendingUp} color="from-green-500 to-blue-500" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Stat label="Total Carregado" value={fmt(data.totalTopupsCents)} I={ArrowDownLeft} color="from-blue-500 to-cyan-500" />
          <Stat label="Total Levantado (pago)" value={fmt(data.withdrawalsPaidCents)} I={ArrowUpRight} color="from-red-500 to-orange-500" />
        </div>

        <RevenueChart dailyStats={data.dailyStats} />
        <InfluencersTable influencers={data.influencers} />
        <PlayersSection />
      </div>
    </div>
  )
}

export default function MaintenancePage() {
  const [authed, setAuthed] = useState(false)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('ff_maintenance_token')
    if (!token) { setChecking(false); return }
    api('/maintenance/me').then(() => setAuthed(true)).catch(() => localStorage.removeItem('ff_maintenance_token')).finally(() => setChecking(false))
  }, [])

  const logout = () => {
    localStorage.removeItem('ff_maintenance_token')
    setAuthed(false)
  }

  if (checking) return <div className="min-h-screen flex items-center justify-center text-zinc-400 bg-zinc-950">A carregar...</div>
  if (!authed) return <MaintenanceLogin onSuccess={() => setAuthed(true)} />
  return <MaintenanceDashboard onLogout={logout} />
}
