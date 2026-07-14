FROM docker:27-cli

ARG WEBHOOK_VERSION=2.8.1

RUN apk add --no-cache curl && \
  arch="$(uname -m)" && \
  case "$arch" in \
    x86_64) webhook_arch=linux-amd64 ;; \
    aarch64) webhook_arch=linux-arm64 ;; \
    *) echo "unsupported architecture: $arch" >&2; exit 1 ;; \
  esac && \
  curl -fsSL "https://github.com/adnanh/webhook/releases/download/${WEBHOOK_VERSION}/webhook-${webhook_arch}.tar.gz" \
    | tar -xz -C /usr/local/bin --strip-components=1 "webhook-${webhook_arch}/webhook" && \
  chmod +x /usr/local/bin/webhook && \
  apk del curl

COPY hooks.json /etc/webhook/hooks.json

EXPOSE 9000

ENTRYPOINT ["webhook"]
CMD ["-verbose", "-hooks", "/etc/webhook/hooks.json", "-hotreload"]
