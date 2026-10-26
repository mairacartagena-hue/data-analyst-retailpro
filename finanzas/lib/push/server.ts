import "server-only";
import webpush from "web-push";

// Envío de notificaciones Web Push con las claves VAPID del proyecto (variables de entorno en Vercel).

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushMessage {
  title: string;
  body?: string;
  url?: string;
  tag?: string;
}

let configured = false;

/** true si están las claves VAPID; si no, las notificaciones quedan apagadas. */
export function pushConfigured(): boolean {
  if (configured) return true;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:finanzas@example.com", pub, priv);
  configured = true;
  return true;
}

/** Varios recordatorios del mismo día se juntan en una sola notificación. */
export function combine(messages: PushMessage[]): PushMessage {
  if (messages.length === 1) return messages[0];
  return {
    title: `Tienes ${messages.length} recordatorios hoy`,
    body: messages.map((m) => `• ${m.title}`).join("\n").slice(0, 300),
    url: "/",
  };
}

/** Envía a un celular. Devuelve "gone" si el servicio dice que ya no existe (hay que borrarlo). */
export async function sendPush(target: PushTarget, msg: PushMessage): Promise<"ok" | "gone" | "error"> {
  try {
    await webpush.sendNotification(
      { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
      JSON.stringify({ title: msg.title, body: msg.body ?? "", url: msg.url ?? "/", tag: msg.tag }),
      { TTL: 60 * 60 * 12, urgency: "normal" },
    );
    return "ok";
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode;
    return status === 404 || status === 410 ? "gone" : "error";
  }
}
