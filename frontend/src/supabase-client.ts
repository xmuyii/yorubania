import { createClient } from "@supabase/supabase-js";

// Uses the ANON key — safe to ship in a browser bundle. Never put the
// service-role key here; that stays server-side only (see backend/README.md).
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);
