import { Analytics } from "@vercel/analytics/next";
import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { AppProviders } from "@/components/providers";
import { Header, Footer } from "@/components/layout";

const outfit = localFont({ src: "../fonts/Outfit-Variable.ttf", variable: "--font-outfit", weight: "100 900", display: "swap" });
const dmSans = localFont({ src: "../fonts/DMSans-Variable.ttf", variable: "--font-dmsans", weight: "100 1000", display: "swap" });
const plexMono = localFont({
  src: [
    { path: "../fonts/IBMPlexMono-Regular.ttf", weight: "400" },
    { path: "../fonts/IBMPlexMono-Medium.ttf", weight: "500" },
  ],
  variable: "--font-plexmono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://dawns.money"),
  title: { default: "dawns.money · Kaspa DeFi, in plain daylight", template: "%s · dawns.money" },
  description: "Live, on-chain health for every protocol in Kaspa DeFi. Every number traces back to a contract and a block.",
  openGraph: { title: "dawns.money", description: "Kaspa DeFi, in plain daylight.", url: "https://dawns.money", siteName: "dawns.money", type: "website" },
};

export const viewport: Viewport = { themeColor: "#100B2B", colorScheme: "dark", viewportFit: "cover" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${outfit.variable} ${dmSans.variable} ${plexMono.variable}`}>
      <body>
        <AppProviders>
          <Header />
          <main>{children}</main>
          <Footer />
        </AppProviders>
        <Analytics />
      </body>
    </html>
  );
}
