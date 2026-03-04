import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { TrendingUp, Eye, EyeOff, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import authBg from "@/assets/auth-bg.jpg";

const loginSchema = z.object({
  email: z.string().trim().email("Please enter a valid email address").max(255, "Email is too long"),
  password: z.string().min(8, "Password must be at least 8 characters").max(128, "Password is too long"),
});

export default function LoginPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [needs2FA, setNeeds2FA] = useState(false);
  const [totpCode, setTotpCode] = useState("");
  const { toast } = useToast();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    const result = loginSchema.safeParse({ email, password });
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      result.error.errors.forEach(err => {
        if (err.path[0]) fieldErrors[err.path[0] as string] = err.message;
      });
      setErrors(fieldErrors);
      return;
    }

    setSubmitting(true);

    try {
      // Server-side atomic auth: password + TOTP verified BEFORE session is returned
      const authRes = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/auth-with-totp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: result.data.email,
          password: result.data.password,
          totp_code: needs2FA ? totpCode : undefined,
        }),
      });

      const authData = await authRes.json();

      // If 2FA is required but no code provided yet
      if (authData.requires_totp && !needs2FA) {
        setNeeds2FA(true);
        setSubmitting(false);
        return;
      }

      if (authData.error) {
        toast({ title: "Login failed", description: authData.error, variant: "destructive" });
        if (needs2FA) {
          setTotpCode("");
        }
        setSubmitting(false);
        return;
      }

      if (!authData.session) {
        toast({ title: "Login failed", description: "Invalid response from server.", variant: "destructive" });
        setSubmitting(false);
        return;
      }

      // Set session from server response — session only exists AFTER all verification passed
      const { data: existingSessionData } = await supabase.auth.getSession();
      const existingAccessToken = existingSessionData.session?.access_token;

      if (existingAccessToken !== authData.session.access_token) {
        await supabase.auth.setSession(authData.session);
      }

      // Navigate based on authenticated role check (fallback to server flag)
      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", authData.user?.id ?? "");

      const hasAdminRole = roles?.some((r: { role: string }) => r.role === "admin") ?? false;

      if (hasAdminRole || authData.is_admin) {
        navigate("/admin");
      } else {
        navigate("/dashboard");
      }
    } catch {
      toast({ title: "Error", description: "Authentication failed. Please try again.", variant: "destructive" });
    }

    setSubmitting(false);
  };

  return (
    <div className="min-h-screen flex">
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md space-y-8">
          <div className="text-center space-y-2">
            <div className="w-16 h-16 rounded-2xl bg-primary/20 flex items-center justify-center mx-auto mb-4">
              <TrendingUp className="w-8 h-8 text-primary" />
            </div>
            <h1 className="text-3xl font-display font-bold gold-gradient-text">Welcome Back</h1>
            <p className="text-muted-foreground">Sign in to your Global Trading account</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm text-muted-foreground">Email</Label>
              <Input
                id="email" type="email" placeholder="you@example.com"
                value={email} onChange={e => setEmail(e.target.value)}
                className={`bg-secondary border-border focus:border-primary focus:ring-primary/20 h-11 ${errors.email ? 'border-destructive' : ''}`}
                required maxLength={255} disabled={submitting || needs2FA}
              />
              {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="password" className="text-sm text-muted-foreground">Password</Label>
              <div className="relative">
                <Input
                  id="password" type={showPassword ? "text" : "password"} placeholder="••••••••"
                  value={password} onChange={e => setPassword(e.target.value)}
                  className={`bg-secondary border-border focus:border-primary focus:ring-primary/20 h-11 pr-10 ${errors.password ? 'border-destructive' : ''}`}
                  required maxLength={128} disabled={submitting || needs2FA}
                />
                {errors.password && <p className="text-xs text-destructive mt-1">{errors.password}</p>}
                <button type="button" onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {needs2FA && (
              <div className="space-y-2 p-4 rounded-lg bg-primary/5 border border-primary/20 animate-fade-in">
                <div className="flex items-center gap-2 mb-2">
                  <Shield className="w-4 h-4 text-primary" />
                  <Label className="text-sm font-medium text-primary">Two-Factor Authentication</Label>
                </div>
                <p className="text-xs text-muted-foreground mb-3">Enter the 6-digit code from your authenticator app</p>
                <Input
                  placeholder="000000"
                  value={totpCode}
                  onChange={e => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  className="bg-secondary border-border focus:border-primary h-11 text-center text-lg tracking-widest max-w-[200px]"
                  maxLength={6}
                  disabled={submitting}
                  autoFocus
                />
              </div>
            )}

            <Button type="submit" disabled={submitting || (needs2FA && totpCode.length !== 6)} className="w-full h-11 bg-primary text-primary-foreground hover:bg-primary/90 font-semibold">
              {submitting ? "Signing in..." : needs2FA ? "Verify & Sign In" : "Sign In"}
            </Button>

            {needs2FA && (
              <Button type="button" variant="ghost" className="w-full text-muted-foreground" onClick={() => { setNeeds2FA(false); setTotpCode(""); }}>
                Back to login
              </Button>
            )}
          </form>

          <p className="text-center text-sm text-muted-foreground">
            Don't have an account?{" "}
            <Link to="/register" className="text-primary hover:underline font-medium">Create Account</Link>
          </p>
        </div>
      </div>
      <div className="hidden lg:block flex-1 relative overflow-hidden">
        <img src={authBg} alt="Trading background" className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-background/40" />
        <div className="absolute inset-0 flex items-center justify-center p-12">
          <div className="text-center space-y-4">
            <h2 className="text-4xl font-display font-bold gold-gradient-text">Global Trading</h2>
            <p className="text-foreground/70 max-w-sm">Your gateway to premium trading opportunities with multi-level referral rewards.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
