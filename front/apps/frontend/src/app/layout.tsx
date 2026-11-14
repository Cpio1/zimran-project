import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { AppShell } from "@/components/AppShell";

export const metadata: Metadata = {
  title: "Claimly — Find it. Claim it. Don't pay twice.",
  description: "Keep warranties, policies, certificates and receipts in one place and use what you already paid for.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#17705f" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
