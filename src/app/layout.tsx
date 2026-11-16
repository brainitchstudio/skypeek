import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import 'maplibre-gl/dist/maplibre-gl.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'SkyPeek',
  description: 'Forecasts, radar and severe weather alerts.',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Nonce-based CSP requires a fresh dynamic render for every document.
  await headers();
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
