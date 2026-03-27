import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import pool from '../db.js';
import { authMiddleware, adminMiddleware } from '../auth.js';

const router = express.Router();

// Get all users (admin)
router.get('/users', authMiddleware, adminMiddleware, async (req, res) => {
  const connection = await pool.getConnection();
  
  try {
    const [users] = await connection.execute(`
      SELECT 
        u.id, u.email, p.full_name, p.referral_code, p.balance, p.created_at,
        ur.role,
        (SELECT COUNT(*) FROM referrals WHERE referrer_id = u.id) as referral_count
      FROM users u
      JOIN profiles p ON u.id = p.user_id
      JOIN user_roles ur ON u.id = ur.user_id
      ORDER BY u.created_at DESC
    `);

    res.json({ users });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

// Get dashboard stats (admin)
router.get('/stats', authMiddleware, adminMiddleware, async (req, res) => {
  const connection = await pool.getConnection();
  
  try {
    // Total users
    const [userCount] = await connection.execute('SELECT COUNT(*) as count FROM users');

    // Total deposits
    const [depositStats] = await connection.execute(`
      SELECT 
        COUNT(*) as total_count,
        SUM(CASE WHEN status = 'approved' THEN amount ELSE 0 END) as approved_amount,
        SUM(CASE WHEN status = 'pending' THEN amount ELSE 0 END) as pending_amount,
        SUM(CASE WHEN status = 'rejected' THEN amount ELSE 0 END) as rejected_amount
      FROM deposits
    `);

    // Total withdrawals
    const [withdrawalStats] = await connection.execute(`
      SELECT 
        COUNT(*) as total_count,
        SUM(CASE WHEN status = 'approved' THEN amount ELSE 0 END) as approved_amount,
        SUM(CASE WHEN status = 'pending' THEN amount ELSE 0 END) as pending_amount
      FROM withdrawals
    `);

    // Referral stats
    const [referralStats] = await connection.execute(`
      SELECT 
        COUNT(DISTINCT referred_id) as total_referrals,
        SUM(commission_amount) as total_commissions
      FROM referrals r
      LEFT JOIN referral_commissions rc ON r.referred_id = rc.referred_id
    `);

    // Activity summary
    const [activities] = await connection.execute(`
      SELECT 
        DATE(created_at) as activity_date,
        action,
        COUNT(*) as count
      FROM activity_logs
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      GROUP BY DATE(created_at), action
      ORDER BY activity_date DESC
    `);

    res.json({
      stats: {
        total_users: userCount[0]?.count || 0,
        deposits: depositStats[0] || { total_count: 0, approved_amount: 0, pending_amount: 0, rejected_amount: 0 },
        withdrawals: withdrawalStats[0] || { total_count: 0, approved_amount: 0, pending_amount: 0 },
        referrals: referralStats[0] || { total_referrals: 0, total_commissions: 0 },
        activity_summary: activities
      }
    });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

// Get activity logs (admin)
router.get('/logs', authMiddleware, adminMiddleware, async (req, res) => {
  const connection = await pool.getConnection();
  
  try {
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;

    const [logs] = await connection.execute(`
      SELECT 
        al.id, al.user_id, al.action, al.details, al.created_at,
        p.full_name, u.email
      FROM activity_logs al
      LEFT JOIN profiles p ON al.user_id = p.user_id
      LEFT JOIN users u ON al.user_id = u.id
      ORDER BY al.created_at DESC
      LIMIT ? OFFSET ?
    `, [limit, offset]);

    const [countResult] = await connection.execute('SELECT COUNT(*) as count FROM activity_logs');

    res.json({
      logs,
      total: countResult[0]?.count || 0,
      offset,
      limit
    });
  } catch (error) {
    console.error('Get logs error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

// Promote user to admin
router.post('/users/:id/promote', authMiddleware, adminMiddleware, async (req, res) => {
  const connection = await pool.getConnection();
  
  try {
    const { id } = req.params;

    // Check if user exists
    const [users] = await connection.execute(
      'SELECT id FROM users WHERE id = ?',
      [id]
    );

    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Update or insert user role
    await connection.execute(
      'UPDATE user_roles SET role = ? WHERE user_id = ?',
      ['admin', id]
    );

    // Log activity
    await connection.execute(
      'INSERT INTO activity_logs (id, user_id, action, details) VALUES (?, ?, ?, ?)',
      [
        uuidv4(),
        req.userId,
        'user_promoted_to_admin',
        JSON.stringify({ promoted_user_id: id })
      ]
    );

    res.json({ message: 'User promoted to admin' });
  } catch (error) {
    console.error('Promote user error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

// Demote admin to user
router.post('/users/:id/demote', authMiddleware, adminMiddleware, async (req, res) => {
  const connection = await pool.getConnection();
  
  try {
    const { id } = req.params;

    // Prevent demotion of last admin
    const [adminCount] = await connection.execute(
      'SELECT COUNT(*) as count FROM user_roles WHERE role = ?',
      ['admin']
    );

    if (adminCount[0]?.count <= 1 && (await isAdmin(id, connection))) {
      return res.status(400).json({ error: 'Cannot demote the last admin' });
    }

    await connection.execute(
      'UPDATE user_roles SET role = ? WHERE user_id = ?',
      ['user', id]
    );

    // Log activity
    await connection.execute(
      'INSERT INTO activity_logs (id, user_id, action, details) VALUES (?, ?, ?, ?)',
      [
        uuidv4(),
        req.userId,
        'admin_demoted_to_user',
        JSON.stringify({ demoted_user_id: id })
      ]
    );

    res.json({ message: 'Admin demoted to user' });
  } catch (error) {
    console.error('Demote user error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

// Delete user (admin)
router.delete('/users/:id', authMiddleware, adminMiddleware, async (req, res) => {
  const connection = await pool.getConnection();
  
  try {
    const { id } = req.params;

    // Prevent deletion of self
    if (id === req.userId) {
      return res.status(400).json({ error: 'Cannot delete yourself' });
    }

    await connection.beginTransaction();

    try {
      // Get user details before delete
      const [userData] = await connection.execute(
        'SELECT email FROM users WHERE id = ?',
        [id]
      );

      // Delete user (cascades to related tables)
      await connection.execute('DELETE FROM users WHERE id = ?', [id]);

      // Log activity
      await connection.execute(
        'INSERT INTO activity_logs (id, user_id, action, details) VALUES (?, ?, ?, ?)',
        [
          uuidv4(),
          req.userId,
          'user_deleted',
          JSON.stringify({ deleted_user_id: id, email: userData[0]?.email })
        ]
      );

      await connection.commit();

      res.json({ message: 'User deleted successfully' });
    } catch (txError) {
      await connection.rollback();
      throw txError;
    }
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

// Helper function
async function isAdmin(userId, connection) {
  const [roles] = await connection.execute(
    'SELECT role FROM user_roles WHERE user_id = ? AND role = ?',
    [userId, 'admin']
  );
  return roles.length > 0;
}

export default router;
