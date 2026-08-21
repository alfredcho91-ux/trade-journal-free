import type { JournalEntry } from '../types';

export type EntryTimeConfidence = 'confirmed' | 'estimated' | 'unavailable';

export interface EntryTimeResolution {
  datetime: string | null;
  confidence: EntryTimeConfidence;
  source: 'matched_fill' | 'position_created_at' | 'inferred_fill' | 'none';
  matchedEntry: JournalEntry | null;
  entryFills: JournalEntry[];
}

function timestamp(entry: JournalEntry): number | null {
  if (!entry.datetime) return null;
  const value = new Date(entry.datetime).getTime();
  return Number.isFinite(value) ? value : null;
}

function fillSide(entry: JournalEntry): 'buy' | 'sell' | null {
  const match = entry.notes?.match(/^\S+\s+\S+\s+fill:\s*(buy|sell)\b/i);
  return match ? (match[1].toLowerCase() as 'buy' | 'sell') : null;
}

function isOpeningFill(position: JournalEntry, fill: JournalEntry): boolean {
  if (fill.direction !== position.direction) return false;
  const side = fillSide(fill);
  if (position.direction === 'Long') return side === 'buy';
  if (position.direction === 'Short') return side === 'sell';
  return false;
}

function groupEntryFillsByOrder(fills: JournalEntry[]): JournalEntry[] {
  const grouped = new Map<string, JournalEntry>();
  fills.forEach((fill, index) => {
    const key = fill.order_id
      ? `order:${fill.order_id}`
      : fill.external_id
        ? `fill:${fill.external_id}`
        : `fill:${fill.id ?? index}`;
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, { ...fill });
      return;
    }

    const existingSize = existing.size != null && Number.isFinite(existing.size) ? Math.abs(existing.size) : 0;
    const fillSize = fill.size != null && Number.isFinite(fill.size) ? Math.abs(fill.size) : 0;
    const totalSize = existingSize + fillSize;
    const existingPrice = existing.entry_price;
    const fillPrice = fill.entry_price;
    const weightedPrice =
      totalSize > 0 &&
      existingPrice != null &&
      fillPrice != null &&
      Number.isFinite(existingPrice) &&
      Number.isFinite(fillPrice)
        ? (existingPrice * existingSize + fillPrice * fillSize) / totalSize
        : existingPrice ?? fillPrice;
    grouped.set(key, {
      ...existing,
      size: totalSize > 0 ? totalSize : existing.size,
      entry_price: weightedPrice,
    });
  });
  return [...grouped.values()];
}

function entryFillsForPosition(position: JournalEntry, fills: JournalEntry[]): JournalEntry[] {
  const grouped = groupEntryFillsByOrder(fills);
  const targetSize = position.size != null && Number.isFinite(position.size)
    ? Math.abs(position.size)
    : 0;
  if (targetSize <= 0) return grouped.slice(0, 1);

  const selected: JournalEntry[] = [];
  let selectedSize = 0;
  const tolerance = Math.max(targetSize * 1e-6, 1e-8);
  for (const fill of grouped) {
    if (selectedSize >= targetSize - tolerance) break;
    selected.push(fill);
    if (fill.size != null && Number.isFinite(fill.size)) {
      selectedSize += Math.abs(fill.size);
    }
  }
  return selected;
}

export function resolvePositionEntryTime(
  position: JournalEntry,
  entries: JournalEntry[],
): EntryTimeResolution {
  const closeTime = timestamp(position);
  if (closeTime == null) {
    return { datetime: null, confidence: 'unavailable', source: 'none', matchedEntry: null, entryFills: [] };
  }

  const matchingFills = entries
    .filter((candidate) => {
      const isFill = candidate.source === 'deepcoin' || candidate.source?.endsWith('_fill');
      if (!isFill || candidate.symbol !== position.symbol || candidate.exchange !== position.exchange) return false;
      if (!isOpeningFill(position, candidate)) return false;
      const fillTime = timestamp(candidate);
      return fillTime != null && fillTime <= closeTime;
    })
    .sort((a, b) => (timestamp(a) || 0) - (timestamp(b) || 0));

  const previousClose = entries
    .filter(
      (candidate) =>
        candidate.id !== position.id &&
        candidate.source?.endsWith('_position') &&
        candidate.exchange === position.exchange &&
        candidate.symbol === position.symbol &&
        candidate.direction === position.direction,
    )
    .map(timestamp)
    .filter((value): value is number => value != null && value < closeTime)
    .sort((a, b) => b - a)[0];

  const windowFills = matchingFills.filter((candidate) => {
    const fillTime = timestamp(candidate);
    return fillTime != null && (previousClose == null || fillTime > previousClose);
  });

  if (position.entry_datetime) {
    const entryTime = new Date(position.entry_datetime).getTime();
    if (Number.isFinite(entryTime) && entryTime <= closeTime) {
      const entryWindowFills = matchingFills.filter((candidate) => {
        const fillTime = timestamp(candidate);
        return fillTime != null && fillTime >= entryTime;
      });
      const firstFill = entryWindowFills[0] || null;
      return {
        datetime: firstFill?.datetime || position.entry_datetime,
        confidence: 'confirmed',
        source: firstFill ? 'matched_fill' : 'position_created_at',
        matchedEntry: firstFill,
        entryFills: entryFillsForPosition(position, entryWindowFills),
      };
    }
  }

  if (position.order_id) {
    const exactFill = windowFills.find((candidate) => candidate.order_id === position.order_id);
    const exactTime = exactFill ? timestamp(exactFill) : null;
    if (exactFill?.datetime && exactTime != null) {
      return {
        datetime: exactFill.datetime,
        confidence: 'confirmed',
        source: 'matched_fill',
        matchedEntry: exactFill,
        entryFills: entryFillsForPosition(
          position,
          windowFills.filter((candidate) => (timestamp(candidate) || 0) >= exactTime),
        ),
      };
    }
  }

  const inferredFill = windowFills[0];

  if (inferredFill?.datetime) {
    return {
      datetime: inferredFill.datetime,
      confidence: 'estimated',
      source: 'inferred_fill',
      matchedEntry: inferredFill,
      entryFills: entryFillsForPosition(position, windowFills),
    };
  }

  return { datetime: null, confidence: 'unavailable', source: 'none', matchedEntry: null, entryFills: [] };
}
