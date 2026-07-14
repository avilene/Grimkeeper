# Pre-built webhook binaries are glibc-linked; docker:27-cli is Alpine (musl).
# Build a static binary so it runs on the Alpine base that ships docker CLI.
FROM golang:1.22-alpine AS webhook-build
ARG WEBHOOK_VERSION=2.8.1
RUN CGO_ENABLED=0 go install github.com/adnanh/webhook@v${WEBHOOK_VERSION}

FROM docker:27-cli
COPY --from=webhook-build /go/bin/webhook /usr/local/bin/webhook
COPY hooks.json /etc/webhook/hooks.json

EXPOSE 9000

ENTRYPOINT ["webhook"]
CMD ["-verbose", "-hooks", "/etc/webhook/hooks.json", "-hotreload"]
