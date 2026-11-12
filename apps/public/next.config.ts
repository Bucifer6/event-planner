import type { NextConfig } from 'next';

// D1: the public site is a static export — no cookies, no third-party scripts.
// CI asserts the built output contains no third-party <script> and sets no cookies.
const nextConfig: NextConfig = {
  output: 'export',
  reactStrictMode: true,
  poweredByHeader: false,
  trailingSlash: true,
  transpilePackages: ['@eventdesk/i18n', '@eventdesk/shared'],
};

export default nextConfig;
