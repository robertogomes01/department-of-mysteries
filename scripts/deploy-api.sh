#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../apps/api"
echo "Building API (Workers)..."
npm run build
echo "Deploying API with wrangler..."
wrangler deploy
echo "API deployed."

