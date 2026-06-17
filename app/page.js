'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { loadStripe } from '@stripe/stripe-js'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { Gamepad2, Flame, Trophy, Wallet as WalletIcon, Users, Plus, Crown, Shield, LogOut, Swords, Target, Activity, Sparkles, Zap, AlertTriangle, XCircle, ChevronRight, Coins, Send, Image as ImageIcon, Landmark, CheckCircle2, MessageSquare, Bell, TrendingUp, Banknote, Lock, Star, BadgeCheck, Timer, Copy, Smartphone } from 'lucide-react'

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)

const fmt = (cents) => `${((cents || 0) / 100).toFixed(2)}€`

const STATUS_LABEL = {
  CRIADA: { label: 'A AGUARDAR PAGAMENTO', cls: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40' },
  ABERTA: { label: 'ABERTA', cls: 'bg-green-500/20 text-green-300 border-green-500/40' },
  EMPARELHADA: { label: 'EMPARELHADA', cls: 'bg-blue-500/20 text-blue-300 border-blue-500/40' },
  EM_ANDAMENTO: { label: 'EM ANDAMENTO', cls: 'bg-purple-500/20 text-purple-300 border-purple-500/40 pulse-glow' },
  FINALIZADA: { label: 'FINALIZADA', cls: 'bg-gray-500/20 text-gray-300 border-gray-500/40' },
  EM_CONFLITO: { label: 'RESULTADO EM CONFLITO', cls: 'bg-orange-500/20 text-orange-300 border-orange-500/40 pulse-glow' },
  EM_DISPUTA: { label: 'EM DISPUTA', cls: 'bg-red-500/20 text-red-300 border-red-500/40' },
  CANCELADA: { label: 'CANCELADA', cls: 'bg-gray-700/40 text-gray-400 border-gray-600' },
}

function StatusBadge({ s }) {
  const x = STATUS_LABEL[s] || { label: s, cls: '' }
  return <Badge variant="outline" className={`${x.cls} font-bold border`}>{x.label}</Badge>
}

const DEVICE_TYPE_LABEL = { MOBILE: { label: 'Mobile', cls: 'bg-green-500/20 text-green-300 border-green-500/40' }, EMULADOR: { label: 'Emulador', cls: 'bg-blue-500/20 text-blue-300 border-blue-500/40' }, MOBILADOR: { label: 'Mobilador', cls: 'bg-orange-500/20 text-orange-300 border-orange-500/40' } }
function DeviceBadge({ type }) {
  const d = DEVICE_TYPE_LABEL[type]
  if (!d) return null
  return <Badge variant="outline" className={`${d.cls} border text-[10px] px-1.5 py-0`}>{d.label}</Badge>
}

const WITHDRAWAL_TYPE_LABELS = { IBAN: 'IBAN', MBWAY: 'MB WAY', TRANSFERENCIA: 'Transferência bancária' }
const WITHDRAWAL_STATUS = {
  PENDENTE: { label: 'Pendente', cls: 'bg-yellow-500/20 text-yellow-300' },
  EM_PROCESSAMENTO: { label: 'Em processamento', cls: 'bg-blue-500/20 text-blue-300' },
  PAGO: { label: 'Pago', cls: 'bg-green-500/20 text-green-300' },
  REJEITADO: { label: 'Rejeitado', cls: 'bg-red-500/20 text-red-300' },
}

function useApi() {
  return useCallback(async (path, opts = {}) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('ff_token') : null
    const res = await fetch('/api' + path, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(opts.headers || {}),
      },
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'Erro')
    return data
  }, [])
}

function useNotifications() {
  const api = useApi()
  const [notifications, setNotifications] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const seenNotifIds = useRef(new Set())

  const load = useCallback(async () => {
    try {
      const r = await api('/wallet/notifications')
      const list = r.notifications || []
      for (const n of list) {
        if (!n.isRead && !seenNotifIds.current.has(n.id)) {
          toast.info(n.title, { description: n.message })
        }
        seenNotifIds.current.add(n.id)
      }
      setNotifications(list)
      setUnreadCount(r.unreadCount || 0)
    } catch (e) { /* ignore */ }
  }, [api])

  useEffect(() => {
    load()
    const i = setInterval(load, 8000)
    return () => clearInterval(i)
  }, [load])

  const markRead = async (id) => {
    try {
      await api(`/wallet/notifications/${id}/read`, { method: 'POST', body: '{}' })
      setNotifications(ns => ns.map(n => n.id === id ? { ...n, isRead: true } : n))
      setUnreadCount(c => Math.max(0, c - 1))
    } catch (e) { /* ignore */ }
  }

  const markAllRead = async () => {
    try {
      await api('/wallet/notifications/read-all', { method: 'POST', body: '{}' })
      setNotifications(ns => ns.map(n => ({ ...n, isRead: true })))
      setUnreadCount(0)
    } catch (e) { toast.error(e.message) }
  }

  const clearNotifications = async () => {
    try {
      await api('/wallet/notifications/clear', { method: 'POST', body: '{}' })
      setNotifications([])
      setUnreadCount(0)
      toast.success('Notificações limpas')
    } catch (e) { toast.error(e.message) }
  }

  return { notifications, unreadCount, markRead, markAllRead, clearNotifications }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i)
  return outputArray
}

