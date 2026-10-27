"use client";
// Bloqueo con huella (o el bloqueo de pantalla del celular) usando WebAuthn, solo en este celular.
// Es un candado de la pantalla: quien tome el celular desbloqueado no ve las finanzas sin la huella.
// La sesión y la seguridad de los datos siguen en Supabase.

const KEY = (userId: string) => `app-lock:${userId}`;
const UNLOCKED = "app-unlocked";
/** Minutos en segundo plano antes de volver a pedir la huella. */
export const RELOCK_MINUTES = 2;

const b64u = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));

function setCookie(on: boolean) {
  document.cookie = on ? "app-lock=1; path=/; max-age=31536000; samesite=lax; secure" : "app-lock=; path=/; max-age=0";
}

export async function lockSupported(): Promise<boolean> {
  try {
    return typeof window !== "undefined" && !!window.PublicKeyCredential && (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
  } catch {
    return false;
  }
}

export function lockCredential(userId: string): string | null {
  try {
    return localStorage.getItem(KEY(userId));
  } catch {
    return null;
  }
}

/** Activa el bloqueo: el celular pide la huella una vez para registrarla. */
export async function enableLock(userId: string, email: string): Promise<void> {
  const cred = (await navigator.credentials.create({
    publicKey: {
      rp: { name: "Finanzas en Pareja", id: location.hostname },
      user: { id: random(16), name: email || "finanzas", displayName: email || "Finanzas en Pareja" },
      challenge: random(32),
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "discouraged" },
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("No se pudo registrar la huella.");
  localStorage.setItem(KEY(userId), b64u(cred.rawId));
  setCookie(true);
  markUnlocked();
}

export function disableLock(userId: string): void {
  try { localStorage.removeItem(KEY(userId)); } catch {}
  setCookie(false);
}

/** Pide la huella. true si la persona la puso bien. */
export async function unlock(userId: string): Promise<boolean> {
  const id = lockCredential(userId);
  if (!id) return true;
  try {
    const ok = await navigator.credentials.get({
      publicKey: { challenge: random(32), allowCredentials: [{ type: "public-key", id: fromB64u(id) }], userVerification: "required", timeout: 60_000 },
    });
    if (ok) markUnlocked();
    return !!ok;
  } catch {
    return false;
  }
}

export function markUnlocked(): void {
  try { sessionStorage.setItem(UNLOCKED, "1"); } catch {}
}

export function isUnlocked(): boolean {
  try { return sessionStorage.getItem(UNLOCKED) === "1"; } catch { return false; }
}

export function relock(): void {
  try { sessionStorage.removeItem(UNLOCKED); } catch {}
}

/** Al cerrar sesión: el bloqueo es de cada persona, se quita la marca del celular. */
export function clearLockCookie(): void {
  setCookie(false);
  relock();
}
