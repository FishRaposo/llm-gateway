export const metadata = {
  title: 'LLM Gateway Dashboard',
  description: 'Routing, guardrails, and cost analytics',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#f4efe5', color: '#13251f' }}>
        <style>{`
          button { min-height:44px; cursor:pointer !important; }
          input, select, textarea { min-height:44px; }
          button:focus-visible, a:focus-visible, select:focus-visible, input:focus-visible { outline:2px solid #0f5f57; outline-offset:2px; }
          @media (max-width:640px) {
            input, select, textarea { font-size:1rem; }
            .console-header { flex-direction:column !important; gap:16px !important; }
            .console-two-col { grid-template-columns:1fr !important; }
          }
          @media (prefers-reduced-motion:reduce) { *, *::before, *::after { animation-duration:.01ms !important; animation-iteration-count:1 !important; transition-duration:.01ms !important; scroll-behavior:auto !important; } }
        `}</style>
        {children}
      </body>
    </html>
  );
}

