"use client";

import { useEffect, useState } from "react";
import { Fingerprint, ShieldCheck } from "lucide-react";
import { useFinance } from "@/lib/data/FinanceProvider";
import { Button } from "@/components/ui/button";
import { Card, SectionTitle } from "@/components/ui/card";
import { ErrorText, Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { RELOCK_MINUTES, disableLock, enableLock, lockCredential, lockSupported } from "@/lib/appLock";
import { activeTotp, startTotp, stopTotp, verifyTotp, type TotpSetup } from "@/lib/mfa";
import { errMsg } from "@/lib/utils";

/** Ajustes → Seguridad: bloqueo con huella (este celular) y verificación en dos pasos (la cuenta). */
export function SecuritySettings() {
  return (
    <>
      <SectionTitle>Seguridad</SectionTitle>
      <div className="space-y-3">
        <FingerprintCard />
        <TwoStepCard />
      </div>
    </>
  );
}

function FingerprintCard() {
  const { me } = useFinance();
  const [supported, setSupported] = useState<boolean | null>(null);
  const [on, setOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void lockSupported().then(setSupported);
    setOn(!!lockCredential(me.user_id));
  }, [me.user_id]);

  async function toggle(v: boolean) {
    setError(null);
    try {
      if (v) await enableLock(me.user_id, me.display_name);
      else disableLock(me.user_id);
      setOn(v);
    } catch (e) {
      setError((e as Error).name === "NotAllowedError" ? "Cancelaste el registro de la huella." : errMsg(e));
    }
  }

  return (
    <Card className="space-y-2">
      <div className="flex items-start gap-3">
        <Fingerprint size={20} className="mt-0.5 shrink-0 text-olive" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Bloquear con huella</p>
          <p className="text-xs text-muted">
            En este celular la app pide tu huella (o el bloqueo de pantalla) al abrirla y al volver después de {RELOCK_MINUTES} minutos.
          </p>
        </div>
        {supported && <Switch checked={on} onCheckedChange={toggle} aria-label="Bloquear con huella" />}
      </div>
      {supported === false && <p className="text-xs text-muted">Este celular o navegador no tiene huella disponible para apps web.</p>}
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}

function TwoStepCard() {
  const { supabase } = useFinance();
  const [factor, setFactor] = useState<string | null | undefined>(undefined);
  const [setup, setSetup] = useState<TotpSetup | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    activeTotp(supabase).then(setFactor).catch(() => setFactor(null));
  }, [supabase]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-3">
      <div className="flex items-start gap-3">
        <ShieldCheck size={20} className="mt-0.5 shrink-0 text-olive" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Verificación en dos pasos {factor ? <span className="ml-1 rounded-full bg-olive-soft px-2 py-0.5 text-xs">Activa</span> : null}</p>
          <p className="text-xs text-muted">
            Al iniciar sesión en un celular o computador nuevo, además de la contraseña se pide un código de una app autenticadora
            (Google Authenticator, Microsoft Authenticator…). Así, con tu contraseña sola nadie puede ver tus finanzas.
          </p>
        </div>
      </div>

      {factor === undefined ? null : factor ? (
        <Button size="sm" variant="outline" disabled={busy}
          onClick={() => confirm("¿Apagar la verificación en dos pasos? Quedará solo la contraseña.") && run(async () => { await stopTotp(supabase, factor); setFactor(null); setMsg("Verificación apagada."); })}>
          Apagar
        </Button>
      ) : setup ? (
        <div className="space-y-3">
          <p className="text-sm">1. En la app autenticadora toca <strong>+</strong> y escanea este código:</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={setup.qr} alt="Código QR para la app autenticadora" className="mx-auto h-48 w-48 rounded-2xl bg-white p-2" />
          <p className="break-all text-xs text-muted">¿No puedes escanearlo? Escribe esta clave: <span className="font-mono text-text">{setup.secret}</span></p>
          <p className="text-sm">2. Escribe el código de 6 dígitos que aparece:</p>
          <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="123456" value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} className="text-center text-xl tracking-[0.3em]" aria-label="Código de 6 dígitos" />
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => { setSetup(null); setCode(""); }} disabled={busy}>Cancelar</Button>
            <Button className="flex-1" disabled={busy || code.length !== 6}
              onClick={() => run(async () => { await verifyTotp(supabase, code, setup.factorId); setFactor(setup.factorId); setSetup(null); setCode(""); setMsg("Listo: la verificación en dos pasos quedó activa."); })}>
              Activar
            </Button>
          </div>
          <p className="text-xs text-muted">Guarda la clave en un lugar seguro: si pierdes el celular con la app autenticadora, la necesitarás para entrar.</p>
        </div>
      ) : (
        <Button size="sm" disabled={busy} onClick={() => run(async () => setSetup(await startTotp(supabase)))}>Activar</Button>
      )}
      {msg && <p className="text-xs text-olive">{msg}</p>}
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}
