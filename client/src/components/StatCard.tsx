import { ArrowUpRight } from 'lucide-react';

interface StatCardProps {
  label: string;
  value: string | number;
  detail?: string;
  featured?: boolean;
}

export function StatCard({ label, value, detail, featured = false }: StatCardProps) {
  return (
    <section className={`grid min-h-44 gap-5 rounded-lg border border-[#e4ebe6] p-6 shadow-panel ${featured ? 'bg-[radial-gradient(circle_at_top_right,#249a5e,#0b4e31_70%)] text-white shadow-[0_18px_40px_rgba(6,69,43,0.2)]' : 'bg-white'}`}>
      <div className="flex items-center justify-between gap-3">
        <p className={featured ? 'text-white/85' : 'text-[#636360]'}>{label}</p>
        <span className="grid h-10 w-10 place-items-center rounded-full border border-current">
          <ArrowUpRight size={18} />
        </span>
      </div>
      <strong className="text-5xl leading-none">{value}</strong>
      {detail ? <small className={featured ? 'text-white/80' : 'text-[#636360]'}>{detail}</small> : null}
    </section>
  );
}
