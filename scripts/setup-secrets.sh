#!/usr/bin/env bash
set -euo pipefail

# Setup CF Workers secrets for API (apps/api)
# Usage:
#   export CF_ACCOUNT_ID=...
#   export STRIPE_SECRET_KEY=...
#   export STRIPE_MP_WEBHOOK_SECRET=...
#   export STRIPE_SUBSCRIPTION_WEBHOOK_SECRET=...
#   export APP_SSO_PRIVATE_KEY_PEM="$(cat private-key.pem)"
#   export R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=...
#   export R2_ACCOUNT_ID=... R2_REGION=auto R2_BUCKET=dom-assets
#   (optional) export MAIL_FROM=... MAIL_FROM_NAME=...
#   Then: bash scripts/setup-secrets.sh

cd "$(dirname "$0")/../apps/api"

echo "Setting secrets in apps/api ..."

req_vars=(STRIPE_SECRET_KEY STRIPE_MP_WEBHOOK_SECRET STRIPE_SUBSCRIPTION_WEBHOOK_SECRET)
for v in "${req_vars[@]}"; do
  if [[ -z "${!v:-}" ]]; then echo "Missing required env: $v"; exit 1; fi
done

# Stripe
printf "%s" "$STRIPE_SECRET_KEY" | wrangler secret put STRIPE_SECRET_KEY --quiet
printf "%s" "$STRIPE_MP_WEBHOOK_SECRET" | wrangler secret put STRIPE_MP_WEBHOOK_SECRET --quiet
printf "%s" "$STRIPE_SUBSCRIPTION_WEBHOOK_SECRET" | wrangler secret put STRIPE_SUBSCRIPTION_WEBHOOK_SECRET --quiet

# App SSO key (optional)
if [[ -n "${APP_SSO_PRIVATE_KEY_PEM:-}" ]]; then
  printf "%s" "$APP_SSO_PRIVATE_KEY_PEM" | wrangler secret put APP_SSO_PRIVATE_KEY_PEM --quiet
fi

# R2 access (optional for presign)
if [[ -n "${R2_ACCESS_KEY_ID:-}" && -n "${R2_SECRET_ACCESS_KEY:-}" ]]; then
  printf "%s" "$R2_ACCESS_KEY_ID" | wrangler secret put R2_ACCESS_KEY_ID --quiet
  printf "%s" "$R2_SECRET_ACCESS_KEY" | wrangler secret put R2_SECRET_ACCESS_KEY --quiet
fi

# Mail (optional)
if [[ -n "${MAIL_FROM:-}" ]]; then
  wrangler kv:namespace create MAIL_META >/dev/null 2>&1 || true
fi

echo "Done. Consider also setting vars in wrangler.toml (PUBLIC_BASE_URL, R2_ACCOUNT_ID, R2_REGION, R2_BUCKET, etc.)."

