import type { Metadata, Viewport } from "next";
import { Instrument_Sans } from "next/font/google";
import "./globals.css";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { ImpersonationBanner } from "@/components/ImpersonationBanner";

const body = Instrument_Sans({ subsets: ["latin"], variable: "--font-body", display: "swap" });

export const metadata: Metadata = {
  title: "Meridian - market dashboard",
  description: "Open-source market dashboard for the ASX, US, UK, Europe, Japan and Hong Kong: indices, movers, sectors, charts and pinned dashboards.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

const themeScript = `try{var t=localStorage.getItem('asx-theme');if(t!=='light'&&t!=='dark')t=matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';document.documentElement.dataset.theme=t;}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-AU" data-theme="dark" className={body.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="flex min-h-dvh flex-col lg:h-dvh lg:overflow-hidden">
        <ImpersonationBanner />
        <Header />
        <main className="min-h-0 flex-1 p-3 lg:overflow-hidden">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
