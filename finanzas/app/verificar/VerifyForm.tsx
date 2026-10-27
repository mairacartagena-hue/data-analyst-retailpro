"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase/client";
import { clearOffline } from "@/lib/offline/store";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorText, Input } from "@/components/ui/input";
import { verifyTotp } from "@/lib/mfa";

export function VerifyForm({ email }: { email: string }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await verifyTotp(getSupabase(), code);
      router.replace("/");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  async function logout() {
    await clearOffline();
    await getSupabase().auth.signOut();
    router.replace("/login");
  }

  return (
    <Card className="mt-6 space-y-4">
      <form onSubmit={submit} className="space-y-3">
        <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="123456" value={code} autoFocus
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} className="text-center text-2xl tracking-[0.4em]" aria-label="Código de 6 dígitos" />
        <ErrorText>{error}</ErrorText>
        <Button type="submit" className="w-full" disabled={busy || code.length !== 6}>{busy ? "Verificando…" : "Entrar"}</Button>
      </form>
      <p className="text-xs text-muted">Entraste como {email}. Si perdiste el celular con la app autenticadora, pide que te quiten la verificación desde Supabase.</p>
      <button type="button" onClick={logout} className="text-sm font-semibold text-olive">Usar otra cuenta</button>
    </Card>
  );
}
