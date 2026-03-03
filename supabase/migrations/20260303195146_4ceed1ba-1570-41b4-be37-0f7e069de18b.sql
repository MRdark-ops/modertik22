CREATE OR REPLACE FUNCTION public.prevent_profile_tampering()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Server-side processes (no auth.uid or different uid) may update balance/referral fields.
  IF auth.uid() IS NULL OR auth.uid() <> OLD.user_id THEN
    NEW.user_id := OLD.user_id;
    NEW.created_at := OLD.created_at;
    RETURN NEW;
  END IF;

  -- End users can only edit their display fields.
  NEW.balance := OLD.balance;
  NEW.referred_by := OLD.referred_by;
  NEW.referral_code := OLD.referral_code;
  NEW.user_id := OLD.user_id;
  NEW.created_at := OLD.created_at;
  RETURN NEW;
END;
$function$;