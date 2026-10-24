import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { Channel, RawEvent } from "@/lib/ingest/types";
import { interpret, toDbEvent } from "@/lib/ingest/pipeline";

// Botón "Reintentar" de Captura automática: vuelve a leer un aviso guardado con las reglas actuales y Gemini.
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const sb = await createClient();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.json({ ok: false, error: "Inicia sesión" }, { status: 401 });

  const { log_id } = (await req.json().catch(() => ({}))) as { log_id?: string };
  if (!log_id) return NextResponse.json({ ok: false, error: "Falta el aviso" }, { status: 400 });

  // La RLS solo deja leer los avisos propios
  const { data: log, error } = await sb.from("ingest_logs").select("id, channel, source, raw_text, received_at").eq("id", log_id).maybeSingle();
  if (error || !log) return NextResponse.json({ ok: false, error: "Ese aviso no existe" }, { status: 404 });
  if (!log.raw_text) return NextResponse.json({ ok: false, error: "El texto original ya se borró (pasaron más de 30 días)" }, { status: 410 });

  const ev: RawEvent = {
    channel: log.channel as Channel,
    source: log.source ?? "",
    text: log.raw_text,
    receivedAt: log.received_at,
  };
  const it = await interpret(ev);
  const { data, error: rpcError } = await sb.rpc("reingest_log", { p_log_id: log_id, p_event: toDbEvent(ev, it) });
  if (rpcError) return NextResponse.json({ ok: false, error: rpcError.message }, { status: 400 });
  return NextResponse.json({ ok: true, parser: it.parser, reason: it.reason ?? null, ...(data as object) });
}
