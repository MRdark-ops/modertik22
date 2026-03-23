-- Admin-only RPC function: returns all direct referrals for a given user,
-- including email (from auth.users), name, join date, and verification status.
CREATE OR REPLACE FUNCTION public.get_user_referrals(referrer_user_id uuid)
RETURNS TABLE (
  user_id     uuid,
  full_name   text,
  email       text,
  joined_at   timestamptz,
  is_verified boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Access denied: admin only';
  END IF;

  RETURN QUERY
  SELECT
    p.user_id,
    COALESCE(p.full_name, '') AS full_name,
    COALESCE(u.email, '')     AS email,
    p.created_at              AS joined_at,
    EXISTS (
      SELECT 1
      FROM   public.referral_commissions rc
      WHERE  rc.referred_id = p.user_id
        AND  rc.level        = 1
        AND  rc.status       = 'paid'
    ) AS is_verified
  FROM   public.referrals r
  JOIN   public.profiles  p ON p.user_id = r.referred_id
  JOIN   auth.users       u ON u.id      = r.referred_id
  WHERE  r.referrer_id = referrer_user_id
    AND  r.level       = 1
  ORDER BY p.created_at DESC;
END;
$$;
