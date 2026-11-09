import { AlertTriangle } from "lucide-react";

interface EnrollProAlertProps {
  message: string;
}

export default function EnrollProAlert({ message }: EnrollProAlertProps) {
  return (
    <div
      role="alert"
      data-testid="eosy-enrollpro-alert"
      className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800"
    >
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
      <p className="text-sm font-medium">{message}</p>
    </div>
  );
}
