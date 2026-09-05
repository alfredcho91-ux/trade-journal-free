import type { AnalyticsGroup } from '../../types/analytics';

/**
 * Presentation only: canonicalise finite decimal text without doing analytics
 * arithmetic. In particular, a value smaller than the old fixed 8-digit
 * display precision must not become indistinguishable from zero.
 */
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
  // Scientific notation keeps tiny values compact while retaining every
  // backend-provided significant digit. Use the same policy for JSON numbers
  // and decimal strings so equivalent values have equivalent display meaning.
  if (scientificExponent < -8) {
    const coefficient = `${significant[0]}${significant.length > 1 ? `.${significant.slice(1).replace(/0+$/, '')}` : ''}`.replace(/\.$/, '');
    return `${sign}${coefficient}e${scientificExponent}`;
  }
  const plain = decimalAfter <= 0
    ? `0.${'0'.repeat(-decimalAfter)}${significant}`
    : decimalAfter >= significant.length
      ? `${significant}${'0'.repeat(decimalAfter - significant.length)}`
      : `${significant.slice(0, decimalAfter)}.${significant.slice(decimalAfter)}`;
  return `${sign}${plain.replace(/\.(\d*?)0+$/, (_, fractional) => fractional ? `.${fractional}` : '')}`;
}
