import { redirect } from "next/navigation";
import { getSessionMember } from "@/lib/supabase/server";
import { HouseholdProvider } from "@/components/HouseholdProvider";
import { BottomNav } from "@/components/BottomNav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, member } = await getSessionMember();
  if (!user) redirect("/login");
  if (!member) redirect("/bienvenida");

  return (
    <HouseholdProvider householdId={member.household_id} memberId={member.id}>
      <main className="mx-auto min-h-dvh max-w-md px-4 pb-[calc(env(safe-area-inset-bottom)+110px)]">{children}</main>
      <BottomNav />
    </HouseholdProvider>
  );
}
