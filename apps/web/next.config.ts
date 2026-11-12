import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: [
    '@eventdesk/db',
    '@eventdesk/shared',
    '@eventdesk/auth',
    '@eventdesk/core',
    '@eventdesk/i18n',
    '@eventdesk/ui',
    '@eventdesk/email',
    '@eventdesk/jobs',
  ],
  serverExternalPackages: ['argon2'],
  webpack: (config, { isServer }) => {
    if (isServer) {
      // native module: must be required at runtime, never bundled
      config.externals = [...(config.externals ?? []), 'argon2'];
    }
    return config;
  },
};

export default nextConfig;
