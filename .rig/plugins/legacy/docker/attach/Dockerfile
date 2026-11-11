FROM docker:28-cli

RUN apk add --no-cache bash

# mkcert issues certs for the legacy sites from the same rootCA as rig-cert (/cert).
ARG MKCERT_VERSION=v1.4.4
RUN ARCH="$(apk --print-arch)" \
    && case "$ARCH" in \
         aarch64) MK_ARCH=arm64 ;; \
         x86_64)  MK_ARCH=amd64 ;; \
         *) echo "unsupported arch: $ARCH" && exit 1 ;; \
       esac \
    && wget -qO /usr/local/bin/mkcert \
         "https://github.com/FiloSottile/mkcert/releases/download/${MKCERT_VERSION}/mkcert-${MKCERT_VERSION}-linux-${MK_ARCH}" \
    && chmod +x /usr/local/bin/mkcert

COPY attach.sh /usr/local/bin/attach.sh
RUN chmod +x /usr/local/bin/attach.sh

ENTRYPOINT ["/usr/local/bin/attach.sh"]
