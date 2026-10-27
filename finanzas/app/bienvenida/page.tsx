import { redirect } from "next/navigation";
import { getSessionMember } from "@/lib/supabase/server";
import { Onboarding } from "./Onboarding";

export default async function BienvenidaPage() {
  const { user, member, needsMfa } = await getSessionMember();
  if (!user) redirect("/login");
  if (needsMfa) redirect("/verificar");
  if (member) redirect("/");
  return <Onboarding email={user.email ?? ""} />;
}
