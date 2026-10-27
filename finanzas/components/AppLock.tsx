"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Fingerprint } from "lucide-react";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { useFinance } from "@/lib/data/FinanceProvider";
import { clearOffline } from "@/lib/offline/store";
import { RELOCK_MINUTES, clearLockCookie, isUnlocked, lockCredential, relock, unlock } from "@/lib/appLock";

/** Cubre la app hasta que se pone la huella. `initiallyLocked` viene del servidor para no mostrar nada antes. */
export function AppLock({ initiallyLocked, children }: { initiallyLocked: boolean; children: React.ReactNode }) {
  const { me, supabase } = useFinance();
  const router = useRouter();
  const [locked, setLocked] = useState(initiallyLocked);
  const [failed, setFailed] = useState(false);
  const hiddenAt = useRef<number | null>(null);
  const asking = useRef(false);

  const ask = useCallback(async () => {
    if (asking.current) return;
    asking.current = true;
    setFailed(false);
    const ok = await unlock(me.user_id);
    asking.current = false;
    if (ok) setLocked(false);
    else setFailed(true);
  }, [me.user_id]);

  // Al abrir: si este celular tiene el bloqueo de esta persona y no se desbloqueó en esta sesión
  useEffect(() => {
    const has = !!lockCredential(me.user_id);
    if (!has) {
      if (initiallyLocked) clearLockCookie();
      setLocked(false);
      return;
    }
    if (isUnlocked()) setLocked(false);
    else {
      setLocked(true);
      void ask();
    }
  }, [me.user_id, initiallyLocked, ask]);

  // Volver a bloquear después de unos minutos en segundo plano
  useEffect(() => {
    const onVis = () => {
      if (!lockCredential(me.user_id)) return;
      if (document.visibilityState === "hidden") hiddenAt.current = Date.now();
      else if (hiddenAt.current && Date.now() - hiddenAt.current > RELOCK_MINUTES * 60_000) {
        relock();
        setLocked(true);
        void ask();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [me.user_id, ask]);

  async function logout() {
    clearLockCookie();
    await clearOffline();
    await supabase.auth.signOut();
    router.replace("/login");
  }

  if (!locked) return <>{children}</>;
  return (
    <main className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-6 bg-bg px-6 text-center">
      <Logo size={64} />
      <div>
        <h1 className="font-display text-3xl">Finanzas en Pareja</h1>
        <p className="mt-2 text-[15px] text-muted">Pon tu huella para entrar.</p>
      </div>
      <Button size="lg" onClick={ask}><Fingerprint size={22} /> Desbloquear</Button>
      {failed && <p className="text-sm text-muted">No se pudo leer la huella. Toca “Desbloquear” para intentar otra vez.</p>}
      <button type="button" onClick={logout} className="text-sm font-semibold text-olive">Cerrar sesión</button>
    </main>
  );
}
