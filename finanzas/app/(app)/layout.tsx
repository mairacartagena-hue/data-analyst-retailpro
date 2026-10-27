import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionMember } from "@/lib/supabase/server";
import { FinanceProvider } from "@/lib/data/FinanceProvider";
import { AppShell } from "@/components/AppShell";
import { AppLock } from "@/components/AppLock";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, member, needsMfa } = await getSessionMember();
  if (!user) redirect("/login");
  if (needsMfa) redirect("/verificar");
  if (!member) redirect("/bienvenida");
  // Con bloqueo con huella activado en este celular, la página llega tapada hasta que se ponga la huella
  const locked = (await cookies()).get("app-lock")?.value === "1";
  return (
    <FinanceProvider userId={user.id}>
      <AppLock initiallyLocked={locked}>
        <AppShell>{children}</AppShell>
      </AppLock>
    </FinanceProvider>
  );
}
