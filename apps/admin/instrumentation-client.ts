import * as Sentry from "@sentry/nextjs";

import {
  adminSentryDsn,
  adminSentryEnvironment,
  adminSentryRelease,
  adminTracesSampleRate,
} from "./lib/sentry";

const dsn = adminSentryDsn();
if (dsn) {
  Sentry.init({
    dsn,
    environment: adminSentryEnvironment(),
    release: adminSentryRelease(),
    // Drives performance tracing + Web Vitals in @sentry/nextjs.
    tracesSampleRate: adminTracesSampleRate(),
    // Session replay only when an error occurs (internal admin UI).
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
    integrations: [Sentry.replayIntegration()],
    debug: process.env.SENTRY_DEBUG === "1",
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
