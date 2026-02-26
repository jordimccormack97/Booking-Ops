import { createClient } from "@supabase/supabase-js";
import { requireEnv } from "./env";

/**
 * Creates a Supabase admin client using the modern secret key (non-JWT).
 */
export function createSupabaseAdminClient() {
  const url = requireEnv("SUPABASE_URL");
  const secretKey = requireEnv("SUPABASE_SECRET_KEY");

  return createClient(url, secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
