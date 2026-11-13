import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    container: { center: true, padding: "1rem", screens: { "2xl": "1280px" } },
    extend: {
      colors: {
        navy: { 950: "#060f1f", 900: "#0b1b33", 800: "#112544", 700: "#1a3560", 600: "#26477d", 500: "#3a5f9a" },
        ivory: { DEFAULT: "#f8f4ea", 50: "#fcfaf5", 100: "#f8f4ea", 200: "#efe8d6", 300: "#e2d8bd" },
        gold: { DEFAULT: "#b89b5e", 300: "#d9c48f", 400: "#c9ae74", 500: "#b89b5e", 600: "#9a7f45", 700: "#7a6335" },
        ink: "#1c2433",
        success: "#2f7d5b",
        danger: "#b3402f",
      },
      fontFamily: {
        serif: ["Georgia", "Cambria", "'Times New Roman'", "serif"],
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "'Segoe UI'", "Roboto", "'Helvetica Neue'", "Arial", "sans-serif"],
      },
      boxShadow: { card: "0 1px 2px rgba(11,27,51,.06), 0 8px 24px -12px rgba(11,27,51,.18)" },
    },
  },
  plugins: [],
};
export default config;
