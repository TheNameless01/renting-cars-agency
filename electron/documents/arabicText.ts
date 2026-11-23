import shaper from 'arabic-persian-reshaper';
import bidiFactory from 'bidi-js';
import type { PDFFont } from 'pdf-lib';
import type { AppLanguage, CurrencyCode, NumeralSystem } from '../../shared/types/domain.ts';

const bidi = bidiFactory();
const EASTERN_ARABIC_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

const ARABIC_CHAR_REGEX = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
const BIDI_CONTROL_STRIP_REGEX = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

/**
 * Wraps technical LTR sequences (matricules, document numbers, ISO/slash dates,
 * phones, emails, Latin codes, formatted numbers) with LRI..PDI so they never
 * reverse inside RTL Arabic paragraphs under UAX #9.
 */
function isolateLtrTokensForRtl(input: string): string {
  const tokenPattern =
    /([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|[A-Z]{2,8}(?:-[A-Z0-9]{1,8})+|\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}(?::\d{2})?)?|\d{2}\/\d{2}\/\d{4}|\d{3,6}-\d{2,4}-\d{2,4}|\+?\d[\d\s.-]{5,}\d|\d+(?:[\s,]\d{3})*(?:\.\d+)?(?:\s*(?:DA|DZD|EUR|km|KM|%))?|[A-Za-z][A-Za-z0-9\s./_-]*[A-Za-z0-9])/g;

  return input.replace(tokenPattern, (match) => `\u2066${match}\u2069`);
}

/**
 * Replaces unsupported emojis / exotic glyphs with safe DejaVu Sans characters
 * so WinAnsi/Identity-H font embedding never crashes on .notdef symbols.
 */
export function sanitizePdfText(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  return String(raw)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\t/g, '  ')
    .replace(/[\u202F\u00A0]/g, ' ')
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')
    .trimEnd();
}

export function applyNumeralPreference(text: string, numerals: NumeralSystem): string {
  if (numerals !== 'arabic') return text;
  return text.replace(/\d/g, (d) => EASTERN_ARABIC_DIGITS[Number(d)] ?? d);
}

/**
 * Shapes logical text (including mixed Arabic + French + codes/numbers)
 * into visual glyph order ready for left-to-right `pdf-lib` drawing.
 */
export function prepareLineForPdf(
  logicalLine: string,
  baseDir: 'ltr' | 'rtl'
): string {
  const clean = sanitizePdfText(logicalLine);
  if (!clean) return '';

  const hasArabic = ARABIC_CHAR_REGEX.test(clean);
  if (!hasArabic) {
    return clean;
  }

  const protectedText = baseDir === 'rtl' ? isolateLtrTokensForRtl(clean) : clean;
  const shaped = shaper.ArabicShaper.convertArabic(protectedText);
  const levels = bidi.getEmbeddingLevels(shaped, baseDir);
  const reordered = bidi.getReorderedString(shaped, levels);
  return reordered.replace(BIDI_CONTROL_STRIP_REGEX, '');
}

/**
 * Wraps logical text at word boundaries using measured PDF font widths,
 * then shapes each line independently for visual BiDi rendering.
 */
export function wrapTextForPdf(
  text: string,
  maxWidth: number,
  font: PDFFont,
  fontSize: number,
  baseDir: 'ltr' | 'rtl'
): string[] {
  const clean = sanitizePdfText(text);
  if (!clean) return [''];

  const paragraphs = clean.split('\n');
  const lines: string[] = [];

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) {
      lines.push('');
      continue;
    }

    const words = trimmed.split(/\s+/);
    let current = '';

    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      const visualCandidate = prepareLineForPdf(candidate, baseDir);
      const width = font.widthOfTextAtSize(visualCandidate, fontSize);

      if (width <= maxWidth) {
        current = candidate;
      } else if (!current) {
        // Hard-break single long token cleanly without cutting surrogate pairs
        let chunk = '';
        for (const ch of word) {
          const nextChunk = chunk + ch;
          if (font.widthOfTextAtSize(prepareLineForPdf(nextChunk, baseDir), fontSize) > maxWidth && chunk) {
            lines.push(prepareLineForPdf(chunk, baseDir));
            chunk = ch;
          } else {
            chunk = nextChunk;
          }
        }
        current = chunk;
      } else {
        lines.push(prepareLineForPdf(current, baseDir));
        current = word;
      }
    }

    if (current) {
      lines.push(prepareLineForPdf(current, baseDir));
    }
  }

  return lines.length > 0 ? lines : [''];
}

export function formatMoneyForDoc(
  minorAmount: number,
  currency: CurrencyCode,
  lang: AppLanguage,
  numerals: NumeralSystem = 'latin'
): string {
  const sign = minorAmount < 0 ? '-' : '';
  const major = Math.abs(minorAmount) / 100;
  const fixed = major.toFixed(2);
  const [intPart, decPart] = fixed.split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const unit = currency === 'EUR' ? 'EUR' : lang === 'ar' ? 'دج' : 'DA';
  return applyNumeralPreference(`${sign}${grouped}.${decPart} ${unit}`, numerals);
}

export function formatDateForDoc(
  iso: string | null | undefined,
  lang: AppLanguage,
  numerals: NumeralSystem = 'latin',
  withTime = false
): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return applyNumeralPreference(iso.slice(0, 16), numerals);
  }
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Algiers',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(withTime ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}),
  });
  const formatted = formatter.format(d);
  return applyNumeralPreference(formatted, numerals);
}
