"use client";
// Activar y desactivar las notificaciones en este celular.

import type { SupabaseClient } from "@supabase/supabase-js";

export type PushState = "unsupported" | "needs-install" | "denied" | "off" | "on";

export const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function standalone(): boolean {
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

function keyBytes(base64: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

export async function pushState(): Promise<PushState> {
  if (typeof window === "undefined" || !("Notification" in window) || !("serviceWorker" in navigator)) {
    return isIos() && !standalone() ? "needs-install" : "unsupported";
  }
  if (!("PushManager" in window)) return isIos() && !standalone() ? "needs-install" : "unsupported";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission !== "granted") return "off";
  return (await currentSubscription()) ? "on" : "off";
}

export async function enablePush(sb: SupabaseClient): Promise<void> {
  if (!VAPID_PUBLIC_KEY) throw new Error("Las notificaciones aún no están configuradas.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Sin permiso no se pueden enviar notificaciones. Actívalo en los ajustes del navegador.");
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) });
  const json = sub.toJSON();
  const { error } = await sb.rpc("save_push_subscription", {
    p: { endpoint: json.endpoint, p256dh: json.keys?.p256dh, auth: json.keys?.auth, user_agent: navigator.userAgent },
  });
  if (error) throw error;
  try { localStorage.removeItem(SYNC_KEY); } catch {}
}

export async function disablePush(sb: SupabaseClient): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await sb.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
  await sub.unsubscribe();
}

/** Huella de la última lista de recordatorios enviada a la base (para no reenviarla en cada carga). */
export const SYNC_KEY = "push-sync";
