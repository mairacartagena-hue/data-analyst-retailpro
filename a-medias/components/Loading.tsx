export function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Cargando">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-24 animate-pulse rounded-[20px] border-[3px] border-rosa bg-rosa-claro/50" />
      ))}
    </div>
  );
}
