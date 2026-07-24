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
    debug: process.env.SENTRY_DEBUG === "1",
  });
}
