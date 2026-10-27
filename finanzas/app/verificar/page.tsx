import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Logo } from "@/components/Logo";
import { VerifyForm } from "./VerifyForm";

// Segundo paso del inicio de sesión: el código de 6 dígitos de la app autenticadora.
export default async function VerificarPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (!(aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2")) redirect("/");
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <Logo size={56} />
      <h1 className="mt-5 font-display text-4xl leading-tight">Verificación en dos pasos</h1>
      <p className="mt-2 text-[15px] text-muted">Abre tu app autenticadora (Google Authenticator u otra) y escribe el código de 6 dígitos de Finanzas en Pareja.</p>
      <VerifyForm email={user.email ?? ""} />
    </main>
  );
}
