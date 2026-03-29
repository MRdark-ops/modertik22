import mongoose from 'mongoose';

const UserSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password_hash: { type: String, required: true },
  role: { type: String, default: 'user', enum: ['user', 'admin'] },
  created_at: { type: Date, default: Date.now }
});

const ProfileSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  full_name: { type: String, required: true },
  balance: { type: Number, default: 0 },
  referral_code: { type: String, unique: true },
  referred_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  created_at: { type: Date, default: Date.now }
});

const DepositSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  amount: { type: Number, required: true },
  proof_url: { type: String },
  status: { type: String, default: 'pending', enum: ['pending', 'approved', 'rejected'] },
  has_commissions: { type: Date, default: null },
  created_at: { type: Date, default: Date.now }
});

const ReferralSchema = new mongoose.Schema({
  referrer_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  referred_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  level: { type: Number, default: 1 },
  created_at: { type: Date, default: Date.now }
});

const ActivityLogSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  action: { type: String, required: true },
  details: { type: mongoose.Schema.Types.Mixed },
  created_at: { type: Date, default: Date.now }
});

const LoginAttemptSchema = new mongoose.Schema({
  email: { type: String, required: true },
  success: { type: Boolean, default: false },
  created_at: { type: Date, default: Date.now }
});

const TotpSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  secret: { type: String, default: '' },
  enabled: { type: Boolean, default: false }
});

const User = mongoose.model('User', UserSchema);
const Profile = mongoose.model('Profile', ProfileSchema);
const Deposit = mongoose.model('Deposit', DepositSchema);
const Referral = mongoose.model('Referral', ReferralSchema);
const ActivityLog = mongoose.model('ActivityLog', ActivityLogSchema);
const LoginAttempt = mongoose.model('LoginAttempt', LoginAttemptSchema);
const Totp = mongoose.model('Totp', TotpSchema);

export {
  User,
  Profile,
  Deposit,
  Referral,
  ActivityLog,
  LoginAttempt,
  Totp
};