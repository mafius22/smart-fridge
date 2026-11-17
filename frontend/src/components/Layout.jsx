import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useTheme } from 'next-themes';
import {
  Cpu, LogOut, Menu, Monitor, Moon, LayoutGrid, Settings, Sun, Thermometer, Users, Warehouse,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup,
  DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useAuth } from '@/auth/AuthContext';
import { syncPushSubscription } from '@/utils/push';

function navItems(isAdmin) {
  return [
    { to: '/', end: true, label: 'Strefy', icon: LayoutGrid },
    ...(isAdmin ? [
      { to: '/admin/users', label: 'Użytkownicy', icon: Users },
      { to: '/admin/fridges', label: 'Strefy i czujniki', icon: Warehouse },
      { to: '/admin/boards', label: 'Płytki', icon: Cpu },
    ] : []),
    { to: '/settings', label: 'Ustawienia', icon: Settings },
  ];
}

function NavItem({ item, className, onNavigate }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      className={({ isActive }) => cn(
        'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
        isActive && 'bg-muted text-foreground',
        className,
      )}
    >
      <Icon className="size-4" />
      {item.label}
    </NavLink>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2 font-semibold">
      <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <Thermometer className="size-4.5" />
      </span>
      <span>Smart Fridge</span>
    </div>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const name = user?.display_name || user?.email || '';
  const initials = name.slice(0, 2).toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-9 gap-2 px-1.5 sm:px-2" aria-label="Menu konta">
          <span className="flex size-7 items-center justify-center rounded-full bg-primary/12 text-xs font-semibold text-primary">
            {initials}
          </span>
          <span className="hidden max-w-40 truncate text-sm md:inline">{name}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{name}</span>
            {user?.role === 'admin' && <Badge variant="secondary">admin</Badge>}
          </div>
          {user?.display_name && <div className="truncate text-xs text-muted-foreground">{user.email}</div>}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">Motyw</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
          <DropdownMenuRadioItem value="light"><Sun /> Jasny</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark"><Moon /> Ciemny</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system"><Monitor /> Systemowy</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={logout}>
          <LogOut /> Wyloguj
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function Layout() {
  const { user } = useAuth();
  const items = navItems(user?.role === 'admin');
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => { syncPushSubscription(); }, []);

  return (
    <div className="min-h-svh">
      <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur supports-backdrop-filter:bg-background/70">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Menu">
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72">
              <SheetHeader><SheetTitle><Brand /></SheetTitle></SheetHeader>
              <nav className="grid gap-1 px-3">
                {/* Klikniecie w link zamyka menu na telefonie */}
                {items.map((item) => <NavItem key={item.to} item={item} onNavigate={() => setMenuOpen(false)} />)}
              </nav>
            </SheetContent>
          </Sheet>

          <Brand />

          <nav className="ml-4 hidden items-center gap-1 lg:flex">
            {items.map((item) => <NavItem key={item.to} item={item} className="py-1.5" />)}
          </nav>

          <div className="ml-auto">
            <UserMenu />
          </div>
        </div>
      </header>

      {/* minmax(0,1fr): szeroka tresc (tabela, pasek zakladek) nie rozszerza strony ponad ekran telefonu */}
      <main className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)] gap-6 px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
