import pool from './db.js';
import 'dotenv/config';

async function migrate() {
  const connection = await pool.getConnection();
  console.log('Starting database migration...');

  try {
    // 1. Create users table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_email (email)
      )
    `);
    console.log('✓ Created users table');

    // 2. Create user_roles table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS user_roles (
        id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
        user_id CHAR(36) NOT NULL UNIQUE,
        role ENUM('user', 'admin') DEFAULT 'user',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_user_id (user_id)
      )
    `);
    console.log('✓ Created user_roles table');

    // 3. Create profiles table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS profiles (
        id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
        user_id CHAR(36) NOT NULL UNIQUE,
        full_name VARCHAR(255) NOT NULL DEFAULT '',
        referral_code VARCHAR(50) UNIQUE NOT NULL,
        referred_by CHAR(36),
        balance DECIMAL(12,2) NOT NULL DEFAULT 0.00 CHECK (balance >= 0),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (referred_by) REFERENCES users(id) ON DELETE SET NULL,
        INDEX idx_user_id (user_id),
        INDEX idx_referral_code (referral_code),
        INDEX idx_referred_by (referred_by)
      )
    `);
    console.log('✓ Created profiles table');

    // 4. Create deposits table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS deposits (
        id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
        user_id CHAR(36) NOT NULL,
        amount DECIMAL(12,2) NOT NULL,
        status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
        proof_url VARCHAR(500),
        admin_note TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_user_id (user_id),
        INDEX idx_status (status),
        INDEX idx_created_at (created_at),
        CONSTRAINT amount_range CHECK (amount >= 10 AND amount <= 100000)
      )
    `);
    console.log('✓ Created deposits table');

    // 5. Create withdrawals table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS withdrawals (
        id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
        user_id CHAR(36) NOT NULL,
        amount DECIMAL(12,2) NOT NULL,
        status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
        wallet_address VARCHAR(255) NOT NULL,
        admin_note TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_user_id (user_id),
        INDEX idx_status (status),
        INDEX idx_created_at (created_at),
        CONSTRAINT amount_range CHECK (amount >= 50 AND amount <= 10000)
      )
    `);
    console.log('✓ Created withdrawals table');

    // 6. Create referrals table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS referrals (
        id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
        referrer_id CHAR(36) NOT NULL,
        referred_id CHAR(36) NOT NULL UNIQUE,
        level INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (referrer_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (referred_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_referrer_id (referrer_id),
        INDEX idx_referred_id (referred_id),
        CONSTRAINT valid_level CHECK (level BETWEEN 1 AND 5)
      )
    `);
    console.log('✓ Created referrals table');

    // 7. Create referral_commissions table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS referral_commissions (
        id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
        referrer_id CHAR(36) NOT NULL,
        referred_id CHAR(36) NOT NULL,
        deposit_id CHAR(36),
        level INT NOT NULL,
        rate DECIMAL(5,2) DEFAULT 0.00,
        commission_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
        status ENUM('pending', 'paid') DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (referrer_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (referred_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (deposit_id) REFERENCES deposits(id) ON DELETE SET NULL,
        INDEX idx_referrer_id (referrer_id),
        INDEX idx_referred_id (referred_id),
        INDEX idx_deposit_id (deposit_id),
        INDEX idx_level (level)
      )
    `);
    console.log('✓ Created referral_commissions table');

    // 8. Create activity_logs table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS activity_logs (
        id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
        user_id CHAR(36) NOT NULL,
        action VARCHAR(100) NOT NULL,
        details JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_user_id (user_id),
        INDEX idx_action (action),
        INDEX idx_created_at (created_at)
      )
    `);
    console.log('✓ Created activity_logs table');

    // 9. Create user_totp table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS user_totp (
        id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
        user_id CHAR(36) NOT NULL UNIQUE,
        secret VARCHAR(255) NOT NULL,
        enabled BOOLEAN DEFAULT FALSE,
        backup_codes JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_user_id (user_id)
      )
    `);
    console.log('✓ Created user_totp table');

    // 10. Create site_visits table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS site_visits (
        id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
        user_id CHAR(36),
        ip_address VARCHAR(45),
        user_agent TEXT,
        page_url VARCHAR(500),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
        INDEX idx_user_id (user_id),
        INDEX idx_created_at (created_at)
      )
    `);
    console.log('✓ Created site_visits table');

    // 11. Create login_attempts table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS login_attempts (
        id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
        email VARCHAR(255) NOT NULL,
        ip_address VARCHAR(45),
        success BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_email (email),
        INDEX idx_created_at (created_at)
      )
    `);
    console.log('✓ Created login_attempts table');

    console.log('\n✓ Database migration completed successfully!');
  } catch (error) {
    console.error('✗ Migration error:', error.message);
    if (error.code !== 'ER_TABLE_EXISTS_ERROR') {
      throw error;
    }
  } finally {
    connection.release();
    await pool.end();
  }
}

migrate();
