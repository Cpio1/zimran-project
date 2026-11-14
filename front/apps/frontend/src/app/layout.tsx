import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { AppShell } from "@/components/AppShell";
import { THEME_SCRIPT } from "@/lib/theme-script";

export const metadata: Metadata = {
  title: "Claimly — Find it. Claim it. Don't pay twice.",
  description: "Keep warranties, policies, certificates and receipts in one place and use what you already paid for.",
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f7f5" },
    { media: "(prefers-color-scheme: dark)", color: "#0d1311" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // data-theme is set by THEME_SCRIPT before React hydrates, so the server markup can't match it.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Before first paint: apply the saved or system theme (no light flash). */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
