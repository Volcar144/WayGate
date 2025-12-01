import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Waygate Provider',
  description: 'Identity Provider scaffold with tenant-aware routing',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
