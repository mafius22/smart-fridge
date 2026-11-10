import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

// Przycisk z sama ikona: podpowiedz po najechaniu + aria-label dla czytnikow ekranu
export default function IconAction({ label, icon: Icon, onClick, destructive, disabled }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          onClick={onClick}
          disabled={disabled}
          className={cn(destructive && 'text-destructive hover:bg-destructive/10 hover:text-destructive')}
        >
          <Icon />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
