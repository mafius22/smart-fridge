import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { Folder, FolderCog, LayoutGrid } from 'lucide-react';
import api, { apiError } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import FoldersDialog from '@/components/FoldersDialog';
import FridgeCard from '@/components/FridgeCard';
import PageHeader from '@/components/PageHeader';
import PageLoading from '@/components/PageLoading';
import StateBadge from '@/components/StateBadge';
import { groupFridges } from '@/utils/order';
import usePolling from '@/utils/usePolling';
import { plural } from '@/utils/format';

const REFRESH_MS = 30000;

export default function DashboardPage() {
  const [fridges, setFridges] = useState(null);
  const [folders, setFolders] = useState([]);
  const [error, setError] = useState('');
  const [foldersOpen, setFoldersOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const [f, d] = await Promise.all([api.get('/fridges'), api.get('/folders')]);
      setFridges(f.data.fridges);
      setFolders(d.data.folders);
      setError('');
    } catch (err) {
      setError(apiError(err, 'Nie udało się pobrać stref'));
    }
  }, []);

  usePolling(load, REFRESH_MS);

  // Zmiany z panelu folderow: komunikat + odswiezenie pulpitu; true = udalo sie
  const act = async (fn, okText) => {
    try {
      await fn();
      if (okText) toast.success(okText);
      await load();
      return true;
    } catch (err) {
      toast.error(apiError(err));
      return false;
    }
  };

  if (fridges === null) return <PageLoading error={error} />;

  const counts = fridges.reduce((acc, f) => ({ ...acc, [f.state]: (acc[f.state] || 0) + 1 }), {});
  // Alfabetycznie (polskie litery, cyfry jak liczby: Lodowka 2 przed Lodowka 10); "Bez folderu" zawsze na koncu
  const { sortedFolders, sortedFridges, groups } = groupFridges(fridges, folders);

  return (
    <>
      <PageHeader title="Strefy" description={`${plural(fridges.length, 'strefa', 'strefy', 'stref')}`}>
        {counts.alarm > 0 && <StateBadge state="alarm" label={`${counts.alarm} alarm`} />}
        {counts.fault > 0 && <StateBadge state="fault" label={`${counts.fault} awaria`} />}
        {counts.offline > 0 && <StateBadge state="offline" label={`${counts.offline} offline`} />}
        {counts.pending > 0 && <StateBadge state="pending" label={`${counts.pending} przekroczenie`} />}
        {fridges.length > 0 && (
          <Button variant="outline" onClick={() => setFoldersOpen(true)}><FolderCog /> Foldery</Button>
        )}
      </PageHeader>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {fridges.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <LayoutGrid className="size-10 text-muted-foreground" />
            <p className="font-medium">Nie masz jeszcze dostępu do żadnej strefy</p>
            <p className="text-sm text-muted-foreground">Poproś administratora o nadanie dostępu.</p>
          </CardContent>
        </Card>
      ) : (
        // Cienka linia miedzy folderami (divide-y), bez linii nad pierwszym i pod ostatnim
        <div className="grid divide-y">
        {groups.map(({ folder, items }) => {
          if (!folder && items.length === 0 && folders.length > 0) return null;
          return (
            <section key={folder ? folder.id : 'none'} className="grid gap-3 py-6 first:pt-0 last:pb-0">
              <div className="flex items-center gap-2">
                {folder && <Folder className="size-4 text-muted-foreground" />}
                <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
                  {folder ? folder.name : (folders.length ? 'Bez folderu' : 'Wszystkie')}
                </h2>
                <span className="text-xs text-muted-foreground">{items.length}</span>
              </div>
              {items.length === 0 ? (
                <button
                  type="button"
                  onClick={() => setFoldersOpen(true)}
                  className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground transition-colors hover:bg-muted/50"
                >
                  Pusty folder.
                </button>
              ) : (
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                  {items.map((f) => <FridgeCard key={f.id} fridge={f} />)}
                </div>
              )}
            </section>
          );
        })}
        </div>
      )}

      <FoldersDialog open={foldersOpen} onOpenChange={setFoldersOpen} folders={sortedFolders} fridges={sortedFridges} act={act} />
    </>
  );
}
