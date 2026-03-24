-- ─── admin_process_deposit ────────────────────────────────────────────────────
-- Handles approve / reject / delete for a deposit.
-- Must be run by an authenticated admin user.
CREATE OR REPLACE FUNCTION admin_process_deposit(
  p_deposit_id  UUID,
  p_action      TEXT,
  p_admin_note  TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller         UUID := auth.uid();
  v_is_admin       BOOLEAN;
  v_deposit        RECORD;
  v_profile        RECORD;
  v_existing_com   RECORD;
  v_signup_bonus   RECORD;
  v_indirect_old   RECORD;
  v_grand_ref_id   UUID;
  v_prior_count    INT;
  v_indirect_amt   NUMERIC;
  DIRECT_REWARD    CONSTANT NUMERIC   := 2.50;
  INDIRECT_TIERS   CONSTANT NUMERIC[] := ARRAY[2.00, 1.50, 1.00, 0.50];
BEGIN
  IF v_caller IS NULL THEN
    RETURN json_build_object('error', 'Unauthorized');
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM user_roles WHERE user_id = v_caller AND role = 'admin'
  ) INTO v_is_admin;
  IF NOT v_is_admin THEN
    RETURN json_build_object('error', 'Forbidden: admin only');
  END IF;

  IF p_action NOT IN ('approve', 'reject', 'delete') THEN
    RETURN json_build_object('error', 'Invalid action');
  END IF;

  SELECT * INTO v_deposit FROM deposits WHERE id = p_deposit_id;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Deposit not found');
  END IF;

  -- ── DELETE ────────────────────────────────────────────────────────────────
  IF p_action = 'delete' THEN
    DELETE FROM deposits WHERE id = p_deposit_id;
    INSERT INTO activity_logs (user_id, action, details)
    VALUES (v_deposit.user_id, 'deposit_deleted',
      json_build_object('deposit_id', p_deposit_id, 'amount', v_deposit.amount,
                        'previous_status', v_deposit.status, 'deleted_by', v_caller));
    RETURN json_build_object('success', true, 'status', 'deleted');
  END IF;

  IF v_deposit.status != 'pending' THEN
    RETURN json_build_object('error', 'Deposit already processed');
  END IF;

  UPDATE deposits
  SET status     = CASE WHEN p_action = 'approve' THEN 'approved' ELSE 'rejected' END,
      admin_note = p_admin_note
  WHERE id = p_deposit_id;

  -- ── APPROVE ───────────────────────────────────────────────────────────────
  IF p_action = 'approve' THEN
    SELECT * INTO v_profile FROM profiles WHERE user_id = v_deposit.user_id;

    UPDATE profiles
    SET balance = COALESCE(balance, 0) + v_deposit.amount
    WHERE user_id = v_deposit.user_id;

    INSERT INTO activity_logs (user_id, action, details)
    VALUES (v_deposit.user_id, 'deposit_approved',
      json_build_object('deposit_id', p_deposit_id, 'amount', v_deposit.amount, 'approved_by', v_caller));

    -- Referral commissions (only if referred_by exists)
    IF v_profile.referred_by IS NOT NULL THEN
      -- Check if deposit-linked commission already exists
      SELECT id INTO v_existing_com
      FROM referral_commissions
      WHERE referred_id = v_deposit.user_id
        AND level = 1 AND status = 'paid' AND deposit_id IS NOT NULL
      LIMIT 1;

      IF NOT FOUND THEN
        -- Void erroneous signup bonus (deposit_id IS NULL)
        SELECT id, commission_amount INTO v_signup_bonus
        FROM referral_commissions
        WHERE referred_id = v_deposit.user_id AND level = 1 AND deposit_id IS NULL
        LIMIT 1;

        IF FOUND THEN
          DELETE FROM referral_commissions WHERE id = v_signup_bonus.id;
          UPDATE profiles
          SET balance = GREATEST(0, balance - v_signup_bonus.commission_amount)
          WHERE user_id = v_profile.referred_by;
        END IF;

        -- Grant $2.50 direct commission
        INSERT INTO referral_commissions
          (referrer_id, referred_id, deposit_id, level, rate, commission_amount, status)
        VALUES
          (v_profile.referred_by, v_deposit.user_id, p_deposit_id, 1, 0, DIRECT_REWARD, 'paid');

        UPDATE profiles SET balance = COALESCE(balance, 0) + DIRECT_REWARD
        WHERE user_id = v_profile.referred_by;

        INSERT INTO activity_logs (user_id, action, details)
        VALUES (v_profile.referred_by, 'referral_direct_reward',
          json_build_object('referred_user_id', v_deposit.user_id, 'amount', DIRECT_REWARD, 'deposit_id', p_deposit_id));

        -- Level-2 indirect reward (grand-referrer)
        SELECT referred_by INTO v_grand_ref_id
        FROM profiles WHERE user_id = v_profile.referred_by;

        IF v_grand_ref_id IS NOT NULL THEN
          SELECT COUNT(*) INTO v_prior_count
          FROM referral_commissions
          WHERE referrer_id = v_profile.referred_by
            AND level = 1 AND status = 'paid'
            AND deposit_id IS NOT NULL
            AND referred_id != v_deposit.user_id;

          IF v_prior_count < 4 THEN
            v_indirect_amt := INDIRECT_TIERS[v_prior_count + 1];
          ELSE
            v_indirect_amt := 0.50;
          END IF;

          -- Void old indirect signup bonus
          SELECT id, commission_amount INTO v_indirect_old
          FROM referral_commissions
          WHERE referred_id = v_deposit.user_id AND level = 2 AND deposit_id IS NULL
          LIMIT 1;

          IF FOUND THEN
            DELETE FROM referral_commissions WHERE id = v_indirect_old.id;
            UPDATE profiles
            SET balance = GREATEST(0, balance - v_indirect_old.commission_amount)
            WHERE user_id = v_grand_ref_id;
          END IF;

          INSERT INTO referral_commissions
            (referrer_id, referred_id, deposit_id, level, rate, commission_amount, status)
          VALUES
            (v_grand_ref_id, v_deposit.user_id, p_deposit_id, 2, 0, v_indirect_amt, 'paid');

          UPDATE profiles SET balance = COALESCE(balance, 0) + v_indirect_amt
          WHERE user_id = v_grand_ref_id;

          INSERT INTO activity_logs (user_id, action, details)
          VALUES (v_grand_ref_id, 'referral_indirect_reward',
            json_build_object('amount', v_indirect_amt, 'deposit_id', p_deposit_id,
                              'indirect_via', v_profile.referred_by));
        END IF;
      END IF;
    END IF;

  ELSE
    -- ── REJECT ──────────────────────────────────────────────────────────────
    INSERT INTO activity_logs (user_id, action, details)
    VALUES (v_deposit.user_id, 'deposit_rejected',
      json_build_object('deposit_id', p_deposit_id, 'amount', v_deposit.amount,
                        'rejected_by', v_caller, 'note', p_admin_note));
  END IF;

  RETURN json_build_object('success', true,
    'status', CASE WHEN p_action = 'approve' THEN 'approved' ELSE 'rejected' END);
