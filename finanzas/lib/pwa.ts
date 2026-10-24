"use client";
// Guarda el evento beforeinstallprompt para usarlo cuando la persona toque "Instalar app".

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

export function setInstallPrompt(e: BeforeInstallPromptEvent | null) {
  deferred = e;
  listeners.forEach((l) => l());
}

export function getInstallPrompt() {
  return deferred;
}

export function subscribeInstallPrompt(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function isStandalone() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
