
-- Prevent users from tampering with sensitive profile fields
CREATE OR REPLACE FUNCTION public.prevent_profile_tampering()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Preserve sensitive fields - only allow full_name and updated_at to change
  NEW.balance := OLD.balance;
  NEW.referred_by := OLD.referred_by;
  NEW.referral_code := OLD.referral_code;
  NEW.user_id := OLD.user_id;
  NEW.created_at := OLD.created_at;
  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_profile_immutability
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.prevent_profile_tampering();
