import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import pool from '../db.js';
import { authMiddleware, adminMiddleware } from '../auth.js';

const router = express.Router();

// Create withdrawal
router.post('/', authMiddleware, async (req, res) => {
  const connection = await pool.getConnection();
  
  try {
    const { amount, wallet_address } = req.body;

    if (!amount || isNaN(amount) || amount < 50 || amount > 10000) {
      return res.status(400).json({ error: 'Invalid withdrawal amount (min $50, max $10,000)' });
    }

    if (!wallet_address) {
      return res.status(400).json({ error: 'Wallet address is required' });
    }

    await connection.beginTransaction();

    try {
      // Get user profile
      const [profiles] = await connection.execute(
        'SELECT balance FROM profiles WHERE user_id = ?',
        [req.userId]
      );

      if (profiles.length === 0) {
        await connection.rollback();
        return res.status(404).json({ error: 'User profile not found' });
      }

      const profile = profiles[0];

      if (profile.balance < amount) {
        await connection.rollback();
        return res.status(400).json({ error: 'Insufficient balance' });
      }

      // Create withdrawal
      const withdrawalId = uuidv4();
      await connection.execute(
        'INSERT INTO withdrawals (id, user_id, amount, wallet_address, status) VALUES (?, ?, ?, ?, ?)',
        [withdrawalId, req.userId, amount, wallet_address, 'pending']
      );

      // Deduct balance
      await connection.execute(
        'UPDATE profiles SET balance = balance - ? WHERE user_id = ?',
        [amount, req.userId]
      );

      // Log activity
      await connection.execute(
        'INSERT INTO activity_logs (id, user_id, action, details) VALUES (?, ?, ?, ?)',
        [
          uuidv4(),
          req.userId,
          'withdrawal_created',
          JSON.stringify({ withdrawal_id: withdrawalId, amount, wallet_address })
        ]
      );

      await connection.commit();

      res.status(201).json({
        message: 'Withdrawal request submitted',
        withdrawal: {
          id: withdrawalId,
          amount: parseFloat(amount),
          wallet_address,
          status: 'pending',
          created_at: new Date().toISOString()
        }
      });
    } catch (txError) {
      await connection.rollback();
      throw txError;
    }
  } catch (error) {
    console.error('Create withdrawal error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

// Get user withdrawals
router.get('/', authMiddleware, async (req, res) => {
  const connection = await pool.getConnection();
  
  try {
    const [withdrawals] = await connection.execute(
      'SELECT id, amount, wallet_address, status, created_at FROM withdrawals WHERE user_id = ? ORDER BY created_at DESC',
      [req.userId]
    );

    res.json({ withdrawals });
  } catch (error) {
    console.error('Get withdrawals error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

// Get all withdrawals (admin)
router.get('/all', authMiddleware, adminMiddleware, async (req, res) => {
  const connection = await pool.getConnection();
  
  try {
    const [withdrawals] = await connection.execute(`
      SELECT 
        w.id, w.user_id, w.amount, w.wallet_address, w.status, w.created_at,
        p.full_name, u.email
      FROM withdrawals w
      JOIN profiles p ON w.user_id = p.user_id
      JOIN users u ON w.user_id = u.id
      ORDER BY w.created_at DESC
    `);

    res.json({ withdrawals });
  } catch (error) {
    console.error('Get all withdrawals error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

// Approve withdrawal (admin)
router.post('/:id/approve', authMiddleware, adminMiddleware, async (req, res) => {
  const connection = await pool.getConnection();
  
  try {
    const { admin_note } = req.body;
    const withdrawalId = req.params.id;

    const [withdrawals] = await connection.execute(
      'SELECT user_id, amount FROM withdrawals WHERE id = ?',
      [withdrawalId]
    );

    if (withdrawals.length === 0) {
      return res.status(404).json({ error: 'Withdrawal not found' });
    }

    const withdrawal = withdrawals[0];

    await connection.execute(
      'UPDATE withdrawals SET status = ?, admin_note = ?, updated_at = NOW() WHERE id = ?',
      ['approved', admin_note || null, withdrawalId]
    );

    // Log activity
    await connection.execute(
      'INSERT INTO activity_logs (id, user_id, action, details) VALUES (?, ?, ?, ?)',
      [
        uuidv4(),
        withdrawal.user_id,
        'withdrawal_approved',
        JSON.stringify({ withdrawal_id: withdrawalId, amount: withdrawal.amount, approved_by: req.userId })
      ]
    );

    res.json({
      message: 'Withdrawal approved successfully',
      withdrawal: { id: withdrawalId, status: 'approved' }
    });
  } catch (error) {
    console.error('Approve withdrawal error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

// Reject withdrawal (admin)
router.post('/:id/reject', authMiddleware, adminMiddleware, async (req, res) => {
  const connection = await pool.getConnection();
  
  try {
    const { admin_note } = req.body;
    const withdrawalId = req.params.id;

    await connection.beginTransaction();

    try {
      const [withdrawals] = await connection.execute(
        'SELECT user_id, amount FROM withdrawals WHERE id = ? FOR UPDATE',
        [withdrawalId]
      );

      if (withdrawals.length === 0) {
        await connection.rollback();
        return res.status(404).json({ error: 'Withdrawal not found' });
      }

      const withdrawal = withdrawals[0];

      await connection.execute(
        'UPDATE withdrawals SET status = ?, admin_note = ?, updated_at = NOW() WHERE id = ?',
        ['rejected', admin_note || null, withdrawalId]
      );

      // Refund balance
      await connection.execute(
        'UPDATE profiles SET balance = balance + ? WHERE user_id = ?',
        [withdrawal.amount, withdrawal.user_id]
      );

      // Log activity
      await connection.execute(
        'INSERT INTO activity_logs (id, user_id, action, details) VALUES (?, ?, ?, ?)',
        [
          uuidv4(),
          withdrawal.user_id,
          'withdrawal_rejected',
          JSON.stringify({ withdrawal_id: withdrawalId, amount: withdrawal.amount, rejected_by: req.userId, note: admin_note })
        ]
      );

      await connection.commit();

      res.json({
        message: 'Withdrawal rejected successfully',
        withdrawal: { id: withdrawalId, status: 'rejected' }
      });
    } catch (txError) {
      await connection.rollback();
      throw txError;
    }
  } catch (error) {
    console.error('Reject withdrawal error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

export default router;
