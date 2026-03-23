# Global Trading Platform

## Overview
A full-featured trading investment platform with referral commissions, deposits, withdrawals, and admin management. Built with React, Vite, and Supabase.

## Architecture
- **Frontend**: React 18 + TypeScript + Vite, served on port 5000
- **UI**: Tailwind CSS + shadcn/ui + Radix UI
- **Auth**: Supabase Auth with custom TOTP 2FA via edge functions
- **Database**: Supabase PostgreSQL with Row Level Security
- **Edge Functions**: Supabase Edge Functions (Deno) for sensitive operations
- **Storage**: Supabase Storage for deposit proof images

## Key Features
- User authentication with optional TOTP 2FA
- Deposit/withdrawal management with admin approval workflow
- 5-level referral commission system ($2.50 flat per direct referral)
- Admin dashboard with user, deposit, withdrawal, referral, and log management
- Site visit tracking
- Capacitor integration for mobile (AdMob banner ads)

## Supabase Project
- Project ID: `tflqruwrfplrsfasfbia`
- URL: `https://tflqruwrfplrsfasfbia.supabase.co`

## Edge Functions (Supabase)
- `auth-with-totp` — Login with optional 2FA, rate-limited
- `totp-setup` — Setup/enable/disable/status TOTP 2FA
- `totp-verify` — Verify TOTP code
- `approve-deposit` — Admin approve/reject deposits
- `approve-withdrawal` — Admin approve/reject/progress withdrawals
- `upload-deposit-proof` — Authenticated file upload with magic-byte validation
- `manage-user-role` — Admin promote/demote/delete users

## Database Schema (Supabase)
Tables: `profiles`, `user_roles`, `deposits`, `withdrawals`, `referrals`, `referral_commissions`, `activity_logs`, `user_totp`, `site_visits`, `login_attempts`

## Environment Variables
Set in Replit environment (shared):
- `VITE_SUPABASE_URL` — Supabase project URL
- `VITE_SUPABASE_PUBLISHABLE_KEY` — Supabase anon key (public, safe)
- `VITE_SUPABASE_PROJECT_ID` — Supabase project ID

## Development
```bash
npm run dev     # Start dev server on port 5000
npm run build   # Production build
npm run lint    # Lint check
```

## Replit Migration Notes
- Migrated from Lovable to Replit
- Removed `lovable-tagger` dev dependency
- Vite server configured on `0.0.0.0:5000` with `allowedHosts: true`
- Replit domain added to CORS allowed origins in edge functions
- App still uses Supabase for all backend functionality (auth, DB, storage, edge functions)
