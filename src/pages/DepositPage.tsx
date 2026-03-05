import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/StatusBadge";
import { ArrowDownToLine, Upload, CheckCircle, X } from "lucide-react";
import { useState, useEffect } from "react";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "@/components/ui/dialog";

const depositSchema = z.object({
  amount: z.number({ invalid_type_error: "Please enter a valid amount" }).min(10, "Minimum deposit is $10").max(100000, "Maximum deposit is $100,000"),
});

const ALLOWED_FILE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_FILE_SIZE = 5 * 1024 * 1024;

export default function DepositPage() {
  const [amount, setAmount] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [showTelegram, setShowTelegram] = useState(false);
  const [lastDepositAmount, setLastDepositAmount] = useState("");
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Auto-close telegram popup after 1 minute
  useEffect(() => {
    if (!showTelegram) return;
    const timer = setTimeout(() => setShowTelegram(false), 60000);
    return () => clearTimeout(timer);
  }, [showTelegram]);

  const { data: deposits = [] } = useQuery({
    queryKey: ["deposits", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("deposits")
        .select("*")
        .order("created_at", { ascending: false });
      return data || [];
    },
    enabled: !!user,
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    if (!ALLOWED_FILE_TYPES.includes(selected.type)) {
      setErrors(prev => ({ ...prev, file: "Only PNG, JPEG, and WebP images are allowed" }));
      return;
    }
    if (selected.size > MAX_FILE_SIZE) {
      setErrors(prev => ({ ...prev, file: "File must be under 5MB" }));
      return;
    }
    setErrors(prev => { const { file, ...rest } = prev; return rest; });
    setFile(selected);
  };

  const handleSubmit = async () => {
    setErrors({});
    const result = depositSchema.safeParse({ amount: parseFloat(amount) });
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      result.error.errors.forEach(err => { fieldErrors.amount = err.message; });
      setErrors(fieldErrors);
      return;
    }
    if (!file) {
      setErrors({ file: "Please upload proof of payment" });
      return;
    }
    if (!user) return;

    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const { data: uploadData, error: uploadError } = await supabase.functions.invoke("upload-deposit-proof", {
        body: formData,
      });

      if (uploadError || !uploadData?.path) {
        toast({
          title: "Upload failed",
          description: uploadError?.message || "Upload failed",
          variant: "destructive",
        });
        setSubmitting(false);
        return;
      }

      const filePath = uploadData.path as string;

      const { error: insertError } = await supabase.from("deposits").insert({
        user_id: user.id,
        amount: result.data.amount,
        proof_url: filePath,
        status: "pending",
      });

      if (insertError) {
        toast({ title: "Error", description: insertError.message, variant: "destructive" });
      } else {
        setLastDepositAmount(result.data.amount.toFixed(2));
        setShowConfirmation(true);
        setTimeout(() => setShowTelegram(true), 3000);
        setAmount("");
        setFile(null);
        queryClient.invalidateQueries({ queryKey: ["deposits"] });
      }
    } catch {
      toast({ title: "Error", description: "Something went wrong.", variant: "destructive" });
    }
    setSubmitting(false);
  };

  return (
    <DashboardLayout title="Deposit Funds">
      <div className="space-y-6 animate-fade-in max-w-4xl">
        <div className="glass-card p-6">
          <h3 className="font-display text-lg font-semibold mb-4 flex items-center gap-2">
            <ArrowDownToLine className="w-5 h-5 text-primary" /> New Deposit
          </h3>
          <div className="space-y-4">
            <div className="p-4 rounded-lg bg-primary/5 border border-primary/20">
              <p className="text-sm font-medium text-primary mb-1">Payment Instructions</p>
              <p className="text-sm text-muted-foreground">Send your deposit via Binance Pay to the following address and upload proof below.</p>
              <p className="text-xs text-muted-foreground mt-2 font-mono bg-secondary/50 p-2 rounded">Wallet: 0x1234...abcd</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-sm text-muted-foreground">Amount (USD)</Label>
                <Input type="number" placeholder="100.00" value={amount} onChange={e => setAmount(e.target.value)}
                  className={`bg-secondary border-border focus:border-primary h-11 ${errors.amount ? 'border-destructive' : ''}`} min="10" max="100000" step="0.01" disabled={submitting} />
                {errors.amount && <p className="text-xs text-destructive">{errors.amount}</p>}
              </div>
              <div className="space-y-2">
                <Label className="text-sm text-muted-foreground">Upload Proof</Label>
                <div className="flex items-center gap-2">
                  <label className="flex-1 flex items-center justify-center gap-2 h-11 rounded-md border border-dashed border-border bg-secondary cursor-pointer hover:border-primary/50 transition-colors">
                    <Upload className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Choose file</span>
                    <input type="file" className="hidden" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" capture="environment" onChange={handleFileChange} disabled={submitting} />
                  </label>
                  {file && <span className="text-xs text-muted-foreground truncate max-w-[120px]">{file.name}</span>}
                </div>
                {errors.file && <p className="text-xs text-destructive">{errors.file}</p>}
              </div>
            </div>
            <Button type="button" onClick={handleSubmit} disabled={submitting} className="bg-primary text-primary-foreground hover:bg-primary/90">
              {submitting ? "Submitting..." : "Submit Deposit"}
            </Button>
          </div>
        </div>

        <div className="glass-card p-6">
          <h3 className="font-display text-lg font-semibold mb-4">Deposit History</h3>
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
                {deposits.map((d: any) => (
                  <tr key={d.id} className="border-b border-border/50">
                    <td className="py-3">{new Date(d.created_at).toLocaleDateString()}</td>
                    <td className="py-3 font-semibold">${Number(d.amount).toFixed(2)}</td>
                    <td className="py-3"><StatusBadge status={d.status} /></td>
                  </tr>
                ))}
                {deposits.length === 0 && (
                  <tr><td colSpan={3} className="py-6 text-center text-muted-foreground">No deposits yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Deposit Confirmation Modal */}
      <Dialog open={showConfirmation} onOpenChange={setShowConfirmation}>
        <DialogContent className="sm:max-w-md bg-card border-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-foreground">
              <CheckCircle className="w-6 h-6 text-success" />
              Deposit Request Submitted
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Your deposit request for <span className="font-semibold text-foreground">${lastDepositAmount}</span> has been successfully submitted and is pending admin approval.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="p-4 rounded-lg bg-primary/5 border border-primary/20">
              <p className="text-sm font-medium text-primary mb-2">What happens next?</p>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• Your deposit will be reviewed by our team</li>
                <li>• Approval typically takes 1-24 hours</li>
                <li>• You'll see the status update in your deposit history</li>
              </ul>
            </div>
            <div className="p-4 rounded-lg bg-secondary/50 border border-border">
              <p className="text-sm font-medium mb-2">Need help? Contact our support team</p>
              <p className="text-xs text-muted-foreground">
                For any questions about your deposit, please reach out via our support channels available in your dashboard.
              </p>
            </div>
            <DialogClose asChild>
              <Button className="w-full bg-primary text-primary-foreground hover:bg-primary/90">
                <X className="w-4 h-4 mr-2" /> Close
              </Button>
            </DialogClose>
          </div>
        </DialogContent>
      </Dialog>

      {/* Telegram Channel Popup - auto-close after 1 minute */}
      <Dialog open={showTelegram} onOpenChange={setShowTelegram}>
        <DialogContent className="sm:max-w-md bg-card border-border" onInteractOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-foreground">
              📢 انضم إلى قناتنا
            </DialogTitle>
            <DialogDescription className="text-muted-foreground text-right">
              اضغط على الرابط أدناه للاشتراك في القناة والتعلم
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <a
              href="https://t.me/powerattack"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setShowTelegram(false)}
              className="block w-full text-center py-3 px-4 rounded-lg bg-primary text-primary-foreground font-semibold hover:bg-primary/90 transition-colors"
            >
              t.me/powerattack
            </a>
          </div>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
