import { Link } from "react-router-dom";
import { TrendingUp, Shield, Users, ArrowRight, Wallet, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import authBg from "@/assets/auth-bg.jpg";
import { useVisitTracker } from "@/hooks/useVisitTracker";

const features = [
  { icon: Wallet, title: "Secure Deposits", desc: "Fund your account with verified payment methods and admin-approved transactions." },
  { icon: Users, title: "5-Level Referrals", desc: "Earn commissions up to 5 levels deep — 10%, 8%, 6%, 4%, and 2% per level." },
  { icon: Shield, title: "Bank-Grade Security", desc: "Input validation, secure authentication, and role-based access control." },
  { icon: BarChart3, title: "Real-Time Dashboard", desc: "Track your balance, earnings, referral network, and withdrawal history." },
];

export default function Index() {
  useVisitTracker();
  return (
    <div className="min-h-screen">
      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="container mx-auto flex items-center justify-between h-16 px-4">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-6 h-6 text-primary" />
            <span className="font-display text-xl font-bold gold-gradient-text">Global Trading</span>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/login">
              <Button variant="ghost" className="text-foreground hover:text-primary">Sign In</Button>
            </Link>
            <Link to="/register">
              <Button className="bg-primary text-primary-foreground hover:bg-primary/90">Get Started</Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
        <img src={authBg} alt="" className="absolute inset-0 w-full h-full object-cover opacity-40" />
        <div className="absolute inset-0 bg-gradient-to-b from-background/60 via-background/80 to-background" />
        <div className="relative z-10 container mx-auto px-4 text-center space-y-8 pt-16">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-primary/30 bg-primary/5 text-primary text-sm font-medium">
            <Shield className="w-3.5 h-3.5" /> Trusted Trading Platform
          </div>
          <h1 className="text-5xl md:text-7xl font-display font-bold leading-tight">
            <span className="gold-gradient-text">Trade Smarter.</span><br />
            <span className="text-foreground">Earn Together.</span>
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto">
            Join Global Trading and unlock premium trading opportunities with our 5-level referral commission system. Earn up to 30% in rewards.
          </p>
          <div className="flex items-center justify-center gap-4">
            <Link to="/register">
              <Button size="lg" className="bg-primary text-primary-foreground hover:bg-primary/90 h-12 px-8 text-base font-semibold gap-2">
                Start Trading <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
            <Link to="/login">
              <Button size="lg" variant="outline" className="h-12 px-8 text-base border-border hover:bg-secondary">
                Sign In
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-24 relative">
        <div className="container mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-display font-bold mb-4">
              Why <span className="gold-gradient-text">Global Trading</span>?
            </h2>
            <p className="text-muted-foreground max-w-xl mx-auto">Everything you need for a secure and profitable trading experience.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {features.map((f, i) => (
              <div key={i} className="stat-card hover:gold-glow transition-all duration-300 group">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
                  <f.icon className="w-6 h-6 text-primary" />
                </div>
                <h3 className="font-display text-lg font-semibold mb-2">{f.title}</h3>
                <p className="text-sm text-muted-foreground">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 relative">
        <div className="container mx-auto px-4">
          <div className="glass-card p-12 text-center gold-glow">
            <h2 className="text-3xl font-display font-bold mb-4 gold-gradient-text">Ready to Start Earning?</h2>
            <p className="text-muted-foreground mb-8 max-w-lg mx-auto">Create your free account today and start building your referral network.</p>
            <Link to="/register">
              <Button size="lg" className="bg-primary text-primary-foreground hover:bg-primary/90 h-12 px-10 font-semibold gap-2">
                Create Free Account <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8">
        <div className="container mx-auto px-4 flex items-center justify-between text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-primary" />
            <span className="font-display font-semibold gold-gradient-text">Global Trading</span>
          </div>
          <p>&copy; 2026 Global Trading. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
