"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorText, Field } from "@/components/ui/input";
import { PasswordInput } from "@/components/PasswordInput";
import { errMsg } from "@/lib/utils";

export function NewPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError("La contraseña debe tener mínimo 8 caracteres.");
    if (password !== confirm) return setError("Las dos contraseñas no coinciden.");
    setBusy(true);
    const { error } = await getSupabase().auth.updateUser({ password });
    setBusy(false);
    if (error) return setError(errMsg(error));
    setDone(true);
  }

  if (done) {
    return (
      <Card className="mt-6 space-y-4">
        <p className="rounded-xl bg-olive-soft px-3 py-2 text-[15px]">Listo: tu contraseña quedó cambiada.</p>
        <Button className="w-full" onClick={() => { router.replace("/"); router.refresh(); }}>Entrar a la app</Button>
      </Card>
    );
  }

  return (
    <Card className="mt-6">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Contraseña nueva" htmlFor="new-password">
          <PasswordInput id="new-password" required minLength={8} autoComplete="new-password" value={password}
            onChange={(e) => setPassword(e.target.value)} placeholder="Mínimo 8 caracteres" />
        </Field>
        <Field label="Repítela" htmlFor="confirm-password">
          <PasswordInput id="confirm-password" required minLength={8} autoComplete="new-password" value={confirm}
            onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        <ErrorText>{error}</ErrorText>
        <Button type="submit" className="w-full" disabled={busy}>{busy ? "Guardando..." : "Guardar contraseña"}</Button>
      </form>
    </Card>
  );
}
