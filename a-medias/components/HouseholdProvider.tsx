"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase/client";
import { addDays, todayStr } from "@/lib/dates";
import type {
  Dismissal,
  Household,
  Member,
  Note,
  Occurrence,
  PantryProduct,
  Pet,
  PetEvent,
  Reminder,
  ShoppingItem,
  ShoppingList,
  Task,
} from "@/lib/types";

// Tablas que se cargan y se escuchan en tiempo real
const TABLAS = {
  members: "members",
  tasks: "tasks",
  occurrences: "task_occurrences",
  lists: "shopping_lists",
  items: "shopping_items",
  pantry: "pantry_products",
  reminders: "reminders",
  pets: "pets",
  petEvents: "pet_events",
  notes: "notes",
  dismissals: "suggestion_dismissals",
} as const;

type Clave = keyof typeof TABLAS;

export interface HouseholdData {
  household: Household | null;
  members: Member[];
  tasks: Task[];
  occurrences: Occurrence[];
  lists: ShoppingList[];
  items: ShoppingItem[];
  pantry: PantryProduct[];
  reminders: Reminder[];
  pets: Pet[];
  petEvents: PetEvent[];
  notes: Note[];
  dismissals: Dismissal[];
}

type Row = { id: string } & Record<string, unknown>;

type Action =
  | { type: "load"; data: HouseholdData }
  | { type: "upsert"; key: Clave; row: Row }
  | { type: "remove"; key: Clave; id: string }
  | { type: "household"; row: Household };

const vacio: HouseholdData = {
  household: null,
  members: [],
  tasks: [],
  occurrences: [],
  lists: [],
  items: [],
  pantry: [],
  reminders: [],
  pets: [],
  petEvents: [],
  notes: [],
  dismissals: [],
};

function reducer(state: HouseholdData, action: Action): HouseholdData {
  switch (action.type) {
    case "load":
      return action.data;
    case "household":
      return { ...state, household: action.row };
    case "upsert": {
      const lista = state[action.key] as unknown as Row[];
      const i = lista.findIndex((r) => r.id === action.row.id);
      const nueva = i >= 0 ? lista.map((r, j) => (j === i ? { ...r, ...action.row } : r)) : [...lista, action.row];
      return { ...state, [action.key]: nueva };
    }
    case "remove": {
      const lista = state[action.key] as unknown as Row[];
      return { ...state, [action.key]: lista.filter((r) => r.id !== action.id) };
    }
  }
}

interface Ctx extends HouseholdData {
  ready: boolean;
  me: Member | null;
  other: Member | null;
  memberById: (id: string | null | undefined) => Member | undefined;
  /** Actualiza el estado local antes de que llegue el evento de Realtime */
  optimistic: <T extends { id: string }>(key: Clave, row: T) => void;
  optimisticRemove: (key: Clave, id: string) => void;
  reload: () => Promise<void>;
}

const HouseholdContext = createContext<Ctx | null>(null);

export function useHousehold() {
  const ctx = useContext(HouseholdContext);
  if (!ctx) throw new Error("useHousehold fuera de HouseholdProvider");
  return ctx;
}

