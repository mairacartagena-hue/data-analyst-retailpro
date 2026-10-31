import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Barrido inicial de la captura automática. El Apps Script de Gmail, con el token de la persona:
//  · GET  → { desde: "AAAA-MM-DD" | null }: fecha desde la que debe enviar los correos, si la persona pidió un barrido.
//  · POST → marca el barrido como terminado.
// Igual que el webhook de ingesta: la identidad la resuelve la base de datos a partir del token.

export const runtime = "nodejs";

function bearer(req: NextRequest): string {
  return req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
}

function client() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function tokenOk(sb: ReturnType<typeof client>, token: string): Promise<boolean> {
  const { data, error } = await sb.rpc("ingest_token_valid", { p_token: token });
  // Si la consulta falla no se bloquea: la función de abajo vuelve a validar el token
  return !!error || data !== false;
}

export async function GET(req: NextRequest) {
  const token = bearer(req);
  if (!token) return NextResponse.json({ ok: false, error: "Falta el token" }, { status: 401 });
  const sb = client();
  if (!(await tokenOk(sb, token))) return NextResponse.json({ ok: false, error: "Token no válido" }, { status: 401 });
  const { data, error } = await sb.rpc("ingest_backfill_pending", { p_token: token });
  if (error) return NextResponse.json({ ok: false, error: "No se pudo consultar" }, { status: 500 });
  return NextResponse.json({ ok: true, desde: typeof data === "string" ? data : null });
}

export async function POST(req: NextRequest) {
  const token = bearer(req);
  if (!token) return NextResponse.json({ ok: false, error: "Falta el token" }, { status: 401 });
  const sb = client();
  if (!(await tokenOk(sb, token))) return NextResponse.json({ ok: false, error: "Token no válido" }, { status: 401 });
  const { error } = await sb.rpc("ingest_backfill_done", { p_token: token });
  if (error) return NextResponse.json({ ok: false, error: "No se pudo marcar" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
