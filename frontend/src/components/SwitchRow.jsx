import { useId } from 'react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

// Przelacznik z opisem: cala etykieta jest klikalna
export default function SwitchRow({ label, description, checked, onCheckedChange, disabled }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="grid gap-0.5">
        <Label htmlFor={id} className="leading-snug">{label}</Label>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} className="mt-0.5" />
    </div>
  );
}
