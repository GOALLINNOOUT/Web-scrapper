export function RootCauseCard({ title, cause, evidence, impact, severity, action }: {
  title: string;
  cause: string;
  evidence: Array<{ metric: string; value: string | number }>;
  impact: string;
  severity: string;
  action: string;
}) {
  return (
    <article className={`admin-card admin-root-cause admin-root-${severity.toLowerCase()}`}>
      <div className="flex items-start justify-between gap-3"><div><h3>{title}</h3><p>{cause}</p></div><span className="admin-chip">{severity}</span></div>
      <dl className="mt-4 grid grid-cols-2 gap-2">{evidence.map((item) => <div key={item.metric}><dt>{item.metric}</dt><dd>{item.value}</dd></div>)}</dl>
      <p className="mt-4 text-sm text-[var(--admin-text-secondary)]">{impact}</p>
      <strong className="mt-3 block text-sm text-[var(--accent-primary)]">{action}</strong>
    </article>
  );
}
