import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import 'dotenv/config';

// Generate JWT token
export function generateToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  });
}

// Verify JWT token
export function verifyToken(token) {
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    return null;
  }
}

// Hash password
export async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

// Compare password
export async function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}

// Generate referral code
export function generateReferralCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Middleware to verify JWT
export function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  req.userId = decoded.userId;
  next();
}

// Middleware to verify admin role
export async function adminMiddleware(req, res, next) {
  if (!req.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const pool = (await import('./db.js')).default;
    const connection = await pool.getConnection();
    
    const [rows] = await connection.execute(
      'SELECT role FROM user_roles WHERE user_id = ?',
      [req.userId]
    );
    
    connection.release();

    if (!rows.length || rows[0].role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    next();
  } catch (error) {
    return res.status(500).json({ error: 'Server error' });
  }
}
