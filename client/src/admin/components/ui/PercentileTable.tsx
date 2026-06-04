export function PercentileTable({ data }: { data: Array<{ metric: string; p50: number; p75: number; p90: number; p95: number; p99: number }> }) {
  return (
    <table className="admin-table">
      <thead><tr><th>Metric</th><th>P50</th><th>P75</th><th>P90</th><th>P95</th><th>P99</th></tr></thead>
      <tbody>
        {data.map((row) => <tr key={row.metric}><td>{row.metric}</td><td>{row.p50}</td><td>{row.p75}</td><td>{row.p90}</td><td>{row.p95}</td><td>{row.p99}</td></tr>)}
      </tbody>
    </table>
  );
}
