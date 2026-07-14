# Pre-built webhook binaries are glibc-linked; docker:27-cli is Alpine (musl).
# Build a static binary so it runs on the Alpine base that ships docker CLI.
FROM golang:1.22-alpine AS webhook-build
ARG WEBHOOK_VERSION=2.8.1
RUN apk add --no-cache git && \
  git clone --depth 1 --branch "${WEBHOOK_VERSION}" https://github.com/adnanh/webhook.git /src/webhook && \
  cd /src/webhook && \
  CGO_ENABLED=0 go build -o /usr/local/bin/webhook .

FROM docker:27-cli
COPY --from=webhook-build /usr/local/bin/webhook /usr/local/bin/webhook
COPY hooks.json /etc/webhook/hooks.json

EXPOSE 9000

ENTRYPOINT ["webhook"]
CMD ["-verbose", "-template", "-hooks", "/etc/webhook/hooks.json", "-hotreload"]
