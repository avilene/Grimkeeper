import * as Sentry from "@sentry/nextjs";
import type { Metadata } from "next";

import { AppNav } from "@/components/app-nav";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Grimkeeper Admin",
    template: "%s · Grimkeeper Admin",
  },
  other: {
    ...Sentry.getTraceData(),
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>
        <div className="flex min-h-screen flex-col md:flex-row">
          <AppNav />
          <main className="min-w-0 flex-1 px-4 py-4 sm:px-6 sm:py-6">
            <div className="mx-auto w-full max-w-6xl">{children}</div>
          </main>
        </div>
      </body>
    </html>
  );
}
