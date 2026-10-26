"use client";

import { useEffect } from "react";
import { setInstallPrompt, type BeforeInstallPromptEvent } from "@/lib/pwa";

const WARM_URLS = ["/", "/movimientos", "/presupuestos", "/informes", "/mas", "/cuentas", "/metas", "/cruce"];

/** Registra el service worker y captura el evento de instalación. */
export function PwaBootstrap() {
  useEffect(() => {
    const cleanups: (() => void)[] = [];
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
      // Guarda las pantallas principales para abrirlas sin conexión (una vez por sesión, con internet)
      const warm = () => {
        if (!navigator.onLine || location.pathname.startsWith("/login")) return;
        try {
          if (sessionStorage.getItem("sw-warm")) return;
          sessionStorage.setItem("sw-warm", "1");
        } catch {}
        navigator.serviceWorker.ready.then((reg) => reg.active?.postMessage({ type: "warm", urls: WARM_URLS })).catch(() => {});
      };
      const t = setTimeout(warm, 4000);
      cleanups.push(() => clearTimeout(t));
    }
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstallPrompt(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      cleanups.forEach((c) => c());
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  return null;
}
