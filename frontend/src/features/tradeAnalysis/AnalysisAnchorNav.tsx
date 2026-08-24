import { useEffect, useState } from 'react';

export type AnalysisAnchor = { id: string; label: string; note?: string };

function scrollToAnchor(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export default function AnalysisAnchorNav({ anchors, isKo }: { anchors: AnalysisAnchor[]; isKo: boolean }) {
  const [activeId, setActiveId] = useState(anchors[0]?.id || '');

  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
      if (visible) setActiveId(visible.target.id);
    }, { rootMargin: '-20% 0px -64% 0px', threshold: [0.05, 0.2, 0.5] });
    const elements = anchors
      .map((anchor) => document.getElementById(anchor.id))
      .filter((element): element is HTMLElement => element != null);
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [anchors]);

  return <>
    <label className="sticky top-2 z-20 block border border-dark-700 bg-dark-950/95 p-2 lg:hidden">
      <span className="sr-only">{isKo ? '상세 분석 이동' : 'Jump to detailed analysis'}</span>
      <select value={activeId} onChange={(event) => scrollToAnchor(event.target.value)} className="w-full bg-transparent px-2 py-1.5 text-xs text-dark-100 outline-none">
        {anchors.map((anchor) => <option key={anchor.id} value={anchor.id}>{anchor.label}</option>)}
      </select>
    </label>
    <aside className="sticky top-5 hidden h-fit border border-dark-700 bg-dark-900/35 p-2 lg:block" aria-label={isKo ? '상세 분석 목차' : 'Detailed analysis navigation'}>
      <div className="px-2 py-2 text-[10px] font-medium uppercase tracking-[0.14em] text-dark-500">{isKo ? '상세 분석' : 'Detailed analysis'}</div>
      <div className="space-y-0.5">
        {anchors.map((anchor, index) => <button key={anchor.id} type="button" onClick={() => scrollToAnchor(anchor.id)} className={`block w-full border-l-2 px-2 py-2 text-left text-xs transition-colors ${activeId === anchor.id ? 'border-primary-300 bg-primary-500/10 text-primary-100' : 'border-transparent text-dark-400 hover:bg-dark-800/60 hover:text-dark-100'}`}>
          <span className="mr-2 font-mono text-[10px] text-dark-600">0{index + 1}</span>{anchor.label}
          {anchor.note && <span className="mt-1 block pl-5 text-[10px] text-dark-600">{anchor.note}</span>}
        </button>)}
      </div>
    </aside>
  </>;
}
