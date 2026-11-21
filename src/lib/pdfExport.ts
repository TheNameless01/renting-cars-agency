import type { AppLanguage, CurrencyCode, NumeralSystem } from '../../shared/types/domain.ts';
import type { FinancialDashboardReportDto, PaymentReceiptDto } from './apiClient.ts';
import { formatCurrencyMinor, formatDateTimeAlgiers, formatDigits } from './formatters.ts';

export function downloadBlobFile(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function downloadCsvFile(fileName: string, csvContent: string): void {
  const bom = '\uFEFF';
  const normalized = csvContent.startsWith(bom) ? csvContent : `${bom}${csvContent}`;
  const blob = new Blob([normalized], { type: 'text/csv;charset=utf-8;' });
  downloadBlobFile(fileName, blob);
}

/**
 * Pure TypeScript multi-page A4 PDF-1.4 builder from offscreen HTML5 Canvases.
 * Avoids window.open() and handles bilingual Arabic RTL + French LTR typography offline.
 */
function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function buildPdfFromCanvases(canvases: HTMLCanvasElement[]): Blob {
  // A4 in PDF points (72 DPI): 595.28 x 841.89
  const pageWidthPt = 595.28;
  const pageHeightPt = 841.89;

  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  let offset = 0;
  const objectOffsets: number[] = [];

  const pushBytes = (bytes: Uint8Array) => {
    chunks.push(bytes);
    offset += bytes.length;
  };
  const pushStr = (text: string) => {
    pushBytes(encoder.encode(text));
  };

  pushStr('%PDF-1.4\n%\xFF\xFF\xFF\xFF\n');

  const pageObjectIds: number[] = [];
  let nextObjId = 3; // 1 = Catalog, 2 = Pages

  interface PageSpec {
    pageId: number;
    contentId: number;
    imgId: number;
    imgName: string;
    imgBytes: Uint8Array;
    imgWidthPx: number;
    imgHeightPx: number;
  }

  const pageSpecs: PageSpec[] = canvases.map((canvas, idx) => {
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    const base64 = dataUrl.split(',')[1] || '';
    const imgBytes = base64ToUint8Array(base64);
    const pageId = nextObjId++;
    const contentId = nextObjId++;
    const imgId = nextObjId++;
    pageObjectIds.push(pageId);
    return {
      pageId,
      contentId,
      imgId,
      imgName: `/Im${idx + 1}`,
      imgBytes,
      imgWidthPx: canvas.width,
      imgHeightPx: canvas.height,
    };
  });

  // Object 1: Catalog
  objectOffsets[1] = offset;
  pushStr('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  // Object 2: Pages
  objectOffsets[2] = offset;
  pushStr(
    `2 0 obj\n<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageObjectIds.length} >>\nendobj\n`
  );

  for (const spec of pageSpecs) {
    // Page object
    objectOffsets[spec.pageId] = offset;
    pushStr(
      `${spec.pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidthPt.toFixed(2)} ${pageHeightPt.toFixed(2)}] /Resources << /XObject << ${spec.imgName} ${spec.imgId} 0 R >> >> /Contents ${spec.contentId} 0 R >>\nendobj\n`
    );

    // Content stream drawing the JPEG full-bleed onto A4
    const contentStream = `q\n${pageWidthPt.toFixed(2)} 0 0 ${pageHeightPt.toFixed(2)} 0 0 cm\n${spec.imgName} Do\nQ\n`;
    const contentBytes = encoder.encode(contentStream);
    objectOffsets[spec.contentId] = offset;
    pushStr(`${spec.contentId} 0 obj\n<< /Length ${contentBytes.length} >>\nstream\n`);
    pushBytes(contentBytes);
    pushStr('endstream\nendobj\n');

    // Image XObject
    objectOffsets[spec.imgId] = offset;
    pushStr(
      `${spec.imgId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${spec.imgWidthPx} /Height ${spec.imgHeightPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${spec.imgBytes.length} >>\nstream\n`
    );
    pushBytes(spec.imgBytes);
    pushStr('\nendstream\nendobj\n');
  }

  const xrefOffset = offset;
  const totalObjects = nextObjId;
  pushStr(`xref\n0 ${totalObjects}\n0000000000 65535 f \n`);
  for (let id = 1; id < totalObjects; id++) {
    const off = objectOffsets[id] ?? 0;
    pushStr(`${String(off).padStart(10, '0')} 00000 n \n`);
  }
  pushStr(
    `trailer\n<< /Size ${totalObjects} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  );

  return new Blob(chunks as unknown as BlobPart[], { type: 'application/pdf' });
}

const A4_W = 1240;
const A4_H = 1754;
const MARGIN_X = 80;
const FONT_FAMILY = "'Plus Jakarta Sans', 'Noto Sans Arabic', 'Segoe UI', Tahoma, sans-serif";

function createA4Page(lang: AppLanguage): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
} {
  const canvas = document.createElement('canvas');
  canvas.width = A4_W;
  canvas.height = A4_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context unavailable');
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, A4_W, A4_H);
  ctx.direction = lang === 'ar' ? 'rtl' : 'ltr';
  ctx.textBaseline = 'top';
  return { canvas, ctx };
}

function drawAlignedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  align: 'start' | 'end' | 'center',
  font: string,
  color = '#0f172a',
  maxWidth?: number
) {
  ctx.save();
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = align === 'center' ? 'center' : align;
  if (maxWidth) {
    ctx.fillText(text, x, y, maxWidth);
  } else {
    ctx.fillText(text, x, y);
  }
  ctx.restore();
}

function drawDivider(ctx: CanvasRenderingContext2D, y: number, color = '#e2e8f0') {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(MARGIN_X, y);
  ctx.lineTo(A4_W - MARGIN_X, y);
  ctx.stroke();
  ctx.restore();
}

function methodLabel(method: string, lang: AppLanguage): string {
  const map: Record<string, { fr: string; ar: string }> = {
    CASH: { fr: 'Espèces (Caisse)', ar: 'نقداً (الصندوق)' },
    CCP: { fr: 'CCP', ar: 'الحساب البريدي (CCP)' },
    BARIDIMOB: { fr: 'BaridiMob', ar: 'بريدي موب' },
    BANK_TRANSFER: { fr: 'Virement bancaire', ar: 'تحويل بنكي' },
    OTHER: { fr: 'Autre', ar: 'أخرى' },
  };
  return map[method]?.[lang] ?? method;
}

function expenseCatLabel(cat: string, lang: AppLanguage): string {
  const map: Record<string, { fr: string; ar: string }> = {
    MAINTENANCE: { fr: 'Maintenance', ar: 'صيانة دورية' },
    REPAIRS: { fr: 'Réparations', ar: 'إصلاحات' },
    SPARE_PARTS: { fr: 'Pièces de rechange', ar: 'قطع غيار' },
    INSURANCE: { fr: 'Assurance', ar: 'تأمين' },
    VIGNETTE: { fr: 'Vignette', ar: 'قسيمة السيارات' },
    TECHNICAL_INSPECTION: { fr: 'Contrôle technique', ar: 'المراقبة التقنية' },
    CLEANING: { fr: 'Lavage / Nettoyage', ar: 'غسيل وتنظيف' },
    ADMINISTRATIVE: { fr: 'Frais administratifs', ar: 'مصاريف إدارية' },
    OTHER: { fr: 'Autres charges', ar: 'مصاريف أخرى' },
  };
  return map[cat]?.[lang] ?? cat;
}

export function exportPaymentReceiptPdf(
  receipt: PaymentReceiptDto,
  lang: AppLanguage,
  numerals: NumeralSystem
): void {
  const isAr = lang === 'ar';
  const startX = isAr ? A4_W - MARGIN_X : MARGIN_X;
  const endX = isAr ? MARGIN_X : A4_W - MARGIN_X;
  const contentW = A4_W - MARGIN_X * 2;

  const { canvas, ctx } = createA4Page(lang);
  const p = receipt.payment;

  // Header band
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(MARGIN_X, 70, contentW, 130);

  drawAlignedText(
    ctx,
    receipt.agency.name || (isAr ? 'وكالة كراء السيارات' : 'Agence de Location'),
    isAr ? startX - 32 : startX + 32,
    94,
    'start',
    `700 32px ${FONT_FAMILY}`,
    '#ffffff',
    contentW - 360
  );
  drawAlignedText(
    ctx,
    `${receipt.agency.address || ''} · ${formatDigits(receipt.agency.phone || '', numerals)}`,
    isAr ? startX - 32 : startX + 32,
    140,
    'start',
    `400 18px ${FONT_FAMILY}`,
    '#cbd5e1',
    contentW - 360
  );

  const receiptBadgeTitle =
    p.direction === 'REFUND'
      ? isAr
        ? 'وصل إرجاع مالي'
        : 'REÇU DE REMBOURSEMENT'
      : isAr
        ? 'وصل دفع مالي'
        : 'REÇU DE PAIEMENT';

  drawAlignedText(
    ctx,
    receiptBadgeTitle,
    isAr ? endX + 32 : endX - 32,
    98,
    'end',
    `700 24px ${FONT_FAMILY}`,
    '#93c5fd'
  );
  drawAlignedText(
    ctx,
    formatDigits(p.receiptNumber, numerals),
    isAr ? endX + 32 : endX - 32,
    136,
    'end',
    `700 26px ${FONT_FAMILY}`,
    '#ffffff'
  );

  let y = 240;

  // Meta row
  drawAlignedText(
    ctx,
    `${isAr ? 'رمز العملية:' : 'Transaction :'} ${formatDigits(p.transactionCode, numerals)}`,
    startX,
    y,
    'start',
    `600 20px ${FONT_FAMILY}`,
    '#334155'
  );
  drawAlignedText(
    ctx,
    `${isAr ? 'تاريخ العملية:' : 'Date paiement :'} ${formatDigits(p.paymentDate, numerals)}`,
    endX,
    y,
    'end',
    `600 20px ${FONT_FAMILY}`,
    '#334155'
  );
  y += 42;
  drawDivider(ctx, y);
  y += 32;

  // Two-column info block: Customer & Contract
  const midX = A4_W / 2;
  const colLeftStart = isAr ? A4_W - MARGIN_X : MARGIN_X;
  const colRightStart = isAr ? midX - 20 : midX + 20;

  drawAlignedText(
    ctx,
    isAr ? 'بيانات الزبون' : 'CLIENT',
    colLeftStart,
    y,
    'start',
    `700 18px ${FONT_FAMILY}`,
    '#64748b'
  );
  drawAlignedText(
    ctx,
    isAr ? 'تفاصيل العقد' : 'CONTRAT DE LOCATION',
    colRightStart,
    y,
    'start',
    `700 18px ${FONT_FAMILY}`,
    '#64748b'
  );
  y += 34;

  drawAlignedText(
    ctx,
    receipt.customer.fullName,
    colLeftStart,
    y,
    'start',
    `700 24px ${FONT_FAMILY}`,
    '#0f172a',
    contentW / 2 - 30
  );
  drawAlignedText(
    ctx,
    `${formatDigits(receipt.contract.contractNumber, numerals)} · ${receipt.contract.vehicleLabel}`,
    colRightStart,
    y,
    'start',
    `700 22px ${FONT_FAMILY}`,
    '#0f172a',
    contentW / 2 - 30
  );
  y += 36;

  drawAlignedText(
    ctx,
    `${isAr ? 'الهاتف:' : 'Tél :'} ${formatDigits(receipt.customer.phone, numerals)}`,
    colLeftStart,
    y,
    'start',
    `400 20px ${FONT_FAMILY}`,
    '#475569'
  );
  drawAlignedText(
    ctx,
    `${formatDateTimeAlgiers(receipt.contract.startDate, lang, numerals)} → ${formatDateTimeAlgiers(
      receipt.contract.expectedReturnDate,
      lang,
      numerals
    )}`,
    colRightStart,
    y,
    'start',
    `400 18px ${FONT_FAMILY}`,
    '#475569',
    contentW / 2 - 30
  );
  y += 34;

  if (receipt.customer.address) {
    drawAlignedText(
      ctx,
      receipt.customer.address,
      colLeftStart,
      y,
      'start',
      `400 18px ${FONT_FAMILY}`,
      '#64748b',
      contentW / 2 - 30
    );
  }
  y += 60;

  // Amount Box
  ctx.fillStyle = p.direction === 'REFUND' ? '#fff1f2' : '#f0fdf4';
  ctx.strokeStyle = p.direction === 'REFUND' ? '#fecdd3' : '#bbf7d0';
  ctx.lineWidth = 2;
  ctx.fillRect(MARGIN_X, y, contentW, 170);
  ctx.strokeRect(MARGIN_X, y, contentW, 170);

  drawAlignedText(
    ctx,
    p.direction === 'REFUND'
      ? isAr
        ? 'المبلغ المرجع للزبون'
        : 'MONTANT REMBOURSÉ'
      : isAr
        ? 'المبلغ المستلم'
        : 'MONTANT ENCAISSÉ',
    A4_W / 2,
    y + 28,
    'center',
    `700 20px ${FONT_FAMILY}`,
    p.direction === 'REFUND' ? '#9f1239' : '#166534'
  );
  drawAlignedText(
    ctx,
    formatCurrencyMinor(p.amountMinor, p.currency, lang, numerals),
    A4_W / 2,
    y + 68,
    'center',
    `700 46px ${FONT_FAMILY}`,
    p.direction === 'REFUND' ? '#881337' : '#14532d'
  );
  drawAlignedText(
    ctx,
    `${isAr ? 'طريقة الدفع:' : 'Mode de règlement :'} ${methodLabel(p.method, lang)}${
      p.paymentReference ? ` · ${isAr ? 'المرجع:' : 'Réf :'} ${p.paymentReference}` : ''
    }`,
    A4_W / 2,
    y + 128,
    'center',
    `500 18px ${FONT_FAMILY}`,
    '#334155'
  );
  y += 210;

  // Contract Financial Situation Table
  const rows: Array<[string, string, boolean?]> = [
    [
      isAr ? 'إجمالي العقد المعتمد' : 'Montant total du contrat',
      formatCurrencyMinor(receipt.contract.totalContractAmountMinor, p.currency, lang, numerals),
    ],
    [
      isAr ? 'إجمالي المدفوعات الصافية' : 'Total net encaissé sur le contrat',
      formatCurrencyMinor(receipt.contract.paidNetMinor, p.currency, lang, numerals),
    ],
    [
      isAr ? 'الرصيد المتبقي للدفع' : 'Reste à payer sur le contrat',
      formatCurrencyMinor(receipt.contract.outstandingMinor, p.currency, lang, numerals),
      true,
    ],
  ];

  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(MARGIN_X, y, contentW, 48);
  drawAlignedText(
    ctx,
    isAr ? 'الوضعية المحاسبية للعقد' : 'SITUATION FINANCIÈRE DU CONTRAT',
    isAr ? startX - 20 : startX + 20,
    y + 13,
    'start',
    `700 18px ${FONT_FAMILY}`,
    '#475569'
  );
  y += 48;

  for (const [label, value, highlight] of rows) {
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(MARGIN_X, y, contentW, 56);
    drawAlignedText(
      ctx,
      label,
      isAr ? startX - 20 : startX + 20,
      y + 16,
      'start',
      `${highlight ? '700' : '500'} 20px ${FONT_FAMILY}`,
      '#0f172a'
    );
    drawAlignedText(
      ctx,
      value,
      isAr ? endX + 20 : endX - 20,
      y + 16,
      'end',
      `700 22px ${FONT_FAMILY}`,
      highlight ? '#b45309' : '#0f172a'
    );
    y += 56;
  }

  if (p.description) {
    y += 32;
    drawAlignedText(
      ctx,
      `${isAr ? 'ملاحظات:' : 'Libellé :'} ${p.description}`,
      startX,
      y,
      'start',
      `400 18px ${FONT_FAMILY}`,
      '#475569',
      contentW
    );
  }

  // Signature & Fiscal Footer
  const footerY = A4_H - 220;
  drawDivider(ctx, footerY);
  drawAlignedText(
    ctx,
    `${isAr ? 'أُعد بواسطة:' : 'Établi par :'} ${receipt.recordedByFullName} (${p.recordedByUsername})`,
    startX,
    footerY + 24,
    'start',
    `500 18px ${FONT_FAMILY}`,
    '#334155'
  );
  drawAlignedText(
    ctx,
    isAr ? 'الختم والتوقيع' : 'Cachet et signature de l’agence',
    endX,
    footerY + 24,
    'end',
    `600 18px ${FONT_FAMILY}`,
    '#334155'
  );

  drawAlignedText(
    ctx,
    `NIF: ${receipt.agency.nif || '—'} · RC: ${receipt.agency.rc || '—'} · ${
      isAr ? 'طبع بتاريخ' : 'Édité le'
    } ${formatDateTimeAlgiers(new Date().toISOString(), lang, numerals)}`,
    A4_W / 2,
    A4_H - 80,
    'center',
    `400 15px ${FONT_FAMILY}`,
    '#64748b'
  );

  const blob = buildPdfFromCanvases([canvas]);
  downloadBlobFile(`${p.receiptNumber}.pdf`, blob);
}

export function exportFinancialReportPdf(
  report: FinancialDashboardReportDto,
  agency: { name?: string; nif?: string; rc?: string; phone?: string },
  lang: AppLanguage,
  numerals: NumeralSystem
): void {
  const isAr = lang === 'ar';
  const startX = isAr ? A4_W - MARGIN_X : MARGIN_X;
  const endX = isAr ? MARGIN_X : A4_W - MARGIN_X;
  const contentW = A4_W - MARGIN_X * 2;
  const currency: CurrencyCode = report.currency;

  const pages: HTMLCanvasElement[] = [];
  let page = createA4Page(lang);
  pages.push(page.canvas);

  const drawHeader = (ctx: CanvasRenderingContext2D, pageNum: number) => {
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(MARGIN_X, 60, contentW, 108);
    drawAlignedText(
      ctx,
      agency.name || (isAr ? 'تقرير النشاط المالي للوكالة' : 'Rapport Financier de l’Agence'),
      isAr ? startX - 28 : startX + 28,
      78,
      'start',
      `700 28px ${FONT_FAMILY}`,
      '#ffffff',
      contentW - 340
    );
    drawAlignedText(
      ctx,
      `${isAr ? 'الفترة:' : 'Période :'} ${formatDigits(report.dateFrom, numerals)} → ${formatDigits(
        report.dateTo,
        numerals
      )}`,
      isAr ? startX - 28 : startX + 28,
      120,
      'start',
      `400 18px ${FONT_FAMILY}`,
      '#cbd5e1'
    );
    drawAlignedText(
      ctx,
      isAr ? `صفحة ${formatDigits(pageNum, numerals)}` : `Page ${pageNum}`,
      isAr ? endX + 28 : endX - 28,
      86,
      'end',
      `600 18px ${FONT_FAMILY}`,
      '#93c5fd'
    );
    drawAlignedText(
      ctx,
      `NIF: ${agency.nif || '—'} · RC: ${agency.rc || '—'}`,
      isAr ? endX + 28 : endX - 28,
      120,
      'end',
      `400 15px ${FONT_FAMILY}`,
      '#cbd5e1'
    );
  };

  drawHeader(page.ctx, 1);
  let y = 200;
  const s = report.summary;

  // Section 1: KPI Summary Grid (2 cols x 4 rows)
  drawAlignedText(
    page.ctx,
    isAr ? '1. المؤشرات المالية الرئيسية (دون احتساب الكفالات كإيراد)' : '1. Synthèse Financière (Cautions exclues du chiffre d’affaires)',
    startX,
    y,
    'start',
    `700 22px ${FONT_FAMILY}`,
    '#0f172a'
  );
  y += 40;

  const kpis: Array<[string, string, string]> = [
    [
      isAr ? 'رقم الأعمال الإيجاري' : 'Chiffre d’affaires locatif',
      formatCurrencyMinor(s.rentalRevenueMinor, currency, lang, numerals),
      '#1e3a8a',
    ],
    [
      isAr ? 'صافي التحصيلات للفترة' : 'Encaissements nets (période)',
      formatCurrencyMinor(s.collectedNetMinor, currency, lang, numerals),
      '#047857',
    ],
    [
      isAr ? 'إجمالي المصاريف المعتمدة' : 'Dépenses validées (période)',
      formatCurrencyMinor(s.expensesMinor, currency, lang, numerals),
      '#b91c1c',
    ],
    [
      isAr ? 'النتيجة التشغيلية الصافية' : 'Résultat opérationnel net',
      formatCurrencyMinor(s.netOperatingIncomeMinor, currency, lang, numerals),
      s.netOperatingIncomeMinor >= 0 ? '#047857' : '#b91c1c',
    ],
    [
      isAr ? 'المستحقات غير المدفوعة (المحفظة)' : 'Créances clients impayées',
      formatCurrencyMinor(s.portfolioOutstandingMinor, currency, lang, numerals),
      '#b45309',
    ],
    [
      isAr ? 'الديون المتأخرة' : 'Créances en retard',
      formatCurrencyMinor(s.portfolioOverdueMinor, currency, lang, numerals),
      '#be123c',
    ],
    [
      isAr ? 'الكفالات المحتجزة (التزام مالي)' : 'Cautions détenues (Passif)',
      `${formatCurrencyMinor(s.depositsCurrentlyHeldDzdMinor, 'DZD', lang, numerals)}${
        s.depositsCurrentlyHeldEurMinor > 0
          ? ` + ${formatCurrencyMinor(s.depositsCurrentlyHeldEurMinor, 'EUR', lang, numerals)}`
          : ''
      }`,
      '#334155',
    ],
    [
      isAr ? 'وضعية الصندوق النقدي' : 'Position de trésorerie',
      formatCurrencyMinor(
        s.openCashSessionBalanceMinor ?? s.lastClosedCashBalanceMinor,
        currency,
        lang,
        numerals
      ),
      '#0f172a',
    ],
  ];

  const boxW = (contentW - 24) / 2;
  const boxH = 92;
  for (let i = 0; i < kpis.length; i++) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const bx = isAr
      ? A4_W - MARGIN_X - boxW - col * (boxW + 24)
      : MARGIN_X + col * (boxW + 24);
    const by = y + row * (boxH + 16);

    page.ctx.fillStyle = '#f8fafc';
    page.ctx.strokeStyle = '#cbd5e1';
    page.ctx.lineWidth = 1.5;
    page.ctx.fillRect(bx, by, boxW, boxH);
    page.ctx.strokeRect(bx, by, boxW, boxH);

    const textAnchor = isAr ? bx + boxW - 20 : bx + 20;
    drawAlignedText(page.ctx, kpis[i][0], textAnchor, by + 16, 'start', `600 17px ${FONT_FAMILY}`, '#475569', boxW - 40);
    drawAlignedText(page.ctx, kpis[i][1], textAnchor, by + 48, 'start', `700 24px ${FONT_FAMILY}`, kpis[i][2], boxW - 40);
  }
  y += 4 * (boxH + 16) + 28;

  // Section 2: Payment Methods & Expenses by Category side-by-side
  drawAlignedText(
    page.ctx,
    isAr ? '2. توزيع التحصيلات والمصاريف' : '2. Répartition des Encaissements & Dépenses',
    startX,
    y,
    'start',
    `700 22px ${FONT_FAMILY}`,
    '#0f172a'
  );
  y += 38;

  const methods: Array<[string, number]> = (Object.entries(report.collectedByMethod) as Array<[string, number]>).map(
    ([m, v]) => [methodLabel(m, lang), v]
  );
  const cats = report.expensesByCategory.slice(0, 8);
  const maxSectionRows = Math.max(methods.length, cats.length, 1);

  for (let i = 0; i < maxSectionRows; i++) {
    const ry = y + i * 36;
    if (methods[i]) {
      drawAlignedText(page.ctx, methods[i][0], startX, ry, 'start', `500 17px ${FONT_FAMILY}`, '#334155', 260);
      drawAlignedText(
        page.ctx,
        formatCurrencyMinor(methods[i][1], currency, lang, numerals),
        isAr ? startX - 490 : startX + 490,
        ry,
        'end',
        `700 17px ${FONT_FAMILY}`,
        '#0f172a'
      );
    }
    if (cats[i]) {
      const catStart = isAr ? A4_W / 2 - 20 : A4_W / 2 + 20;
      drawAlignedText(
        page.ctx,
        expenseCatLabel(cats[i].category, lang),
        catStart,
        ry,
        'start',
        `500 17px ${FONT_FAMILY}`,
        '#334155',
        260
      );
      drawAlignedText(
        page.ctx,
        formatCurrencyMinor(cats[i].totalMinor, currency, lang, numerals),
        endX,
        ry,
        'end',
        `700 17px ${FONT_FAMILY}`,
        '#b91c1c'
      );
    }
  }
  y += maxSectionRows * 36 + 36;

  // Section 3: Vehicle Profitability Table (paginate cleanly if needed)
  const ensureSpace = (needed: number) => {
    if (y + needed > A4_H - 120) {
      page = createA4Page(lang);
      pages.push(page.canvas);
      drawHeader(page.ctx, pages.length);
      y = 200;
    }
  };

  ensureSpace(140);
  drawAlignedText(
    page.ctx,
    isAr ? '3. مردودية المركبات (الإيرادات، المصاريف والربح الصافي)' : '3. Rentabilité par Véhicule',
    startX,
    y,
    'start',
    `700 22px ${FONT_FAMILY}`,
    '#0f172a'
  );
  y += 38;

  const drawVehTableHeader = () => {
    page.ctx.fillStyle = '#e2e8f0';
    page.ctx.fillRect(MARGIN_X, y, contentW, 42);
    const cols = isAr
      ? [A4_W - MARGIN_X - 16, A4_W - MARGIN_X - 360, A4_W - MARGIN_X - 540, A4_W - MARGIN_X - 720, A4_W - MARGIN_X - 910, MARGIN_X + 16]
      : [MARGIN_X + 16, MARGIN_X + 360, MARGIN_X + 540, MARGIN_X + 720, MARGIN_X + 910, A4_W - MARGIN_X - 16];

    drawAlignedText(page.ctx, isAr ? 'المركبة' : 'Véhicule', cols[0], y + 11, 'start', `700 16px ${FONT_FAMILY}`, '#334155');
    drawAlignedText(page.ctx, isAr ? 'الأيام' : 'Jours', cols[1], y + 11, 'end', `700 16px ${FONT_FAMILY}`, '#334155');
    drawAlignedText(page.ctx, isAr ? 'الإيراد' : 'Revenu', cols[2], y + 11, 'end', `700 16px ${FONT_FAMILY}`, '#334155');
    drawAlignedText(page.ctx, isAr ? 'المصاريف' : 'Dépenses', cols[3], y + 11, 'end', `700 16px ${FONT_FAMILY}`, '#334155');
    drawAlignedText(page.ctx, isAr ? 'الربح الصافي' : 'Résultat Net', cols[4], y + 11, 'end', `700 16px ${FONT_FAMILY}`, '#334155');
    drawAlignedText(page.ctx, 'ROI', cols[5], y + 11, 'end', `700 16px ${FONT_FAMILY}`, '#334155');
    y += 42;
  };

  drawVehTableHeader();
  for (const vp of report.vehicleProfitability) {
    if (y + 44 > A4_H - 110) {
      page = createA4Page(lang);
      pages.push(page.canvas);
      drawHeader(page.ctx, pages.length);
      y = 200;
      drawVehTableHeader();
    }
    page.ctx.strokeStyle = '#e2e8f0';
    page.ctx.lineWidth = 1;
    page.ctx.strokeRect(MARGIN_X, y, contentW, 42);
    const cols = isAr
      ? [A4_W - MARGIN_X - 16, A4_W - MARGIN_X - 360, A4_W - MARGIN_X - 540, A4_W - MARGIN_X - 720, A4_W - MARGIN_X - 910, MARGIN_X + 16]
      : [MARGIN_X + 16, MARGIN_X + 360, MARGIN_X + 540, MARGIN_X + 720, MARGIN_X + 910, A4_W - MARGIN_X - 16];

    drawAlignedText(
      page.ctx,
      `${vp.brand} ${vp.model} (${formatDigits(vp.matricule, numerals)})`,
      cols[0],
      y + 11,
      'start',
      `500 16px ${FONT_FAMILY}`,
      '#0f172a',
      320
    );
    drawAlignedText(page.ctx, formatDigits(vp.rentedDays, numerals), cols[1], y + 11, 'end', `500 16px ${FONT_FAMILY}`, '#334155');
    drawAlignedText(
      page.ctx,
      formatCurrencyMinor(vp.rentalRevenueMinor, currency, lang, numerals),
      cols[2],
      y + 11,
      'end',
      `500 16px ${FONT_FAMILY}`,
      '#0f172a',
      170
    );
    drawAlignedText(
      page.ctx,
      formatCurrencyMinor(vp.expensesMinor, currency, lang, numerals),
      cols[3],
      y + 11,
      'end',
      `500 16px ${FONT_FAMILY}`,
      '#b91c1c',
      170
    );
    drawAlignedText(
      page.ctx,
      formatCurrencyMinor(vp.netProfitMinor, currency, lang, numerals),
      cols[4],
      y + 11,
      'end',
      `700 16px ${FONT_FAMILY}`,
      vp.netProfitMinor >= 0 ? '#047857' : '#b91c1c',
      180
    );
    drawAlignedText(
      page.ctx,
      vp.roiPercent != null ? `${formatDigits(vp.roiPercent.toFixed(1), numerals)}%` : '—',
      cols[5],
      y + 11,
      'end',
      `600 16px ${FONT_FAMILY}`,
      '#334155'
    );
    y += 42;
  }

  // Disclaimer & Timestamp on last page
  drawAlignedText(
    page.ctx,
    isAr
      ? 'ملاحظة محاسبية: الكفالات المالية تُسجل كالتزامات/أمانات مستردة ولا تُحتسب إطلاقاً ضمن إيرادات الكراء.'
      : 'Règle comptable : Les cautions sont suivies en passif (dettes restituables) et ne sont jamais comptées comme revenu locatif.',
    A4_W / 2,
    A4_H - 84,
    'center',
    `500 15px ${FONT_FAMILY}`,
    '#475569',
    contentW
  );

  const blob = buildPdfFromCanvases(pages);
  downloadBlobFile(`rapport-financier-${report.dateFrom}_${report.dateTo}.pdf`, blob);
}
