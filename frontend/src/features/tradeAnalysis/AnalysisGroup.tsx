import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

export function AnalysisAccordion({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <details className="group overflow-hidden border border-dark-700 bg-dark-950/25" open={isOpen} onToggle={(event) => setIsOpen(event.currentTarget.open)}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 text-sm font-medium text-dark-200 hover:bg-dark-800/40">
        {title}
        <ChevronDown className="h-4 w-4 shrink-0 text-dark-500 transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-dark-700 p-4">{children}</div>
    </details>
  );
}

export default function AnalysisGroup({
  id,
  index,
  title,
  detail,
  conclusion,
  chips,
  scope = 'global',
  isKo,
  focused = false,
  children,
}: {
  id: string;
  index: number;
  title: string;
  detail: string;
  conclusion: string;
  chips: Array<{ label: string; tone?: 'neutral' | 'positive' | 'negative' | 'warning' }>;
  scope?: 'global' | 'section' | 'partial';
  isKo: boolean;
  focused?: boolean;
  children: ReactNode;
}) {
  const toneClass = (tone: typeof chips[number]['tone']) => (
    tone === 'positive' ? 'border-bull/30 bg-bull/5 text-bull'
      : tone === 'negative' ? 'border-bear/30 bg-bear/5 text-bear'
        : tone === 'warning' ? 'border-amber-300/30 bg-amber-300/5 text-amber-200'
          : 'border-dark-700 bg-dark-900/50 text-dark-300'
  );

  return (
    <section
      id={id}
      className={`scroll-mt-32 border border-dark-700 bg-dark-900/20 p-4 transition-[border-color,box-shadow] duration-500 sm:p-5 ${focused ? 'border-primary-300/80 shadow-[0_0_0_3px_rgba(96,165,250,0.16)]' : ''}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-dark-700 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-primary-300">0{index}</span>
            <h2 className="text-lg font-semibold tracking-tight text-white">{title}</h2>
          </div>
          <p className="mt-1 text-xs text-dark-500">{detail}</p>
        </div>
        <span className={`border px-2 py-1 text-[10px] ${scope === 'section' ? 'border-primary-400/35 bg-primary-500/10 text-primary-200' : scope === 'partial' ? 'border-amber-300/30 bg-amber-300/5 text-amber-200' : 'border-dark-700 bg-dark-950/40 text-dark-500'}`}>
          {scope === 'section'
            ? (isKo ? '섹션 전용 조건' : 'Section-only conditions')
            : scope === 'partial'
              ? (isKo ? '기간·수익률 필터 적용' : 'Period & return filters applied')
              : (isKo ? '전역 필터 적용' : 'Global filters applied')}
        </span>
      </div>

      <div className="mt-4 border-l-2 border-primary-300/70 bg-dark-950/45 px-3 py-2.5 text-sm font-medium leading-6 text-dark-100">
        {conclusion}
      </div>
      {chips.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {chips.map((chip) => <span key={`${chip.label}-${chip.tone || 'neutral'}`} className={`border px-2 py-1 font-mono text-[10px] ${toneClass(chip.tone)}`}>{chip.label}</span>)}
        </div>
      )}

      <div className="mt-4 space-y-3">{children}</div>
    </section>
  );
}
