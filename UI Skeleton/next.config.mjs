/** Where the Python station planner runs (uvicorn asteroid_industry.api:app). */
const PLANNER_URL = process.env.PLANNER_URL || 'http://127.0.0.1:8000'

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  // The UI calls /api/planner/*; Next.js forwards it to the Python planner.
  async rewrites() {
    return [{ source: '/api/planner/:path*', destination: `${PLANNER_URL}/:path*` }]
  },
}

export default nextConfig
