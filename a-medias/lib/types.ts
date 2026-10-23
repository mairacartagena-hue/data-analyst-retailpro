export type Color = "rosa" | "bordo";
export type Frecuencia = "diaria" | "semanal" | "quincenal" | "mensual";
export type Modo = "fija" | "rota" | "juntos";
export type Categoria = "Abarrotes" | "Frutas y verduras" | "Carnes" | "Lácteos" | "Aseo" | "Otros";
export const CATEGORIAS: Categoria[] = ["Abarrotes", "Frutas y verduras", "Carnes", "Lácteos", "Aseo", "Otros"];
export type NombreLista = "Mercado" | "Droguería" | "Para la casa";
export const LISTAS: NombreLista[] = ["Mercado", "Droguería", "Para la casa"];

export interface Household {
  id: string;
  nombre: string;
  codigo_invitacion: string;
  created_at: string;
}

export interface Member {
  id: string;
  household_id: string;
  user_id: string;
  nombre: string;
  color: Color;
  created_at: string;
}

export interface Task {
  id: string;
  household_id: string;
  titulo: string;
  tipo: "tarea" | "medicamento";
  pet_id: string | null;
  dosis: string | null;
  frecuencia: Frecuencia;
  dias_semana: number[];
  modo: Modo;
  responsable_fijo: string | null;
  orden_rotacion: string[];
  rotacion_ancla: string | null;
  rotacion_ancla_miembro: string | null;
  fecha_inicio: string;
  hora_recordatorio: string | null;
  horas_toma: string[];
  duracion_dias: number | null;
  fecha_fin: string | null;
  activa: boolean;
  created_at: string;
}

export interface Occurrence {
  id: string;
  task_id: string;
  household_id: string;
  fecha: string;
  hora: string;
  fecha_original: string | null;
  responsable_id: string | null;
  responsable_manual: boolean;
  completada: boolean;
  completada_por: string | null;
  completada_en: string | null;
}

export interface PetDocument {
  id: string;
  household_id: string;
  pet_id: string;
  titulo: string;
  fecha: string;
  tipo: "pdf" | "imagen";
  ruta: string;
  tamano: number;
  created_at: string;
}

export interface ShoppingList {
  id: string;
  household_id: string;
  nombre: NombreLista;
  quien_va: string | null;
  va_juntos?: boolean;
  tarea_id?: string | null;
  fecha: string | null;
}

export interface ShoppingItem {
  id: string;
  list_id: string;
  household_id: string;
  nombre: string;
  categoria: Categoria;
  cantidad: string | null;
  pedido_por: string | null;
  comprado: boolean;
  comprado_en: string | null;
  es_automatico: boolean;
  pantry_product_id: string | null;
  duracion_dias?: number | null;
  created_at: string;
}

export interface PantryProduct {
  id: string;
  household_id: string;
  nombre: string;
  categoria: Categoria;
  duracion_dias: number;
  fecha_ultima_compra: string;
}

export interface Reminder {
  id: string;
  household_id: string;
  titulo: string;
  fecha_hora: string;
  responsables: string[];
  repeticion: "ninguna" | "mensual" | "anual";
  aviso_previo_dias: number;
  nota: string | null;
}

export interface Pet {
  id: string;
  household_id: string;
  nombre: string;
  especie: "gato" | "perro";
  created_at: string;
}

export interface PetEvent {
  id: string;
  pet_id: string;
  household_id: string;
  tipo: "vacuna" | "control" | "otro";
  titulo: string;
  fecha: string;
  repeticion: "ninguna" | "anual";
  aviso_previo_dias: number;
  responsable_id: string | null;
  nota: string | null;
}

export interface Note {
  id: string;
  household_id: string;
  titulo: string;
  contenido: string;
  updated_at: string;
}

export interface Dismissal {
  id: string;
  household_id: string;
  occurrence_id: string;
  fecha_destino: string;
}
