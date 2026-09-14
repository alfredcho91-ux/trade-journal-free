import type { AnalyticsGroup } from '../../types/analytics';

/** Display-only half-up rounding to two decimal places; source values stay intact. */
export function displayAnalyticsValue(value: AnalyticsGroup['value']): string {
  if (value === null || (typeof value === 'number' && !Number.isFinite(value))) return 'Unavailable';
  const source = typeof value === 'number' ? value.toString() : value.trim();
  const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(source);
  if (!match) return 'Unavailable';

  const sign = match[1] === '-' ? '-' : '';
  const whole = match[2] ?? '';
  const fraction = match[3] ?? match[4] ?? '';
  const exponent = Number(match[5] ?? '0');
  const digits = `${whole}${fraction}`;
  const firstSignificant = digits.search(/[1-9]/);
  if (firstSignificant < 0) return '0'; // Includes JavaScript -0 and decimal "-0".
  if (!Number.isSafeInteger(exponent)) return source;

  const significant = digits.slice(firstSignificant);
  const decimalAfter = whole.length + exponent - firstSignificant;
  const scientificExponent = decimalAfter - 1;
  if (scientificExponent < -3) return '0';
  const plain = decimalAfter <= 0
    ? `0.${'0'.repeat(-decimalAfter)}${significant}`
    : decimalAfter >= significant.length
      ? `${significant}${'0'.repeat(decimalAfter - significant.length)}`
      : `${significant.slice(0, decimalAfter)}.${significant.slice(decimalAfter)}`;
  const [integer, decimals = ''] = plain.split('.');
  // Round decimal strings directly, including amounts beyond Number's safe integer range.
  const cents = BigInt(integer) * 100n + BigInt(decimals.padEnd(2, '0').slice(0, 2)) + (Number(decimals[2] ?? 0) >= 5 ? 1n : 0n);
  const fractionDigits = String(cents % 100n).padStart(2, '0').replace(/0+$/, '');
  return `${cents === 0n ? '' : sign}${cents / 100n}${fractionDigits ? `.${fractionDigits}` : ''}`;
}
