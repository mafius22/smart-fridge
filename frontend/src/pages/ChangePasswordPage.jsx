import { useNavigate } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { useAuth } from '@/auth/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import AuthShell from '@/components/AuthShell';
import ChangePasswordForm from '@/components/ChangePasswordForm';

export default function ChangePasswordPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <AuthShell>
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Zmiana hasła</CardTitle>
          {user?.must_change_password && (
            <CardDescription>To pierwsze logowanie. Ustaw własne hasło, aby korzystać z aplikacji.</CardDescription>
          )}
        </CardHeader>
        <CardContent className="grid gap-3">
          <ChangePasswordForm onDone={() => navigate('/', { replace: true })} />
          <Button variant="ghost" onClick={logout}><LogOut /> Wyloguj</Button>
        </CardContent>
      </Card>
    </AuthShell>
  );
}
