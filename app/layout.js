import './globals.css'
import { Toaster } from '@/components/ui/sonner'

export const metadata = {
  title: 'FF Arena - Apostas 1vs1 Free Fire',
  description: 'Plataforma de apostas 1vs1 Free Fire com dinheiro real. Cria salas, encontra adversários e ganha prémios.',
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
}

export default function RootLayout({ children }) {
  return (
    <html lang="pt" className="dark">
      <body className="bg-background text-foreground antialiased min-h-screen">
        {children}
        <Toaster richColors theme="dark" position="top-center" mobileOffset={8} />
      </body>
    </html>
  )
}
