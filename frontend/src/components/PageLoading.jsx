import { Skeleton } from '@/components/ui/skeleton';
import FormMessage from '@/components/FormMessage';

export default function PageLoading({ error }) {
  if (error) return <FormMessage message={{ type: 'error', text: error }} />;
  return (
    <div className="grid gap-4" aria-busy="true" aria-label="Ładowanie">
      <Skeleton className="h-8 w-48" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="h-44 rounded-xl" />
        <Skeleton className="h-44 rounded-xl" />
        <Skeleton className="h-44 rounded-xl" />
      </div>
    </div>
  );
}
