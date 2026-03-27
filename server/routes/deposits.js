import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import pool from '../db.js';
import { authMiddleware, adminMiddleware } from '../auth.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const router = express.Router();

// Configure multer for file uploads
const uploadDir = process.env.UPLOAD_DIR || './uploads/deposits';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, cb) => {
      const uniqueName = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}${path.extname(file.originalname)}`;
      cb(null, uniqueName);
    }
  }),
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE) || 5242880 },
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  }
});

// Create deposit
router.post('/', authMiddleware, upload.single('proof_image'), async (req, res) => {
  const connection = await pool.getConnection();
  
  try {
    const { amount } = req.body;

    if (!amount || isNaN(amount) || amount < 10 || amount > 100000) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Invalid deposit amount' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Proof image is required' });
    }

    await connection.beginTransaction();

    try {
      const depositId = uuidv4();
      const proofUrl = req.file.filename;

      // Create deposit
      await connection.execute(
        'INSERT INTO deposits (id, user_id, amount, proof_url, status) VALUES (?, ?, ?, ?, ?)',
        [depositId, req.userId, amount, proofUrl, 'pending']
      );

      // Log activity
      await connection.execute(
        'INSERT INTO activity_logs (id, user_id, action, details) VALUES (?, ?, ?, ?)',
        [
          uuidv4(),
          req.userId,
          'deposit_created',
          JSON.stringify({ deposit_id: depositId, amount })
        ]
      );

      await connection.commit();

      res.status(201).json({
        message: 'Deposit submitted successfully',
        deposit: {
          id: depositId,
          amount: parseFloat(amount),
          status: 'pending',
          created_at: new Date().toISOString()
        }
      });
    } catch (txError) {
      await connection.rollback();
      if (req.file) fs.unlinkSync(req.file.path);
      throw txError;
    }
  } catch (error) {
    if (req.file) fs.unlinkSync(req.file.path);
    console.error('Create deposit error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

// Get user deposits
router.get('/', authMiddleware, async (req, res) => {
  const connection = await pool.getConnection();
  
  try {
    const [deposits] = await connection.execute(
      'SELECT id, amount, status, created_at, proof_url FROM deposits WHERE user_id = ? ORDER BY created_at DESC',
      [req.userId]
    );

    res.json({ deposits });
  } catch (error) {
    console.error('Get deposits error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

// Get all deposits (admin)
router.get('/all', authMiddleware, adminMiddleware, async (req, res) => {
  const connection = await pool.getConnection();
  
  try {
    const [deposits] = await connection.execute(`
      SELECT 
        d.id, d.user_id, d.amount, d.status, d.created_at, d.proof_url,
        p.full_name, u.email
      FROM deposits d
      JOIN profiles p ON d.user_id = p.user_id
      JOIN users u ON d.user_id = u.id
      ORDER BY d.created_at DESC
    `);

    res.json({ deposits });
  } catch (error) {
    console.error('Get all deposits error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

// Approve deposit (admin)
router.post('/:id/approve', authMiddleware, adminMiddleware, async (req, res) => {
  const connection = await pool.getConnection();
  
  try {
    const { admin_note } = req.body;
    const depositId = req.params.id;

    await connection.beginTransaction();

    try {
      // Get deposit
      const [deposits] = await connection.execute(
        'SELECT user_id, amount FROM deposits WHERE id = ?',
        [depositId]
      );

      if (deposits.length === 0) {
        await connection.rollback();
        return res.status(404).json({ error: 'Deposit not found' });
      }

      const deposit = deposits[0];

      // Update deposit status
      await connection.execute(
        'UPDATE deposits SET status = ?, admin_note = ?, updated_at = NOW() WHERE id = ?',
        ['approved', admin_note || null, depositId]
      );

      // Update user balance
      await connection.execute(
        'UPDATE profiles SET balance = balance + ? WHERE user_id = ?',
        [deposit.amount, deposit.user_id]
      );

      // Handle referral rewards
      const [profiles] = await connection.execute(
        'SELECT referred_by FROM profiles WHERE user_id = ?',
        [deposit.user_id]
      );

      if (profiles.length > 0 && profiles[0].referred_by) {
        const directReferrerId = profiles[0].referred_by;
        const DIRECT_REWARD = 2.5;

        // Add direct referral commission
        await connection.execute(
          'INSERT INTO referral_commissions (id, referrer_id, referred_id, deposit_id, level, commission_amount, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [uuidv4(), directReferrerId, deposit.user_id, depositId, 1, DIRECT_REWARD, 'paid']
        );

        // Update referrer balance
        await connection.execute(
          'UPDATE profiles SET balance = balance + ? WHERE user_id = ?',
          [DIRECT_REWARD, directReferrerId]
        );

        // Log referrer activity
        await connection.execute(
          'INSERT INTO activity_logs (id, user_id, action, details) VALUES (?, ?, ?, ?)',
          [
            uuidv4(),
            directReferrerId,
            'direct_referral_reward',
            JSON.stringify({ deposit_user_id: deposit.user_id, deposit_id: depositId, amount: DIRECT_REWARD })
          ]
        );

        // Handle indirect rewards (up to 5 levels)
        const INDIRECT_REWARD_TIERS = [2.0, 1.5, 1.0, 0.5];
        let currentReferrer = directReferrerId;

        for (let level = 2; level <= 5; level++) {
          const [referrerProfile] = await connection.execute(
            'SELECT referred_by FROM profiles WHERE user_id = ?',
            [currentReferrer]
          );

          if (referrerProfile.length === 0 || !referrerProfile[0].referred_by) {
            break;
          }

          const grandReferrerId = referrerProfile[0].referred_by;
          const indirectAmount = INDIRECT_REWARD_TIERS[level - 2] || 0.5;

          // Add indirect commission
          await connection.execute(
            'INSERT INTO referral_commissions (id, referrer_id, referred_id, deposit_id, level, commission_amount, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [uuidv4(), grandReferrerId, deposit.user_id, depositId, level, indirectAmount, 'paid']
          );

          // Update grand referrer balance
          await connection.execute(
            'UPDATE profiles SET balance = balance + ? WHERE user_id = ?',
            [indirectAmount, grandReferrerId]
          );

          // Log activity
          await connection.execute(
            'INSERT INTO activity_logs (id, user_id, action, details) VALUES (?, ?, ?, ?)',
            [
              uuidv4(),
              grandReferrerId,
              'indirect_referral_reward',
              JSON.stringify({
                level,
                deposit_user_id: deposit.user_id,
                deposit_id: depositId,
                amount: indirectAmount
              })
            ]
          );

          currentReferrer = grandReferrerId;
        }
      }

      // Log activity
      await connection.execute(
        'INSERT INTO activity_logs (id, user_id, action, details) VALUES (?, ?, ?, ?)',
        [
          uuidv4(),
          deposit.user_id,
          'deposit_approved',
          JSON.stringify({ deposit_id: depositId, amount: deposit.amount, approved_by: req.userId })
        ]
      );

      await connection.commit();

      res.json({
        message: 'Deposit approved successfully',
        deposit: { id: depositId, status: 'approved' }
      });
    } catch (txError) {
      await connection.rollback();
      throw txError;
    }
  } catch (error) {
    console.error('Approve deposit error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

// Reject deposit (admin)
router.post('/:id/reject', authMiddleware, adminMiddleware, async (req, res) => {
  const connection = await pool.getConnection();
  
  try {
    const { admin_note } = req.body;
    const depositId = req.params.id;

    const [deposits] = await connection.execute(
      'SELECT user_id, amount FROM deposits WHERE id = ?',
      [depositId]
    );

    if (deposits.length === 0) {
      return res.status(404).json({ error: 'Deposit not found' });
    }

    const deposit = deposits[0];

    await connection.execute(
      'UPDATE deposits SET status = ?, admin_note = ?, updated_at = NOW() WHERE id = ?',
      ['rejected', admin_note || null, depositId]
    );

    // Log activity
    await connection.execute(
      'INSERT INTO activity_logs (id, user_id, action, details) VALUES (?, ?, ?, ?)',
      [
        uuidv4(),
        deposit.user_id,
        'deposit_rejected',
        JSON.stringify({ deposit_id: depositId, amount: deposit.amount, rejected_by: req.userId, note: admin_note })
      ]
    );

    res.json({
      message: 'Deposit rejected successfully',
      deposit: { id: depositId, status: 'rejected' }
    });
  } catch (error) {
    console.error('Reject deposit error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

export default router;
