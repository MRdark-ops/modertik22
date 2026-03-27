# 🚀 Trading Platform - Complete Setup Guide

## **Current Status**

✅ Frontend: Running on `http://localhost:5001`  
❌ Backend Database: Not installed (needs MySQL)  
❌ Backend Server: Not running  

---

## **Step 1: Install MySQL (Choose One)**

### **A. Quick Install (Chocolatey)**
```powershell
choco install mysql
```

### **B. Manual Install**
1. Download: https://dev.mysql.com/downloads/mysql/
2. Run the `.msi` installer
3. Select **Developer Default** installation
4. Configure MySQL Server:
   - **Port**: `3306`
   - **Root Password**: `password`
   - Install as **Windows Service**: ✓
5. Complete installation

### **C. Docker (if installed)**
```powershell
docker run --name mysql_trading `
  -e MYSQL_ROOT_PASSWORD=password `
  -e MYSQL_DATABASE=trading_platform `
  -p 3306:3306 -d mysql:8.0
```

---

## **Step 2: Verify MySQL is Running**

```powershell
# Check if service is running
Get-Service | Where-Object {$_.DisplayName -like "*MySQL*"}

# Should show: Status=Running
```

---

## **Step 3: Run Database Migrations**

```powershell
cd server
node migrate.js
```

Expected output:
```
✓ Created users table
✓ Created profiles table
✓ Created deposits table
...
✓ Migration completed successfully!
```

---

## **Step 4: Start Backend Server**

```powershell
cd server
node server.js
```

Expected output:
```
Server running on http://localhost:3000
```

---

## **Step 5: Test the Platform**

### **Frontend** (already running)
- http://localhost:5001

### **Backend API** (after Step 4)
- http://localhost:3000/api/health

### **Test Flow**
1. Open http://localhost:5001
2. Register a new account
3. Login
4. Submit a deposit
5. View dashboard

---

## **Troubleshooting**

### ❌ Port 3306 refused
**Solution**: MySQL is not running
```powershell
# Find MySQL service
Get-Service | Where-Object {$_.DisplayName -like "*MySQL*"}

# Start it
net start MySQL80  # or use the service name you found
```

### ❌ "Access denied" error
**Solution**: Check database credentials in `.env`
```
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=password
DB_PORT=3306
```

### ❌ "Database does not exist"
**Solution**: Run migrations
```powershell
cd server
node migrate.js
```

### ❌ Port 3000/5001 already in use
```powershell
# Find and kill process using port 3000
netstat -ano | findstr :3000
taskkill /PID <PID> /F
```

---

## **Project Structure**

```
├── frontend (Vite + React)
│   ├── src/pages/          # All page components (FIXED ✓)
│   ├── src/hooks/          # useAuth, useVisitTracker (FIXED ✓)
│   ├── src/lib/api.js      # API client for backend communication ✓
│   └── package.json
│
├── server (Express + MySQL)
│   ├── db.js               # MySQL connection pool
│   ├── migrate.js          # Database schema creation
│   ├── server.js           # Express API server
│   ├── routes/             # API endpoints
│   │   ├── auth.js
│   │   ├── deposits.js
│   │   ├── withdrawals.js
│   │   ├── referrals.js
│   │   └── admin.js
│   ├── .env                # Database config
│   └── package.json
```

---

## **Available Commands**

### Frontend
```bash
npm run dev        # Start dev server (port 5001)
npm run build      # Build for production
npm run lint       # Check code style
npm run test       # Run tests
```

### Backend
```bash
node migrate.js    # Create database schema
node server.js     # Start API server (port 3000)
```

---

## **API Endpoints**

All endpoints are in `/src/lib/api.js`:

- `POST /auth/register` - Create new account
- `POST /auth/login` - Login
- `GET /auth/me` - Get current user
- `POST /deposits` - Create deposit (with file upload)
- `GET /deposits` - Get user's deposits
- `POST /withdrawals` - Request withdrawal
- `GET /admin/stats` - Admin dashboard stats
- `GET /admin/deposits` - All deposits (admin)
- `POST /admin/deposits/:id/approve` - Approve deposit

---

## **What's Been Done** ✅

1. ✅ Created Express backend with MySQL
2. ✅ Implemented all API endpoints
3. ✅ Created JWT authentication system
4. ✅ Updated all 12 page components to use new API
5. ✅ Fixed all Supabase references
6. ✅ Frontend dev server running
7. ✅ TypeScript dependencies installed

## **What's Next** 🔄

1. Install MySQL (see Step 1 above)
2. Run migrations (Step 3)
3. Start backend server (Step 4)
4. Test the complete flow (Step 5)

---

**Questions?** Check the troubleshooting section above!
