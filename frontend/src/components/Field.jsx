import { useId, cloneElement, isValidElement } from 'react';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

// Etykieta + pole + podpowiedz; id laczy etykiete z polem (klikniecie w etykiete, czytniki ekranu)
export default function Field({ label, hint, className, children }) {
  const id = useId();
  const control = isValidElement(children) && !children.props.id ? cloneElement(children, { id }) : children;
  return (
    <div className={cn('grid gap-1.5', className)}>
      {label && <Label htmlFor={isValidElement(control) ? control.props.id : undefined}>{label}</Label>}
      {control}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
