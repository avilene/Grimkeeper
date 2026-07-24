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
    tracesSampleRate: adminTracesSampleRate(),
    // Keep replay off by default for a small internal admin UI.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    debug: process.env.SENTRY_DEBUG === "1",
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
