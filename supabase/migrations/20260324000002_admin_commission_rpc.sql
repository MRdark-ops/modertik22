-- ─────────────────────────────────────────────────────────────────────────────
-- admin_run_commissions
-- Run the 5-level commission chain for a given approved deposit.
-- SECURITY DEFINER → bypasses RLS, no extra policies needed.
-- Returns a JSON summary of what was credited (or why it was skipped).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_run_commissions(p_deposit_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller       UUID    := auth.uid();
  v_is_admin     BOOLEAN;
  v_deposit      RECORD;
  v_current_uid  UUID;
  v_ancestor_id  UUID;
  v_ancestor_bal NUMERIC;
  v_ancestor_nm  TEXT;
  v_comm_amt     NUMERIC;
  v_existing     INT;
  v_lines        JSON[]  := ARRAY[]::JSON[];
  AMOUNTS        CONSTANT NUMERIC[] := ARRAY[2.50, 2.00, 1.50, 1.00, 0.50];
BEGIN
  -- ── Auth check ────────────────────────────────────────────────────────────
  IF v_caller IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'Unauthorized');
  END IF;
  SELECT EXISTS(
    SELECT 1 FROM user_roles WHERE user_id = v_caller AND role = 'admin'
  ) INTO v_is_admin;
  IF NOT v_is_admin THEN
    RETURN json_build_object('ok', false, 'error', 'Admin only');
  END IF;

  -- ── Fetch deposit ─────────────────────────────────────────────────────────
  SELECT d.*, p.referred_by, p.balance AS depositor_balance
  INTO v_deposit
  FROM deposits d
  JOIN profiles p ON p.user_id = d.user_id
  WHERE d.id = p_deposit_id;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'Deposit not found');
  END IF;

  IF v_deposit.status != 'approved' THEN
    RETURN json_build_object('ok', false, 'error', 'Deposit is not approved (status: ' || v_deposit.status || ')');
  END IF;

  -- ── Check if depositor has a referrer ────────────────────────────────────
  IF v_deposit.referred_by IS NULL THEN
    RETURN json_build_object(
      'ok', true,
      'skipped', true,
      'reason', 'User has no referrer — registered without a referral code',
      'lines', '[]'::JSON
    );
  END IF;

  -- ── Guard: skip if commissions already paid for this deposit ─────────────
  SELECT COUNT(*) INTO v_existing
  FROM referral_commissions
  WHERE deposit_id = p_deposit_id AND status = 'paid';

  IF v_existing > 0 THEN
    RETURN json_build_object(
      'ok', true,
      'skipped', true,
      'reason', 'Commissions already exist for this deposit (' || v_existing || ' records)',
      'lines', '[]'::JSON
    );
  END IF;

  -- ── Walk the referral chain up to 5 levels ───────────────────────────────
  v_current_uid := v_deposit.user_id;

  FOR lvl IN 1..5 LOOP
    -- Get this level's ancestor
    SELECT referred_by INTO v_ancestor_id
    FROM profiles WHERE user_id = v_current_uid;

    EXIT WHEN v_ancestor_id IS NULL;

    v_comm_amt := AMOUNTS[lvl];

    -- Get ancestor name + current balance
    SELECT full_name, COALESCE(balance, 0)
    INTO v_ancestor_nm, v_ancestor_bal
    FROM profiles WHERE user_id = v_ancestor_id;

    -- Insert commission record
    BEGIN
      INSERT INTO referral_commissions
        (referrer_id, referred_id, deposit_id, level, rate, commission_amount, status)
      VALUES
        (v_ancestor_id, v_deposit.user_id, p_deposit_id, lvl, 0, v_comm_amt, 'paid');

      -- Credit balance
      UPDATE profiles
      SET balance = COALESCE(balance, 0) + v_comm_amt
      WHERE user_id = v_ancestor_id;

      v_lines := v_lines || json_build_object(
        'level', lvl,
        'referrer_id', v_ancestor_id,
        'name', COALESCE(v_ancestor_nm, 'Unknown'),
        'amount', v_comm_amt,
        'ok', true
      );

    EXCEPTION WHEN OTHERS THEN
      v_lines := v_lines || json_build_object(
        'level', lvl,
        'referrer_id', v_ancestor_id,
        'name', COALESCE(v_ancestor_nm, 'Unknown'),
        'amount', v_comm_amt,
        'ok', false,
        'error', SQLERRM
      );
    END;

    v_current_uid := v_ancestor_id;
  END LOOP;

  RETURN json_build_object(
    'ok', true,
    'skipped', false,
    'lines_count', array_length(v_lines, 1),
    'lines', array_to_json(v_lines)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_run_commissions(UUID) TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- admin_approve_deposit
-- Approve a pending deposit + credit balance + run 5-level commission chain.
-- SECURITY DEFINER → bypasses RLS entirely.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_approve_deposit(p_deposit_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller     UUID    := auth.uid();
  v_is_admin   BOOLEAN;
  v_deposit    RECORD;
  v_profile    RECORD;
  v_comm_result JSON;
BEGIN
  IF v_caller IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'Unauthorized');
  END IF;
  SELECT EXISTS(
    SELECT 1 FROM user_roles WHERE user_id = v_caller AND role = 'admin'
  ) INTO v_is_admin;
  IF NOT v_is_admin THEN
    RETURN json_build_object('ok', false, 'error', 'Admin only');
  END IF;

  SELECT * INTO v_deposit FROM deposits WHERE id = p_deposit_id;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'Deposit not found');
  END IF;
  IF v_deposit.status != 'pending' THEN
    RETURN json_build_object('ok', false, 'error', 'Deposit already processed (status: ' || v_deposit.status || ')');
  END IF;

  -- Mark approved
  UPDATE deposits SET status = 'approved' WHERE id = p_deposit_id;

  -- Credit depositor balance
  UPDATE profiles
  SET balance = COALESCE(balance, 0) + v_deposit.amount
  WHERE user_id = v_deposit.user_id;

  -- Run commission chain (calls admin_run_commissions which also verifies admin)
  -- We call directly since we're already in the same security context
  SELECT public.admin_run_commissions(p_deposit_id) INTO v_comm_result;

  RETURN json_build_object(
    'ok', true,
    'status', 'approved',
    'amount', v_deposit.amount,
    'commission', v_comm_result
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_approve_deposit(UUID) TO authenticated;
