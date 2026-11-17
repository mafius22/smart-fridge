import { Folder } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

// Radix Select nie pozwala na pusta wartosc - "none" = Bez folderu
const NONE = 'none';
const collator = new Intl.Collator('pl', { numeric: true, sensitivity: 'base' });

export default function FolderSelect({ value, folders, onChange, className, size = 'default', id }) {
  return (
    <Select
      value={value == null || value === '' ? NONE : String(value)}
      onValueChange={(v) => onChange(v === NONE ? null : Number(v))}
    >
      <SelectTrigger id={id} size={size} className={cn('w-full text-left *:data-[slot=select-value]:flex-1', className)} aria-label="Folder">
        <Folder className="text-muted-foreground" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>Bez folderu</SelectItem>
        {[...folders].sort((a, b) => collator.compare(a.name, b.name)).map((f) => <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
