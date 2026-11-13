import { useEffect, useMemo, useRef, useState } from 'react';
import type { ModeId, ResolvedTheme } from '@staffhub/theme-core';
import { Button, Icon, StatusBadge, ThemeScope } from '@staffhub/ui';
import { AppFrame } from '../AppFrame.tsx';
import { DashboardView } from '../DashboardView.tsx';
import { samplePreview } from './previewData.ts';

export type Device = 'desktop' | 'mobile';
const SIZE: Record<Device, { w: number; h: number }> = { desktop: { w: 1000, h: 740 }, mobile: { w: 390, h: 820 } };

/** A faithful, inert copy of the real app rendered with an arbitrary theme, scaled to fit its column. */
export function PreviewFrame({ theme, scheme, device, caption }: { theme: ResolvedTheme; scheme: 'light' | 'dark'; device: Device; caption: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = wrap.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e!.contentRect.width));
    ro.observe(el); setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const { w, h } = SIZE[device];
  const scale = Math.min(1, (width || w) / (w + (device === 'mobile' ? 20 : 2)));
  const data = useMemo(() => samplePreview(), []);
  return (
    <figure className={`pv pv--${device}`} ref={wrap}>
      <figcaption className="pv__caption"><Icon name={scheme === 'dark' ? 'moon' : 'sun'} size={14} /> {caption}</figcaption>
      <div className="pv__box" style={{ width: (w + (device === 'mobile' ? 20 : 2)) * scale, height: (h + (device === 'mobile' ? 20 : 2)) * scale }}>
        <div className="pv__scaler" style={{ transform: `scale(${scale})`, width: w + (device === 'mobile' ? 20 : 2), height: h + (device === 'mobile' ? 20 : 2) }}>
          <div className="pv__bezel" style={{ width: w + (device === 'mobile' ? 20 : 2), height: h + (device === 'mobile' ? 20 : 2) }}>
            {/* inert: the preview is a picture of the app, not a second app to tab through */}
            <div aria-hidden="true" {...{ inert: true }}>
              <ThemeScope theme={theme} mode={scheme} style={{ width: w, height: h, overflow: 'hidden', ['--ds-shell-h' as string]: `${h}px` }}>
                <AppFrame
                  theme={theme} activeId="/" userName="Alex Morgan" userRole="Operations manager" title="Dashboard"
                  nav={[
                    { id: '/', label: 'Dashboard', icon: 'home', href: '#' }, { id: '/leave', label: 'Leave', icon: 'calendar', href: '#' },
                    { id: '/roster', label: 'Roster', icon: 'roster', href: '#' }, { id: '/notifications', label: 'Alerts', icon: 'bell', href: '#' },
                  ]}
                  actions={<Button size="sm" icon="plus">Request</Button>}
                >
                  <DashboardView {...data} styleGuide />
                </AppFrame>
              </ThemeScope>
            </div>
          </div>
        </div>
      </div>
    </figure>
  );
}

/** Small thumbnail for the preset gallery: identity, heading font, statuses and a button. */
export function MiniPreview({ theme, mode }: { theme: ResolvedTheme; mode: ModeId }) {
  return (
    <ThemeScope theme={theme} mode={mode} className="mini">
      <div className="mini__shell">
        <div className="mini__nav"><span className="mini__dot" /><span className="mini__bar" /><span className="mini__bar mini__bar--on" /><span className="mini__bar" /></div>
        <div className="mini__main">
          <div className="mini__title">Aa Welcome</div>
          <div className="mini__card">
            <div className="mini__row"><StatusBadge status="approved" /><StatusBadge status="pending" /></div>
            <div className="mini__row"><Button size="sm">Primary</Button><Button size="sm" variant="secondary">Secondary</Button></div>
          </div>
        </div>
      </div>
    </ThemeScope>
  );
}
