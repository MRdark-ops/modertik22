import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import pool from '../db.js';
import {
  hashPassword,
  comparePassword,
  generateToken,
  generateReferralCode,
  authMiddleware
} from '../auth.js';

const router = express.Router();

// Register new user
router.post('/register', async (req, res) => {
  const connection = await pool.getConnection();
  
  try {
    const { email, password, full_name, referral_code_input } = req.body;

    // Validate input
    if (!email || !password || !full_name) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    // Check if user exists
    const [existing] = await connection.execute(
      'SELECT id FROM users WHERE email = ?',
      [email]
    );

    if (existing.length > 0) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Start transaction
    await connection.beginTransaction();

    try {
      // Create user
      const userId = uuidv4();
      const passwordHash = await hashPassword(password);

      await connection.execute(
        'INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)',
        [userId, email, passwordHash]
      );

      // Create user role
      await connection.execute(
        'INSERT INTO user_roles (id, user_id, role) VALUES (?, ?, ?)',
        [uuidv4(), userId, 'user']
      );

      // Handle referral
      let referredBy = null;
      if (referral_code_input) {
        const [referrer] = await connection.execute(
          'SELECT user_id FROM profiles WHERE referral_code = ?',
          [referral_code_input]
        );

        if (referrer.length > 0) {
          referredBy = referrer[0].user_id;
        }
      }

      // Create profile
      const referralCode = generateReferralCode();
      await connection.execute(
        'INSERT INTO profiles (id, user_id, full_name, referral_code, referred_by) VALUES (?, ?, ?, ?, ?)',
        [uuidv4(), userId, full_name, referralCode, referredBy]
      );

      // If referrer exists, create referral record
      if (referredBy) {
        await connection.execute(
          'INSERT INTO referrals (id, referrer_id, referred_id, level) VALUES (?, ?, ?, ?)',
          [uuidv4(), referredBy, userId, 1]
        );
      }

      // Create TOTP record
      await connection.execute(
        'INSERT INTO user_totp (id, user_id, secret, enabled) VALUES (?, ?, ?, ?)',
        [uuidv4(), userId, '', false]
      );

      // Log activity
      await connection.execute(
        'INSERT INTO activity_logs (id, user_id, action, details) VALUES (?, ?, ?, ?)',
        [
          uuidv4(),
          userId,
          'user_registered',
          JSON.stringify({ email, referral_code_input: !!referral_code_input })
        ]
      );

      await connection.commit();

      // Generate token
      const token = generateToken(userId);

      res.json({
        message: 'User registered successfully',
        token,
        user: {
          id: userId,
          email,
          full_name
        },
        profile: {
          referral_code: referralCode,
          balance: 0
        }
      });
    } catch (txError) {
      await connection.rollback();
      throw txError;
    }
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

// Login user
router.post('/login', async (req, res) => {
  const connection = await pool.getConnection();
  
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    // Log login attempt
    await connection.execute(
      'INSERT INTO login_attempts (id, email, success) VALUES (?, ?, ?)',
      [uuidv4(), email, false]
    );

    // Find user
    const [users] = await connection.execute(
      'SELECT id, password_hash FROM users WHERE email = ?',
      [email]
    );

    if (users.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = users[0];
    const validPassword = await comparePassword(password, user.password_hash);

    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Update login attempt as successful
    await connection.execute(
      'UPDATE login_attempts SET success = ? WHERE email = ? ORDER BY created_at DESC LIMIT 1',
      [true, email]
    );

    // Fetch user profile and role
    const [roles] = await connection.execute(
      'SELECT role FROM user_roles WHERE user_id = ?',
      [user.id]
    );

    const [profiles] = await connection.execute(
      'SELECT full_name, referral_code, balance, referred_by FROM profiles WHERE user_id = ?',
      [user.id]
    );

    // Log activity
    await connection.execute(
      'INSERT INTO activity_logs (id, user_id, action) VALUES (?, ?, ?)',
      [uuidv4(), user.id, 'user_login']
    );

    // Generate token
    const token = generateToken(user.id);

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        email
      },
      profile: profiles.length > 0 ? profiles[0] : null,
      isAdmin: roles.length > 0 && roles[0].role === 'admin'
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

// Get current user profile
router.get('/me', authMiddleware, async (req, res) => {
  const connection = await pool.getConnection();
  
  try {
    const [users] = await connection.execute(
      'SELECT id, email FROM users WHERE id = ?',
      [req.userId]
    );

    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = users[0];

    const [profiles] = await connection.execute(
      'SELECT full_name, referral_code, balance, referred_by FROM profiles WHERE user_id = ?',
      [user.id]
    );

    const [roles] = await connection.execute(
      'SELECT role FROM user_roles WHERE user_id = ?',
      [user.id]
    );

    res.json({
      user: {
        id: user.id,
        email: user.email
      },
      profile: profiles.length > 0 ? profiles[0] : null,
      isAdmin: roles.length > 0 && roles[0].role === 'admin'
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

// Update user profile
router.put('/profile', authMiddleware, async (req, res) => {
  const connection = await pool.getConnection();
  
  try {
    const { full_name } = req.body;

    if (!full_name) {
      return res.status(400).json({ error: 'Full name is required' });
    }

    await connection.execute(
      'UPDATE profiles SET full_name = ? WHERE user_id = ?',
      [full_name, req.userId]
    );

    res.json({ message: 'Profile updated successfully' });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

export default router;
