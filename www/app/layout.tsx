import type { Metadata } from 'next';

import { AudioProvider } from '@/components/AudioProvider';
import { TripProvider } from '@/components/TripContext';

import './globals.css';

export const metadata: Metadata = {
  // Without a base the social image URLs point at localhost.
  metadataBase: process.env.NEXT_PUBLIC_WWW_URL ? new URL(process.env.NEXT_PUBLIC_WWW_URL) : undefined,
  title: 'Pointless Travel Planner',
  description: 'En liten omväg.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="sv">
      <body>
        <AudioProvider>
          <TripProvider>{children}</TripProvider>
        </AudioProvider>
      </body>
    </html>
  );
}
