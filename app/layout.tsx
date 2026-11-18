import type { Metadata, Viewport } from 'next';
import { Instrument_Sans } from 'next/font/google';
import 'maplibre-gl/dist/maplibre-gl.css';
import './globals.css';

const sans = Instrument_Sans({
  variable: '--font-sans',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Paris, rames en direct',
  description: 'Carte en direct des métros, RER, trams et Transilien J et L de Paris, positions estimées à partir des données temps réel IDFM.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#eef1f5' },
    { media: '(prefers-color-scheme: dark)', color: '#10141b' },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <body className={sans.variable}>{children}</body>
    </html>
  );
}
