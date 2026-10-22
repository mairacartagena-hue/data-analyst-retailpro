import type { Metadata, Viewport } from "next";
import { Anton, Poppins } from "next/font/google";
import { PwaBootstrap } from "@/components/PwaBootstrap";
import "./globals.css";

const anton = Anton({ weight: "400", subsets: ["latin"], variable: "--font-anton", display: "swap" });
const poppins = Poppins({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  variable: "--font-poppins",
  display: "swap",
});

export const metadata: Metadata = {
  title: "A Medias",
  description: "Tareas de la casa, compras, recordatorios y mascotas, a medias entre los dos.",
  manifest: "/manifest.webmanifest",
  applicationName: "A Medias",
  appleWebApp: { capable: true, title: "A Medias", statusBarStyle: "default" },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#7c0116",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-CO" className={`${anton.variable} ${poppins.variable}`}>
      <body className="min-h-dvh bg-crema text-vino antialiased">
        {children}
        <PwaBootstrap />
      </body>
    </html>
  );
}
