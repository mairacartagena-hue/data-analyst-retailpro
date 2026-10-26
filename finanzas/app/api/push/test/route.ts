import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { pushConfigured, sendPush } from "@/lib/push/server";

// Notificación de prueba a los celulares de la persona con sesión (Ajustes → Notificaciones → Probar).
export const runtime = "nodejs";

export async function POST() {
  if (!pushConfigured()) return NextResponse.json({ ok: false, reason: "Las notificaciones aún no están configuradas en el servidor." }, { status: 503 });
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, reason: "Necesitas iniciar sesión" }, { status: 401 });
  const { data, error } = await sb.from("push_subscriptions").select("endpoint, p256dh, auth").eq("user_id", user.id);
  if (error) return NextResponse.json({ ok: false, reason: error.message }, { status: 500 });
  let sent = 0;
  const gone: string[] = [];
  for (const s of data ?? []) {
    const r = await sendPush(s, { title: "¡Notificaciones activadas!", body: "Aquí te llegarán los vencimientos, cuotas y el cierre del mes.", url: "/ajustes", tag: "prueba" });
    if (r === "ok") sent++;
    if (r === "gone") gone.push(s.endpoint);
  }
  if (gone.length) await sb.from("push_subscriptions").delete().in("endpoint", gone);
  return NextResponse.json({ ok: sent > 0, sent, reason: sent ? undefined : "No hay celulares activos. Vuelve a activar las notificaciones." });
}
