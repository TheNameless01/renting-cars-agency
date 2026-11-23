declare module 'arabic-persian-reshaper' {
  export const ArabicShaper: {
    convertArabic(input: string): string;
  };
  export const PersianShaper: {
    convertPersian(input: string): string;
  };
  const _default: {
    ArabicShaper: typeof ArabicShaper;
    PersianShaper: typeof PersianShaper;
  };
  export default _default;
}

declare module 'bidi-js' {
  export interface BidiApi {
    getEmbeddingLevels(str: string, dir?: 'ltr' | 'rtl' | 'auto'): {
      paragraphs: Array<{ start: number; end: number; level: number }>;
      levels: Uint8Array;
    };
    getReorderedString(str: string, embeddingLevels: ReturnType<BidiApi['getEmbeddingLevels']>): string;
    getReorderSegments(str: string, embeddingLevels: ReturnType<BidiApi['getEmbeddingLevels']>): Array<[number, number]>;
  }
  export default function bidiFactory(): BidiApi;
}
