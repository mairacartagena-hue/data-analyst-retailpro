import { NextResponse } from "next/server";
import webpush from "web-push";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

// Envía una notificación de prueba a los celulares de quien la pide.
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Necesitas iniciar sesión" }, { status: 401 });

  const { NEXT_PUBLIC_VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_KEY: priv, VAPID_SUBJECT: subject } = process.env;
  if (!pub || !priv || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Faltan las claves VAPID o la service role en el servidor" }, { status: 500 });
  }
  webpush.setVapidDetails(subject || "mailto:hola@amedias.app", pub, priv);

  const admin = createAdminClient();
  const { data: subs } = await admin.from("push_subscriptions").select("id, endpoint, keys").eq("user_id", user.id);

  let enviadas = 0;
  const codigos: number[] = [];
  const vencidas: string[] = [];
  await Promise.all(
    (subs ?? []).map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: s.keys },
          JSON.stringify({ title: "A Medias", body: "Así te van a llegar los avisos.", url: "/", tag: "prueba" }),
        );
        enviadas++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode ?? 0;
        codigos.push(status);
        if (status === 404 || status === 410) vencidas.push(s.id);
      }
    }),
  );
  if (vencidas.length) await admin.from("push_subscriptions").delete().in("id", vencidas);

  if (!enviadas) {
    const error = !subs?.length
      ? "No hay suscripciones activas en este celular. Actívalas de nuevo."
      : `El servicio de notificaciones rechazó el envío (código ${codigos[0] ?? "desconocido"}). Toca "Reactivar" y prueba otra vez.`;
    return NextResponse.json({ error }, { status: 404 });
  }
  return NextResponse.json({ enviadas });
}
