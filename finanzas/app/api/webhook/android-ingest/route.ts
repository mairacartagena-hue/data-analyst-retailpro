import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Channel, RawEvent } from "@/lib/ingest/types";
import { interpret, toDbEvent } from "@/lib/ingest/pipeline";
import { dropUnfilled } from "@/lib/ingest/normalize";

// Webhook único de ingesta: MacroDroid (notificaciones y SMS) y Google Apps Script (Gmail).
// Autenticación: "Authorization: Bearer <token de la persona>". La identidad la resuelve
// la base de datos a partir del token, así que este servidor no usa claves secretas de Supabase.

export const runtime = "nodejs";

const CHANNELS: Channel[] = ["ANDROID_NOTIFICATION", "ANDROID_SMS", "GMAIL"];

function str(v: unknown, max = 4000): string {
  return typeof v === "string" ? v.slice(0, max) : v == null ? "" : String(v).slice(0, max);
}

/** Acepta JSON (recomendado) o texto que contenga JSON; MacroDroid a veces envía text/plain. */
async function readBody(req: NextRequest): Promise<Record<string, unknown> | null> {
  const raw = await req.text();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // JSON mal formado (ej. comillas dentro del texto de la notificación): rescatar campo por campo
    if (raw.trim().startsWith("{")) {
      const out: Record<string, unknown> = {};
      const re = /"(\w+)"\s*:\s*"([\s\S]*?)"\s*(?=,\s*"\w+"\s*:|\s*}\s*$)/g;
      for (let m = re.exec(raw); m; m = re.exec(raw)) out[m[1]] = m[2];
      if (Object.keys(out).length > 0) return out;
    }
    // Formulario: channel=...&text=...
    const params = new URLSearchParams(raw);
    if ([...params.keys()].length > 0) return Object.fromEntries(params.entries());
    return null;
  }
}

function toEvent(body: Record<string, unknown>): RawEvent | null {
  const channel = str(body.channel).toUpperCase() as Channel;
  if (!CHANNELS.includes(channel)) return null;
  const text = dropUnfilled(str(body.text ?? body.body ?? body.message));
  if (!text) return null;
  const received = str(body.received_at);
  return {
    channel,
    source: dropUnfilled(str(body.app ?? body.package ?? body.sender ?? body.from, 200)),
    title: dropUnfilled(str(body.title, 300)) || undefined,
    subject: str(body.subject, 300) || undefined,
    text,
    receivedAt: received && !Number.isNaN(Date.parse(received)) ? new Date(received).toISOString() : new Date().toISOString(),
    externalId: str(body.external_id, 200) || undefined,
  };
}

export async function POST(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  if (!token) return NextResponse.json({ ok: false, error: "Falta el token" }, { status: 401 });

  const body = await readBody(req);
  const ev = body ? toEvent(body) : null;
  if (!ev) return NextResponse.json({ ok: false, error: "Faltan channel o text" }, { status: 400 });

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // Primero el token: sin uno válido no se gasta el cupo de Gemini leyendo el aviso
  const { data: valid, error: tokenError } = await sb.rpc("ingest_token_valid", { p_token: token });
  if (!tokenError && valid === false) return NextResponse.json({ ok: false, error: "Token no válido" }, { status: 401 });

  const it = await interpret(ev);
  const { data, error } = await sb.rpc("ingest_event", { p_token: token, p_event: toDbEvent(ev, it) });

  if (error) {
    const unauthorized = /token no válido/i.test(error.message);
    return NextResponse.json({ ok: false, error: unauthorized ? "Token no válido" : "No se pudo registrar" }, { status: unauthorized ? 401 : 500 });
  }
  return NextResponse.json({ ok: true, ...(data as object) });
}

export function GET() {
  return NextResponse.json({ ok: true, info: "Envía un POST con Authorization: Bearer <token>. Guía en la app: Ajustes → Captura automática." });
}
