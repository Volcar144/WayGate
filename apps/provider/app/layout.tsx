import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Waygate Provider',
  description: 'Identity Provider scaffold with tenant-aware routing',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[var(--background)] text-[var(--foreground)] antialiased font-sans">
        <div className="min-h-screen">
          {children}
        </div>
      </body>
    </html>
  );
}
