import { useEffect, useRef, useState } from 'react';

export type AnalysisAnchor = { id: string; label: string; note?: string };

function scrollToAnchor(id: string) {
  const element = document.getElementById(id);
  if (!element) return;
  const offset = 124;
  window.scrollTo({ top: Math.max(0, window.scrollY + element.getBoundingClientRect().top - offset), behavior: 'smooth' });
}

export default function AnalysisAnchorNav({ anchors, isKo }: { anchors: AnalysisAnchor[]; isKo: boolean }) {
  const [activeId, setActiveId] = useState(anchors[0]?.id || '');
  const activeIdRef = useRef(activeId);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  useEffect(() => {
    const elements = anchors
      .map((anchor) => document.getElementById(anchor.id))
      .filter((element): element is HTMLElement => element != null);
    const updateActive = () => {
      const reachedPageEnd = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4;
      if (reachedPageEnd) {
        const lastId = elements[elements.length - 1]?.id;
        if (lastId && lastId !== activeIdRef.current) setActiveId(lastId);
        return;
      }
      const positions = elements.map((element) => ({ element, rect: element.getBoundingClientRect() }));
      const crossed = positions
        .filter(({ rect }) => rect.top <= 140 && rect.bottom > 112)
        .sort((left, right) => right.rect.top - left.rect.top)[0];
      const upcoming = positions
        .filter(({ rect }) => rect.top > 140)
        .sort((left, right) => left.rect.top - right.rect.top)[0];
      const nextId = (crossed || upcoming)?.element.id;
      if (nextId && nextId !== activeIdRef.current) setActiveId(nextId);
    };
    let animationFrame: number | null = null;
    const scheduleUpdate = () => {
      if (animationFrame != null) return;
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = null;
        updateActive();
      });
    };
    const observer = new IntersectionObserver(scheduleUpdate, { rootMargin: '-112px 0px -52% 0px', threshold: [0.01, 0.2, 0.45] });
    elements.forEach((element) => observer.observe(element));
    window.addEventListener('scroll', scheduleUpdate, { passive: true });
    updateActive();
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', scheduleUpdate);
      if (animationFrame != null) window.cancelAnimationFrame(animationFrame);
    };
  }, [anchors]);

  return <>
    <label className="sticky top-2 z-20 block border border-dark-700 bg-dark-950/95 p-2 lg:hidden">
      <span className="sr-only">{isKo ? '상세 분석 이동' : 'Jump to detailed analysis'}</span>
      <select value={activeId} onChange={(event) => { setActiveId(event.target.value); scrollToAnchor(event.target.value); }} className="w-full bg-transparent px-2 py-1.5 text-xs text-dark-100 outline-none">
        {anchors.map((anchor) => <option key={anchor.id} value={anchor.id}>{anchor.label}</option>)}
      </select>
    </label>
    <aside className="sticky top-5 hidden h-fit border border-dark-700 bg-dark-900/35 p-2 lg:block" aria-label={isKo ? '상세 분석 목차' : 'Detailed analysis navigation'}>
      <div className="px-2 py-2 text-[10px] font-medium uppercase tracking-[0.14em] text-dark-500">{isKo ? '상세 분석' : 'Detailed analysis'}</div>
      <div className="space-y-0.5">
        {anchors.map((anchor, index) => <button key={anchor.id} type="button" onClick={() => { setActiveId(anchor.id); scrollToAnchor(anchor.id); }} className={`block w-full border-l-2 px-2 py-2 text-left text-xs transition-colors ${activeId === anchor.id ? 'border-primary-300 bg-primary-500/10 text-primary-100' : 'border-transparent text-dark-400 hover:bg-dark-800/60 hover:text-dark-100'}`}>
          <span className={`mr-2 inline-block h-1.5 w-1.5 rounded-full ${activeId === anchor.id ? 'bg-primary-300' : 'bg-dark-600'}`} />
          <span className="mr-2 font-mono text-[10px] text-dark-600">0{index + 1}</span>{anchor.label}
          {anchor.note && <span className="mt-1 block pl-7 text-[10px] text-dark-600">{anchor.note}</span>}
        </button>)}
      </div>
    </aside>
  </>;
}
