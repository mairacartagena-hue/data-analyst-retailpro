"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Home, KeyRound, LogOut } from "lucide-react";
import { getSupabase } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorText, Field, Input } from "@/components/ui/input";
import { errMsg } from "@/lib/utils";
import { clearOffline } from "@/lib/offline/store";

export function Onboarding({ email, initialCode = "" }: { email: string; initialCode?: string }) {
  const router = useRouter();
  const [name, setName] = useState(email.split("@")[0] ?? "");
  const [household, setHousehold] = useState("Nuestro hogar");
  const [code, setCode] = useState(initialCode);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => PromiseLike<{ error: unknown }>) {
    setBusy(true);
    setError(null);
    const { error } = await fn();
    setBusy(false);
    if (error) return setError(errMsg(error));
    router.replace("/");
    router.refresh();
  }

  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <h1 className="font-display text-5xl">Hola</h1>
      <p className="mt-2 text-[15px] text-muted">Crea el hogar o únete al de tu pareja con su código.</p>

      <div className="mt-6">
        <Field label="¿Cómo quieres que te vean en la app?" htmlFor="name">
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required />
        </Field>
      </div>

      {!initialCode && (
        <Card className="mt-6 space-y-3">
          <h2 className="flex items-center gap-2 font-display text-2xl"><Home size={22} /> Crear un hogar</h2>
          <Field label="Nombre del hogar" htmlFor="household">
            <Input id="household" value={household} onChange={(e) => setHousehold(e.target.value)} />
          </Field>
          <Button className="w-full" disabled={busy || !name.trim()}
            onClick={() => run(() => getSupabase().rpc("create_household", { p_household_name: household, p_display_name: name }))}>
            Crear hogar
          </Button>
        </Card>
      )}

      <Card className="mt-4 space-y-3">
        <h2 className="flex items-center gap-2 font-display text-2xl"><KeyRound size={22} /> Tengo un código</h2>
        <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={8}
          placeholder="ABCD2345" aria-label="Código de invitación" className="uppercase tracking-[0.25em]" />
        <Button variant={initialCode ? "primary" : "secondary"} className="w-full" disabled={busy || code.length !== 8 || !name.trim()}
          onClick={() => run(() => getSupabase().rpc("join_household", { p_code: code, p_display_name: name }))}>
          Unirme al hogar
        </Button>
      </Card>

      <ErrorText>{error}</ErrorText>

      <button className="mx-auto mt-8 flex items-center gap-2 text-sm text-muted"
        onClick={async () => { await clearOffline(); await getSupabase().auth.signOut(); router.replace("/login"); }}>
        <LogOut size={16} /> Salir
      </button>
    </main>
  );
}
