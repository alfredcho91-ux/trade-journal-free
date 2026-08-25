export type SampleQuality = 'low' | 'medium' | 'strong';

export function sampleQuality(count: number): SampleQuality {
  if (count < 15) return 'low';
  if (count < 40) return 'medium';
  return 'strong';
}

export function wilsonInterval(successes: number, total: number): { low: number; high: number } | null {
  if (!Number.isInteger(successes) || !Number.isInteger(total) || total <= 0 || successes < 0 || successes > total) return null;
  const z = 1.959963984540054;
  const proportion = successes / total;
  const zSquared = z ** 2;
  const denominator = 1 + zSquared / total;
  const center = (proportion + zSquared / (2 * total)) / denominator;
  const margin = (z * Math.sqrt((proportion * (1 - proportion) + zSquared / (4 * total)) / total)) / denominator;
  return {
    low: Math.max(0, (center - margin) * 100),
    high: Math.min(100, (center + margin) * 100),
  };
}
