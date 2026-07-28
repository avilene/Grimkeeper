import * as Sentry from "@sentry/nextjs";

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

/**
 * Report a handled server-action failure to Sentry.
 * Skips Next.js redirect/notFound digests (those are control flow, not errors).
 */
export function captureAdminException(
  error: unknown,
  context: Record<string, unknown> = {},
): void {
  if (error && typeof error === "object" && "digest" in error) return;

  Sentry.withScope((scope) => {
    scope.setLevel("error");
    for (const [key, value] of Object.entries(context)) {
      if (value === undefined) continue;
      if (key === "action" && typeof value === "string") {
        scope.setTag("action", value);
        continue;
      }
      scope.setExtra(key, value);
    }
    if (error instanceof Error) {
      Sentry.captureException(error);
      return;
    }
    Sentry.captureException(
      new Error(typeof error === "string" ? error : "admin.action.failed"),
      { extra: { original: error } },
    );
  });
}
