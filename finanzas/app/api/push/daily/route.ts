import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { combine, pushConfigured, sendPush, type PushMessage, type PushTarget } from "@/lib/push/server";
import { todayBogota } from "@/lib/finance/periods";

// Vercel Cron la llama una vez al día (8 a. m. de Bogotá): pide a la base lo que toca enviar hoy y lo envía.
// La base exige su propia clave (PUSH_CRON_SECRET), así que el servidor no necesita claves secretas de Supabase.

export const runtime = "nodejs";

interface Due {
  user_id: string;
  messages: PushMessage[];
  subscriptions: PushTarget[] | null;
}

export async function GET(request: NextRequest) {
  const cron = process.env.CRON_SECRET;
  if (cron && request.headers.get("authorization") !== `Bearer ${cron}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const secret = process.env.PUSH_CRON_SECRET;
  if (!secret || !pushConfigured()) return NextResponse.json({ ok: false, reason: "Faltan las variables de las notificaciones" }, { status: 503 });

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { data, error } = await sb.rpc("push_due", { p_secret: secret, p_today: todayBogota() });
  if (error) return NextResponse.json({ ok: false, reason: error.message }, { status: 500 });

  let sent = 0;
  let failed = 0;
  const gone: string[] = [];
  for (const u of (data ?? []) as Due[]) {
    if (!u.messages?.length) continue;
    const msg = { ...combine(u.messages), tag: `diario-${todayBogota()}` };
    for (const s of u.subscriptions ?? []) {
      const r = await sendPush(s, msg);
      if (r === "ok") sent++;
      else if (r === "gone") gone.push(s.endpoint);
      else failed++;
    }
  }
  if (gone.length) await sb.rpc("push_gone", { p_secret: secret, p_endpoints: gone });
  return NextResponse.json({ ok: true, sent, failed, removed: gone.length });
}
