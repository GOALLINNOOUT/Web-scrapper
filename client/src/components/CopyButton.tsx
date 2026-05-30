import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { showToast } from '../toast.js';

interface CopyButtonProps {
  value: string;
  label?: string;
}

export function CopyButton({ value, label = 'Copy' }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  async function copyValue() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      showToast({ title: 'Copied', description: value, tone: 'success' });
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      showToast({ title: 'Copy failed', description: 'Clipboard access was not available.', tone: 'error' });
    }
  }

  return (
    <button
      className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[#c8c8c2] bg-white text-[#636360] transition hover:border-brand-300 hover:text-brand-800"
      type="button"
      onClick={copyValue}
      title={label}
      aria-label={label}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}
