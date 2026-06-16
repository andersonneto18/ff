'use client'
import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

function CheckoutSuccessContent() {
  const router = useRouter()
  const params = useSearchParams()
  const type = params.get('type')
  const sessionId = params.get('session_id')
  const roomId = params.get('roomId')
  const [status, setStatus] = useState('A verificar pagamento...')
  const [amount, setAmount] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    async function verify() {
      try {
        if (type === 'topup' && sessionId) {
          const res = await fetch('/api/stripe/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId }),
          })
          const data = await res.json()
          if (data.status === 'paid') {
            setStatus('Saldo carregado com sucesso!')
            setAmount(data.amountCents)
          } else {
            setStatus('Aguardando confirmação do pagamento...')
          }
        } else {
          setStatus('Pagamento confirmado!')
        }
        setTimeout(() => {
          if (type === 'topup') router.replace('/?view=wallet')
          else if (roomId) router.replace(`/?view=room&id=${roomId}`)
          else router.replace('/?view=rooms')
        }, 2200)
      } catch (e) {
        setError(e.message)
        setTimeout(() => router.replace('/?view=wallet'), 3000)
      }
    }
    verify()
  }, [type, sessionId, roomId, router])

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="glow-card rounded-2xl p-10 max-w-md text-center border border-purple-500/30">
        <div className="text-6xl mb-4">{error ? '⚠️' : amount ? '✅' : '⏳'}</div>
        <h1 className="text-2xl font-bold gradient-text mb-2">{status}</h1>
        {amount !== null && (
          <div className="text-3xl font-black text-green-300 mt-3 mb-2">+{(amount / 100).toFixed(2)}€</div>
        )}
        {error && <p className="text-red-300 text-sm mt-2">{error}</p>}
        <p className="text-muted-foreground text-sm mt-3">A redirecionar para a carteira...</p>
      </div>
    </div>
  )
}

function LoadingFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="glow-card rounded-2xl p-10 max-w-md text-center border border-purple-500/30">
        <div className="text-6xl mb-4">⏳</div>
        <h1 className="text-2xl font-bold gradient-text mb-2">A verificar pagamento...</h1>
        <p className="text-muted-foreground text-sm mt-3">Por favor aguarda...</p>
      </div>
    </div>
  )
}

export default function CheckoutSuccess() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <CheckoutSuccessContent />
    </Suspense>
  )
}
