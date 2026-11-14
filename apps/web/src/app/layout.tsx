import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { I18nProvider } from '@/lib/i18n';
import { ToastProvider } from '@/components/ui';

export const metadata: Metadata = { title: { default: 'TableFlow — Scan. Order. Pay. Enjoy.', template: '%s · TableFlow' }, description: 'QR ordering and LankaQR payments for Sri Lankan cafés and restaurants.', applicationName: 'TableFlow', robots: { index: false } };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#0F5C4D' };

export default function Root({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* apply saved theme before paint to avoid a flash */}
        <script dangerouslySetInnerHTML={{ __html: `try{var p=localStorage.getItem('tf-theme')||'auto';var d=p==='dark'||(p==='auto'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light'}catch(e){}` }} />
      </head>
      <body><I18nProvider><ToastProvider>{children}</ToastProvider></I18nProvider></body>
    </html>
  );
}
