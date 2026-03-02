-- Add SELECT policy so users can only read their own TOTP records
CREATE POLICY "Users can view own totp"
  ON public.user_totp
  FOR SELECT
  USING (auth.uid() = user_id);