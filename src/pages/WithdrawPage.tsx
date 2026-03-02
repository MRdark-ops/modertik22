import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/StatusBadge";
import { ArrowUpFromLine } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";

const ETH_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
const BTC_ADDRESS_REGEX = /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$/;
const TRX_ADDRESS_REGEX = /^T[a-zA-HJ-NP-Z0-9]{33}$/;

const withdrawSchema = z.object({
  amount: z.number({ invalid_type_error: "Please enter a valid amount" }).min(50, "Minimum withdrawal is $50").max(10000, "Maximum withdrawal is $10,000"),
  walletAddress: z.string()
    .min(26, "Wallet address is too short")
    .max(62, "Wallet address is too long")
    .refine(
      addr => ETH_ADDRESS_REGEX.test(addr) || BTC_ADDRESS_REGEX.test(addr) || TRX_ADDRESS_REGEX.test(addr),
      "Please enter a valid cryptocurrency wallet address (ETH, BTC, or TRX)"
    ),
});

export default function WithdrawPage() {
  const [amount, setAmount] = useState("");
  const [walletAddress, setWalletAddress] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();

  const { data: withdrawals = [] } = useQuery({
    queryKey: ["withdrawals", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("withdrawals")
        .select("*")
        .order("created_at", { ascending: false });
      return data || [];
    },
    enabled: !!user,
  });

  const balance = profile?.balance ?? 0;

  const handleSubmit = async () => {
    setErrors({});
    const parsed = withdrawSchema.safeParse({ amount: parseFloat(amount), walletAddress });
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      parsed.error.errors.forEach(err => {
        if (err.path[0]) fieldErrors[err.path[0] as string] = err.message;
      });
      setErrors(fieldErrors);
      return;
    }
    if (parsed.data.amount > balance) {
      setErrors({ amount: "Insufficient balance" });
      return;
    }
    if (!user) return;

    setSubmitting(true);
    const { error } = await supabase.rpc("create_withdrawal", {
      p_amount: parsed.data.amount,
      p_wallet_address: parsed.data.walletAddress,
    });
    setSubmitting(false);

    if (error) {
      const msg = error.message.includes("Insufficient balance")
        ? "Insufficient balance"
        : error.message;
      toast({ title: "Error", description: msg, variant: "destructive" });
    } else {
      toast({ title: "Withdrawal requested", description: "Your withdrawal is pending admin approval." });
      setAmount("");
      setWalletAddress("");
      queryClient.invalidateQueries({ queryKey: ["withdrawals"] });
      queryClient.invalidateQueries({ queryKey: ["profile"] });
    }
  };

  return (
    <DashboardLayout title="Withdraw Funds">
      <div className="space-y-6 animate-fade-in max-w-4xl">
        <div className="glass-card p-6">
          <h3 className="font-display text-lg font-semibold mb-4 flex items-center gap-2">
            <ArrowUpFromLine className="w-5 h-5 text-primary" /> New Withdrawal
          </h3>
          <div className="space-y-4">
            <div className="p-4 rounded-lg bg-secondary/50 border border-border">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Available Balance</span>
                <span className="font-semibold gold-gradient-text">${Number(balance).toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm mt-1">
                <span className="text-muted-foreground">Minimum Withdrawal</span>
                <span>$50.00</span>
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">Withdrawal Amount (USD)</Label>
              <Input type="number" placeholder="50.00" value={amount} onChange={e => setAmount(e.target.value)}
                className={`bg-secondary border-border focus:border-primary h-11 ${errors.amount ? 'border-destructive' : ''}`} min="50" max="10000" step="0.01" disabled={submitting} />
              {errors.amount && <p className="text-xs text-destructive">{errors.amount}</p>}
            </div>
            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">Wallet Address</Label>
              <Input placeholder="Enter your wallet address" value={walletAddress} onChange={e => setWalletAddress(e.target.value)}
                className={`bg-secondary border-border focus:border-primary h-11 ${errors.walletAddress ? 'border-destructive' : ''}`} maxLength={200} disabled={submitting} />
              {errors.walletAddress && <p className="text-xs text-destructive">{errors.walletAddress}</p>}
            </div>
            <Button onClick={handleSubmit} disabled={submitting} className="bg-primary text-primary-foreground hover:bg-primary/90">
              {submitting ? "Submitting..." : "Request Withdrawal"}
            </Button>
          </div>
        </div>

        <div className="glass-card p-6">
          <h3 className="font-display text-lg font-semibold mb-4">Withdrawal History</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 text-muted-foreground font-medium">Date</th>
                  <th className="text-left py-3 text-muted-foreground font-medium">Amount</th>
                  <th className="text-left py-3 text-muted-foreground font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {withdrawals.map((w: any) => (
                  <tr key={w.id} className="border-b border-border/50">
                    <td className="py-3">{new Date(w.created_at).toLocaleDateString()}</td>
                    <td className="py-3 font-semibold">${Number(w.amount).toFixed(2)}</td>
                    <td className="py-3"><StatusBadge status={w.status} /></td>
                  </tr>
                ))}
                {withdrawals.length === 0 && (
                  <tr><td colSpan={3} className="py-6 text-center text-muted-foreground">No withdrawals yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
