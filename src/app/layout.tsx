import type { Metadata, Viewport } from "next";
import { Toaster } from "@/components/ui/sonner";
import { getOrgSettings, HEX_COLOR, readableForeground } from "@/server/settings";
import "./globals.css";

// Branding comes from org settings in the database, so pages render per request rather than at build time.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "RGXM Staffing", template: "%s · RGXM Staffing" },
  description: "Staffing, scheduling, attendance and payments for RGXM activations.",
  applicationName: "RGXM Staffing",
  appleWebApp: { capable: true, title: "RGXM", statusBarStyle: "default" },
  robots: { index: false, follow: false },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfbf9" },
    { media: "(prefers-color-scheme: dark)", color: "#18181b" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const settings = await getOrgSettings();
  const accent = HEX_COLOR.test(settings.accentColor) ? settings.accentColor : "#E4572E";
  const brandVars = `:root{--brand:${accent};--brand-foreground:${readableForeground(accent)}}`;

  return (
    <html lang="en-CA" className="h-full">
      <head>
        <style dangerouslySetInnerHTML={{ __html: brandVars }} />
      </head>
      <body className="min-h-full">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
