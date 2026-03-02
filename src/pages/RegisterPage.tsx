import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { TrendingUp, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import authBg from "@/assets/auth-bg.jpg";

const registerSchema = z.object({
  fullName: z.string().trim().min(2, "Name must be at least 2 characters").max(100, "Name is too long")
    .regex(/^[a-zA-Z\s'-]+$/, "Name contains invalid characters"),
  email: z.string().trim().email("Please enter a valid email address").max(255, "Email is too long"),
  password: z.string().min(8, "Password must be at least 8 characters").max(128, "Password is too long")
    .regex(/[A-Z]/, "Must contain an uppercase letter")
    .regex(/[0-9]/, "Must contain a number")
    .regex(/[^a-zA-Z0-9]/, "Must contain a special character"),
  referralCode: z.string().max(20, "Referral code is too long").regex(/^[a-zA-Z0-9]*$/, "Invalid referral code format").optional().or(z.literal("")),
});

export default function RegisterPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [form, setForm] = useState({ fullName: "", email: "", password: "", referralCode: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    const result = registerSchema.safeParse(form);
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      result.error.errors.forEach(err => {
        if (err.path[0]) fieldErrors[err.path[0] as string] = err.message;
      });
      setErrors(fieldErrors);
      return;
    }

    setSubmitting(true);
    const { error } = await supabase.auth.signUp({
      email: result.data.email,
      password: result.data.password,
      options: {
        emailRedirectTo: window.location.origin,
        data: {
          full_name: result.data.fullName,
          referral_code: result.data.referralCode || undefined,
        },
      },
    });
    setSubmitting(false);

    if (error) {
      toast({ title: "Registration failed", description: error.message, variant: "destructive" });
      return;
    }

    toast({ title: "Account created!", description: "Please check your email to verify your account before signing in." });
    navigate("/login");
  };

  const update = (key: string, value: string) => setForm(f => ({ ...f, [key]: value }));

  return (
    <div className="min-h-screen flex">
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md space-y-8">
          <div className="text-center space-y-2">
            <div className="w-16 h-16 rounded-2xl bg-primary/20 flex items-center justify-center mx-auto mb-4">
              <TrendingUp className="w-8 h-8 text-primary" />
            </div>
            <h1 className="text-3xl font-display font-bold gold-gradient-text">Create Account</h1>
            <p className="text-muted-foreground">Join Global Trading and start earning</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">Full Name</Label>
              <Input placeholder="John Doe" value={form.fullName} onChange={e => update("fullName", e.target.value)}
                className={`bg-secondary border-border focus:border-primary h-11 ${errors.fullName ? 'border-destructive' : ''}`} required maxLength={100} disabled={submitting} />
              {errors.fullName && <p className="text-xs text-destructive">{errors.fullName}</p>}
            </div>
            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">Email</Label>
              <Input type="email" placeholder="you@example.com" value={form.email} onChange={e => update("email", e.target.value)}
                className={`bg-secondary border-border focus:border-primary h-11 ${errors.email ? 'border-destructive' : ''}`} required maxLength={255} disabled={submitting} />
              {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
            </div>
            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">Password</Label>
              <div className="relative">
                <Input type={showPassword ? "text" : "password"} placeholder="••••••••" value={form.password}
                  onChange={e => update("password", e.target.value)}
                  className={`bg-secondary border-border focus:border-primary h-11 pr-10 ${errors.password ? 'border-destructive' : ''}`} required maxLength={128} disabled={submitting} />
                {errors.password && <p className="text-xs text-destructive mt-1">{errors.password}</p>}
                <button type="button" onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">Referral Code (Optional)</Label>
              <Input placeholder="Enter referral code" value={form.referralCode} onChange={e => update("referralCode", e.target.value)}
                className={`bg-secondary border-border focus:border-primary h-11 ${errors.referralCode ? 'border-destructive' : ''}`} maxLength={20} disabled={submitting} />
              {errors.referralCode && <p className="text-xs text-destructive">{errors.referralCode}</p>}
            </div>
            <Button type="submit" disabled={submitting} className="w-full h-11 bg-primary text-primary-foreground hover:bg-primary/90 font-semibold">
              {submitting ? "Creating account..." : "Create Account"}
            </Button>
          </form>

          <p className="text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link to="/login" className="text-primary hover:underline font-medium">Sign In</Link>
          </p>
        </div>
      </div>
      <div className="hidden lg:block flex-1 relative overflow-hidden">
        <img src={authBg} alt="Trading background" className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-background/40" />
        <div className="absolute inset-0 flex items-center justify-center p-12">
          <div className="text-center space-y-4">
            <h2 className="text-4xl font-display font-bold gold-gradient-text">Global Trading</h2>
            <p className="text-foreground/70 max-w-sm">Earn up to 30% through our 5-level referral program.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
