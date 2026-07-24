import type { Metadata } from "next";

import { AppNav } from "@/components/app-nav";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Grimkeeper Admin",
    template: "%s · Grimkeeper Admin",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppNav />
        <main className="mx-auto max-w-6xl px-6 py-6">{children}</main>
      </body>
    </html>
  );
}
