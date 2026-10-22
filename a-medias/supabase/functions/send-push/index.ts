// Edge Function: send-push
// La llama pg_cron cada 5 minutos. Envía las notificaciones que tocan
// (tareas a su hora, tomas de medicamentos, recordatorios y vacunas) y
// borra las suscripciones que respondan 404/410.
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("PUSH_CRON_SECRET")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:hola@amedias.app";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

type Due = { key: string; user_id: string; title: string; body: string; url: string };
type Sub = { id: string; user_id: string; endpoint: string; keys: { p256dh: string; auth: string } };

Deno.serve(async (req) => {
  if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return new Response("No autorizado", { status: 401 });
  }

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: due, error } = await db.rpc("due_notifications");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const pendientes = (due ?? []) as Due[];
  if (pendientes.length === 0) return Response.json({ enviadas: 0 });

  // Reclamar cada aviso en push_log; solo se envía lo que se insertó ahora
  // (si dos ejecuciones se cruzan, no se duplica).
  const { data: reclamados, error: errLog } = await db
    .from("push_log")
    .upsert(pendientes.map((d) => ({ key: d.key })), { onConflict: "key", ignoreDuplicates: true })
    .select("key");
  if (errLog) return Response.json({ error: errLog.message }, { status: 500 });
  const claves = new Set((reclamados ?? []).map((r: { key: string }) => r.key));
  const aEnviar = pendientes.filter((d) => claves.has(d.key));
  if (aEnviar.length === 0) return Response.json({ enviadas: 0 });

  const userIds = [...new Set(aEnviar.map((d) => d.user_id))];
  const { data: subs } = await db
    .from("push_subscriptions")
    .select("id, user_id, endpoint, keys")
    .in("user_id", userIds);

  const porUsuario = new Map<string, Sub[]>();
  for (const s of (subs ?? []) as Sub[]) {
    porUsuario.set(s.user_id, [...(porUsuario.get(s.user_id) ?? []), s]);
  }

  let enviadas = 0;
  const vencidas: string[] = [];
  await Promise.all(
    aEnviar.flatMap((d) =>
      (porUsuario.get(d.user_id) ?? []).map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: s.keys },
            JSON.stringify({ title: d.title, body: d.body, url: d.url, tag: d.key }),
            { TTL: 60 * 60 },
          );
          enviadas++;
        } catch (e) {
          const status = (e as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) vencidas.push(s.id);
          else console.error("push falló", status, (e as Error).message);
        }
      }),
    ),
  );

  if (vencidas.length) await db.from("push_subscriptions").delete().in("id", vencidas);

  return Response.json({ enviadas, eliminadas: vencidas.length });
});
