// Remitentes de correo que nunca traen movimientos (marketing, empleo, extractos en PDF, desarrollo).
// Se descartan sin llamar a Gemini. Se compara por la dirección de correo, no por el nombre que se muestra.
// Para agregar uno: suma su dirección en minúsculas. Si un remitente mezcla avisos útiles con publicidad
// (ej. mep-autorizador-col.group@bbva.com), NO va aquí: se maneja por texto en detectIgnore().

export const NO_MOVEMENT_SENDERS: ReadonlySet<string> = new Set([
  "jobalerts-noreply@linkedin.com", // alertas de empleo
  "notifications@github.com", // comentarios de GitHub y Vercel
  "comunidad.rumbo@lumni.net", // Fundación Bancolombia · Lumni
  "beneficios@notificaciones.davivienda.com", // beneficios DaviPlata
  "informacion@solicitudesgrupobancolombia.com.co", // información de Bancolombia
  "info@email.bbva.com.co", // correos de marketing de BBVA
  "extractos@extractos.bbva.com.co", // aviso del extracto en PDF
  "extractosbancolombia@extractos.documentosbancolombia.com", // aviso del extracto en PDF
]);

/** Dirección de correo dentro de un remitente como `"Nombre" <correo@dominio.com>`; null si no hay. */
export function senderEmail(source: string): string | null {
  const m = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/.exec(source);
  return m ? m[0].toLowerCase() : null;
}

export function isNoMovementSender(source: string): boolean {
  const email = senderEmail(source);
  return !!email && NO_MOVEMENT_SENDERS.has(email);
}
