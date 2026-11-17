import { useState } from 'react';
import { Check, FolderPlus, Pencil, Trash2, X } from 'lucide-react';
import api from '@/api/client';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { useDialogs } from '@/components/DialogsProvider';
import FolderSelect from '@/components/FolderSelect';
import IconAction from '@/components/IconAction';

function FolderRow({ folder, count, onRename, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(folder.name);

  const save = async (e) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed && trimmed !== folder.name) await onRename(folder, trimmed);
    setEditing(false);
  };

  if (editing) {
    return (
      <form className="flex items-center gap-1.5" onSubmit={save}>
        <Input value={name} maxLength={50} autoFocus onChange={(e) => setName(e.target.value)} aria-label="Nazwa folderu" />
        <IconAction label="Zapisz" icon={Check} onClick={save} />
        <IconAction label="Anuluj" icon={X} onClick={() => { setName(folder.name); setEditing(false); }} />
      </form>
    );
  }
  return (
    <div className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-muted/60">
      <span className="flex-1 truncate text-sm font-medium">{folder.name}</span>
      <span className="text-xs text-muted-foreground">{count}</span>
      <IconAction label="Zmień nazwę" icon={Pencil} onClick={() => setEditing(true)} />
      <IconAction label="Usuń folder" icon={Trash2} destructive onClick={() => onDelete(folder)} />
    </div>
  );
}

/** Panel folderow: dodawanie, zmiana nazwy, usuwanie i przypisanie lodowek do folderow. */
export default function FoldersDialog({ open, onOpenChange, folders, fridges, act }) {
  const { confirm } = useDialogs();
  const [newName, setNewName] = useState('');

  const create = async (e) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    const ok = await act(() => api.post('/folders', { name }), 'Dodano folder');
    if (ok) setNewName('');
  };

  const rename = (folder, name) => act(() => api.patch(`/folders/${folder.id}`, { name }), 'Zmieniono nazwę');

  const remove = async (folder) => {
    const ok = await confirm({
      title: `Usunąć folder „${folder.name}”?`,
      description: 'Strefy z tego folderu trafią do „Bez folderu”.',
      confirmText: 'Usuń', destructive: true,
    });
    if (ok) act(() => api.delete(`/folders/${folder.id}`), 'Usunięto folder');
  };

  const move = (fridge, folderId) => act(() => api.patch(`/fridges/${fridge.id}/prefs`, { folder_id: folderId }));

  const countIn = (folderId) => fridges.filter((f) => f.folder_id === folderId).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] gap-5 overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Ustawienia folderów</DialogTitle>
          <DialogDescription>Foldery widzisz tylko Ty.</DialogDescription>
        </DialogHeader>

        <section className="grid gap-2">
          <h3 className="text-sm font-semibold">Foldery</h3>
          <form className="flex gap-2" onSubmit={create}>
            <Input
              placeholder="Nazwa nowego folderu"
              value={newName}
              maxLength={50}
              onChange={(e) => setNewName(e.target.value)}
              aria-label="Nazwa nowego folderu"
            />
            <Button type="submit" disabled={!newName.trim()}><FolderPlus /> Dodaj</Button>
          </form>
          {folders.length === 0 ? (
            <p className="text-sm text-muted-foreground">Brak folderów.</p>
          ) : (
            <div className="grid gap-0.5">
              {folders.map((f) => (
                <FolderRow key={f.id} folder={f} count={countIn(f.id)} onRename={rename} onDelete={remove} />
              ))}
            </div>
          )}
        </section>

        <Separator />

        <section className="grid gap-2">
          <h3 className="text-sm font-semibold">Strefy</h3>
          {fridges.map((fridge) => (
            <div key={fridge.id} className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{fridge.display_name}</div>
                {fridge.location && <div className="truncate text-xs text-muted-foreground">{fridge.location}</div>}
              </div>
              <FolderSelect
                size="sm"
                className="w-44 shrink-0"
                value={fridge.folder_id}
                folders={folders}
                onChange={(folderId) => move(fridge, folderId)}
              />
            </div>
          ))}
        </section>
      </DialogContent>
    </Dialog>
  );
}
