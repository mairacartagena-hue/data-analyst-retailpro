import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { Channel, RawEvent } from "@/lib/ingest/types";
import { interpret, toDbEvent } from "@/lib/ingest/pipeline";

// Primer barrido del celular: SMS (de una copia de seguridad) o notificaciones pegadas, uno por solicitud.
// Pasa por las mismas reglas y Gemini que el webhook, pero con la sesión de la app en vez del token.
export const runtime = "nodejs";

const CHANNELS: Channel[] = ["ANDROID_SMS", "ANDROID_NOTIFICATION"];

export async function POST(req: NextRequest) {
  const sb = await createClient();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.json({ ok: false, error: "Inicia sesión" }, { status: 401 });

  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const channel = String(b?.channel ?? "") as Channel;
  const text = typeof b?.text === "string" ? b.text.trim().slice(0, 4000) : "";
  const externalId = typeof b?.external_id === "string" ? b.external_id.slice(0, 200) : "";
  const received = typeof b?.received_at === "string" ? b.received_at : "";
  if (!CHANNELS.includes(channel) || !text || !externalId || Number.isNaN(Date.parse(received))) {
    return NextResponse.json({ ok: false, error: "Aviso incompleto" }, { status: 400 });
  }

  const ev: RawEvent = {
    channel,
    source: typeof b?.source === "string" ? b.source.slice(0, 200) : "",
    text,
    receivedAt: new Date(received).toISOString(),
    externalId,
  };
  const it = await interpret(ev);
  const { data, error } = await sb.rpc("ingest_import_event", { p_event: toDbEvent(ev, it) });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, ...(data as object) });
}