END;
$$;

GRANT EXECUTE ON FUNCTION admin_process_deposit(UUID, TEXT, TEXT) TO authenticated;


-- ─── admin_process_withdrawal ─────────────────────────────────────────────────
-- Handles approve / reject / in_progress / completed for a withdrawal.
CREATE OR REPLACE FUNCTION admin_process_withdrawal(
  p_withdrawal_id UUID,
  p_action        TEXT,
  p_admin_note    TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller     UUID := auth.uid();
  v_is_admin   BOOLEAN;
  v_withdrawal RECORD;
  v_new_status TEXT;
BEGIN
  IF v_caller IS NULL THEN
    RETURN json_build_object('error', 'Unauthorized');
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM user_roles WHERE user_id = v_caller AND role = 'admin'
  ) INTO v_is_admin;
  IF NOT v_is_admin THEN
    RETURN json_build_object('error', 'Forbidden: admin only');
  END IF;

  IF p_action NOT IN ('approve', 'reject', 'in_progress', 'completed') THEN
    RETURN json_build_object('error', 'Invalid action');
  END IF;

  SELECT * INTO v_withdrawal FROM withdrawals WHERE id = p_withdrawal_id;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Withdrawal not found');
  END IF;

  v_new_status := CASE p_action
    WHEN 'approve'     THEN 'approved'
    WHEN 'reject'      THEN 'rejected'
    WHEN 'in_progress' THEN 'in_progress'
    WHEN 'completed'   THEN 'completed'
  END;

  -- Validate state transitions
  IF (v_withdrawal.status = 'pending'     AND p_action NOT IN ('approve', 'reject'))  OR
     (v_withdrawal.status = 'approved'    AND p_action != 'in_progress')               OR
     (v_withdrawal.status = 'in_progress' AND p_action != 'completed')                THEN
    RETURN json_build_object('error',
      'Cannot transition from ' || v_withdrawal.status || ' to ' || v_new_status);
  END IF;

  UPDATE withdrawals
  SET status = v_new_status, admin_note = p_admin_note
  WHERE id = p_withdrawal_id;

  IF p_action = 'reject' THEN
    UPDATE profiles
    SET balance = COALESCE(balance, 0) + v_withdrawal.amount
    WHERE user_id = v_withdrawal.user_id;
  END IF;

  INSERT INTO activity_logs (user_id, action, details)
  VALUES (v_withdrawal.user_id, 'withdrawal_' || v_new_status,
    json_build_object('withdrawal_id', p_withdrawal_id, 'amount', v_withdrawal.amount,
                      'processed_by', v_caller, 'note', p_admin_note));

  RETURN json_build_object('success', true, 'status', v_new_status);
END;
$$;

GRANT EXECUTE ON FUNCTION admin_process_withdrawal(UUID, TEXT, TEXT) TO authenticated;