export function HouseholdProvider({
  householdId,
  memberId,
  children,
}: {
  householdId: string;
  memberId: string;
  children: React.ReactNode;
}) {
  const [state, dispatch] = useReducer(reducer, vacio);
  const [ready, setReady] = useState(false);
  const cargando = useRef(false);

  const reload = useCallback(async () => {
    if (cargando.current) return;
    cargando.current = true;
    const sb = getSupabase();
    const desde = addDays(todayStr(), -21);
    try {
      const porHogar = <T,>(tabla: string) => sb.from(tabla).select("*").eq("household_id", householdId).returns<T[]>();
      const [hh, members, tasks, occRecientes, lists, items, pantry, reminders, pets, petEvents, notes, dismissals] =
        await Promise.all([
          sb.from("households").select("*").eq("id", householdId).maybeSingle<Household>(),
          porHogar<Member>("members"),
          porHogar<Task>("tasks"),
          sb
            .from("task_occurrences")
            .select("*")
            .eq("household_id", householdId)
            .gte("fecha", desde)
            .order("fecha")
            .limit(5000)
            .returns<Occurrence[]>(),
          porHogar<ShoppingList>("shopping_lists"),
          porHogar<ShoppingItem>("shopping_items"),
          porHogar<PantryProduct>("pantry_products"),
          porHogar<Reminder>("reminders"),
          porHogar<Pet>("pets"),
          porHogar<PetEvent>("pet_events"),
          porHogar<Note>("notes"),
          porHogar<Dismissal>("suggestion_dismissals"),
        ]);

      // Todas las tomas de medicamentos (para progreso e historial completos)
      const medIds = (tasks.data ?? []).filter((t) => t.tipo === "medicamento").map((t) => t.id);
      let occMeds: Occurrence[] = [];
      if (medIds.length) {
        const { data } = await sb
          .from("task_occurrences")
          .select("*")
          .in("task_id", medIds)
          .lt("fecha", desde)
          .limit(5000)
          .returns<Occurrence[]>();
        occMeds = data ?? [];
      }

      dispatch({
        type: "load",
        data: {
          household: hh.data ?? null,
          members: members.data ?? [],
          tasks: tasks.data ?? [],
          occurrences: [...occMeds, ...(occRecientes.data ?? [])],
          lists: lists.data ?? [],
          items: items.data ?? [],
          pantry: pantry.data ?? [],
          reminders: reminders.data ?? [],
          pets: pets.data ?? [],
          petEvents: petEvents.data ?? [],
          notes: notes.data ?? [],
          dismissals: dismissals.data ?? [],
        },
      });
      setReady(true);
    } finally {
      cargando.current = false;
    }
  }, [householdId]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Realtime: cada cambio en la base llega aquí y actualiza la pantalla
  useEffect(() => {
    const sb = getSupabase();
    let primeraVez = true;
    const canal = sb.channel(`hogar-${householdId}`);

    canal.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "households", filter: `id=eq.${householdId}` },
      (p: RealtimePostgresChangesPayload<Household>) => {
        if (p.eventType === "DELETE") window.location.href = "/bienvenida";
        else dispatch({ type: "household", row: p.new as Household });
      },
    );

    (Object.keys(TABLAS) as Clave[]).forEach((key) => {
      canal.on(
        "postgres_changes",
        { event: "*", schema: "public", table: TABLAS[key], filter: `household_id=eq.${householdId}` },
        (p: RealtimePostgresChangesPayload<Row>) => {
          if (p.eventType === "DELETE") {
            const id = (p.old as Partial<Row>).id;
            if (id) dispatch({ type: "remove", key, id });
            if (key === "members" && id === memberId) window.location.href = "/bienvenida";
          } else {
            dispatch({ type: "upsert", key, row: p.new as Row });
          }
        },
      );
    });

    canal.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        // Al reconectar se recarga todo por si algo cambió mientras tanto
        if (!primeraVez) reload();
        primeraVez = false;
      }
    });

    // Al volver a la app (celular en segundo plano), refrescar
    const alVolver = () => {
      if (document.visibilityState === "visible") reload();
    };
    document.addEventListener("visibilitychange", alVolver);

    return () => {
      document.removeEventListener("visibilitychange", alVolver);
      sb.removeChannel(canal);
    };
  }, [householdId, memberId, reload]);

  const value = useMemo<Ctx>(() => {
    const me = state.members.find((m) => m.id === memberId) ?? null;
    const other = state.members.find((m) => m.id !== memberId) ?? null;
    return {
      ...state,
      members: [...state.members].sort((a, b) => a.created_at.localeCompare(b.created_at)),
      ready,
      me,
      other,
      memberById: (id) => (id ? state.members.find((m) => m.id === id) : undefined),
      optimistic: (key, row) => dispatch({ type: "upsert", key, row: row as Row }),
      optimisticRemove: (key, id) => dispatch({ type: "remove", key, id }),
      reload,
    };
  }, [state, ready, memberId, reload]);

  return <HouseholdContext.Provider value={value}>{children}</HouseholdContext.Provider>;
}
