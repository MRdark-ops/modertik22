import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import QRCode from "qrcode";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Shield, ShieldCheck, ShieldOff, Copy, Check } from "lucide-react";

export default function SecuritySettingsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [setupData, setSetupData] = useState<{ secret: string; otpauth_uri: string } | null>(null);
  const [qrCodeUrl, setQrCodeUrl] = useState<string>("");
  const [code, setCode] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState("");

  // Generate QR code client-side when setup data changes
  useEffect(() => {
    if (setupData?.otpauth_uri) {
      QRCode.toDataURL(setupData.otpauth_uri, { width: 200, margin: 2 })
        .then((url: string) => setQrCodeUrl(url))
        .catch(() => setQrCodeUrl(""));
    } else {
      setQrCodeUrl("");
    }
  }, [setupData]);

  const { data: totpStatus, isLoading: statusLoading } = useQuery({
    queryKey: ["totp-status", user?.id],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/totp-setup`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "status" }),
      });
      return res.json();
    },
    enabled: !!user,
  });

  const handleSetup = async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/totp-setup`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "setup" }),
      });
      const data = await res.json();
      if (data.error) {
        toast({ title: "Error", description: data.error, variant: "destructive" });
      } else {
        setSetupData(data);
      }
    } catch {
      toast({ title: "Error", description: "Failed to initialize 2FA setup", variant: "destructive" });
    }
    setLoading(false);
  };

  const handleEnable = async () => {
    if (!/^\d{6}$/.test(code)) {
      toast({ title: "Error", description: "Please enter a valid 6-digit code", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/totp-setup`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "enable", code }),
      });
      const data = await res.json();
      if (data.error) {
        toast({ title: "Invalid Code", description: data.error, variant: "destructive" });
      } else {
        toast({ title: "2FA Enabled", description: "Two-factor authentication has been activated." });
        setSetupData(null);
        setCode("");
        queryClient.invalidateQueries({ queryKey: ["totp-status"] });
      }
    } catch {
      toast({ title: "Error", description: "Failed to enable 2FA", variant: "destructive" });
    }
    setLoading(false);
  };

  const handleDisable = async () => {
    if (!/^\d{6}$/.test(disableCode)) {
      toast({ title: "Error", description: "Please enter a valid 6-digit code", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/totp-setup`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "disable", code: disableCode }),
      });
      const data = await res.json();
      if (data.error) {
        toast({ title: "Invalid Code", description: data.error, variant: "destructive" });
      } else {
        toast({ title: "2FA Disabled", description: "Two-factor authentication has been removed." });
        setDisableCode("");
        queryClient.invalidateQueries({ queryKey: ["totp-status"] });
      }
    } catch {
      toast({ title: "Error", description: "Failed to disable 2FA", variant: "destructive" });
    }
    setLoading(false);
  };

  const copySecret = () => {
    if (setupData?.secret) {
      navigator.clipboard.writeText(setupData.secret);
      setCopied("secret");
      setTimeout(() => setCopied(""), 2000);
    }
  };

  const isEnabled = totpStatus?.enabled;

  return (
    <DashboardLayout title="Security Settings">
      <div className="space-y-6 animate-fade-in max-w-2xl">
        <div className="glass-card p-6">
          <h3 className="font-display text-lg font-semibold mb-2 flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" /> Two-Factor Authentication (2FA)
          </h3>
          <p className="text-sm text-muted-foreground mb-6">
            Add an extra layer of security to your account using Google Authenticator or any TOTP-compatible app.
          </p>

          {statusLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary" />
              Loading...
            </div>
          ) : isEnabled ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 p-3 rounded-lg bg-success/10 border border-success/20">
                <ShieldCheck className="w-5 h-5 text-success" />
                <span className="text-sm font-medium text-success">2FA is active</span>
              </div>
              <div className="space-y-3">
                <Label className="text-sm text-muted-foreground">Enter code from your authenticator to disable 2FA</Label>
                <div className="flex gap-2">
                  <Input
                    placeholder="000000"
                    value={disableCode}
                    onChange={e => setDisableCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    className="bg-secondary border-border focus:border-primary h-11 max-w-[200px] text-center text-lg tracking-widest"
                    maxLength={6}
                    disabled={loading}
                  />
                  <Button onClick={handleDisable} disabled={loading} variant="destructive">
                    {loading ? "Disabling..." : "Disable 2FA"}
                  </Button>
                </div>
              </div>
            </div>
          ) : setupData ? (
            <div className="space-y-5">
              <div className="space-y-3">
                <p className="text-sm font-medium">1. Scan QR code or enter secret manually</p>
                <div className="flex flex-col items-center gap-4 p-4 rounded-lg bg-secondary/50 border border-border">
                  {qrCodeUrl ? (
                    <img
                      src={qrCodeUrl}
                      alt="TOTP QR Code"
                      className="rounded-lg"
                      width={200}
                      height={200}
                    />
                  ) : (
                    <div className="w-[200px] h-[200px] flex items-center justify-center text-muted-foreground text-sm">
                      Generating QR code...
                    </div>
                  )}
                  <div className="flex items-center gap-2 w-full max-w-sm">
                    <code className="flex-1 text-xs bg-background p-2 rounded border border-border text-center break-all">
                      {setupData.secret}
                    </code>
                    <Button onClick={copySecret} variant="outline" size="icon" className="shrink-0">
                      {copied === "secret" ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>
              </div>
              <div className="space-y-3">
                <p className="text-sm font-medium">2. Enter the 6-digit code from your app</p>
                <div className="flex gap-2">
                  <Input
                    placeholder="000000"
                    value={code}
                    onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    className="bg-secondary border-border focus:border-primary h-11 max-w-[200px] text-center text-lg tracking-widest"
                    maxLength={6}
                    disabled={loading}
                  />
                  <Button onClick={handleEnable} disabled={loading || code.length !== 6} className="bg-primary text-primary-foreground hover:bg-primary/90">
                    {loading ? "Verifying..." : "Verify & Enable"}
                  </Button>
                </div>
              </div>
              <Button onClick={() => setSetupData(null)} variant="ghost" className="text-muted-foreground">
                Cancel
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                <ShieldOff className="w-5 h-5 text-destructive" />
                <span className="text-sm font-medium text-destructive">2FA is not enabled</span>
              </div>
              <Button onClick={handleSetup} disabled={loading} className="bg-primary text-primary-foreground hover:bg-primary/90">
                {loading ? "Setting up..." : "Set Up 2FA"}
              </Button>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
