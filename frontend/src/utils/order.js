// Kolejnosc stref wspolna dla pulpitu i strzalek na stronie strefy:
// foldery alfabetycznie, w nich strefy alfabetycznie, "Bez folderu" na koncu.
// Polskie litery, bez rozrozniania wielkosci, liczby jak liczby (Lodowka 2 przed Lodowka 10).
const collator = new Intl.Collator('pl', { numeric: true, sensitivity: 'base' });

export const byName = (a, b) => collator.compare(a || '', b || '');

export function groupFridges(fridges, folders) {
  const sortedFolders = [...folders].sort((a, b) => byName(a.name, b.name));
  const sortedFridges = [...fridges].sort((a, b) => byName(a.display_name, b.display_name));
  const groups = [
    ...sortedFolders.map((folder) => ({ folder, items: sortedFridges.filter((f) => f.folder_id === folder.id) })),
    { folder: null, items: sortedFridges.filter((f) => !folders.some((folder) => folder.id === f.folder_id)) },
  ];
  return { sortedFolders, sortedFridges, groups };
}

export function orderedFridges(fridges, folders) {
  return groupFridges(fridges, folders).groups.flatMap((g) => g.items);
}