function NotificationBell() {
  const { notifications, unreadCount, markRead, markAllRead, clearNotifications } = useNotifications()
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="relative shrink-0">
          <Bell className="w-4 h-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-purple-500 text-white text-[10px] font-bold flex items-center justify-center">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(320px,calc(100vw-1rem))] p-0">
        <div className="flex items-center justify-between p-3 border-b border-border/40">
          <h4 className="font-bold text-sm flex items-center gap-2"><Bell className="w-4 h-4" />Notificações</h4>
          <div className="flex gap-1">
            {unreadCount > 0 && <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={markAllRead}>Marcar lidas</Button>}
            {notifications.length > 0 && <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={clearNotifications}>Limpar</Button>}
          </div>
        </div>
        <div className="max-h-96 overflow-y-auto">
          {notifications.map(n => (
            <div key={n.id} className={`p-3 border-b border-border/30 text-sm cursor-pointer ${!n.isRead ? 'bg-purple-500/10' : ''}`}
              onClick={() => !n.isRead && markRead(n.id)}>
              <div className={n.isRead ? 'text-muted-foreground' : 'font-semibold'}>{n.title}</div>
              {n.message && <div className="text-xs text-muted-foreground mt-0.5">{n.message}</div>}
              <div className="text-xs text-muted-foreground/70 mt-1">{new Date(n.createdAt).toLocaleString('pt-PT')}</div>
            </div>
          ))}
          {!notifications.length && <div className="p-4 text-sm text-muted-foreground text-center">Sem notificações</div>}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function NotificationSettings() {
  const api = useApi()
  const [supported, setSupported] = useState(false)
  const [permission, setPermission] = useState('default')
  const [subscribed, setSubscribed] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const ok = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window
    setSupported(ok)
    if (!ok) return
    setPermission(Notification.permission)
    navigator.serviceWorker.register('/sw.js')
      .then(async (reg) => {
        const sub = await reg.pushManager.getSubscription()
        setSubscribed(!!sub)
      })
      .catch(() => {})
  }, [])

  const subscribe = async () => {
    setBusy(true)
    try {
      const perm = await Notification.requestPermission()
      setPermission(perm)
      if (perm !== 'granted') { toast.error('Permissão de notificações negada'); return }
      const { publicKey } = await api('/push/vapid-public-key')
      if (!publicKey) { toast.error('Notificações push não estão configuradas no servidor'); return }
      const reg = await navigator.serviceWorker.register('/sw.js')
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      })
      await api('/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription: sub.toJSON() }) })
      await api('/push/preference', { method: 'POST', body: JSON.stringify({ enabled: true }) })
      setSubscribed(true)
      toast.success('Notificações push ativadas')
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }

  const unsubscribe = async () => {
    setBusy(true)
    try {
      const reg = await navigator.serviceWorker.getRegistration()
      const sub = await reg?.pushManager.getSubscription()
      if (sub) {
        await api('/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) })
        await sub.unsubscribe()
      }
      await api('/push/preference', { method: 'POST', body: JSON.stringify({ enabled: false }) })
      setSubscribed(false)
      toast.success('Notificações push desativadas')
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }

  const sendTest = async () => {
    try {
      await api('/push/test', { method: 'POST', body: '{}' })
      toast.success('Notificação de teste enviada')
    } catch (e) { toast.error(e.message) }
  }

  return (
    <Card className="glow-card p-5 border-purple-500/20">
      <h3 className="font-bold mb-3 flex items-center gap-2"><Bell className="w-4 h-4" />Definições de Notificações</h3>
      {!supported ? (
        <div className="text-sm text-muted-foreground">O teu navegador não suporta notificações push.</div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium">Notificações push do navegador</div>
              <div className="text-xs text-muted-foreground">Recebe alertas mesmo com o site minimizado, noutra aba ou fechado.</div>
            </div>
            <Switch checked={subscribed} disabled={busy} onCheckedChange={(v) => v ? subscribe() : unsubscribe()} />
          </div>
          {permission === 'denied' && (
            <div className="text-xs text-yellow-300">Bloqueaste as notificações nas definições do navegador. Ativa-as lá para receberes alertas aqui.</div>
          )}
          {subscribed && (
            <Button size="sm" variant="outline" onClick={sendTest}>Enviar notificação de teste</Button>
          )}
        </div>
      )}
    </Card>
  )
}

function Landing({ onLogin, onRegister }) {
  const stats = [
    { label: 'Aposta mínima', value: '2€', icon: TrendingUp, color: 'text-green-300' },
    { label: 'Saque p/ conta', value: '24h', icon: Banknote, color: 'text-yellow-300' },
    { label: 'Anti-trapaça', value: '100%', icon: Lock, color: 'text-blue-300' },
    { label: 'Verificação', value: 'Auto', icon: BadgeCheck, color: 'text-purple-300' },
  ]
  const features = [
    {
      icon: Banknote,
      color: 'bg-green-500/15 text-green-300',
      title: 'Saque direto na tua conta',
      desc: 'Os teus ganhos vão direto para o teu IBAN ou MB WAY. Sem complicações, sem demoras.',
    },
    {
      icon: BadgeCheck,
      color: 'bg-blue-500/15 text-blue-300',
      title: 'Verificação automática',
      desc: 'O sistema confirma o resultado de cada partida automaticamente. Ninguém consegue trapacear.',
    },
    {
      icon: Lock,
      color: 'bg-red-500/15 text-red-300',
      title: 'Zero trapaças',
      desc: 'Prova com vídeo, moderação ativa e ban permanente. A plataforma mais séria do Free Fire.',
    },
    {
      icon: WalletIcon,
      color: 'bg-emerald-500/15 text-emerald-300',
      title: 'Carrega via cartão',
      desc: 'Visa e Mastercard — carrega saldo em segundos com o teu cartão de débito ou crédito. Pagamento 100% seguro e encriptado.',
    },
    {
      icon: TrendingUp,
      color: 'bg-yellow-500/15 text-yellow-300',
      title: 'Apostas até 500€',
      desc: 'Escolhe o valor que queres arriscar — de 2€ a 500€ por partida. Tu controlas o risco.',
    },
    {
      icon: Zap,
      color: 'bg-purple-500/15 text-purple-300',
      title: 'Prémio na hora',
      desc: 'Ganhaste? O dinheiro entra na tua carteira em segundos. Sem esperas, sem burocracia.',
    },
    {
      icon: Star,
      color: 'bg-orange-500/15 text-orange-300',
      title: 'Ganha todos os dias',
      desc: 'Joga quando quiseres, quantas partidas quiseres. O teu skill tem valor real — usa-o.',
    },
  ]

  return (
    <div className="min-h-screen relative overflow-hidden">
      <div className="absolute inset-0 bg-grid opacity-40 pointer-events-none" />
      <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-purple-600/25 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] bg-blue-500/20 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[400px] bg-purple-900/20 rounded-full blur-[100px] pointer-events-none" />

      {/* Nav */}
      <nav className="relative z-10 flex items-center justify-between px-4 sm:px-6 md:px-12 py-4 sm:py-5">
        <div className="flex items-center gap-2">
          <Flame className="w-6 h-6 sm:w-7 sm:h-7 text-purple-400" />
          <span className="text-lg sm:text-xl font-extrabold tracking-tight gradient-text">FF ARENA</span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onLogin}>Entrar</Button>
          <Button size="sm" onClick={onRegister} className="bg-gradient-to-r from-purple-600 to-blue-500 hover:opacity-90">Criar Conta</Button>
        </div>
      </nav>

      {/* Hero */}
      <div className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 pt-8 sm:pt-14 pb-8 text-center">
        <Badge className="mb-4 sm:mb-5 bg-green-500/15 text-green-300 border-green-500/40 px-3 sm:px-4 py-1 sm:py-1.5 text-xs sm:text-sm font-bold">
          <Sparkles className="w-3 h-3 sm:w-3.5 sm:h-3.5 mr-1.5" /> Plataforma #1 de Free Fire em Portugal
        </Badge>

        <h1 className="text-4xl sm:text-6xl md:text-7xl font-black tracking-tight leading-[1.05] mb-4 sm:mb-5">
          Faz Dinheiro<br className="sm:hidden" /> Todos os Dias<br />
          <span className="gradient-text">Jogando Free Fire.</span>
        </h1>

        <p className="text-base sm:text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-3 px-2">
          Aposta de <span className="text-green-300 font-bold">2€ a 500€</span> por partida, vence e recebe direto na tua conta bancária.
          Verificação automática — <span className="text-white font-semibold">sem trapaças, sem discussões.</span>
        </p>
        <p className="text-sm text-purple-300 mb-6 font-medium flex flex-wrap justify-center gap-x-4 gap-y-1">
          <span>✓ Carrega com Visa / Mastercard</span>
          <span>✓ Saque direto para IBAN</span>
          <span>✓ Verificação automática</span>
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center mb-5">
          <Button size="lg" onClick={onRegister} className="bg-gradient-to-r from-purple-600 to-blue-500 hover:opacity-90 text-base h-13 px-8 neon-border-purple font-black">
            <Coins className="w-5 h-5 mr-2" /> Começar a Ganhar Agora
          </Button>
          <Button size="lg" variant="outline" onClick={onLogin} className="h-12 px-8 border-purple-500/40 font-semibold">
            Já tenho conta
          </Button>
        </div>

        {/* Payment methods */}
        <div className="flex flex-col items-center gap-2 mb-10 sm:mb-14">
          <p className="text-xs text-muted-foreground">Métodos de carregamento aceites</p>
          <div className="flex items-center gap-2 flex-wrap justify-center">
            <div className="flex items-center gap-1.5 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5">
              <span className="font-black text-sm tracking-widest text-blue-300">VISA</span>
            </div>
            <div className="flex items-center gap-1.5 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5">
              <span className="font-black text-sm text-red-400">M</span><span className="font-black text-sm text-orange-400">C</span>
              <span className="text-xs text-muted-foreground font-semibold ml-0.5">Mastercard</span>
            </div>
            <div className="flex items-center gap-1.5 bg-green-500/10 border border-green-500/30 rounded-lg px-3 py-1.5">
              <Lock className="w-3 h-3 text-green-400" />
              <span className="text-xs text-green-300 font-semibold">Pagamento seguro</span>
            </div>
          </div>
        </div>

        {/* Stats bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-12 sm:mb-16">
          {stats.map((s, i) => (
            <div key={i} className="glow-card rounded-2xl p-4 sm:p-5 text-center">
              <s.icon className={`w-6 h-6 mx-auto mb-2 ${s.color}`} />
              <div className={`text-2xl sm:text-3xl font-black ${s.color}`}>{s.value}</div>
              <div className="text-xs text-muted-foreground mt-0.5 font-medium">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Feature grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
          {features.map((f, i) => (
            <div key={i} className="glow-card rounded-2xl p-5 sm:p-6 text-left hover:border-purple-400/40 transition-colors">
              <div className={`w-11 h-11 rounded-xl ${f.color} bg-opacity-20 flex items-center justify-center mb-3`}>
                <f.icon className="w-5 h-5" />
              </div>
              <h3 className="text-base sm:text-lg font-bold mb-1.5">{f.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>

        {/* Bottom CTA */}
        <div className="mt-12 sm:mt-16 glow-card rounded-3xl p-6 sm:p-10 border-purple-500/30">
          <div className="flex items-center justify-center gap-2 mb-3">
            <Trophy className="w-6 h-6 text-yellow-400" />
            <span className="text-yellow-300 font-bold text-sm uppercase tracking-wider">O teu skill tem valor real</span>
          </div>
          <h2 className="text-2xl sm:text-4xl font-black mb-3">
            Quantas partidas consegues <span className="gradient-text">ganhar hoje?</span>
          </h2>
          <p className="text-muted-foreground text-sm sm:text-base mb-6 max-w-xl mx-auto">
            Cada vitória é dinheiro real. Cria a tua conta grátis, carrega saldo e começa a desafiar jogadores em segundos.
          </p>
          <Button size="lg" onClick={onRegister} className="bg-gradient-to-r from-purple-600 to-blue-500 hover:opacity-90 h-12 px-10 font-black text-base neon-border-purple">
            <Swords className="w-5 h-5 mr-2" /> Criar Conta Grátis
          </Button>
          <div className="flex items-center justify-center flex-wrap gap-3 mt-5 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5 text-green-400" /> Registo gratuito</span>
            <span className="flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5 text-green-400" /> Visa / Mastercard</span>
            <span className="flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5 text-green-400" /> Saque p/ conta bancária</span>
            <span className="flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5 text-green-400" /> Suporte 24/7</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function AuthForm({ mode, onSwitch, onSuccess }) {
  const api = useApi()
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({ email: '', password: '', name: '', ffUid: '', ffNickname: '', deviceType: '' })
  const submit = async (e) => {
    e.preventDefault()
    if (mode === 'register' && !form.deviceType) { toast.error('Seleciona o tipo de dispositivo'); return }
    setLoading(true)
    try {
      const path = mode === 'login' ? '/auth/login' : '/auth/register'
      const data = await api(path, { method: 'POST', body: JSON.stringify(form) })
      localStorage.setItem('ff_token', data.token)
      toast.success(mode === 'login' ? 'Bem-vindo de volta!' : 'Conta criada!')
      onSuccess(data.user)
    } catch (e) { toast.error(e.message) }
    finally { setLoading(false) }
  }
  return (
    <div className="min-h-screen flex items-start sm:items-center justify-center px-4 py-8 relative">
      <div className="absolute inset-0 bg-grid opacity-30" />
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-500/20 rounded-full blur-[100px]" />
      <Card className="relative w-full max-w-md p-5 sm:p-8 glow-card border-purple-500/30">
        <div className="flex items-center gap-2 mb-6">
          <Flame className="w-6 h-6 text-purple-400" />
          <span className="font-extrabold gradient-text text-lg">FF ARENA</span>
        </div>
        <h2 className="text-2xl font-bold mb-1">{mode === 'login' ? 'Entrar' : 'Criar Conta'}</h2>
        <p className="text-sm text-muted-foreground mb-6">{mode === 'login' ? 'Continua a tua jornada competitiva.' : 'Junta-te a milhares de jogadores.'}</p>
        <form onSubmit={submit} className="space-y-4">
          {mode === 'register' && (
            <div><Label>Nome</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required /></div>
          )}
          <div><Label>Email</Label><Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} required /></div>
          <div><Label>Password</Label><Input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} required /></div>
          {mode === 'register' && (
            <>
              <div><Label>UID Free Fire</Label><Input value={form.ffUid} onChange={e => setForm({ ...form, ffUid: e.target.value })} required /></div>
              <div><Label>Nickname Free Fire</Label><Input value={form.ffNickname} onChange={e => setForm({ ...form, ffNickname: e.target.value })} required /></div>
              <div>
                <Label>Tipo de Dispositivo</Label>
                <Select value={form.deviceType} onValueChange={v => setForm({ ...form, deviceType: v })} required>
                  <SelectTrigger><SelectValue placeholder="Seleciona o teu dispositivo" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MOBILE">Mobile</SelectItem>
                    <SelectItem value="EMULADOR">Emulador</SelectItem>
                    <SelectItem value="MOBILADOR">Mobilador</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
          <Button type="submit" disabled={loading} className="w-full bg-gradient-to-r from-purple-600 to-blue-500 hover:opacity-90 h-11 font-bold">
            {loading ? '...' : (mode === 'login' ? 'Entrar' : 'Criar Conta')}
          </Button>
        </form>
        <div className="text-sm text-center text-muted-foreground mt-4">
          {mode === 'login' ? 'Não tens conta?' : 'Já tens conta?'}
          <button onClick={onSwitch} className="ml-2 text-purple-300 hover:text-purple-200 font-semibold">
            {mode === 'login' ? 'Criar conta' : 'Entrar'}
          </button>
        </div>
      </Card>
    </div>
  )
}

function RoomCard({ room, onOpen }) {
  return (
    <Card className="glow-card border-purple-500/20 p-5 hover:border-purple-400/60 transition-all hover:scale-[1.01] cursor-pointer" onClick={onOpen}>
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <Avatar className="w-12 h-12 ring-2 ring-purple-500/40">
            <AvatarImage src={room.creator?.photoUrl} />
            <AvatarFallback>{room.creator?.ffNickname?.[0] || '?'}</AvatarFallback>
          </Avatar>
          <div>
            <div className="font-bold flex items-center gap-1.5">{room.creator?.ffNickname} <DeviceBadge type={room.creator?.deviceType} /></div>
            <div className="text-xs text-purple-300 font-mono">UID FF: {room.creator?.ffUid}</div>
            <div className="text-[10px] text-muted-foreground">{room.creator?.wins || 0}V · {room.creator?.losses || 0}D</div>
          </div>
        </div>
        <StatusBadge s={room.status} />
      </div>
      <div className="flex items-center justify-between mb-3">
        <div className="text-3xl font-black gradient-text">{fmt(room.betAmountCents)}</div>
        <Badge variant="secondary" className="bg-blue-500/15 text-blue-300 border border-blue-500/30">{room.mode}</Badge>
      </div>
      <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <div><span className="text-purple-300">Tipo:</span> {room.roomType || '-'}</div>
        <div><span className="text-purple-300">Plataforma:</span> {room.platform}</div>
        <div><span className="text-purple-300">Servidor:</span> {room.server || '-'}</div>
        <div><span className="text-purple-300">Armas:</span> {room.weapons}</div>
      </div>
      <Button className="w-full mt-4 bg-gradient-to-r from-purple-600 to-blue-500" size="sm"><Gamepad2 className="w-4 h-4 mr-2" /> Jogar</Button>
    </Card>
  )
}

function CreateRoomDialog({ open, onOpenChange, balanceCents, onNeedTopup, onSuccess }) {
  const api = useApi()
  const [loading, setLoading] = useState(false)
  const [commissionPct, setCommissionPct] = useState(15)
  const [form, setForm] = useState({ betEuros: '1', mode: 'X1', roomType: 'Rápida', server: '', weapons: 'Todas', platform: 'Mobile', notes: '' })
  useEffect(() => {
    fetch('/api/platform-status').then(r => r.json()).then(d => { if (d.commissionPercent) setCommissionPct(d.commissionPercent) }).catch(() => {})
  }, [])
  const submit = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('ff_token') },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (res.status === 402 && data.needTopup) {
        toast.error(`Saldo insuficiente. Faltam ${(data.missingCents/100).toFixed(2)}€`)
        onOpenChange(false)
        onNeedTopup?.(data.missingCents)
        return
      }
      if (!res.ok) throw new Error(data.error || 'Erro')
      toast.success('Sala criada e visível na Arena!')
      onOpenChange(false)
      onSuccess?.()
    } catch (e) { toast.error(e.message) }
    finally { setLoading(false) }
  }
  const betNum = parseFloat(form.betEuros) || 0
  const hasBalance = balanceCents >= Math.round(betNum * 100)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-purple-500/30 w-[calc(100vw-2rem)] sm:max-w-lg max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Plus className="w-5 h-5 text-purple-300" /> Criar Sala Rápida</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="text-xs text-muted-foreground bg-purple-500/10 border border-purple-500/30 rounded p-3">
            ⚡ Sala Rápida — depois de emparelhada, combina o horário do jogo com o adversário no chat privado da sala.
          </div>
          <div>
            <Label>💰 Valor da Aposta (€)</Label>
            <Input type="number" min="2" step="0.50" value={form.betEuros} onChange={e => setForm({ ...form, betEuros: e.target.value })} required placeholder="ex: 5" />
          </div>
          <div>
            <Label>🎮 Modo</Label>
            <Input value={form.mode} onChange={e => setForm({ ...form, mode: e.target.value })} required placeholder="ex: X1, Contra Squad, 2v2..." />
          </div>
          <div><Label>🌐 Servidor</Label><Input value={form.server} onChange={e => setForm({ ...form, server: e.target.value })} required placeholder="ex: BR, EU, Ásia..." /></div>
          <div><Label>🔫 Armas Permitidas</Label><Input value={form.weapons} onChange={e => setForm({ ...form, weapons: e.target.value })} required placeholder="ex: AK, M4A1, Granadas" /></div>
          <div>
            <Label>📱 Plataforma</Label>
            <Select value={form.platform} onValueChange={v => setForm({ ...form, platform: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{['Mobile','Emulador','Mobilador','Misto'].map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>📝 Observações (opcional)</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} /></div>

          <div className="glow-card rounded-lg p-4 text-sm space-y-1.5">
            <div className="flex justify-between"><span className="text-muted-foreground">Saldo atual:</span><b className={hasBalance ? 'text-green-300' : 'text-red-300'}>{fmt(balanceCents)}</b></div>
            <div className="flex justify-between"><span className="text-muted-foreground">A tua aposta:</span><b>{betNum.toFixed(2)}€</b></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Aposta adversário:</span><b>{betNum.toFixed(2)}€</b></div>
            <div className="flex justify-between text-purple-300"><span>Pote total:</span><b>{(betNum*2).toFixed(2)}€</b></div>
            <div className="flex justify-between text-zinc-400"><span>Comissão plataforma ({commissionPct}%):</span><span>-{(betNum*2*commissionPct/100).toFixed(2)}€</span></div>
            <div className="flex justify-between text-green-300 text-base font-bold border-t border-green-500/20 pt-1.5 mt-0.5">
              <span>Se ganhares recebes:</span>
              <span>{(betNum*2*(1-commissionPct/100)).toFixed(2)}€</span>
            </div>
          </div>

          {!hasBalance && betNum >= 1 && (
            <div className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded p-3 flex items-center justify-between">
              <span>Saldo insuficiente. Faltam {((Math.round(betNum*100)-balanceCents)/100).toFixed(2)}€</span>
              <Button type="button" size="sm" onClick={() => { onOpenChange(false); onNeedTopup?.(Math.round(betNum*100)-balanceCents) }} className="bg-gradient-to-r from-green-600 to-emerald-500">Carregar Saldo</Button>
            </div>
          )}

          <Button type="submit" disabled={loading || betNum < 1 || !hasBalance} className="w-full bg-gradient-to-r from-purple-600 to-blue-500 h-11 font-bold">
            {loading ? 'A criar...' : `Criar Sala (debita ${betNum.toFixed(2)}€ do saldo)`}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Info({ label, v }) {
  return <div className="glow-card p-3 rounded-lg"><div className="text-xs text-purple-300 uppercase mb-0.5">{label}</div><div className="font-semibold">{v}</div></div>
}
function PlayerCard({ user, label }) {
  return (
    <div className="glow-card rounded-xl p-4 text-center">
      <div className="text-xs text-purple-300 uppercase tracking-wider mb-2">{label}</div>
      <Avatar className="w-16 h-16 mx-auto ring-2 ring-purple-500/50 mb-2">
        <AvatarImage src={user?.photoUrl} />
        <AvatarFallback>{user?.ffNickname?.[0]}</AvatarFallback>
      </Avatar>
      <div className="font-bold">{user?.ffNickname}</div>
      <div className="text-xs text-muted-foreground">UID: {user?.ffUid}</div>
      <div className="mt-1 flex justify-center"><DeviceBadge type={user?.deviceType} /></div>
      <div className="text-xs text-muted-foreground mt-1"><span className="text-green-300">{user?.wins || 0}V</span> / <span className="text-red-300">{user?.losses || 0}D</span></div>
    </div>
  )
}

function ChatPanel({ roomId, me, creator, opponent, status }) {
  const api = useApi()
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [unread, setUnread] = useState(0)
  const scrollRef = useRef(null)
  const prevLenRef = useRef(null)

  const nameFor = (userId) => userId === creator?.id ? (creator?.ffNickname || 'Criador') : userId === opponent?.id ? (opponent?.ffNickname || 'Adversário') : '???'

  const load = useCallback(async () => {
    try {
      const d = await api('/rooms/' + roomId + '/messages')
      const msgs = d.messages || []
      const prevLen = prevLenRef.current
      if (prevLen != null && msgs.length > prevLen) {
        const newOnes = msgs.slice(prevLen)
        const fromOther = newOnes.filter(m => m.userId !== me?.id)
        if (fromOther.length) {
          toast.info(`${nameFor(fromOther[0].userId)}: ${fromOther[0].message}`.slice(0, 80))
          const el = scrollRef.current
          const atBottom = el ? el.scrollHeight - el.scrollTop - el.clientHeight < 80 : true
          if (!atBottom) setUnread(u => u + fromOther.length)
        }
      }
      prevLenRef.current = msgs.length
      setMessages(msgs)
    } catch { /* not a participant or transient error */ }
  }, [api, roomId, me?.id, creator?.id, opponent?.id])

  useEffect(() => { load(); const i = setInterval(load, 3000); return () => clearInterval(i) }, [load])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    if (atBottom) { el.scrollTop = el.scrollHeight; setUnread(0) }
  }, [messages])

  const scrollToBottom = () => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
    setUnread(0)
  }

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 30) setUnread(0)
  }

  const send = async () => {
    const t = text.trim()
    if (!t) return
    setBusy(true)
    try {
      await api('/rooms/' + roomId + '/messages', { method: 'POST', body: JSON.stringify({ message: t }) })
      setText('')
      await load()
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }

  const closed = ['FINALIZADA', 'CANCELADA'].includes(status)

  return (
    <Card className="glow-card p-5 border-purple-500/30">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-purple-400" />
          <h3 className="font-bold text-lg">Chat da Partida</h3>
        </div>
        {unread > 0 && (
          <button onClick={scrollToBottom} className="text-xs bg-purple-500/30 text-purple-200 rounded-full px-3 py-1 font-bold">
            {unread} nova{unread > 1 ? 's' : ''} ↓
          </button>
        )}
      </div>
      <div ref={scrollRef} onScroll={handleScroll} className="h-56 sm:h-64 overflow-y-auto space-y-2 mb-3 pr-1">
        {messages.map(m => {
          const mine = m.userId === me?.id
          return (
            <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${mine ? 'bg-purple-600/30 text-white' : 'bg-zinc-800/70 text-zinc-200'}`}>
                <div className="text-xs font-bold mb-0.5 opacity-70">{nameFor(m.userId)}</div>
                <div className="break-words whitespace-pre-wrap">{m.message}</div>
                <div className="text-[10px] text-muted-foreground mt-1 text-right">{new Date(m.createdAt).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' })}</div>
              </div>
            </div>
          )
        })}
        {!messages.length && <div className="text-center text-sm text-muted-foreground py-10">Sem mensagens ainda. Combina aqui os detalhes da partida.</div>}
      </div>
      {closed ? (
        <div className="text-center text-xs text-muted-foreground border-t border-purple-500/20 pt-3">Chat encerrado — partida finalizada.</div>
      ) : (
        <div className="flex gap-2">
          <Input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} placeholder="Escreve uma mensagem..." maxLength={1000} disabled={busy} />
          <Button onClick={send} disabled={busy || !text.trim()}><Send className="w-4 h-4" /></Button>
        </div>
      )}
    </Card>
  )
}

function RoomDetail({ roomId, me, onBack, refreshMe }) {
  const api = useApi()
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [report, setReport] = useState({ reason: '', videoUrl: '', files: [] })

  const load = useCallback(async () => {
    try { const d = await api('/rooms/' + roomId); setData(d) } catch (e) { toast.error(e.message) }
  }, [api, roomId])

  useEffect(() => { load(); const i = setInterval(load, 4000); return () => clearInterval(i) }, [load])

  if (!data) return <div className="p-8 text-center text-muted-foreground">A carregar...</div>
  const { room, creator, opponent } = data
  const isCreator = me?.id === room.creatorId
  const isOpponent = me?.id === room.opponentId
  const isParticipant = isCreator || isOpponent
  const myClaim = (room.claims || {})[me?.id]

  const joinAndPay = async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/rooms/' + room.id + '/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('ff_token') },
      })
      const j = await res.json()
      if (res.status === 402 && j.needTopup) {
        toast.error(`Saldo insuficiente. Faltam ${(j.missingCents/100).toFixed(2)}€`)
        if (typeof window !== 'undefined') window.location.href = '/?view=wallet&topup=' + j.missingCents
        return
      }
      if (!res.ok) throw new Error(j.error || 'Erro')
      toast.success('Entraste na sala!')
      load(); refreshMe?.()
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }

  const startMatch = async () => {
    setBusy(true)
    try { await api('/rooms/' + room.id + '/start', { method: 'POST' }); toast.success('Partida iniciada!'); load() }
    catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }

  const claim = async (result) => {
    setBusy(true)
    try { await api('/rooms/' + room.id + '/claim', { method: 'POST', body: JSON.stringify({ result }) }); toast.success(result === 'win' ? 'Vitória reclamada' : 'Derrota assumida'); load(); refreshMe?.() }
    catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }

  const submitReport = async () => {
    setBusy(true)
    try {
      const files = await Promise.all((report.files || []).slice(0, 4).map(f => new Promise((resolve, reject) => {
        if (f.size > 2 * 1024 * 1024) return reject(new Error(`Ficheiro ${f.name} excede 2MB`))
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.onerror = () => reject(new Error('Erro a ler ' + f.name))
        reader.readAsDataURL(f)
      })))
      await api('/rooms/' + room.id + '/report', {
        method: 'POST',
        body: JSON.stringify({
          reason: report.reason, videoUrl: report.videoUrl,
          screenshots: files,
        })
      })
      toast.success('Denúncia enviada. O administrador irá analisar.')
      setReportOpen(false); setReport({ reason: '', videoUrl: '', files: [] }); load()
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <Button variant="ghost" onClick={onBack} className="text-sm h-8 px-2">← Voltar</Button>

      <Card className="glow-card p-4 sm:p-6 border-purple-500/30">
        <div className="flex items-start justify-between gap-2 mb-4 sm:mb-6 flex-wrap">
          <h2 className="text-lg sm:text-2xl font-bold">Sala #{room.id.slice(0,8).toUpperCase()}</h2>
          <StatusBadge s={room.status} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4 items-center mb-4 sm:mb-6">
          <PlayerCard user={creator} label="Criador" />
          <div className="text-center order-first md:order-none py-2 md:py-0">
            <div className="text-3xl sm:text-5xl font-black gradient-text">{fmt(room.betAmountCents)}</div>
            <div className="text-xs text-muted-foreground uppercase tracking-wider mt-1">Aposta cada</div>
            <Swords className="w-6 h-6 sm:w-8 sm:h-8 mx-auto mt-2 sm:mt-3 text-purple-400" />
            <div className="text-xs text-green-300 mt-1">Prémio: {fmt(Math.round(room.betAmountCents * 2 * 0.80))}</div>
          </div>
          {opponent ? <PlayerCard user={opponent} label="Adversário" /> :
            <div className="glow-card rounded-xl p-4 text-center border-dashed border-purple-500/30">
              <div className="text-muted-foreground text-sm">A aguardar adversário...</div>
            </div>
          }
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3 text-sm mb-4 sm:mb-6">
          <Info label="Modo" v={room.mode} />
          <Info label="Tipo" v={room.roomType || '-'} />
          <Info label="Plataforma" v={room.platform} />
          <Info label="Servidor" v={room.server || '-'} />
          <Info label="Armas" v={room.weapons} />
        </div>
        {room.notes && <div className="text-sm text-muted-foreground mb-4"><b className="text-purple-300">Observações:</b> {room.notes}</div>}

        <div className="space-y-3">
          {room.status === 'ABERTA' && !isCreator && (
            <Button onClick={joinAndPay} disabled={busy} className="w-full h-12 bg-gradient-to-r from-purple-600 to-blue-500 font-bold">
              <Coins className="w-5 h-5 mr-2" /> Entrar e Pagar {fmt(room.betAmountCents)}
            </Button>
          )}
          {room.status === 'ABERTA' && isCreator && (
            <div className="text-center text-muted-foreground text-sm">A aguardar um adversário entrar...</div>
          )}
          {room.status === 'EMPARELHADA' && isCreator && (
            <Button onClick={startMatch} disabled={busy} className="w-full h-12 bg-gradient-to-r from-purple-600 to-blue-500 font-bold">
              <Zap className="w-5 h-5 mr-2" /> INICIAR PARTIDA
            </Button>
          )}
          {room.status === 'EMPARELHADA' && isOpponent && (
            <div className="text-center text-muted-foreground text-sm">A aguardar o criador iniciar a partida...</div>
          )}
          {room.status === 'EM_ANDAMENTO' && isParticipant && !myClaim && (
            <div className="grid grid-cols-2 gap-3">
              <Button onClick={() => claim('win')} disabled={busy} className="h-12 bg-green-600 hover:bg-green-700 font-bold">
                <Trophy className="w-5 h-5 mr-2" /> Eu Ganhei
              </Button>
              <Button onClick={() => claim('loss')} disabled={busy} variant="destructive" className="h-12 font-bold">
                <XCircle className="w-5 h-5 mr-2" /> Eu Perdi
              </Button>
            </div>
          )}
          {room.status === 'EM_ANDAMENTO' && isParticipant && myClaim && (
            <div className="text-center glow-card p-4 rounded-lg">
              A analisar a resposta do outro jogador...
            </div>
          )}
          {room.status === 'FINALIZADA' && (
            <div className="glow-card p-5 rounded-xl text-center">
              {room.winnerId === me?.id && (
                <div className="winner-text text-3xl md:text-4xl font-black mb-3">🏆 VENCESTE! 🏆</div>
              )}
              <Crown className="w-10 h-10 mx-auto text-yellow-400 mb-2" />
              <div className="text-lg font-bold">Vencedor</div>
              <div className="text-2xl gradient-text font-black">
                {room.winnerId === creator?.id ? creator?.ffNickname : opponent?.ffNickname}
              </div>
              <div className="text-green-300 mt-2">Prémio: {fmt(room.prizeCents)}</div>
              {isParticipant && room.winnerId !== me?.id && (
                <div className="mt-4 pt-4 border-t border-red-500/30">
                  <p className="text-sm text-muted-foreground mb-3">Achas que houve trapaça? Tens 24h para denunciar com provas.</p>
                  <Button onClick={() => setReportOpen(true)} variant="outline" className="border-red-500/50 text-red-300 hover:bg-red-500/10">
                    <AlertTriangle className="w-4 h-4 mr-2" /> Denunciar Trapaça
                  </Button>
                </div>
              )}
            </div>
          )}
          {room.status === 'EM_CONFLITO' && (
            <div className="glow-card p-5 rounded-xl text-center border border-orange-500/40">
              <AlertTriangle className="w-8 h-8 mx-auto text-orange-300 mb-2" />
              <div className="font-bold text-orange-300">Resultado em Conflito</div>
              <div className="text-sm text-muted-foreground mt-1">Os dois jogadores enviaram resultados contraditórios. O prémio fica bloqueado até decisão do administrador.</div>
              {isParticipant && (
                <Button onClick={() => setReportOpen(true)} className="mt-4 bg-orange-600 hover:bg-orange-700 font-bold">
                  <Send className="w-4 h-4 mr-2" /> Enviar para Análise
                </Button>
              )}
            </div>
          )}
          {room.status === 'EM_DISPUTA' && (
            <div className="glow-card p-5 rounded-xl text-center border border-red-500/40">
              <AlertTriangle className="w-8 h-8 mx-auto text-red-300 mb-2" />
              <div className="font-bold text-red-300">EM DISPUTA</div>
              <div className="text-sm text-muted-foreground mt-1">A aguardar decisão da moderação.</div>
            </div>
          )}
        </div>
      </Card>

      {isParticipant && (
        <ChatPanel roomId={room.id} me={me} creator={creator} opponent={opponent} status={room.status} />
      )}

      <Dialog open={reportOpen} onOpenChange={setReportOpen}>
        <DialogContent className="bg-card border-purple-500/30 max-h-[90dvh] overflow-y-auto w-[calc(100vw-2rem)] sm:max-w-lg">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-red-400" />{room.status === 'EM_CONFLITO' ? 'Enviar para Análise' : 'Denunciar Trapaça'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground bg-yellow-500/10 border border-yellow-500/30 p-3 rounded">
              ⚠️ Denúncias falsas podem resultar em banimento. Anexa provas claras.
            </div>
            <div>
              <Label>Descrição *</Label>
              <Textarea value={report.reason} onChange={e => setReport({ ...report, reason: e.target.value })} rows={3} placeholder={room.status === 'EM_CONFLITO' ? 'Descreve o que aconteceu na partida e porque o resultado está em conflito...' : 'Descreve o que aconteceu: hack, fraude, kill steal, comportamento abusivo...'} required />
            </div>
            <div>
              <Label>📎 Imagens (máx 2MB cada, até 4 ficheiros)</Label>
              <Input type="file" accept="image/*" multiple onChange={e => setReport({ ...report, files: Array.from(e.target.files || []).slice(0, 4) })} className="cursor-pointer" />
              {report.files?.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {report.files.map((f, i) => (
                    <div key={i} className="text-xs bg-purple-500/15 border border-purple-500/30 rounded px-2 py-1 flex items-center gap-1">
                      <ImageIcon className="w-3 h-3" /> {f.name} ({(f.size/1024).toFixed(0)}KB)
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <Label>🎥 URL do vídeo (opcional - YouTube, Streamable...)</Label>
              <Input value={report.videoUrl} onChange={e => setReport({ ...report, videoUrl: e.target.value })} placeholder="https://..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReportOpen(false)}>Cancelar</Button>
            <Button onClick={submitReport} disabled={busy || !report.reason} className="bg-red-600 hover:bg-red-700"><Send className="w-4 h-4 mr-2" />{busy ? 'A enviar...' : 'Enviar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function compressImage(file) {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const img = new Image()
      img.onload = () => {
        const MAX = 1280
        let { width, height } = img
        if (width > MAX || height > MAX) {
          if (width > height) { height = Math.round(height * MAX / width); width = MAX }
          else { width = Math.round(width * MAX / height); height = MAX }
        }
        const canvas = document.createElement('canvas')
        canvas.width = width; canvas.height = height
        canvas.getContext('2d').drawImage(img, 0, 0, width, height)
        resolve(canvas.toDataURL('image/jpeg', 0.75))
      }
      img.src = e.target.result
    }
    reader.readAsDataURL(file)
  })
}

function WalletView({ refreshMe, stripeEnabled }) {
  const api = useApi()
  const sp = useSearchParams()
  const [data, setData] = useState(null)
  const [method, setMethod] = useState(null)
  const { notifications, unreadCount, markAllRead, clearNotifications } = useNotifications()
  const [open, setOpen] = useState(false)
  const [methodOpen, setMethodOpen] = useState(false)
  const [topupOpen, setTopupOpen] = useState(false)
  const [topupAmount, setTopupAmount] = useState('10')
  const [topupMethod, setTopupMethod] = useState('mbway')
  const [mbwayPhone, setMbwayPhone] = useState(null)
  const [mbwayProof, setMbwayProof] = useState(null)
  const [mbwayTopups, setMbwayTopups] = useState([])
  const [form, setForm] = useState({ amountEuros: '10' })
  const [methodForm, setMethodForm] = useState({ fullName: '', type: 'IBAN', iban: '', mbway: '', bank: '', notes: '' })
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => { try { setData(await api('/wallet')) } catch (e) { toast.error(e.message) } }, [api])
  const loadMethod = useCallback(async () => {
    try {
      const r = await api('/wallet/withdrawal-method')
      if (r.method) {
        setMethod(r.method)
        setMethodForm({
          fullName: r.method.fullName || '', type: r.method.type || 'IBAN',
          iban: r.method.iban || '', mbway: r.method.mbway || '',
          bank: r.method.bank || '', notes: r.method.notes || '',
        })
      }
    } catch (e) { /* ignore */ }
  }, [api])
  const loadMbwayTopups = useCallback(async () => {
    try { const r = await api('/wallet/mbway-topups'); setMbwayTopups(r.topups || []) } catch (e) { /* ignore */ }
  }, [api])
  useEffect(() => {
    load(); loadMethod(); loadMbwayTopups()
    const i = setInterval(load, 4000)
    return () => clearInterval(i)
  }, [load, loadMethod, loadMbwayTopups])
  useEffect(() => {
    fetch('/api/platform-status').then(r => r.json()).then(d => setMbwayPhone(d.mbwayPhone || null)).catch(() => {})
  }, [])

  // Auto-open topup if redirected with ?topup=cents
  useEffect(() => {
    const t = sp.get('topup')
    if (t) { setTopupAmount(String(Math.ceil(parseInt(t)/100))); setTopupOpen(true) }
  }, [sp])

  const saveMethod = async () => {
    if (!methodForm.fullName.trim()) return toast.error('Indica o nome completo')
    if (!['IBAN', 'MBWAY', 'TRANSFERENCIA'].includes(methodForm.type)) return toast.error('Escolhe o tipo de levantamento')
    if ((methodForm.type === 'IBAN' || methodForm.type === 'TRANSFERENCIA') && !methodForm.iban.trim()) return toast.error('Indica o IBAN')
    if (methodForm.type === 'MBWAY' && !methodForm.mbway.trim()) return toast.error('Indica o número MB WAY')
    setBusy(true)
    try {
      const r = await api('/wallet/withdrawal-method', { method: 'POST', body: JSON.stringify(methodForm) })
      setMethod(r.method)
      toast.success('Método de levantamento guardado')
      setMethodOpen(false)
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }

  const openWithdraw = () => {
    if (!method) {
      toast.info('Configura primeiro o teu método de levantamento')
      setMethodOpen(true)
      return
    }
    setOpen(true)
  }

  const startTopup = async () => {
    setBusy(true)
    try {
      const r = await api('/wallet/topup', { method: 'POST', body: JSON.stringify({ amountEuros: topupAmount }) })
      const stripe = await stripePromise
      await stripe.redirectToCheckout({ sessionId: r.id })
    } catch (e) { toast.error(e.message); setBusy(false) }
  }

  const handleProofFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const isImage = file.type.startsWith('image/')
    const isPdf = file.type === 'application/pdf'
    if (!isImage && !isPdf) { toast.error('Formato não suportado. Usa imagem ou PDF'); return }
    setBusy(true)
    try {
      if (isImage) {
        setMbwayProof(await compressImage(file))
      } else {
        const reader = new FileReader()
        reader.onload = (ev) => setMbwayProof(ev.target.result)
        reader.readAsDataURL(file)
      }
    } catch (e) { toast.error('Erro ao processar ficheiro') }
    finally { setBusy(false) }
  }

  const submitMbwayTopup = async () => {
    if (!mbwayProof) { toast.error('Seleciona o comprovativo de pagamento'); return }
    const cents = Math.round(parseFloat(topupAmount) * 100)
    if (!cents || cents < 100) { toast.error('Valor mínimo: 1€'); return }
    setBusy(true)
    try {
      await api('/wallet/topup/mbway', { method: 'POST', body: JSON.stringify({ amountEuros: topupAmount, proofImage: mbwayProof }) })
      toast.success('Comprovativo enviado! O teu saldo será creditado após confirmação.')
      setTopupOpen(false)
      setMbwayProof(null)
      loadMbwayTopups()
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }

  const request = async () => {
    const cents = Math.round(parseFloat(form.amountEuros || '0') * 100)
    if (!cents || cents < 1000) return toast.error('Valor mínimo de levantamento: 10€')
    if (cents > (data?.balanceCents || 0)) return toast.error('Saldo insuficiente')
    setBusy(true)
    try {
      await api('/wallet/withdraw', { method: 'POST', body: JSON.stringify({ amountEuros: form.amountEuros }) })
      toast.success('Pedido de levantamento enviado! Vai ser processado manualmente pela equipa FF Arena.')
      setOpen(false); load(); refreshMe?.()
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="glow-card p-6 border-green-500/30">
          <div className="text-sm text-muted-foreground">Saldo Disponível</div>
          <div className="text-3xl font-black text-green-300 mt-1">{fmt(data?.balanceCents)}</div>
        </Card>
        <Card className="glow-card p-6 border-yellow-500/30">
          <div className="text-sm text-muted-foreground">Saldo Pendente (saque)</div>
          <div className="text-3xl font-black text-yellow-300 mt-1">{fmt(data?.pendingCents)}</div>
        </Card>
        <Card className="glow-card p-6 border-purple-500/30">
          <div className="text-sm text-muted-foreground">Ganhos Totais</div>
          <div className="text-3xl font-black gradient-text mt-1">{fmt(data?.totalEarningsCents)}</div>
        </Card>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Button onClick={() => setTopupOpen(true)} className="bg-gradient-to-r from-green-600 to-emerald-500 h-11">
          <Plus className="w-4 h-4 mr-1.5 shrink-0" /> <span className="truncate">Carregar</span>
        </Button>
        <Button onClick={openWithdraw} variant="outline" className="border-purple-500/40 h-11">
          <WalletIcon className="w-4 h-4 mr-1.5 shrink-0" /> <span className="truncate">Sacar</span>
        </Button>
        <Button onClick={() => setMethodOpen(true)} variant="outline" className="border-blue-500/40 text-blue-300 h-11">
          <Landmark className="w-4 h-4 mr-1.5 shrink-0" /> <span className="truncate">{method ? 'Método' : 'Configurar'}</span>
        </Button>
      </div>

      {method ? (
        <div className="flex items-center gap-2 text-sm text-green-300 bg-green-500/10 border border-green-500/30 rounded-lg px-4 py-2">
          <CheckCircle2 className="w-4 h-4" /> Método de levantamento configurado: {WITHDRAWAL_TYPE_LABELS[method.type] || method.type}
          {method.type === 'MBWAY' ? ` · ${method.mbway}` : method.iban ? ` · ${method.iban}` : ''}
        </div>
      ) : (
        <div className="flex items-center gap-2 text-sm text-yellow-300 bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-4 py-2">
          <AlertTriangle className="w-4 h-4" /> Configura o teu método de levantamento (IBAN, MB WAY ou transferência bancária) para poderes sacar o teu saldo.
        </div>
      )}

      <Card className="glow-card p-5 border-purple-500/20">
        <div className="flex items-start justify-between gap-2 mb-3 flex-wrap">
          <h3 className="font-bold flex items-center gap-2">
            <Bell className="w-4 h-4" />Notificações
            {unreadCount > 0 && <Badge className="bg-purple-500/20 text-purple-300">{unreadCount}</Badge>}
          </h3>
          <div className="flex gap-1.5 flex-wrap">
            {unreadCount > 0 && <Button size="sm" variant="outline" onClick={markAllRead} className="h-7 text-xs px-2">Marcar lidas</Button>}
            {notifications.length > 0 && <Button size="sm" variant="outline" onClick={clearNotifications} className="h-7 text-xs px-2">Limpar</Button>}
          </div>
        </div>
        <div className="space-y-2">
          {notifications.map(n => (
            <div key={n.id} className="text-sm border-b border-border/40 pb-2">
              <div className={n.isRead ? 'text-muted-foreground' : 'font-semibold'}>{n.title}</div>
              {n.message && <div className="text-xs text-muted-foreground">{n.message}</div>}
              <div className="text-xs text-muted-foreground">{new Date(n.createdAt).toLocaleString('pt-PT')}</div>
            </div>
          ))}
          {!notifications.length && <div className="text-sm text-muted-foreground">Sem notificações</div>}
        </div>
      </Card>

      <Card className="glow-card p-5 border-purple-500/20">
        <h3 className="font-bold mb-3 flex items-center gap-2"><Activity className="w-4 h-4" />Histórico de Transações</h3>
        <div className="space-y-2">
          {(data?.transactions || []).map(t => (
            <div key={t.id} className="flex items-center justify-between text-sm border-b border-border/40 pb-2">
              <div><div className="font-medium">{t.description}</div><div className="text-xs text-muted-foreground">{new Date(t.createdAt).toLocaleString('pt-PT')}</div></div>
              <div className={t.amountCents > 0 ? 'text-green-300 font-bold' : 'text-red-300 font-bold'}>{t.amountCents > 0 ? '+' : ''}{fmt(t.amountCents)}</div>
            </div>
          ))}
          {!data?.transactions?.length && <div className="text-sm text-muted-foreground">Sem transações</div>}
        </div>
      </Card>

      {mbwayTopups.length > 0 && (
        <Card className="glow-card p-5 border-blue-500/20">
          <h3 className="font-bold mb-3 flex items-center gap-2"><Smartphone className="w-4 h-4 text-blue-400" />Carregamentos MB WAY</h3>
          <div className="space-y-2">
            {mbwayTopups.map(t => {
              const stMap = {
                PENDENTE: { label: 'Pendente', cls: 'bg-yellow-500/20 text-yellow-300' },
                CONFIRMADO: { label: 'Confirmado', cls: 'bg-green-500/20 text-green-300' },
                REJEITADO: { label: 'Rejeitado', cls: 'bg-red-500/20 text-red-300' },
              }
              const st = stMap[t.status] || { label: t.status, cls: 'bg-muted/30 text-muted-foreground' }
              return (
                <div key={t.id} className="flex items-center justify-between text-sm border-b border-border/40 pb-2">
                  <div>
                    <div className="font-medium">{fmt(t.amountCents)} via MB WAY</div>
                    <div className="text-xs text-muted-foreground">{new Date(t.createdAt).toLocaleString('pt-PT')}</div>
                    {t.status === 'REJEITADO' && t.rejectionReason && <div className="text-xs text-red-300">Motivo: {t.rejectionReason}</div>}
                  </div>
                  <Badge className={st.cls}>{st.label}</Badge>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      <Card className="glow-card p-5 border-purple-500/20">
        <h3 className="font-bold mb-3">Pedidos de Levantamento</h3>
        <div className="space-y-2">
          {(data?.withdrawals || []).map(w => {
            const st = WITHDRAWAL_STATUS[w.status] || { label: w.status, cls: 'bg-muted/30 text-muted-foreground' }
            const methodLabel = w.withdrawalType === 'MBWAY'
              ? `MB WAY: ${w.mbway || ''}`
              : w.withdrawalType ? `${WITHDRAWAL_TYPE_LABELS[w.withdrawalType] || w.withdrawalType}: ${w.iban || ''}` : ''
            return (
              <div key={w.id} className="flex items-center justify-between text-sm border-b border-border/40 pb-2">
                <div>
                  <div className="font-medium">{fmt(w.amountCents)}</div>
                  <div className="text-xs text-muted-foreground">{new Date(w.createdAt).toLocaleString('pt-PT')}{methodLabel ? ` · ${methodLabel}` : ''}</div>
                  {w.status === 'PAGO' && w.paidAt && <div className="text-xs text-green-300">Pago em {new Date(w.paidAt).toLocaleString('pt-PT')}</div>}
                  {w.status === 'REJEITADO' && w.rejectionReason && <div className="text-xs text-red-300">Motivo: {w.rejectionReason}</div>}
                </div>
                <Badge className={st.cls}>{st.label}</Badge>
              </div>
            )
          })}
          {!data?.withdrawals?.length && <div className="text-sm text-muted-foreground">Sem pedidos</div>}
        </div>
      </Card>

      <Dialog open={topupOpen} onOpenChange={(o) => { setTopupOpen(o); if (!o) { setMbwayProof(null) } }}>
        <DialogContent className="bg-card border-green-500/30 w-[calc(100vw-2rem)] sm:max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Plus className="w-5 h-5 text-green-300" />Carregar Saldo</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {/* Method toggle */}
            <div className="grid grid-cols-2 gap-2 p-1 bg-zinc-800/60 rounded-lg">
              <button onClick={() => setTopupMethod('stripe')} className={`py-2 rounded-md text-sm font-semibold transition flex items-center justify-center gap-1.5 ${topupMethod === 'stripe' ? 'bg-gradient-to-r from-green-600 to-emerald-500 text-white' : stripeEnabled ? 'text-zinc-400 hover:text-white' : 'text-zinc-500'}`}>
                {!stripeEnabled && <AlertTriangle className="w-3.5 h-3.5 text-yellow-500" />} {stripeEnabled ? 'Cartão (Stripe)' : 'Cartão (Manutencao)'}
              </button>
              <button onClick={() => setTopupMethod('mbway')} className={`py-2 rounded-md text-sm font-semibold transition flex items-center justify-center gap-1.5 ${topupMethod === 'mbway' ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-white'}`}>
                <Smartphone className="w-4 h-4" /> MB WAY
              </button>
            </div>

            {/* Amount selector — shown for all methods except stripe-in-maintenance */}
            {!(topupMethod === 'stripe' && !stripeEnabled) && (
              <>
                <div className="grid grid-cols-3 gap-2">
                  {(topupMethod === 'mbway' ? [1, 2, 5, 10, 20, 50] : [5, 10, 20, 50, 100, 200]).map(v => (
                    <Button key={v} type="button" variant={topupAmount === String(v) ? 'default' : 'outline'} onClick={() => setTopupAmount(String(v))} className={topupAmount === String(v) ? (topupMethod === 'mbway' ? 'bg-blue-600' : 'bg-gradient-to-r from-green-600 to-emerald-500') : ''}>{v}€</Button>
                  ))}
                </div>
                <div>
                  <Label>Valor personalizado (€)</Label>
                  <Input type="number" min={topupMethod === 'mbway' ? '1' : '5'} step="0.50" value={topupAmount} onChange={e => setTopupAmount(e.target.value)} />
                </div>
              </>
            )}

            {topupMethod === 'stripe' ? (
              stripeEnabled ? (
                <Button onClick={startTopup} disabled={busy || !parseFloat(topupAmount)} className="w-full bg-gradient-to-r from-green-600 to-emerald-500 h-11 font-bold">
                  {busy ? 'A redirecionar...' : `Pagar ${parseFloat(topupAmount || 0).toFixed(2)}€`}
                </Button>
              ) : (
                <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 text-center space-y-1">
                  <AlertTriangle className="w-6 h-6 text-yellow-400 mx-auto" />
                  <div className="text-sm font-semibold text-yellow-300">Carregamento por cartao em manutencao</div>
                  <div className="text-xs text-zinc-400">O pagamento via Visa/Mastercard esta temporariamente indisponivel. Por favor usa o MB WAY.</div>
                </div>
              )
            ) : (
              <div className="space-y-3">
                {mbwayPhone ? (
                  <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
                    <div className="text-xs text-zinc-400 mb-1">Envia {parseFloat(topupAmount||0).toFixed(2)}€ para o número MB WAY:</div>
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-2xl font-black text-blue-300 tracking-wider">{mbwayPhone}</div>
                      <button onClick={() => { navigator.clipboard?.writeText(mbwayPhone); toast.success('Número copiado!') }} className="flex items-center gap-1 text-xs text-zinc-400 hover:text-white bg-zinc-800 px-2 py-1 rounded">
                        <Copy className="w-3.5 h-3.5" /> Copiar
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-yellow-300 bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3">
                    Carregamento via MB WAY não disponível de momento.
                  </div>
                )}
                {mbwayPhone && (
                  <>
                    <div>
                      <Label className="text-zinc-300">Comprovativo de pagamento (foto, screenshot ou PDF)</Label>
                      <label className="mt-1.5 flex items-center gap-2 cursor-pointer border border-dashed border-zinc-600 hover:border-blue-500 rounded-lg p-3 transition">
                        <ImageIcon className="w-4 h-4 text-zinc-400" />
                        <span className="text-sm text-zinc-400">{mbwayProof ? 'Imagem selecionada ✓' : 'Selecionar foto do comprovativo'}</span>
                        <input type="file" accept="image/*,application/pdf" className="hidden" onChange={handleProofFile} />
                      </label>
                      {mbwayProof && (
                        mbwayProof.startsWith('data:application/pdf')
                          ? <div className="mt-2 flex items-center gap-2 bg-zinc-800 rounded p-2 text-sm text-zinc-300"><span>📄</span> PDF selecionado</div>
                          : <img src={mbwayProof} alt="Comprovativo" className="mt-2 w-full max-h-48 object-contain rounded border border-zinc-700" />
                      )}
                    </div>
                    <Button onClick={submitMbwayTopup} disabled={busy || !mbwayProof || !parseFloat(topupAmount)} className="w-full bg-blue-600 hover:bg-blue-700 h-11 font-bold">
                      {busy ? 'A enviar...' : `Enviar comprovativo de ${parseFloat(topupAmount||0).toFixed(2)}€`}
                    </Button>
                    <p className="text-xs text-zinc-500 text-center">Após confirmação pela equipa FF Arena o saldo é creditado automaticamente.</p>
                  </>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-card border-purple-500/30 w-[calc(100vw-2rem)] sm:max-w-md">
          <DialogHeader><DialogTitle>Sacar Saldo</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">
              O valor pedido fica reservado do teu saldo com o estado "Pendente" até a equipa FF Arena efetuar o pagamento manualmente para o método configurado.
            </div>
            {method && (
              <div className="text-xs text-muted-foreground bg-muted/20 border border-border/40 rounded-lg px-3 py-2 space-y-0.5">
                <div><b>Titular:</b> {method.fullName}</div>
                <div><b>Método:</b> {WITHDRAWAL_TYPE_LABELS[method.type] || method.type}</div>
                {method.type === 'MBWAY' ? <div><b>MB WAY:</b> {method.mbway}</div> : <div><b>IBAN:</b> {method.iban}</div>}
              </div>
            )}
            <div>
              <Label>Valor (mínimo 10€, disponível: {fmt(data?.balanceCents)})</Label>
              <Input type="number" min="10" step="0.01" value={form.amountEuros} onChange={e => setForm({ ...form, amountEuros: e.target.value })} />
            </div>
          </div>
          <DialogFooter><Button onClick={request} disabled={busy} className="bg-gradient-to-r from-purple-600 to-blue-500">{busy ? 'A processar...' : 'Pedir Levantamento'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={methodOpen} onOpenChange={setMethodOpen}>
        <DialogContent className="bg-card border-blue-500/30 w-[calc(100vw-2rem)] sm:max-w-md max-h-[90dvh] overflow-y-auto">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Landmark className="w-5 h-5 text-blue-300" />Método de Levantamento</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Nome completo</Label>
              <Input value={methodForm.fullName} onChange={e => setMethodForm({ ...methodForm, fullName: e.target.value })} placeholder="Nome como aparece na conta bancária" />
            </div>
            <div>
              <Label>Tipo de levantamento</Label>
              <Select value={methodForm.type} onValueChange={v => setMethodForm({ ...methodForm, type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="IBAN">IBAN</SelectItem>
                  <SelectItem value="MBWAY">MB WAY</SelectItem>
                  <SelectItem value="TRANSFERENCIA">Transferência bancária</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {(methodForm.type === 'IBAN' || methodForm.type === 'TRANSFERENCIA') && (
              <div>
                <Label>IBAN</Label>
                <Input value={methodForm.iban} onChange={e => setMethodForm({ ...methodForm, iban: e.target.value })} placeholder="PT50..." />
              </div>
            )}
            {methodForm.type === 'MBWAY' && (
              <div>
                <Label>Número MB WAY</Label>
                <Input value={methodForm.mbway} onChange={e => setMethodForm({ ...methodForm, mbway: e.target.value })} placeholder="9XXXXXXXX" />
              </div>
            )}
            <div>
              <Label>Banco (opcional)</Label>
              <Input value={methodForm.bank} onChange={e => setMethodForm({ ...methodForm, bank: e.target.value })} />
            </div>
            <div>
              <Label>Observações (opcional)</Label>
              <Textarea value={methodForm.notes} onChange={e => setMethodForm({ ...methodForm, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter><Button onClick={saveMethod} disabled={busy} className="bg-gradient-to-r from-blue-600 to-purple-500">{busy ? 'A guardar...' : 'Guardar'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Ranking() {
  const api = useApi()
  const [type, setType] = useState('wins')
  const [list, setList] = useState([])
  useEffect(() => { api('/ranking?type=' + type).then(d => setList(d.ranking)).catch(() => {}) }, [api, type])
  const tabs = [['wins', 'Top Vitórias', Trophy], ['earnings', 'Top Ganhos', Coins], ['rate', 'Melhor Taxa', Target]]
  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        {tabs.map(([k, l, I]) => (
          <Button key={k} variant={type === k ? 'default' : 'outline'} onClick={() => setType(k)} className={type === k ? 'bg-gradient-to-r from-purple-600 to-blue-500' : ''}>
            <I className="w-4 h-4 mr-2" />{l}
          </Button>
        ))}
      </div>
      <div className="space-y-2">
        {list.map((u, i) => (
          <Card key={u.id} className="glow-card p-3 sm:p-4 flex items-center gap-3 border-purple-500/20">
            <div className={`w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center font-black text-sm sm:text-lg shrink-0 ${i === 0 ? 'bg-yellow-500 text-black' : i === 1 ? 'bg-gray-300 text-black' : i === 2 ? 'bg-orange-500 text-black' : 'bg-secondary'}`}>{i + 1}</div>
            <Avatar className="w-8 h-8 sm:w-10 sm:h-10 shrink-0"><AvatarImage src={u.photoUrl} /><AvatarFallback>{u.ffNickname?.[0]}</AvatarFallback></Avatar>
            <div className="flex-1 min-w-0">
              <div className="font-bold truncate text-sm sm:text-base">{u.ffNickname}</div>
              <div className="text-xs text-muted-foreground truncate">{u.wins}V · {u.losses}D · {u.winRate}%</div>
            </div>
            <div className="text-right shrink-0">
              {type === 'earnings' ? <div className="font-bold text-green-300 text-sm sm:text-base">{fmt(u.totalEarningsCents)}</div> :
                type === 'rate' ? <div className="font-bold gradient-text text-sm sm:text-base">{u.winRate}%</div> :
                  <div className="font-bold text-purple-300 text-sm sm:text-base">{u.wins} V</div>}
            </div>
          </Card>
        ))}
        {!list.length && <div className="text-muted-foreground text-sm">Sem dados ainda.</div>}
      </div>
    </div>
  )
}

function Stat({ label, value, color }) {
  return <div className="glow-card p-4 rounded"><div className="text-xs text-muted-foreground">{label}</div><div className={`text-2xl font-black ${color || ''}`}>{value}</div></div>
}

function Shell({ me, onLogout, view, setView, children }) {
  const [topupsEnabled, setTopupsEnabled] = useState(true)
  useEffect(() => {
    const load = () => fetch('/api/platform-status').then(r => r.json()).then(d => { setTopupsEnabled(d.topupsEnabled) }).catch(() => {})
    load()
    const i = setInterval(load, 30000)
    return () => clearInterval(i)
  }, [])

  const nav = [
    ['rooms', 'Arena', Gamepad2],
    ['mine', 'Salas', Swords],
    ['wallet', 'Carteira', WalletIcon],
    ['ranking', 'Ranking', Trophy],
    ['profile', 'Perfil', Users],
  ]
  return (
    <div className="min-h-screen pb-16 md:pb-0">
      <nav className="sticky top-0 z-30 backdrop-blur-lg bg-background/80 border-b border-purple-500/20">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 flex items-center gap-2 py-3">
          <div className="flex items-center gap-2 shrink-0">
            <Flame className="w-5 h-5 sm:w-6 sm:h-6 text-purple-400" />
            <span className="font-extrabold gradient-text text-sm sm:text-base">FF ARENA</span>
          </div>
          <div className="hidden md:flex items-center gap-1.5 ml-4">
            {nav.map(([k, l, I]) => (
              <Button key={k} variant={view === k ? 'default' : 'ghost'} size="sm" onClick={() => setView(k)}
                className={view === k ? 'bg-gradient-to-r from-purple-600 to-blue-500' : ''}>
                <I className="w-4 h-4 mr-1.5" />{l}
              </Button>
            ))}
          </div>
          <div className="flex-1" />
          <div className="text-right shrink-0">
            <div className="hidden sm:block text-xs text-muted-foreground">Saldo</div>
            <div className="text-sm font-black text-green-300">{fmt(me.balanceCents)}</div>
          </div>
          <NotificationBell />
          <Button variant="ghost" size="sm" onClick={onLogout} className="shrink-0"><LogOut className="w-4 h-4" /></Button>
        </div>
      </nav>
      {!topupsEnabled && (
        <div className="bg-yellow-500/10 border-b border-yellow-500/40 px-4 py-2.5 flex items-center justify-center gap-2 text-sm text-yellow-300">
          <span>⚠️</span>
          <span><b>Plataforma em manutenção</b> — Os carregamentos estão temporariamente desactivados. Os teus jogos e saldo estão seguros.</span>
        </div>
      )}
      <main className="max-w-7xl mx-auto p-3 sm:p-4 md:p-8">{children}</main>
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 backdrop-blur-xl bg-background/95 border-t border-purple-500/20">
        <div className="flex items-center justify-around py-1.5 px-1 safe-area-bottom">
          {nav.map(([k, l, I]) => (
            <button key={k} onClick={() => setView(k)}
              className={`flex flex-col items-center gap-0.5 py-1.5 px-3 rounded-xl transition-all ${view === k ? 'text-purple-300' : 'text-muted-foreground active:text-purple-400'}`}>
              <I className={`w-5 h-5 transition-transform ${view === k ? 'scale-110' : ''}`} />
              <span className="text-[9px] font-semibold leading-none mt-0.5">{l}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  )
}

function Dashboard({ me, onLogout, refreshMe }) {
  const router = useRouter()
  const sp = useSearchParams()
  const [view, setView] = useState(sp.get('view') || 'rooms')
  const [rooms, setRooms] = useState([])
  const [myRooms, setMyRooms] = useState([])
  const [openRoom, setOpenRoom] = useState(sp.get('id') || null)
  const [createOpen, setCreateOpen] = useState(false)
  const [stripeEnabled, setStripeEnabled] = useState(false)
  const api = useApi()

  useEffect(() => {
    const load = () => fetch('/api/platform-status').then(r => r.json()).then(d => setStripeEnabled(d.stripeEnabled)).catch(() => {})
    load()
    const i = setInterval(load, 30000)
    return () => clearInterval(i)
  }, [])

  useEffect(() => {
    const v = sp.get('view'); const id = sp.get('id')
    if (v) setView(v); if (id) setOpenRoom(id)
  }, [sp])

  const load = useCallback(async () => {
    try {
      const [r, mr] = await Promise.all([api('/rooms'), api('/rooms/mine')])
      setRooms(r.rooms)
      // Detect transitions: ABERTA → EMPARELHADA on rooms I created
      setMyRooms(prev => {
        for (const newR of mr.rooms) {
          const old = prev.find(x => x.id === newR.id)
          if (old && newR.creatorId === me?.id && old.status === 'ABERTA' && newR.status === 'EMPARELHADA') {
            toast.success('⚔️ Adversário entrou na tua sala! Pronto para iniciar.', { duration: 6000 })
          }
        }
        return mr.rooms
      })
    } catch (e) {}
  }, [api, me?.id])
  useEffect(() => { load(); const i = setInterval(load, 5000); return () => clearInterval(i) }, [load])

  const setViewClean = (v) => { setView(v); setOpenRoom(null); router.replace('/?view=' + v) }

  if (openRoom) return (
    <Shell me={me} onLogout={onLogout} view={view} setView={setViewClean}>
      <CreateRoomDialog open={createOpen} onOpenChange={setCreateOpen} balanceCents={me.balanceCents} onNeedTopup={() => setViewClean('wallet')} onSuccess={() => { load(); refreshMe?.() }} />
      <RoomDetail roomId={openRoom} me={me} onBack={() => setViewClean('rooms')} refreshMe={refreshMe} />
    </Shell>
  )

  return (
    <Shell me={me} onLogout={onLogout} view={view} setView={setViewClean}>
      <CreateRoomDialog open={createOpen} onOpenChange={setCreateOpen} balanceCents={me.balanceCents} onNeedTopup={() => setViewClean('wallet')} onSuccess={() => { load(); refreshMe?.() }} />
      {view === 'rooms' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h1 className="text-3xl font-black gradient-text">Arena</h1>
              <p className="text-sm text-muted-foreground">Salas abertas — entra numa e prova o teu valor</p>
            </div>
            <Button onClick={() => setCreateOpen(true)} className="bg-gradient-to-r from-purple-600 to-blue-500 h-11"><Plus className="w-4 h-4 mr-2" />Criar Sala</Button>
          </div>
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-purple-300 mb-2">Salas públicas</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {rooms.filter(r => r.creatorId !== me.id).map(r => <RoomCard key={r.id} room={r} onOpen={() => { setOpenRoom(r.id); router.replace('/?view=room&id=' + r.id) }} />)}
              {rooms.filter(r => r.creatorId !== me.id).length === 0 && <Card className="glow-card p-8 text-center col-span-full text-muted-foreground">Sem salas de outros jogadores disponíveis. <Button variant="link" onClick={() => setCreateOpen(true)}>Cria a tua!</Button></Card>}
            </div>
          </div>
        </div>
      )}
      {view === 'mine' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h1 className="text-3xl font-black gradient-text">Minhas Salas</h1>
              <p className="text-sm text-muted-foreground">Todas as salas que criaste ou em que participaste</p>
            </div>
            <Button onClick={() => setCreateOpen(true)} className="bg-gradient-to-r from-purple-600 to-blue-500 h-11"><Plus className="w-4 h-4 mr-2" />Nova Sala</Button>
          </div>
          {myRooms.length === 0 && (
            <Card className="glow-card p-8 text-center text-muted-foreground">Ainda não criaste nem entraste em nenhuma sala. <Button variant="link" onClick={() => setCreateOpen(true)}>Cria a primeira!</Button></Card>
          )}
          {myRooms.filter(r => ['CRIADA','ABERTA','EMPARELHADA','EM_ANDAMENTO','EM_CONFLITO','EM_DISPUTA'].includes(r.status)).length > 0 && (
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-purple-300 mb-2">Ativas</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {myRooms.filter(r => ['CRIADA','ABERTA','EMPARELHADA','EM_ANDAMENTO','EM_CONFLITO','EM_DISPUTA'].includes(r.status)).map(r => {
                  const isCreator = r.creatorId === me.id
                  const canStart = isCreator && r.status === 'EMPARELHADA'
                  const ready = r.status === 'EMPARELHADA'
                  return (
                    <Card key={r.id} className={`glow-card p-4 cursor-pointer hover:scale-[1.01] transition ${canStart ? 'border-blue-500/60 pulse-glow' : 'border-purple-500/30'}`} onClick={() => { setOpenRoom(r.id); router.replace('/?view=room&id=' + r.id) }}>
                      <div className="flex justify-between mb-2"><b className="text-lg gradient-text">{fmt(r.betAmountCents)}</b><StatusBadge s={r.status} /></div>
                      <div className="text-xs text-muted-foreground">{r.mode} · {r.platform} · {r.server || '-'}</div>
                      <div className="text-xs text-muted-foreground mt-1">{isCreator ? 'Criada por ti' : 'Entraste como adversário'}</div>
                      {ready && (
                        <div className="text-xs text-blue-300 mt-2 font-bold flex items-center gap-1">
                          <Zap className="w-3 h-3" /> Adversário entrou! {isCreator ? 'Clica para iniciar' : 'A aguardar criador'}
                        </div>
                      )}
                      {canStart ? (
                        <Button onClick={async (e) => {
                          e.stopPropagation()
                          try {
                            await fetch('/api/rooms/' + r.id + '/start', { method: 'POST', headers: { Authorization: 'Bearer ' + localStorage.getItem('ff_token') } })
                            toast.success('Partida iniciada!')
                            setOpenRoom(r.id); router.replace('/?view=room&id=' + r.id)
                          } catch { toast.error('Erro ao iniciar') }
                        }} className="w-full mt-3 bg-gradient-to-r from-blue-500 to-purple-600 font-bold">
                          <Zap className="w-4 h-4 mr-2" /> INICIAR PARTIDA
                        </Button>
                      ) : (
                        <div className="flex items-center justify-between mt-2">
                          <span className="text-xs text-purple-300">Ver detalhes</span>
                          <ChevronRight className="w-4 h-4 text-purple-300" />
                        </div>
                      )}
                    </Card>
                  )
                })}
              </div>
            </div>
          )}
          {myRooms.filter(r => ['FINALIZADA','CANCELADA'].includes(r.status)).length > 0 && (
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-purple-300 mb-2">Histórico</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {myRooms.filter(r => ['FINALIZADA','CANCELADA'].includes(r.status)).map(r => {
                  const iWon = r.winnerId === me.id
                  return (
                    <Card key={r.id} className={`glow-card p-4 cursor-pointer border ${iWon ? 'border-green-500/40' : r.status === 'CANCELADA' ? 'border-gray-500/30' : 'border-red-500/30'}`} onClick={() => { setOpenRoom(r.id); router.replace('/?view=room&id=' + r.id) }}>
                      <div className="flex justify-between mb-2"><b>{fmt(r.betAmountCents)}</b><StatusBadge s={r.status} /></div>
                      <div className="text-xs text-muted-foreground">{r.mode} · {r.platform}</div>
                      <div className={`text-sm font-bold mt-2 ${iWon ? 'text-green-300' : r.status === 'CANCELADA' ? 'text-gray-400' : 'text-red-300'}`}>
                        {r.status === 'CANCELADA' ? 'Cancelada (reembolso)' : iWon ? `✓ Ganhaste ${fmt(r.prizeCents)}` : '✗ Perdeste'}
                      </div>
                    </Card>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
      {view === 'wallet' && <WalletView refreshMe={refreshMe} stripeEnabled={stripeEnabled} />}
      {view === 'ranking' && <Ranking />}
      {view === 'profile' && (
        <Card className="glow-card p-4 sm:p-6 border-purple-500/30">
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4 mb-6 text-center sm:text-left">
            <Avatar className="w-24 h-24 sm:w-20 sm:h-20 ring-2 ring-purple-500/60 shrink-0"><AvatarImage src={me.photoUrl} /><AvatarFallback>{me.ffNickname?.[0]}</AvatarFallback></Avatar>
            <div>
              <h2 className="text-2xl font-black">{me.ffNickname}</h2>
              <div className="text-sm text-muted-foreground">UID Free Fire: {me.ffUid}</div>
              <div className="text-xs text-muted-foreground">{me.email}</div>
              <div className="mt-2 flex justify-center sm:justify-start"><DeviceBadge type={me.deviceType} /></div>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="Vitórias" value={me.wins} color="text-green-300" />
            <Stat label="Derrotas" value={me.losses} color="text-red-300" />
            <Stat label="Taxa Vitória" value={(me.wins + me.losses) > 0 ? Math.round(me.wins / (me.wins + me.losses) * 100) + '%' : '0%'} color="text-purple-300" />
            <Stat label="Ganhos Totais" value={fmt(me.totalEarningsCents)} color="text-yellow-300" />
          </div>
        </Card>
      )}

      {view === 'profile' && <NotificationSettings />}
    </Shell>
  )
}

function App() {
  const api = useApi()
  const router = useRouter()
  const [me, setMe] = useState(null)
  const [loading, setLoading] = useState(true)
  const [authView, setAuthView] = useState(null)

  const refreshMe = useCallback(async () => {
    try { const d = await api('/auth/me'); setMe(d.user) }
    catch (e) { setMe(null); if (typeof window !== 'undefined') localStorage.removeItem('ff_token') }
  }, [api])

  useEffect(() => {
    const t = typeof window !== 'undefined' ? localStorage.getItem('ff_token') : null
    if (!t) { setLoading(false); return }
    refreshMe().finally(() => setLoading(false))
  }, [refreshMe])

  const logout = () => { localStorage.removeItem('ff_token'); setMe(null); setAuthView(null); router.replace('/') }

  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="animate-pulse text-purple-300">A carregar...</div></div>
  if (me) return <Dashboard me={me} onLogout={logout} refreshMe={refreshMe} />
  if (authView) return <AuthForm mode={authView} onSwitch={() => setAuthView(authView === 'login' ? 'register' : 'login')} onSuccess={(u) => { setMe(u); setAuthView(null) }} />
  return <Landing onLogin={() => setAuthView('login')} onRegister={() => setAuthView('register')} />
}

export default App
