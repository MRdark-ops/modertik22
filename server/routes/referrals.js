import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import pool from '../db.js';
import { authMiddleware } from '../auth.js';

const router = express.Router();

// Get user referrals
router.get('/', authMiddleware, async (req, res) => {
  const connection = await pool.getConnection();
  
  try {
    // Get all referred users
    const [referrals] = await connection.execute(`
      SELECT 
        r.referred_id,
        p.full_name,
        u.email,
        p.balance,
        p.created_at as joined_at,
        COUNT(DISTINCT rc.id) as commission_count,
        COALESCE(SUM(rc.commission_amount), 0) as total_earned
      FROM referrals r
      JOIN users u ON r.referred_id = u.id
      JOIN profiles p ON r.referred_id = p.user_id
      LEFT JOIN referral_commissions rc ON rc.referrer_id = ? AND rc.referred_id = r.referred_id
      WHERE r.referrer_id = ?
      GROUP BY r.referred_id, p.full_name, u.email, p.balance, p.created_at
      ORDER BY r.created_at DESC
    `, [req.userId, req.userId]);

    // Get referral commissions breakdown
    const [commissions] = await connection.execute(`
      SELECT 
        level,
        COUNT(*) as count,
        SUM(commission_amount) as total,
        AVG(commission_amount) as average
      FROM referral_commissions
      WHERE referrer_id = ?
      GROUP BY level
      ORDER BY level
    `, [req.userId]);

    // Get total stats
    const [stats] = await connection.execute(`
      SELECT 
        COUNT(DISTINCT referred_id) as total_referred,
        COALESCE(SUM(commission_amount), 0) as total_earned,
        COUNT(CASE WHEN status = 'paid' THEN 1 END) as paid_count
      FROM referral_commissions
      WHERE referrer_id = ?
    `, [req.userId]);

    res.json({
      referrals,
      commissions_breakdown: commissions,
      stats: stats[0] || {
        total_referred: 0,
        total_earned: 0,
        paid_count: 0
      }
    });
  } catch (error) {
    console.error('Get referrals error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

// Get referral code
router.get('/code', authMiddleware, async (req, res) => {
  const connection = await pool.getConnection();
  
  try {
    const [profiles] = await connection.execute(
      'SELECT referral_code FROM profiles WHERE user_id = ?',
      [req.userId]
    );

    if (profiles.length === 0) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    res.json({ referral_code: profiles[0].referral_code });
  } catch (error) {
    console.error('Get referral code error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

export default router;
