'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function CheckoutCancel() {
  const router = useRouter()
  useEffect(() => {
    const t = setTimeout(() => router.replace('/?view=rooms'), 1500)
    return () => clearTimeout(t)
  }, [router])
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="glow-card rounded-2xl p-10 max-w-md text-center">
        <div className="text-6xl mb-4">⚠️</div>
        <h1 className="text-2xl font-bold mb-2">Pagamento cancelado</h1>
        <p className="text-muted-foreground">A regressar...</p>
      </div>
    </div>
  )
}
