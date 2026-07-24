"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
          <h1>Something went wrong</h1>
          <p>The error has been reported. Try refreshing the page.</p>
          {error.digest ? (
            <p style={{ opacity: 0.7, fontSize: "0.9rem" }}>Digest: {error.digest}</p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
