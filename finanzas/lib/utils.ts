import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Mensaje legible de un error de Supabase o JS. */
export function errMsg(e: unknown): string {
  if (!e) return "Algo salió mal.";
  if (typeof e === "string") return e;
  const m = (e as { message?: string }).message ?? "";
  if (/Failed to fetch|NetworkError/i.test(m)) return "Sin conexión. Revisa tu internet e intenta de nuevo.";
  if (/Invalid login credentials/i.test(m)) return "Correo o contraseña incorrectos.";
  if (/User already registered/i.test(m)) return "Ese correo ya tiene cuenta. Entra con tu contraseña.";
  if (/Email not confirmed/i.test(m)) return "Confirma tu correo con el enlace que te llegó y vuelve a intentar.";
  return m || "Algo salió mal.";
}
