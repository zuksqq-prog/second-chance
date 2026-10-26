/** @type {import('next').NextConfig} */
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Next.js needs inline scripts for hydration; wallets inject via extension, not network.
      "script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""),
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https://dd.dexscreener.com https://cdn.dexscreener.com https://assets.geckoterminal.com https://coin-images.coingecko.com https://assets.coingecko.com https://ipfs.io https://arweave.net https://cf-ipfs.com https://*.mypinata.cloud https://gateway.pinata.cloud https://*.ipfs.dweb.link https://*.arweave.net",
      "font-src 'self'",
      // The browser only talks to our own API (and the public RPC the wallet adapter may ping).
      "connect-src 'self' https://api.mainnet-beta.solana.com wss://api.mainnet-beta.solana.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Lint runs separately (npm run lint); type errors still fail the build.
  eslint: { ignoreDuringBuilds: true },
  images: { unoptimized: true },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
