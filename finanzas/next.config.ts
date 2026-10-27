import type { NextConfig } from "next";

// Política de contenido: el navegador solo carga código, estilos e imágenes de la propia app y solo se conecta
// con ella y con Supabase. Cualquier script o conexión a otro sitio queda bloqueado.
function contentSecurityPolicy(): string {
  const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const ws = supabase.replace(/^http/, "ws");
  const dev = process.env.NODE_ENV !== "production";
  // En las vistas previas de Vercel, su barra de comentarios
  const live = process.env.VERCEL_ENV === "preview" ? ["https://vercel.live"] : [];
  const rules: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'", ...(dev ? ["'unsafe-eval'"] : []), ...live],
    "style-src": ["'self'", "'unsafe-inline'", ...live],
    "img-src": ["'self'", "data:", "blob:", ...live, ...(live.length ? ["https://vercel.com"] : [])],
    "font-src": ["'self'", "data:", ...live],
    "connect-src": ["'self'", supabase, ws, ...live, ...(live.length ? ["wss://ws-us3.pusher.com"] : [])].filter(Boolean),
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
    "frame-src": live.length ? live : ["'none'"],
    "frame-ancestors": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "object-src": ["'none'"],
  };
  return Object.entries(rules).map(([k, v]) => `${k} ${v.join(" ")}`).join("; ");
}

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Seguridad básica: nadie puede meter la app en un iframe (clickjacking), el navegador no adivina tipos
        // de archivo y las direcciones internas no se filtran a otros sitios. Micrófono solo para dictar.
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(), payment=(), publickey-credentials-create=(self), publickey-credentials-get=(self)" },
          { key: "Content-Security-Policy", value: contentSecurityPolicy() },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: [{ key: "Content-Type", value: "application/manifest+json" }],
      },
    ];
  },
};

export default nextConfig;
