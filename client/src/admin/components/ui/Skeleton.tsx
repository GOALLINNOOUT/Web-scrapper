export function SkeletonBlock({ height = 140 }: { height?: number }) {
  return <div className="admin-skeleton-block" style={{ minHeight: height }} aria-hidden="true" />;
}

export function SkeletonGrid({ count = 4, columns = 'admin-grid-four', height = 138 }: { count?: number; columns?: string; height?: number }) {
  return (
    <section className={columns} aria-busy="true">
      {Array.from({ length: count }, (_, index) => <SkeletonBlock key={index} height={height} />)}
    </section>
  );
}

export function SkeletonPanel({ title = true, height = 280 }: { title?: boolean; height?: number }) {
  return (
    <article className="admin-card" aria-busy="true">
      {title ? <div className="admin-skeleton-line mb-5 h-5 w-40" /> : null}
      <SkeletonBlock height={height} />
    </article>
  );
}
