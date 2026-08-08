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
        <AppNav>{children}</AppNav>
      </body>
    </html>
  );
}
