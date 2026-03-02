
-- Create TOTP 2FA secrets table
CREATE TABLE public.user_totp (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  totp_secret text NOT NULL,
  is_enabled boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.user_totp ENABLE ROW LEVEL SECURITY;

-- Users can only view their own TOTP config
CREATE POLICY "Users can view own totp"
ON public.user_totp FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- No client-side insert/update/delete - all managed via edge functions with service role
-- Admins can view for support purposes
CREATE POLICY "Admins can view all totp"
ON public.user_totp FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Trigger for updated_at
CREATE TRIGGER update_user_totp_updated_at
BEFORE UPDATE ON public.user_totp
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at();
