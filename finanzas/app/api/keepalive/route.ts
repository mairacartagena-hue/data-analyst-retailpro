import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Supabase pausa los proyectos gratuitos tras 7 días sin actividad.
// Vercel Cron llama a esta ruta una vez al día y hace una consulta liviana.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
  });
  // Sin sesión no hay permiso de lectura, pero la petición llega a la base de datos y cuenta como actividad.
  const { status } = await sb.from("households").select("id", { head: true });
  return NextResponse.json({ ok: status > 0, at: new Date().toISOString() });
}
