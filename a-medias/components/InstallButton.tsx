"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { getInstallPrompt, isStandalone, setInstallPrompt, subscribeInstallPrompt } from "@/lib/pwa";

export function InstallButton({ className = "" }: { className?: string }) {
  const [disponible, setDisponible] = useState(false);
  const [instalada, setInstalada] = useState(false);

  useEffect(() => {
    setInstalada(isStandalone());
    const update = () => setDisponible(!!getInstallPrompt());
    update();
    return subscribeInstallPrompt(update);
  }, []);

  if (instalada) return <p className="text-sm text-sec">La app ya está instalada en este celular.</p>;

  if (!disponible)
    return (
      <p className="text-sm text-sec">
        Para instalarla, abre el menú de Chrome (tres puntos) y toca &quot;Instalar app&quot; o &quot;Agregar a la
        pantalla principal&quot;.
      </p>
    );

  return (
    <button
      className={`btn btn-primary ${className}`}
      onClick={async () => {
        const e = getInstallPrompt();
        if (!e) return;
        await e.prompt();
        await e.userChoice;
        setInstallPrompt(null);
      }}
    >
      <Download size={18} /> Instalar app
    </button>
  );
}
