type SampleQuality = 'low' | 'medium' | 'strong';

function sampleQuality(count: number): SampleQuality {
  if (count < 15) return 'low';
  if (count < 40) return 'medium';
  return 'strong';
}

export function SampleBadge({ count, isKo }: { count: number; isKo: boolean }) {
  const quality = sampleQuality(count);
  const label = quality === 'low'
    ? (isKo ? '표본 부족' : 'Low sample')
    : quality === 'medium'
      ? (isKo ? '보통 표본' : 'Medium sample')
      : (isKo ? '충분한 표본' : 'Strong sample');
  const tone = quality === 'low'
    ? 'border-amber-300/35 text-amber-200'
    : quality === 'medium'
      ? 'border-primary-400/35 text-primary-200'
      : 'border-bull/35 text-bull';

  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] ${tone}`}>{label} · n={count}</span>;
}
