/**
 * Shared Sentry options for the admin Next.js app.
 * Uses the dedicated admin project DSN — do not reuse the bot `SENTRY_DSN`.
 */
export function adminSentryDsn(): string | undefined {
  const dsn =
    process.env.ADMIN_SENTRY_DSN?.trim() ||
    process.env.NEXT_PUBLIC_ADMIN_SENTRY_DSN?.trim() ||
    "";
  return dsn || undefined;
}

export function adminSentryEnvironment(): string {
  return (
    process.env.SENTRY_ENVIRONMENT?.trim() ||
    process.env.NODE_ENV ||
    "development"
  );
}

export function adminSentryRelease(): string | undefined {
  return process.env.SENTRY_RELEASE?.trim() || undefined;
}

export function adminTracesSampleRate(): number {
  return process.env.NODE_ENV === "production" ? 0.1 : 1.0;
}
