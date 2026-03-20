import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Tell Next.js not to bundle better-sqlite3 (native Node.js module)
  serverExternalPackages: ['better-sqlite3', 'xlsx'],
}

export default nextConfig
