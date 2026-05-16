import { createClient } from '@supabase/supabase-js';

// Nur in API-Routes verwenden — niemals im Client-Code importieren
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
