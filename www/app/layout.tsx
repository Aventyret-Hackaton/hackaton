import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Pointless Travel Planner',
  description: 'Pointless Travel Planner — built on the Äventyret rig.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="sv">
      <body>{children}</body>
    </html>
  );
}
