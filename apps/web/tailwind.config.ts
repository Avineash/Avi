import type { Config } from 'tailwindcss';
const v = (n: string) => `rgb(var(--${n}) / <alpha-value>)`;
export default {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: { bg: v('bg'), surface: v('surface'), sunken: v('sunken'), ink: v('ink'), muted: v('muted'), line: v('line'),
        brand: v('brand'), brand2: v('brand2'), onbrand: v('on-brand'), brandtext: v('brand-text'),
        ok: v('ok'), warn: v('warn'), bad: v('bad') },
      fontFamily: { sans: ['var(--font-body)'], display: ['var(--font-display)'] },
      borderRadius: { '2xl': '1.25rem', '3xl': '1.75rem' },
      boxShadow: { card: '0 1px 2px rgb(0 0 0 / .04), 0 8px 24px -12px rgb(0 0 0 / .12)', pop: '0 20px 50px -12px rgb(0 0 0 / .35)' },
      keyframes: {
        up: { from: { transform: 'translateY(100%)' }, to: { transform: 'translateY(0)' } },
        fade: { from: { opacity: '0' }, to: { opacity: '1' } },
        pop: { '0%': { transform: 'scale(.9)', opacity: '0' }, '100%': { transform: 'scale(1)', opacity: '1' } },
        ping2: { '75%,100%': { transform: 'scale(2.2)', opacity: '0' } },
        flash: { '0%,100%': { boxShadow: '0 0 0 0 rgb(var(--brand) / .0)' }, '50%': { boxShadow: '0 0 0 8px rgb(var(--brand) / .35)' } },
      },
      animation: { up: 'up .28s cubic-bezier(.2,.8,.2,1)', fade: 'fade .2s ease-out', pop: 'pop .22s cubic-bezier(.2,.8,.2,1)', ping2: 'ping2 1.6s cubic-bezier(0,0,.2,1) infinite', flash: 'flash 1.2s ease-in-out 3' },
    },
  },
  plugins: [],
} satisfies Config;
