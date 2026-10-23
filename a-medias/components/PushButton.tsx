"use client";

import { useEffect, useState } from "react";
import { Bell, BellRing } from "lucide-react";
import { getSupabase } from "@/lib/supabase/client";
import { urlBase64ToUint8Array } from "@/lib/pwa";

type Estado = "cargando" | "no-soportado" | "bloqueado" | "inactivo" | "activo";

export function PushButton({ compact = false }: { compact?: boolean }) {
  const [estado, setEstado] = useState<Estado>("cargando");
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        setEstado("no-soportado");
        return;
      }
      if (Notification.permission === "denied") {
        setEstado("bloqueado");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      setEstado(sub && Notification.permission === "granted" ? "activo" : "inactivo");
    })();
  }, []);

  // Debe llamarse desde un toque (gesto del usuario)
  async function activar() {
    setOcupado(true);
    setMensaje(null);
    try {
      const permiso = await Notification.requestPermission();
      if (permiso !== "granted") {
        setEstado(permiso === "denied" ? "bloqueado" : "inactivo");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const clave = urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!);
      let sub = await reg.pushManager.getSubscription();
      // Una suscripción creada con otra clave VAPID no sirve: se reemplaza
      if (sub) {
        const actual = sub.options?.applicationServerKey ? new Uint8Array(sub.options.applicationServerKey) : null;
        const igual = !!actual && actual.length === clave.length && actual.every((b, i) => b === clave[i]);
        if (!igual) {
          await sub.unsubscribe();
          sub = null;
        }
      }
      sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: clave });
      const json = sub.toJSON();
      const sb = getSupabase();
      const {
        data: { user },
      } = await sb.auth.getUser();
      const { error } = await sb
        .from("push_subscriptions")
        .upsert({ user_id: user!.id, endpoint: json.endpoint, keys: json.keys }, { onConflict: "endpoint" });
      if (error) throw error;
      setEstado("activo");
    } catch (e) {
      setMensaje("No pudimos activar las notificaciones. Intenta de nuevo.");
      console.error(e);
    } finally {
      setOcupado(false);
    }
  }

  async function probar() {
    setOcupado(true);
    setMensaje(null);
    const res = await fetch("/api/push/test", { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setMensaje(res.ok ? `Listo, enviamos ${body.enviadas ?? 0} notificación(es) de prueba.` : body.error ?? "No se pudo enviar.");
    setOcupado(false);
  }

  if (estado === "cargando") return null;
  if (estado === "no-soportado")
    return <p className="text-sm text-sec">Este navegador no permite notificaciones. Instala la app y ábrela desde el ícono.</p>;
  if (estado === "bloqueado")
    return (
      <p className="text-sm text-sec">
        Las notificaciones están bloqueadas. Actívalas en Ajustes del celular &gt; Apps &gt; A Medias &gt; Notificaciones.
      </p>
    );

  if (estado === "activo") {
    if (compact) return null;
    return (
      <div className="space-y-2">
        <p className="flex items-center gap-2 text-sm">
          <BellRing size={18} /> Notificaciones activas en este celular.
        </p>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-secondary btn-sm" onClick={probar} disabled={ocupado}>
            Enviar una de prueba
          </button>
          <button className="btn btn-secondary btn-sm" onClick={activar} disabled={ocupado}>
            Reactivar
          </button>
        </div>
        {mensaje && <p className="text-sm text-sec">{mensaje}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <button className={`btn btn-primary ${compact ? "btn-sm" : "w-full"}`} onClick={activar} disabled={ocupado}>
        <Bell size={compact ? 16 : 18} /> Activar notificaciones
      </button>
      {mensaje && <p className="text-sm text-sec">{mensaje}</p>}
    </div>
  );
}
