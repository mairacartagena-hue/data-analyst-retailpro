import "server-only";
import { createClient } from "@supabase/supabase-js";

/** Cliente con service role. SOLO en el servidor. */
export function createAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
