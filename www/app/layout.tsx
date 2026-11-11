import type { Metadata } from 'next';

import { TripProvider } from '@/components/TripContext';

import './globals.css';

export const metadata: Metadata = {
  title: 'Pointless Travel Planner',
  description: 'En liten omväg.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="sv">
      <body>
        <TripProvider>{children}</TripProvider>
      </body>
    </html>
  );
}
