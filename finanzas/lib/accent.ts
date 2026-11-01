// Color principal de la app: sigue el color de las iniciales de la persona (Ajustes).
// Reemplaza el verde oliva de botones, filtros activos, barras y enlaces.

const KEY = "accent";
const HEX = /^#[0-9a-f]{6}$/i;

/** Texto sobre el color: claro sobre colores oscuros, oscuro sobre colores claros. */
export function onAccent(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  const l = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return l > 0.35 ? "#2e2922" : "#fbf8f1";
}

/** Aplica el color (o vuelve al verde si no hay uno válido). `remember` lo guarda para pintarlo al abrir. */
export function applyAccent(color: string | null | undefined, remember = true): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (!color || !HEX.test(color)) {
    root.removeAttribute("data-accent");
    root.style.removeProperty("--accent");
    root.style.removeProperty("--on-accent");
    if (remember) try { localStorage.removeItem(KEY); } catch {}
    return;
  }
  root.setAttribute("data-accent", "");
  root.style.setProperty("--accent", color);
  root.style.setProperty("--on-accent", onAccent(color));
  if (remember) try { localStorage.setItem(KEY, color); } catch {}
}

/** Script para el <head>: pone el último color antes de pintar, sin parpadeo. */
export const accentScript = `(function(){try{var c=localStorage.getItem('${KEY}');if(c&&/^#[0-9a-f]{6}$/i.test(c)){var r=document.documentElement;r.setAttribute('data-accent','');r.style.setProperty('--accent',c);var n=parseInt(c.slice(1),16),f=function(v){v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)},l=0.2126*f(n>>16&255)+0.7152*f(n>>8&255)+0.0722*f(n&255);r.style.setProperty('--on-accent',l>0.35?'#2e2922':'#fbf8f1');}}catch(e){}})();`;
