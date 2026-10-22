import { redirect } from "next/navigation";
import { getSessionMember } from "@/lib/supabase/server";
import { Onboarding } from "./Onboarding";

export default async function BienvenidaPage() {
  const { user, member } = await getSessionMember();
  if (!user) redirect("/login");
  if (member) redirect("/");
  return <Onboarding email={user.email ?? ""} />;
}
