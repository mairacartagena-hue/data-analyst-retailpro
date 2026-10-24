// Tipos del pipeline de ingesta. Todos los canales (notificaciones, SMS, Gmail) llegan como RawEvent.

export type Channel = "ANDROID_NOTIFICATION" | "ANDROID_SMS" | "GMAIL";

export interface RawEvent {
  channel: Channel;
  /** App (nombre o paquete) de la notificación, número que envía el SMS o remitente del correo. */
  source: string;
  title?: string;
  subject?: string;
  text: string;
  receivedAt: string; // ISO
  /** Id único del mensaje (Gmail) para no procesarlo dos veces. */
  externalId?: string;
}

export type MovementKind =
  | "PURCHASE" // compra
  | "TRANSFER_OUT" // transferencia enviada
  | "TRANSFER_IN" // transferencia recibida
  | "WITHDRAWAL" // retiro
  | "CARD_PAYMENT" // pago de tarjeta
  | "INCOME" // ingreso
  | "IGNORE"; // no es un movimiento (código, publicidad, rechazada…)

export type IdentifierType = "NIT" | "ACCOUNT" | "PHONE";

export interface ParsedEvent {
  kind: MovementKind;
  amount?: number; // pesos enteros
  merchant?: string | null; // nombre limpio para mostrar
  merchantNorm?: string | null; // versión normalizada para comparar
  last4?: string | null;
  institution?: string | null; // Nequi, Bancolombia…
  occurredAt?: string | null; // ISO
  identifiers?: { type: IdentifierType; value: string }[];
  /** Etiquetas automáticas (ej. #suscripcion). */
  tags?: string[];
  ignoreReason?: string;
}

/** Un parser por fuente (banco o app). Se registran en lib/ingest/registry.ts. */
export interface BankParser {
  id: string;
  institution: string;
  /** ¿Este evento viene de esta fuente? (app, remitente o número). */
  matches: (ev: RawEvent) => boolean;
  /** Extrae los datos o devuelve null si el formato no se reconoce. */
  parse: (ev: RawEvent) => ParsedEvent | null;
}
