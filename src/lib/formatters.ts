import { DEFAULT_TIMEZONE, fromMinorUnits } from '../../shared/constants/algeria.ts';
import type { AppLanguage, CurrencyCode, NumeralSystem } from '../../shared/types/domain.ts';

const EASTERN_ARABIC_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

export function formatDigits(input: string | number, numerals: NumeralSystem): string {
  const str = String(input);
  if (numerals !== 'arabic') return str;
  return str.replace(/\d/g, (d) => EASTERN_ARABIC_DIGITS[Number(d)] ?? d);
}

export function formatCurrencyMinor(
  minorAmount: number,
  currency: CurrencyCode,
  lang: AppLanguage,
  numerals: NumeralSystem = 'latin'
): string {
  const major = fromMinorUnits(minorAmount);
  const locale = lang === 'ar' ? 'ar-DZ' : 'fr-DZ';
  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(major);
  const unit = currency === 'DZD' ? (lang === 'ar' ? 'دج' : 'DA') : 'EUR';
  return formatDigits(`${formatted} ${unit}`, numerals);
}

export function formatDateTimeAlgiers(
  isoString: string | null | undefined,
  lang: AppLanguage,
  numerals: NumeralSystem = 'latin'
): string {
  if (!isoString) return '—';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return isoString;
  const locale = lang === 'ar' ? 'ar-DZ' : 'fr-DZ';
  const formatted = new Intl.DateTimeFormat(locale, {
    timeZone: DEFAULT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
  return formatDigits(formatted, numerals);
}
