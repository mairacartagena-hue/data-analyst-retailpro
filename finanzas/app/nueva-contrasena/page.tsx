import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Logo } from "@/components/Logo";
import { NewPasswordForm } from "./NewPasswordForm";

// Después del enlace de "Olvidé mi contraseña": la persona ya tiene sesión y elige una contraseña nueva.
export default async function NuevaContrasenaPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2") redirect("/verificar?next=/nueva-contrasena");
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <Logo size={56} />
      <h1 className="mt-5 font-display text-4xl leading-tight">Contraseña nueva</h1>
      <p className="mt-2 text-[15px] text-muted">Elige la contraseña con la que vas a entrar desde ahora ({user.email}).</p>
      <NewPasswordForm />
    </main>
  );
}
