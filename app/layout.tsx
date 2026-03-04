import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'КоммуниК — Revenue Intelligence Platform',
  description: 'Превращаем поддержку PLG/SaaS компаний из центра затрат в источник выручки',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  )
}
