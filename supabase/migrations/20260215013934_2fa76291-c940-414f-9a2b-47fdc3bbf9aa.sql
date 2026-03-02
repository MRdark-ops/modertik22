
-- Fix 1: Remove client-side SELECT on user_totp (TOTP secrets should NEVER be readable by client)
-- Edge functions use service role which bypasses RLS, so this is safe
DROP POLICY IF EXISTS "Users can view own totp" ON public.user_totp;

-- Fix 2: Allow users to INSERT their own TOTP record (needed for setup flow via edge functions,
-- but since edge functions use service role this is a defense-in-depth measure)
CREATE POLICY "Users can insert own totp"
  ON public.user_totp
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Fix 3: Allow users to UPDATE their own TOTP record (enable/disable)
CREATE POLICY "Users can update own totp"
  ON public.user_totp
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
