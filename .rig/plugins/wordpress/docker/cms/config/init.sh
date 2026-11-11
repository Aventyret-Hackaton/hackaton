#!/usr/bin/env bash
set -e

# /rig/cert is the shared `rig-cert` docker volume (rootCA.pem + ca-bundle.crt
# + per-site certs under sites/).
#
# PHP/composer/wp-cli trust the rig CA via php.ini (curl.cainfo/openssl.cafile
# point at /rig/cert/ca-bundle.crt) — no root-only update-ca-certificates.
# WordPress' HTTP API is the exception: it forces its own bundled CA
# (wp-includes/certificates/ca-bundle.crt) and ignores php.ini, so WP loopback
# calls to https://cms.<site>.test only trust the rig cert if we drop the rig
# bundle in there. /rig/cert/ca-bundle.crt is a superset (public roots + rig
# rootCA), so overwriting keeps external HTTPS working too.
WP_CA=/service/cms/web/wp/wp-includes/certificates/ca-bundle.crt
if [ -f /rig/cert/ca-bundle.crt ] && [ -f "$WP_CA" ]; then
  cp /rig/cert/ca-bundle.crt "$WP_CA" || echo "[init] could not update the WordPress ca-bundle" >&2
else
  echo "[init] skipping the WordPress ca-bundle (missing /rig/cert/ca-bundle.crt or WP not installed)" >&2
fi

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

nginx &
php-fpm &

wait -n
