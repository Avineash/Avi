import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    container: { center: true, padding: "1rem", screens: { "2xl": "1280px" } },
    extend: {
      colors: {
        navy: { 950: "#050d1c", 900: "#0b1b33", 800: "#112544", 700: "#1a3560", 600: "#26477d", 500: "#3a5f9a" },
        ivory: { DEFAULT: "#f8f4ea", 50: "#fcfaf5", 100: "#f8f4ea", 200: "#efe8d6", 300: "#e2d8bd" },
        gold: { DEFAULT: "#b89b5e", 300: "#e0cb97", 400: "#d0b57c", 500: "#b89b5e", 600: "#9a7f45", 700: "#74602f" },
        ink: "#1c2433",
        success: "#2a7553",
        danger: "#a93a2a",
      },
      fontFamily: {
        serif: ['"Fraunces Variable"', "Georgia", "Cambria", "serif"],
        sans: ['"Inter Variable"', "ui-sans-serif", "system-ui", "-apple-system", "'Segoe UI'", "Roboto", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(11,27,51,.05), 0 12px 32px -16px rgba(11,27,51,.22)",
        float: "0 30px 60px -24px rgba(5,13,28,.55)",
        glow: "0 0 0 1px rgba(184,155,94,.35), 0 12px 40px -12px rgba(184,155,94,.45)",
      },
      keyframes: {
        marquee: { to: { transform: "translateX(-50%)" } },
        aurora1: { "0%,100%": { transform: "translate3d(0,0,0) scale(1)" }, "50%": { transform: "translate3d(6%,8%,0) scale(1.15)" } },
        aurora2: { "0%,100%": { transform: "translate3d(0,0,0) scale(1)" }, "50%": { transform: "translate3d(-8%,-6%,0) scale(1.1)" } },
        floaty: { "0%,100%": { transform: "translateY(0) rotate(var(--r,0deg))" }, "50%": { transform: "translateY(-10px) rotate(var(--r,0deg))" } },
        ring: { to: { strokeDashoffset: "0" } },
        rise: { from: { opacity: "0", transform: "translateY(18px)" }, to: { opacity: "1", transform: "none" } },
      },
      animation: {
        marquee: "marquee 55s linear infinite",
        aurora1: "aurora1 18s ease-in-out infinite",
        aurora2: "aurora2 22s ease-in-out infinite",
        floaty: "floaty 7s ease-in-out infinite",
        rise: "rise .8s cubic-bezier(.2,.7,.2,1) both",
      },
    },
  },
  plugins: [],
};
export default config;
