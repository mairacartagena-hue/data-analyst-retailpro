import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Llamado desde un Server Component: el proxy refresca la sesión.
          }
        },
      },
    },
  );
}

/** Usuario actual y su membresía en el hogar (o null si aún no tiene hogar). */
export async function getSessionMember() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, member: null, needsMfa: false };
  // Verificación en dos pasos activada y aún sin el código: la base no deja ver nada hasta escribirlo
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2") return { supabase, user, member: null, needsMfa: true };
  const { data: member } = await supabase
    .from("household_members")
    .select("id, household_id, display_name, slot")
    .eq("user_id", user.id)
    .maybeSingle();
  return { supabase, user, member, needsMfa: false };
}
