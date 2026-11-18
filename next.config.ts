import type { NextConfig } from 'next';
import { securityHeaders } from './lib/securityHeaders';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // No AGENTS.md written by next dev.
  agentRules: false,
  // No Next badge over the map in dev.
  devIndicators: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders(process.env.NODE_ENV !== 'production') }];
  },
};

export default nextConfig;
