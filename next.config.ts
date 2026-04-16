import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // xlsx uses dynamic requires — must stay external
  serverExternalPackages: ['xlsx'],
  turbopack: {
    root: '.',
  },
}

export default nextConfig
