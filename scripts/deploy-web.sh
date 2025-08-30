#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../apps/web"

if [[ -z "${NEXT_PUBLIC_API_BASE:-}" ]]; then
  echo "NEXT_PUBLIC_API_BASE not set — exporting default http://localhost:8787"
  export NEXT_PUBLIC_API_BASE="http://localhost:8787"
fi

echo "Building Next.js for Cloudflare Pages via next-on-pages..."
npx -y @cloudflare/next-on-pages@latest build

echo "Deploying to Cloudflare Pages..."
wrangler pages deploy .vercel/output/static

echo "Web deployed."

