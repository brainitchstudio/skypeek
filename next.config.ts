import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  devIndicators: false,
  output: process.env.SKY_PEEK_STANDALONE_BUILD === '1' ? 'standalone' : undefined,
  experimental: { proxyClientMaxBodySize: '16kb' },
  async headers() {
    return [{ source: '/(.*)', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'no-referrer' },
      { key: 'Permissions-Policy', value: 'geolocation=(self), camera=(), microphone=()' },
    ] }];
  },
};

export default nextConfig;
