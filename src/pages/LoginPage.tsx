import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { TrendingUp, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
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
  const { toast } = useToast();
  const navigate = useNavigate();
  const { login, isAdmin } = useAuth();

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
      await login(result.data.email, result.data.password);
      toast({ title: "Success", description: "Logged in successfully" });
      
      // Navigate based on role
      if (isAdmin) {
        navigate("/admin");
      } else {
        navigate("/dashboard");
      }
    } catch (error: any) {
      toast({ title: "Login failed", description: error.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
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
                required maxLength={255} disabled={submitting}
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
                  required maxLength={128} disabled={submitting}
                />
                {errors.password && <p className="text-xs text-destructive mt-1">{errors.password}</p>}
                <button type="button" onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <Button type="submit" disabled={submitting} className="w-full h-11 bg-primary text-primary-foreground hover:bg-primary/90 font-semibold">
              {submitting ? "Signing in..." : "Sign In"}
            </Button>
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
