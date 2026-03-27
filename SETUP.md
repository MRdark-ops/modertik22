# Global Trading Platform - Setup Guide

هذا المشروع تم تحويله من Supabase إلى Backend Express مع قاعدة بيانات SQL خاصة.

## متطلبات النظام

- Node.js 18+ و npm
- MySQL 8.0+
- متصفح حديث

## خطوات التثبيت

### 1. تثبيت Dependencies

**للـ Frontend:**
```bash
cd c:\Users\admin\Downloads\modertik22
npm install
```

**للـ Backend:**
```bash
cd server
npm install
```

### 2. إعداد قاعدة البيانات

```bash
# إنشاء قاعدة بيانات MySQL
mysql -u root -p
> CREATE DATABASE trading_platform;
> EXIT;
```

### 3. إعداد ملفات البيئة

**Frontend (.env):**
```env
VITE_API_URL="http://localhost:3000/api"
```

**Backend (server/.env):**
```env
PORT=3000
NODE_ENV=development

DB_HOST=localhost
DB_USER=root
DB_PASSWORD=password
DB_DATABASE=trading_platform
DB_PORT=3306

JWT_SECRET=your_super_secret_jwt_key_change_this_in_production
JWT_EXPIRES_IN=7d

UPLOAD_DIR=./uploads
MAX_FILE_SIZE=5242880

CORS_ORIGIN=http://localhost:5000
ADMIN_EMAIL=admin@example.com
```

### 4. تشغيل الـ Migrations

```bash
cd server
npm run migrate
```

هذا سينشئ جميع الجداول المطلوبة في قاعدة البيانات.

## تشغيل المشروع

### في terminals منفصلة:

**Terminal 1 - Backend Server:**
```bash
cd server
npm run dev
```
سيعمل على: `http://localhost:3000`

**Terminal 2 - Frontend:**
```bash
npm run dev
```
سيعمل على: `http://localhost:5000`

## الميزات المضافة

✅ Backend Express مع MySQL
✅ JWT Authentication
✅ Deposits/Withdrawals Management
✅ 5-Level Referral System
✅ Admin Dashboard & Controls
✅ Activity Logging
✅ Image Upload for Deposits
✅ CORS Configuration

## الميزات الإضافية المدعومة

- **User Management**: Create, Read, Update, Delete users
- **Role Management**: Admin/User roles
- **Commission System**: Automatic multi-level commissions
- **Balance Management**: Atomic transactions for deposits/withdrawals
- **Admin Analytics**: Dashboard statistics and logs

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user
- `GET /api/auth/me` - Get current user
- `PUT /api/auth/profile` - Update profile

### Deposits
- `POST /api/deposits` - Create deposit
- `GET /api/deposits` - Get user deposits
- `GET /api/deposits/all` - Get all deposits (admin)
- `POST /api/deposits/:id/approve` - Approve deposit (admin)
- `POST /api/deposits/:id/reject` - Reject deposit (admin)

### Withdrawals
- `POST /api/withdrawals` - Create withdrawal
- `GET /api/withdrawals` - Get user withdrawals
- `GET /api/withdrawals/all` - Get all withdrawals (admin)
- `POST /api/withdrawals/:id/approve` - Approve withdrawal (admin)
- `POST /api/withdrawals/:id/reject` - Reject withdrawal (admin)

### Referrals
- `GET /api/referrals` - Get referrals info
- `GET /api/referrals/code` - Get referral code

### Admin
- `GET /api/admin/users` - Get all users
- `GET /api/admin/stats` - Get platform stats
- `GET /api/admin/logs` - Get activity logs
- `POST /api/admin/users/:id/promote` - Promote to admin
- `POST /api/admin/users/:id/demote` - Demote from admin
- `DELETE /api/admin/users/:id` - Delete user

## البنية

```
modertik22/
├── server/                    # Backend Express Server
│   ├── db.js                 # Database connection
│   ├── auth.js               # JWT utilities
│   ├── migrate.js            # Database migrations
│   ├── server.js             # Main server
│   └── routes/
│       ├── auth.js
│       ├── deposits.js
│       ├── withdrawals.js
│       ├── referrals.js
│       └── admin.js
├── src/                       # Frontend React App
│   ├── lib/
│   │   └── api.js           # API client
│   ├── hooks/
│   │   └── useAuth.tsx      # Auth hook
│   ├── pages/               # Page components
│   └── components/          # UI components
└── .env                      # Configuration
```

## الاختبار

```bash
# Backend health check
curl http://localhost:3000/health

# Frontend running on port 5000
curl http://localhost:5000
```

## ملاحظات أمان

⚠️ **تغيير `JWT_SECRET` في الإنتاج**: استخدم قيمة قوية جداً وعشوائية

⚠️ **قاعدة البيانات**: استخدم كلمات مرور قوية

⚠️ **CORS**: قيد CORS_ORIGIN للـ production domains فقط

## استكشاف الأخطاء

### خطأ: "connect ECONNREFUSED localhost:3306"
- تأكد من تشغيل MySQL server
- تحقق من قيم قاعدة البيانات في .env

### خطأ: "Unauthorized" في API calls
- تأكد من أن token صحيح و موجود في localStorage
- تحقق من انتهاء الـ token

### الملفات المرفوعة لا تظهر
- تأكد من أن مجلد `uploads` موجود وقابل للكتابة
- تحقق من قيمة `UPLOAD_DIR` في .env

## الدعم والمساعدة

للمزيد من المعلومات، راجع:
- [Express.js Documentation](https://expressjs.com)
- [MySQL Documentation](https://dev.mysql.com/doc)
- [JWT Authentication](https://tools.ietf.org/html/rfc7519)
