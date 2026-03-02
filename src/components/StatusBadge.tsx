interface StatusBadgeProps {
  status: 'pending' | 'approved' | 'rejected' | 'in_progress' | 'completed';
}

const labels: Record<string, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  in_progress: 'In Progress',
  completed: 'Completed',
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const styles: Record<string, string> = {
    pending: 'bg-warning/10 text-warning border-warning/20',
    approved: 'bg-success/10 text-success border-success/20',
    rejected: 'bg-destructive/10 text-destructive border-destructive/20',
    in_progress: 'bg-primary/10 text-primary border-primary/20',
    completed: 'bg-success/10 text-success border-success/20',
  };

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${styles[status] || 'bg-secondary text-muted-foreground border-border'}`}>
      {labels[status] || status}
    </span>
  );
}
