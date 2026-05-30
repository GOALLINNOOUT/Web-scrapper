import { LoaderCircle } from 'lucide-react';

interface LoadMoreButtonProps {
  hasMore: boolean;
  isLoading: boolean;
  onClick: () => void;
  label?: string;
  loadingLabel?: string;
}

export function LoadMoreButton({ hasMore, isLoading, onClick, label = 'Load more', loadingLabel = 'Loading more' }: LoadMoreButtonProps) {
  if (!hasMore) return null;

  return (
    <button className="inline-flex min-h-11 justify-self-center items-center justify-center gap-2 rounded-full border border-[#c8c8c2] bg-white px-5 font-bold text-brand-800 disabled:cursor-wait disabled:opacity-70" type="button" onClick={onClick} disabled={isLoading}>
      {isLoading ? <LoaderCircle className="animate-spin" size={16} /> : null}
      {isLoading ? loadingLabel : label}
    </button>
  );
}
