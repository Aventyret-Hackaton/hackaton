#!/usr/bin/env bash
set -euo pipefail

# In-container TLS for direct container→container calls (docker-DNS hostnames
# bypass Traefik). rig-cert issues the site cert on container start (label
# rig.hosts) and shares it via the rig-cert volume — first boot may
# race the issuing, hence the wait. hostname cms.vi.test → sites/vi.test.pem.
site_cert_slug() {
  local host slug
  host="$(hostname)"
  for slug in "$host" "${host#*.}"; do
    if [ -f "/rig/cert/sites/$slug.pem" ] && [ -f "/rig/cert/sites/$slug-key.pem" ]; then
      echo "$slug"
      return 0
    fi
  done
  return 1
}

# Without the rig-cert volume (Cloud Run, CI) /rig/cert does not exist at all. Skip
# directly instead of waiting out the loop (15 s cold start otherwise).
slug=""
if [ -d /rig/cert ]; then
  for _ in $(seq 15); do
    slug="$(site_cert_slug)" && break
    sleep 1
  done
fi

if [ -n "$slug" ]; then
  cp "/rig/cert/sites/$slug.pem" /etc/nginx/cert/site-crt.pem
  cp "/rig/cert/sites/$slug-key.pem" /etc/nginx/cert/site-key.pem
  cat > /etc/nginx/cert/tls.conf <<'EOF'
listen 443 ssl;
ssl_certificate     /etc/nginx/cert/site-crt.pem;
ssl_certificate_key /etc/nginx/cert/site-key.pem;
EOF
  echo "[init] 443 active with rig cert sites/$slug.pem"
else
  echo "[init] no rig cert for $(hostname) — HTTP only on 8080" >&2
fi

# Start Next dev
pnpm run dev &

# Run nginx in the foreground
exec nginx -g 'daemon off;'
