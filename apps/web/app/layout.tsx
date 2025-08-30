export const metadata = { title: 'Department of Mysteries' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body style={{ fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Noto Sans JP, sans-serif', margin: 0 }}>
        {children}
      </body>
    </html>
  )
}

