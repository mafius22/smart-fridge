import { CircleAlert, CircleCheck } from 'lucide-react';
import { cn } from '@/lib/utils';

// Komunikat pod formularzem: { type: 'error' | 'success', text }
export default function FormMessage({ message, className }) {
  if (!message) return null;
  const error = message.type === 'error';
  const Icon = error ? CircleAlert : CircleCheck;
  return (
    <div
      role={error ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-2 rounded-lg border px-3 py-2 text-sm',
        error ? 'border-destructive/30 bg-destructive/8 text-destructive' : 'border-ok/30 bg-ok/8 text-ok',
        className,
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <span className="whitespace-pre-line">{message.text}</span>
    </div>
  );
}
