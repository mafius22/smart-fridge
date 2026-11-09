import { useCallback, useState } from 'react';
import { FolderPlus, Pencil, Trash2 } from 'lucide-react';
import api, { apiError } from '../api/client';
import FridgeCard from '../components/FridgeCard';
import usePolling from '../utils/usePolling';

const REFRESH_MS = 30000;

export default function DashboardPage() {
  const [fridges, setFridges] = useState(null);
  const [folders, setFolders] = useState([]);
  const [error, setError] = useState('');
  const [newFolder, setNewFolder] = useState('');

  const load = useCallback(async () => {
    try {
      const [f, d] = await Promise.all([api.get('/fridges'), api.get('/folders')]);
      setFridges(f.data.fridges);
      setFolders(d.data.folders);
      setError('');
    } catch (err) {
      setError(apiError(err, 'Nie udało się pobrać lodówek'));
    }
  }, []);

  usePolling(load, REFRESH_MS);

  const act = async (fn) => {
    try { await fn(); await load(); } catch (err) { setError(apiError(err)); }
  };

  const createFolder = (e) => {
    e.preventDefault();
    if (!newFolder.trim()) return;
    act(async () => { await api.post('/folders', { name: newFolder.trim() }); setNewFolder(''); });
  };

  const renameFolder = (folder) => {
    const name = window.prompt('Nowa nazwa folderu', folder.name);
    if (name && name.trim() && name.trim() !== folder.name) act(() => api.patch(`/folders/${folder.id}`, { name: name.trim() }));
  };

  const deleteFolder = (folder) => {
    if (window.confirm(`Usunąć folder „${folder.name}”? Lodówki trafią do „Bez folderu”.`)) {
      act(() => api.delete(`/folders/${folder.id}`));
    }
  };

  const moveFridge = (fridge, folderId) => act(() => api.patch(`/fridges/${fridge.id}/prefs`, { folder_id: folderId }));

  if (fridges === null) return <div className="page-loading">{error || 'Ładowanie…'}</div>;

  const counts = fridges.reduce((acc, f) => ({ ...acc, [f.state]: (acc[f.state] || 0) + 1 }), {});
  const groups = [
    ...folders.map((folder) => ({ folder, items: fridges.filter((f) => f.folder_id === folder.id) })),
    { folder: null, items: fridges.filter((f) => !folders.some((folder) => folder.id === f.folder_id)) },
  ];

  return (
    <div className="page">
      <div className="page-header">
        <h1>Lodówki</h1>
        <div className="summary">
          <span className="summary-item">{fridges.length} łącznie</span>
          {counts.alarm > 0 && <span className="summary-item badge badge-alarm">{counts.alarm} alarm</span>}
          {counts.fault > 0 && <span className="summary-item badge badge-fault">{counts.fault} awaria</span>}
          {counts.offline > 0 && <span className="summary-item badge badge-offline">{counts.offline} offline</span>}
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {fridges.length === 0 ? (
        <div className="card empty">Nie masz jeszcze dostępu do żadnej lodówki. Poproś administratora o nadanie dostępu.</div>
      ) : (
        <>
          <form className="inline-form" onSubmit={createFolder}>
            <input placeholder="Nowy folder, np. Sklep Centrum" value={newFolder} maxLength={50} onChange={(e) => setNewFolder(e.target.value)} />
            <button className="btn btn-secondary"><FolderPlus size={16} /> Dodaj folder</button>
          </form>

          {groups.map(({ folder, items }) => {
            if (!folder && items.length === 0 && folders.length > 0) return null;
            return (
              <section key={folder ? folder.id : 'none'} className="folder-section">
                <div className="folder-header">
                  <h2>{folder ? folder.name : (folders.length ? 'Bez folderu' : 'Wszystkie')}</h2>
                  <span className="muted small">{items.length}</span>
                  {folder && (
                    <div className="folder-actions">
                      <button className="btn btn-ghost btn-icon" onClick={() => renameFolder(folder)} title="Zmień nazwę"><Pencil size={15} /></button>
                      <button className="btn btn-ghost btn-icon" onClick={() => deleteFolder(folder)} title="Usuń folder"><Trash2 size={15} /></button>
                    </div>
                  )}
                </div>
                {items.length === 0 ? (
                  <p className="muted small">Pusty folder - przenieś tu lodówkę wybierając folder na jej karcie.</p>
                ) : (
                  <div className="fridge-grid">
                    {items.map((f) => <FridgeCard key={f.id} fridge={f} folders={folders} onMove={moveFridge} />)}
                  </div>
                )}
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}
