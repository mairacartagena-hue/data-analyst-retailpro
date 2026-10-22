import { redirect } from "next/navigation";
import { getSessionMember } from "@/lib/supabase/server";
import { JoinForm } from "./JoinForm";

export default async function UnirsePage({ params }: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await params;
  const code = decodeURIComponent(codigo).toUpperCase();
  const { user, member } = await getSessionMember();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/unirse/${code}`)}`);
  return <JoinForm codigo={code} email={user.email ?? ""} yaTieneHogar={!!member} />;
}
