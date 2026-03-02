
-- Create site visits table for tracking
CREATE TABLE public.site_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_id text NOT NULL,
  user_id uuid,
  page text NOT NULL DEFAULT '/',
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.site_visits ENABLE ROW LEVEL SECURITY;

-- Admins can view all visits
CREATE POLICY "Admins can view all visits"
ON public.site_visits
FOR SELECT
USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Anyone can insert visits (for anonymous tracking)
CREATE POLICY "Anyone can insert visits"
ON public.site_visits
FOR INSERT
WITH CHECK (true);

-- Create index for performance
CREATE INDEX idx_site_visits_created_at ON public.site_visits(created_at);
CREATE INDEX idx_site_visits_user_id ON public.site_visits(user_id);

-- Create login_attempts table for rate limiting
CREATE TABLE public.login_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  ip_address text,
  success boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS  
ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;

-- No client access - only edge functions with service role
CREATE POLICY "No direct access"
ON public.login_attempts
FOR ALL
USING (false);

-- Create index for rate limiting queries
CREATE INDEX idx_login_attempts_email_created ON public.login_attempts(email, created_at);

-- Enable realtime for site_visits (optional for live dashboard)
ALTER PUBLICATION supabase_realtime ADD TABLE public.site_visits;
