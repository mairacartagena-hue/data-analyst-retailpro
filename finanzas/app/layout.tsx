import type { Metadata, Viewport } from "next";
import { DM_Sans, Fraunces } from "next/font/google";
import { PwaBootstrap } from "@/components/PwaBootstrap";
import { accentScript } from "@/lib/accent";
import "./globals.css";

const body = DM_Sans({ subsets: ["latin"], variable: "--font-body", display: "swap" });
const display = Fraunces({ subsets: ["latin"], variable: "--font-display-face", display: "swap", weight: ["400", "600"] });

export const metadata: Metadata = {
  title: "Finanzas en Pareja",
  description: "Saldo Seguro, presupuestos por responsable y cruce de cuentas entre los dos.",
  manifest: "/manifest.webmanifest",
  applicationName: "Finanzas en Pareja",
  appleWebApp: { capable: true, title: "Finanzas", statusBarStyle: "default" },
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4efe6" },
    { media: "(prefers-color-scheme: dark)", color: "#1b1814" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

// Aplica el tema antes de pintar para evitar el parpadeo.
const themeScript = `(function(){try{var t=localStorage.getItem('theme');var d=t==='dark'||((!t||t==='system')&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-CO" className={`${body.variable} ${display.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript + accentScript }} />
      </head>
      <body className="min-h-dvh antialiased">
        {children}
        <PwaBootstrap />
      </body>
    </html>
  );
}
