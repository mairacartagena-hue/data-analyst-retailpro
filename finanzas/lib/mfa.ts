"use client";
// Verificación en dos pasos con una app autenticadora (TOTP de Supabase Auth, gratis).

import type { SupabaseClient } from "@supabase/supabase-js";

export interface TotpSetup {
  factorId: string;
  /** Código QR (imagen SVG) para escanear con la app autenticadora. */
  qr: string;
  /** La misma clave en texto, por si no se puede escanear. */
  secret: string;
}

/** Factor TOTP ya confirmado (null si la verificación no está activada). */
export async function activeTotp(sb: SupabaseClient): Promise<string | null> {
  const { data, error } = await sb.auth.mfa.listFactors();
  if (error) throw error;
  return data.totp[0]?.id ?? null;
}

/** Empieza la activación: devuelve el QR. Borra intentos anteriores sin terminar. */
export async function startTotp(sb: SupabaseClient): Promise<TotpSetup> {
  const { data: list } = await sb.auth.mfa.listFactors();
  for (const f of list?.all ?? []) {
    if (f.factor_type === "totp" && f.status !== "verified") await sb.auth.mfa.unenroll({ factorId: f.id });
  }
  const { data, error } = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: "Finanzas en Pareja", issuer: "Finanzas en Pareja" });
  if (error) throw error;
  return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}

/** Confirma la activación (o el inicio de sesión) con el código de 6 dígitos. */
export async function verifyTotp(sb: SupabaseClient, code: string, factorId?: string): Promise<void> {
  const id = factorId ?? (await activeTotp(sb));
  if (!id) throw new Error("No tienes la verificación en dos pasos activada.");
  const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: id, code: code.trim() });
  if (error) throw new Error("Ese código no funcionó. Revisa que la hora del celular esté bien y escribe el código que aparece ahora.");
}

/** Apaga la verificación (pide estar ya verificado). */
export async function stopTotp(sb: SupabaseClient, factorId: string): Promise<void> {
  const { error } = await sb.auth.mfa.unenroll({ factorId });
  if (error) throw error;
  await sb.auth.refreshSession();
}
