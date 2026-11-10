import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Field from '@/components/Field';

const DialogsContext = createContext(null);

/**
 * Okna potwierdzenia i pytania zamiast window.confirm / window.prompt:
 *   const ok = await confirm({ title, description, confirmText, destructive })
 *   const value = await prompt({ title, description, label, defaultValue })  // null = anulowano
 */
export function DialogsProvider({ children }) {
  const [state, setState] = useState(null);
  const [value, setValue] = useState('');
  const resolver = useRef(null);

  const open = useCallback((kind, options) => new Promise((resolve) => {
    resolver.current = resolve;
    setValue(options.defaultValue ?? '');
    setState({ kind, ...options });
  }), []);

  const close = (result) => {
    resolver.current?.(result);
    resolver.current = null;
    setState(null);
  };

  const api = useMemo(() => ({
    confirm: (options) => open('confirm', options),
    prompt: (options) => open('prompt', options),
  }), [open]);

  return (
    <DialogsContext.Provider value={api}>
      {children}

      <AlertDialog open={state?.kind === 'confirm'} onOpenChange={(o) => { if (!o) close(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{state?.title}</AlertDialogTitle>
            {state?.description && (
              <AlertDialogDescription className="whitespace-pre-line">{state.description}</AlertDialogDescription>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => close(false)}>Anuluj</AlertDialogCancel>
            <AlertDialogAction variant={state?.destructive ? 'destructive' : 'default'} onClick={() => close(true)}>
              {state?.confirmText || 'OK'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={state?.kind === 'prompt'} onOpenChange={(o) => { if (!o) close(null); }}>
        <DialogContent className="sm:max-w-md">
          <form
            className="grid gap-4"
            onSubmit={(e) => { e.preventDefault(); close(value); }}
          >
            <DialogHeader>
              <DialogTitle>{state?.title}</DialogTitle>
              {state?.description && (
                <DialogDescription className="whitespace-pre-line">{state.description}</DialogDescription>
              )}
            </DialogHeader>
            <Field label={state?.label} hint={state?.hint}>
              <Input
                autoFocus
                value={value}
                placeholder={state?.placeholder}
                onChange={(e) => setValue(e.target.value)}
              />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => close(null)}>Anuluj</Button>
              <Button type="submit" variant={state?.destructive ? 'destructive' : 'default'}>
                {state?.confirmText || 'Zapisz'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </DialogsContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useDialogs() {
  return useContext(DialogsContext);
}
