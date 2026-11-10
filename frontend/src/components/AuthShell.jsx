import { Thermometer } from 'lucide-react';

// Strony bez menu (logowanie, wymuszona zmiana hasla)
export default function AuthShell({ children }) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted/40 px-4 py-10 lg:gap-8">
      <div className="flex items-center gap-2 text-lg font-semibold lg:gap-3 lg:text-2xl">
        <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm lg:size-12">
          <Thermometer className="size-5 lg:size-6" />
        </span>
        Smart Fridge
      </div>
      {/* Na komputerze szerszy formularz, wieksze pola i tekst */}
      <div className="w-full max-w-sm sm:max-w-md lg:max-w-lg lg:[&_[data-slot=card]]:gap-6 lg:[&_[data-slot=card]]:py-8 lg:[&_[data-slot=card-content]]:px-8 lg:[&_[data-slot=card-header]]:px-8 lg:[&_[data-slot=card-title]]:text-2xl lg:[&_[data-slot=card-description]]:text-base lg:[&_[data-slot=input]]:h-11 lg:[&_[data-slot=input]]:text-base lg:[&_[data-slot=label]]:text-base lg:[&_[data-slot=button]]:h-11 lg:[&_[data-slot=button]]:text-base">
        {children}
      </div>
    </div>
  );
}
