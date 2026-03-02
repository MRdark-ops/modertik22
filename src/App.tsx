import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import UserDashboard from "./pages/UserDashboard";
import DepositPage from "./pages/DepositPage";
import WithdrawPage from "./pages/WithdrawPage";
import ReferralsPage from "./pages/ReferralsPage";
import SecuritySettingsPage from "./pages/SecuritySettingsPage";
import AdminDashboard from "./pages/AdminDashboard";
import AdminUsersPage from "./pages/AdminUsersPage";
import AdminDepositsPage from "./pages/AdminDepositsPage";
import AdminWithdrawalsPage from "./pages/AdminWithdrawalsPage";
import AdminReferralsPage from "./pages/AdminReferralsPage";
import AdminLogsPage from "./pages/AdminLogsPage";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/dashboard" element={<ProtectedRoute><UserDashboard /></ProtectedRoute>} />
            <Route path="/deposit" element={<ProtectedRoute><DepositPage /></ProtectedRoute>} />
            <Route path="/withdraw" element={<ProtectedRoute><WithdrawPage /></ProtectedRoute>} />
            <Route path="/referrals" element={<ProtectedRoute><ReferralsPage /></ProtectedRoute>} />
            <Route path="/security" element={<ProtectedRoute><SecuritySettingsPage /></ProtectedRoute>} />
            <Route path="/admin" element={<ProtectedRoute requireAdmin><AdminDashboard /></ProtectedRoute>} />
            <Route path="/admin/users" element={<ProtectedRoute requireAdmin><AdminUsersPage /></ProtectedRoute>} />
            <Route path="/admin/deposits" element={<ProtectedRoute requireAdmin><AdminDepositsPage /></ProtectedRoute>} />
            <Route path="/admin/withdrawals" element={<ProtectedRoute requireAdmin><AdminWithdrawalsPage /></ProtectedRoute>} />
            <Route path="/admin/referrals" element={<ProtectedRoute requireAdmin><AdminReferralsPage /></ProtectedRoute>} />
            <Route path="/admin/logs" element={<ProtectedRoute requireAdmin><AdminLogsPage /></ProtectedRoute>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
