import { redirect } from "next/navigation";
import { getSessionMember } from "@/lib/supabase/server";
import { FinanceProvider } from "@/lib/data/FinanceProvider";
import { AppShell } from "@/components/AppShell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, member } = await getSessionMember();
  if (!user) redirect("/login");
  if (!member) redirect("/bienvenida");
  return (
    <FinanceProvider userId={user.id}>
      <AppShell>{children}</AppShell>
    </FinanceProvider>
  );
}
