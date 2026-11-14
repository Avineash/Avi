/** API runs as a separate service. In dev the browser talks to Next only; /api is proxied so cookies are same-origin.
 *  In production put both behind one domain (see infra/Caddyfile). */
const API = process.env.API_INTERNAL_URL || 'http://localhost:4000';
export default {
  reactStrictMode: true,
  compress: false,                       // keeps Server-Sent Events unbuffered through the dev proxy
  poweredByHeader: false,
  async rewrites() { return [{ source: '/api/:path*', destination: `${API}/api/:path*` }]; },
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    ] }];
  },
};
