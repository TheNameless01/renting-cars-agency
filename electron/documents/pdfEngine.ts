import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type {
  AppLanguage,
  DocumentFormat,
  DocumentTemplateConfig,
  NumeralSystem,
} from '../../shared/types/domain.ts';
import {
  applyNumeralPreference,
  prepareLineForPdf,
  sanitizePdfText,
  wrapTextForPdf,
} from './arabicText.ts';

export type DocumentSectionBlock =
  | {
      type: 'kv_grid';
      title?: string;
      columns?: 1 | 2;
      items: Array<{ label: string; value: string; emphasize?: boolean }>;
    }
  | {
      type: 'table';
      title?: string;
      columns: Array<{
        key: string;
        label: string;
        widthWeight: number;
        align?: 'left' | 'right' | 'center';
      }>;
      rows: Array<Record<string, string | number | null | undefined>>;
      emptyText?: string;
    }
  | {
      type: 'summary_box';
      title?: string;
      rows: Array<{ label: string; value: string; highlight?: boolean }>;
    }
  | {
      type: 'text_block';
      title?: string;
      text: string;
      muted?: boolean;
    }
  | {
      type: 'signatures';
      leftLabel: string;
      rightLabel: string;
      leftImageDataUrl?: string | null;
      rightImageDataUrl?: string | null;
      leftSubtitle?: string | null;
      rightSubtitle?: string | null;
    };

export interface DocumentRenderPayload {
  documentNumber: string;
  title: string;
  subtitle?: string;
  issueDateDisplay: string;
  format: DocumentFormat;
  language: AppLanguage;
  numeralSystem: NumeralSystem;
  isCopy: boolean;
  sourceDocumentNumber?: string | null;
  copyNumber?: number;
  template: DocumentTemplateConfig;
  logoBytes?: { bytes: Buffer; mimeType: string } | null;
  sections: DocumentSectionBlock[];
}

interface FontBundle {
  regular: Buffer;
  bold: Buffer;
  mono: Buffer;
}

let cachedFonts: FontBundle | null = null;

function resolveFontsDir(): string {
  const candidates: string[] = [];
  if (typeof __dirname !== 'undefined') {
    candidates.push(path.resolve(__dirname, '../../electron/assets/fonts'));
    candidates.push(path.resolve(__dirname, '../assets/fonts'));
  }
  if (import.meta.dirname) {
    candidates.push(path.resolve(import.meta.dirname, '..', 'assets', 'fonts'));
  }
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (typeof resourcesPath === 'string' && resourcesPath) {
    candidates.push(path.resolve(resourcesPath, 'app.asar.unpacked', 'electron', 'assets', 'fonts'));
    candidates.push(path.resolve(resourcesPath, 'electron', 'assets', 'fonts'));
  }
  candidates.push(path.resolve(process.cwd(), 'electron', 'assets', 'fonts'));
  candidates.push('/usr/share/fonts/truetype/dejavu');

  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'DejaVuSans.ttf'))) {
      return dir;
    }
  }
  throw new Error('Polices PDF introuvables (DejaVuSans.ttf requis dans electron/assets/fonts).');
}

function loadFontBundle(): FontBundle {
  if (cachedFonts) return cachedFonts;
  const dir = resolveFontsDir();
  cachedFonts = {
    regular: fs.readFileSync(path.join(dir, 'DejaVuSans.ttf')),
    bold: fs.readFileSync(path.join(dir, 'DejaVuSans-Bold.ttf')),
    mono: fs.readFileSync(path.join(dir, 'DejaVuSansMono.ttf')),
  };
  return cachedFonts;
}

async function embedOptionalImage(
  pdfDoc: PDFDocument,
  dataUrlOrBuffer: { bytes: Uint8Array; mimeType: string } | string | null | undefined
): Promise<PDFImage | null> {
  if (!dataUrlOrBuffer) return null;
  try {
    let bytes: Uint8Array;
    let mime = '';
    if (typeof dataUrlOrBuffer === 'string') {
      const match = /^data:(image\/(?:png|jpeg|jpg));base64,(.+)$/i.exec(dataUrlOrBuffer.trim());
      if (!match) return null;
      mime = match[1].toLowerCase();
      bytes = Buffer.from(match[2], 'base64');
    } else {
      bytes = dataUrlOrBuffer.bytes;
      mime = dataUrlOrBuffer.mimeType.toLowerCase();
    }
    if (bytes.length === 0) return null;
    if (mime.includes('png')) return await pdfDoc.embedPng(bytes);
    if (mime.includes('jpeg') || mime.includes('jpg')) return await pdfDoc.embedJpg(bytes);
    return null;
  } catch {
    return null;
  }
}

const PALETTE = {
  ink: rgb(0.08, 0.11, 0.17),
  slate: rgb(0.32, 0.37, 0.45),
  muted: rgb(0.47, 0.52, 0.6),
  border: rgb(0.84, 0.87, 0.91),
  surface: rgb(0.96, 0.97, 0.985),
  accent: rgb(0.06, 0.36, 0.56),
  accentSoft: rgb(0.92, 0.955, 0.985),
  copyRed: rgb(0.75, 0.16, 0.16),
  copyBg: rgb(0.995, 0.94, 0.94),
  white: rgb(1, 1, 1),
};

function drawAlignedLine(
  page: PDFPage,
  visualText: string,
  x: number,
  y: number,
  boxWidth: number,
  font: PDFFont,
  size: number,
  align: 'left' | 'right' | 'center',
  color = PALETTE.ink
) {
  if (!visualText) return;
  const textWidth = font.widthOfTextAtSize(visualText, size);
  let drawX = x;
  if (align === 'right') {
    drawX = x + Math.max(0, boxWidth - textWidth);
  } else if (align === 'center') {
    drawX = x + Math.max(0, (boxWidth - textWidth) / 2);
  }
  page.drawText(visualText, { x: drawX, y, size, font, color });
}

export async function renderDocumentToPdf(payload: DocumentRenderPayload): Promise<Uint8Array> {
  if (payload.format === 'THERMAL_80MM' || payload.format === 'THERMAL_58MM') {
    return renderThermalReceiptPdf(payload);
  }
  return renderA4DocumentPdf(payload);
}

async function renderA4DocumentPdf(payload: DocumentRenderPayload): Promise<Uint8Array> {
  const isLandscape = payload.format === 'A4_LANDSCAPE_PDF';
  const pageWidth = isLandscape ? 841.89 : 595.28;
  const pageHeight = isLandscape ? 595.28 : 841.89;
  const marginX = 34;
  const contentWidth = pageWidth - marginX * 2;
  const topMargin = 32;
  const footerReserve = 42;
  const isRtl = payload.language === 'ar';
  const baseDir: 'ltr' | 'rtl' = isRtl ? 'rtl' : 'ltr';
  const defaultAlign: 'left' | 'right' = isRtl ? 'right' : 'left';

  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  const fonts = loadFontBundle();
  const fontReg = await pdfDoc.embedFont(fonts.regular, { subset: true });
  const fontBold = await pdfDoc.embedFont(fonts.bold, { subset: true });
  const fontMono = await pdfDoc.embedFont(fonts.mono, { subset: true });

  const logoImage =
    payload.template.showLogo && payload.logoBytes
      ? await embedOptionalImage(pdfDoc, payload.logoBytes)
      : null;

  const pages: PDFPage[] = [];
  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  pages.push(page);
  let y = pageHeight - topMargin;

  const drawAgencyHeader = (targetPage: PDFPage, compact: boolean): number => {
    let cursorY = pageHeight - topMargin;
    const headerHeight = compact ? 42 : 76;

    // Header band background
    targetPage.drawRectangle({
      x: marginX,
      y: cursorY - headerHeight,
      width: contentWidth,
      height: headerHeight,
      color: PALETTE.surface,
      borderColor: PALETTE.border,
      borderWidth: 0.75,
    });

    if (!compact) {
      const logoBoxSize = 48;
      const hasLogo = Boolean(logoImage);
      if (logoImage) {
        const scaled = logoImage.scaleToFit(logoBoxSize, logoBoxSize);
        const lx = isRtl ? marginX + contentWidth - scaled.width - 10 : marginX + 10;
        const ly = cursorY - 14 - scaled.height;
        targetPage.drawImage(logoImage, { x: lx, y: ly, width: scaled.width, height: scaled.height });
      }

      const infoOffset = hasLogo ? logoBoxSize + 18 : 10;
      const infoWidth = contentWidth * 0.56 - infoOffset;
      const infoX = isRtl ? marginX + contentWidth - infoOffset - infoWidth : marginX + infoOffset;

      const agencyName = prepareLineForPdf(
        payload.template.agencyName || (isRtl ? 'وكالة كراء السيارات' : 'Agence de Location'),
        baseDir
      );
      drawAlignedLine(targetPage, agencyName, infoX, cursorY - 18, infoWidth, fontBold, 11.5, defaultAlign, PALETTE.accent);

      const contactParts = [
        payload.template.agencyAddress,
        payload.template.agencyPhone ? `Tél: ${payload.template.agencyPhone}` : '',
        payload.template.agencyEmail,
      ].filter(Boolean);
      const contactLine = prepareLineForPdf(contactParts.join(' · '), baseDir);
      const contactWrapped = wrapTextForPdf(contactLine, infoWidth, fontReg, 7.8, baseDir).slice(0, 2);
      contactWrapped.forEach((line, idx) => {
        drawAlignedLine(targetPage, line, infoX, cursorY - 31 - idx * 10, infoWidth, fontReg, 7.8, defaultAlign, PALETTE.slate);
      });

      if (payload.template.showFiscalIds) {
        const fiscalParts = [
          payload.template.rcNumber ? `RC: ${payload.template.rcNumber}` : '',
          payload.template.nifNumber ? `NIF: ${payload.template.nifNumber}` : '',
          payload.template.nisNumber ? `NIS: ${payload.template.nisNumber}` : '',
          payload.template.artNumber ? `ART: ${payload.template.artNumber}` : '',
        ].filter(Boolean);
        if (fiscalParts.length > 0) {
          const fiscalWrapped = wrapTextForPdf(fiscalParts.join(' · '), infoWidth, fontReg, 7.2, baseDir).slice(0, 1);
          drawAlignedLine(targetPage, fiscalWrapped[0], infoX, cursorY - 56, infoWidth, fontReg, 7.2, defaultAlign, PALETTE.muted);
        }
      }

      // Document title & metadata block on opposite side
      const metaWidth = contentWidth * 0.4;
      const metaX = isRtl ? marginX + 10 : marginX + contentWidth - metaWidth - 10;
      const metaAlign: 'left' | 'right' = isRtl ? 'left' : 'right';

      const docTitleLine = prepareLineForPdf(payload.title, baseDir);
      drawAlignedLine(targetPage, docTitleLine, metaX, cursorY - 19, metaWidth, fontBold, 11, metaAlign, PALETTE.ink);

      const numLine = prepareLineForPdf(
        `${isRtl ? 'المرجع' : 'N°'} : ${applyNumeralPreference(payload.documentNumber, payload.numeralSystem)}`,
        baseDir
      );
      drawAlignedLine(targetPage, numLine, metaX, cursorY - 33, metaWidth, fontBold, 9, metaAlign, PALETTE.accent);

      const dateLine = prepareLineForPdf(
        `${isRtl ? 'تاريخ الإصدار' : 'Émis le'} : ${payload.issueDateDisplay}`,
        baseDir
      );
      drawAlignedLine(targetPage, dateLine, metaX, cursorY - 45, metaWidth, fontReg, 8, metaAlign, PALETTE.slate);

      const badgeLabel = payload.isCopy
        ? isRtl
          ? `نسخة مطابقة للأصل${payload.sourceDocumentNumber ? ` (${payload.sourceDocumentNumber})` : ''}`
          : `COPIE CONFORME${payload.sourceDocumentNumber ? ` · Réf ${payload.sourceDocumentNumber}` : ''}`
        : isRtl
          ? 'الوثيقة الأصلية'
          : 'ORIGINAL ARCHIVÉ';
      drawAlignedLine(
        targetPage,
        prepareLineForPdf(badgeLabel, baseDir),
        metaX,
        cursorY - 59,
        metaWidth,
        fontBold,
        7.8,
        metaAlign,
        payload.isCopy ? PALETTE.copyRed : PALETTE.accent
      );

      cursorY -= headerHeight + 10;

      if (payload.isCopy) {
        const copyBannerHeight = 20;
        targetPage.drawRectangle({
          x: marginX,
          y: cursorY - copyBannerHeight,
          width: contentWidth,
          height: copyBannerHeight,
          color: PALETTE.copyBg,
          borderColor: PALETTE.copyRed,
          borderWidth: 0.75,
        });
        const copyBannerText = isRtl
          ? `تنبيه: هذه نسخة معاد طباعتها (#${payload.copyNumber ?? 1}) من الوثيقة الأصلية المحفوظة في الأرشيف.`
          : `AVIS : Ce document est une COPIE RÉÉDITÉE (#${payload.copyNumber ?? 1}) issue de l'archive immuable.`;
        drawAlignedLine(
          targetPage,
          prepareLineForPdf(applyNumeralPreference(copyBannerText, payload.numeralSystem), baseDir),
          marginX + 8,
          cursorY - 13.5,
          contentWidth - 16,
          fontBold,
          8,
          'center',
          PALETTE.copyRed
        );
        cursorY -= copyBannerHeight + 8;
      }

      if (payload.subtitle) {
        const subLines = wrapTextForPdf(payload.subtitle, contentWidth - 16, fontReg, 8.5, baseDir);
        for (const sl of subLines) {
          drawAlignedLine(targetPage, sl, marginX + 8, cursorY - 10, contentWidth - 16, fontReg, 8.5, defaultAlign, PALETTE.slate);
          cursorY -= 12;
        }
        cursorY -= 4;
      }
      return cursorY;
    }

    // Compact continuation page header
    drawAlignedLine(
      targetPage,
      prepareLineForPdf(`${payload.title} · ${payload.documentNumber}`, baseDir),
      marginX + 10,
      cursorY - 17,
      contentWidth - 20,
      fontBold,
      9.5,
      defaultAlign,
      PALETTE.accent
    );
    drawAlignedLine(
      targetPage,
      prepareLineForPdf(
        `${payload.template.agencyName} — ${payload.issueDateDisplay}${payload.isCopy ? (isRtl ? ' (نسخة)' : ' (COPIE)') : ''}`,
        baseDir
      ),
      marginX + 10,
      cursorY - 31,
      contentWidth - 20,
      fontReg,
      7.8,
      defaultAlign,
      PALETTE.slate
    );
    return cursorY - headerHeight - 10;
  };

  const ensureSpace = (neededHeight: number) => {
    if (y - neededHeight < footerReserve) {
      page = pdfDoc.addPage([pageWidth, pageHeight]);
      pages.push(page);
      y = drawAgencyHeader(page, true);
    }
  };

  y = drawAgencyHeader(page, false);

  const drawSectionHeading = (title: string) => {
    ensureSpace(24);
    const barH = 18;
    page.drawRectangle({
      x: marginX,
      y: y - barH,
      width: contentWidth,
      height: barH,
      color: PALETTE.accentSoft,
      borderColor: PALETTE.border,
      borderWidth: 0.5,
    });
    drawAlignedLine(
      page,
      prepareLineForPdf(title, baseDir),
      marginX + 8,
      y - 12.5,
      contentWidth - 16,
      fontBold,
      9,
      defaultAlign,
      PALETTE.accent
    );
    y -= barH + 6;
  };

  for (const section of payload.sections) {
    if (section.type === 'kv_grid') {
      if (section.title) drawSectionHeading(section.title);
      const cols = section.columns ?? 2;
      const gap = 10;
      const colW = cols === 2 ? (contentWidth - gap) / 2 : contentWidth;

      const items = section.items;
      for (let i = 0; i < items.length; i += cols) {
        const pair = items.slice(i, i + cols);
        const wrappedCells = pair.map((item) => {
          const lblLines = wrapTextForPdf(item.label, colW - 14, fontBold, 7.5, baseDir);
          const valLines = wrapTextForPdf(item.value || '—', colW - 14, item.emphasize ? fontBold : fontReg, 8.8, baseDir);
          const cellH = lblLines.length * 10 + valLines.length * 11.5 + 10;
          return { item, lblLines, valLines, cellH };
        });
        const rowH = Math.max(...wrappedCells.map((c) => c.cellH), 26);
        ensureSpace(rowH + 4);

        wrappedCells.forEach((cell, idx) => {
          const visualCol = isRtl && cols === 2 ? 1 - idx : idx;
          const boxX = marginX + visualCol * (colW + gap);
          page.drawRectangle({
            x: boxX,
            y: y - rowH,
            width: colW,
            height: rowH,
            color: PALETTE.white,
            borderColor: PALETTE.border,
            borderWidth: 0.5,
          });
          let cy = y - 11;
          for (const ll of cell.lblLines) {
            drawAlignedLine(page, ll, boxX + 7, cy, colW - 14, fontBold, 7.5, defaultAlign, PALETTE.muted);
            cy -= 10;
          }
          for (const vl of cell.valLines) {
            drawAlignedLine(
              page,
              vl,
              boxX + 7,
              cy,
              colW - 14,
              cell.item.emphasize ? fontBold : fontReg,
              8.8,
              defaultAlign,
              cell.item.emphasize ? PALETTE.accent : PALETTE.ink
            );
            cy -= 11.5;
          }
        });
        y -= rowH + 5;
      }
      y -= 4;
    } else if (section.type === 'table') {
      if (section.title) drawSectionHeading(section.title);
      const totalWeight = section.columns.reduce((acc, c) => acc + c.widthWeight, 0) || 1;
      const orderedCols = isRtl ? [...section.columns].reverse() : section.columns;
      const colWidths = orderedCols.map((c) => (c.widthWeight / totalWeight) * contentWidth);

      const drawTableHeader = () => {
        const hdrH = 20;
        ensureSpace(hdrH + 16);
        page.drawRectangle({
          x: marginX,
          y: y - hdrH,
          width: contentWidth,
          height: hdrH,
          color: PALETTE.accent,
        });
        let cx = marginX;
        orderedCols.forEach((col, idx) => {
          const w = colWidths[idx];
          const align = col.align ?? (isRtl ? 'right' : 'left');
          const lbl = wrapTextForPdf(col.label, w - 8, fontBold, 7.8, baseDir)[0] ?? '';
          drawAlignedLine(page, lbl, cx + 4, y - 13, w - 8, fontBold, 7.8, align, PALETTE.white);
          cx += w;
        });
        y -= hdrH;
      };

      drawTableHeader();

      if (section.rows.length === 0) {
        const emptyH = 22;
        ensureSpace(emptyH);
        page.drawRectangle({
          x: marginX,
          y: y - emptyH,
          width: contentWidth,
          height: emptyH,
          color: PALETTE.white,
          borderColor: PALETTE.border,
          borderWidth: 0.5,
        });
        drawAlignedLine(
          page,
          prepareLineForPdf(section.emptyText || (isRtl ? 'لا توجد بيانات مسجلة' : 'Aucune donnée enregistrée'), baseDir),
          marginX + 8,
          y - 14,
          contentWidth - 16,
          fontReg,
          8.2,
          'center',
          PALETTE.muted
        );
        y -= emptyH + 8;
        continue;
      }

      section.rows.forEach((row, rowIdx) => {
        const cellWrapped = orderedCols.map((col, idx) => {
          const raw = row[col.key];
          const valStr = raw === null || raw === undefined || raw === '' ? '—' : String(raw);
          return wrapTextForPdf(valStr, colWidths[idx] - 8, fontReg, 8, baseDir);
        });
        const maxLines = Math.max(...cellWrapped.map((l) => l.length), 1);
        const rowH = Math.max(18, maxLines * 10.5 + 8);

        if (y - rowH < footerReserve) {
          page = pdfDoc.addPage([pageWidth, pageHeight]);
          pages.push(page);
          y = drawAgencyHeader(page, true);
          drawTableHeader();
        }

        page.drawRectangle({
          x: marginX,
          y: y - rowH,
          width: contentWidth,
          height: rowH,
          color: rowIdx % 2 === 1 ? PALETTE.surface : PALETTE.white,
          borderColor: PALETTE.border,
          borderWidth: 0.4,
        });

        let cx = marginX;
        orderedCols.forEach((col, idx) => {
          const w = colWidths[idx];
          const align = col.align ?? (isRtl ? 'right' : 'left');
          const lines = cellWrapped[idx];
          lines.forEach((line, li) => {
            drawAlignedLine(page, line, cx + 4, y - 11.5 - li * 10.5, w - 8, fontReg, 8, align, PALETTE.ink);
          });
          cx += w;
        });

        y -= rowH;
      });
      y -= 8;
    } else if (section.type === 'summary_box') {
      if (section.title) drawSectionHeading(section.title);
      const boxH = section.rows.length * 18 + 10;
      ensureSpace(boxH + 4);
      page.drawRectangle({
        x: marginX,
        y: y - boxH,
        width: contentWidth,
        height: boxH,
        color: PALETTE.surface,
        borderColor: PALETTE.border,
        borderWidth: 0.75,
      });
      let sy = y - 16;
      for (const r of section.rows) {
        const lblFont = r.highlight ? fontBold : fontReg;
        const valFont = r.highlight ? fontBold : fontMono;
        const labelX = isRtl ? marginX + contentWidth * 0.42 : marginX + 10;
        const labelW = contentWidth * 0.56 - 10;
        const valX = isRtl ? marginX + 10 : marginX + contentWidth * 0.58;
        const valW = contentWidth * 0.42 - 14;

        drawAlignedLine(
          page,
          prepareLineForPdf(r.label, baseDir),
          labelX,
          sy,
          labelW,
          lblFont,
          r.highlight ? 9.5 : 8.5,
          isRtl ? 'right' : 'left',
          r.highlight ? PALETTE.accent : PALETTE.ink
        );
        drawAlignedLine(
          page,
          prepareLineForPdf(r.value, baseDir),
          valX,
          sy,
          valW,
          valFont,
          r.highlight ? 9.5 : 8.5,
          isRtl ? 'left' : 'right',
          r.highlight ? PALETTE.accent : PALETTE.ink
        );
        sy -= 18;
      }
      y -= boxH + 8;
    } else if (section.type === 'text_block') {
      if (section.title) drawSectionHeading(section.title);
      const lines = wrapTextForPdf(section.text, contentWidth - 16, fontReg, 8.3, baseDir);
      let idx = 0;
      while (idx < lines.length) {
        const availableH = y - footerReserve - 16;
        const maxLinesFit = Math.max(1, Math.floor(availableH / 11.5));
        const chunk = lines.slice(idx, idx + maxLinesFit);
        const boxH = chunk.length * 11.5 + 12;
        page.drawRectangle({
          x: marginX,
          y: y - boxH,
          width: contentWidth,
          height: boxH,
          color: PALETTE.white,
          borderColor: PALETTE.border,
          borderWidth: 0.5,
        });
        chunk.forEach((line, li) => {
          drawAlignedLine(
            page,
            line,
            marginX + 8,
            y - 13 - li * 11.5,
            contentWidth - 16,
            fontReg,
            8.3,
            defaultAlign,
            section.muted ? PALETTE.slate : PALETTE.ink
          );
        });
        y -= boxH + 6;
        idx += chunk.length;
        if (idx < lines.length) {
          page = pdfDoc.addPage([pageWidth, pageHeight]);
          pages.push(page);
          y = drawAgencyHeader(page, true);
        }
      }
    } else if (section.type === 'signatures' && payload.template.showSignatureBoxes) {
      const sigH = 84;
      ensureSpace(sigH + 6);
      const boxW = (contentWidth - 14) / 2;
      const leftImg = await embedOptionalImage(pdfDoc, section.leftImageDataUrl);
      const rightImg = await embedOptionalImage(pdfDoc, section.rightImageDataUrl);

      const leftBox = {
        label: section.leftLabel,
        subtitle: section.leftSubtitle,
        img: leftImg,
        x: isRtl ? marginX + boxW + 14 : marginX,
      };
      const rightBox = {
        label: section.rightLabel,
        subtitle: section.rightSubtitle,
        img: rightImg,
        x: isRtl ? marginX : marginX + boxW + 14,
      };

      for (const box of [leftBox, rightBox]) {
        page.drawRectangle({
          x: box.x,
          y: y - sigH,
          width: boxW,
          height: sigH,
          color: PALETTE.white,
          borderColor: PALETTE.border,
          borderWidth: 0.75,
        });
        drawAlignedLine(
          page,
          prepareLineForPdf(box.label, baseDir),
          box.x + 8,
          y - 14,
          boxW - 16,
          fontBold,
          8.2,
          defaultAlign,
          PALETTE.slate
        );
        if (box.img) {
          const scaled = box.img.scaleToFit(boxW - 24, 46);
          page.drawImage(box.img, {
            x: box.x + (boxW - scaled.width) / 2,
            y: y - sigH + 16,
            width: scaled.width,
            height: scaled.height,
          });
        }
        if (box.subtitle) {
          drawAlignedLine(
            page,
            prepareLineForPdf(box.subtitle, baseDir),
            box.x + 8,
            y - sigH + 6,
            boxW - 16,
            fontReg,
            7.2,
            defaultAlign,
            PALETTE.muted
          );
        }
      }
      y -= sigH + 8;
    }
  }

  // Page numbers & configured footer on all pages
  const totalPages = pages.length;
  const footerText = sanitizePdfText(isRtl ? payload.template.footerAr : payload.template.footerFr);
  pages.forEach((p, idx) => {
    const pageNumText = isRtl
      ? `صفحة ${idx + 1} / ${totalPages}`
      : `Page ${idx + 1} / ${totalPages}`;
    const lineY = 26;
    p.drawLine({
      start: { x: marginX, y: lineY + 8 },
      end: { x: pageWidth - marginX, y: lineY + 8 },
      thickness: 0.5,
      color: PALETTE.border,
    });
    if (footerText) {
      const fLine = wrapTextForPdf(footerText, contentWidth - 90, fontReg, 7.2, baseDir)[0] ?? '';
      drawAlignedLine(
        p,
        fLine,
        isRtl ? marginX + 90 : marginX,
        lineY - 2,
        contentWidth - 90,
        fontReg,
        7.2,
        defaultAlign,
        PALETTE.muted
      );
    }
    drawAlignedLine(
      p,
      prepareLineForPdf(applyNumeralPreference(pageNumText, payload.numeralSystem), baseDir),
      isRtl ? marginX : marginX + contentWidth - 85,
      lineY - 2,
      85,
      fontReg,
      7.5,
      isRtl ? 'left' : 'right',
      PALETTE.slate
    );
  });

  return pdfDoc.save();
}

async function renderThermalReceiptPdf(payload: DocumentRenderPayload): Promise<Uint8Array> {
  const is58 = payload.format === 'THERMAL_58MM';
  const pageWidth = is58 ? 164.41 : 226.77; // exact 58mm / 80mm in points
  const marginX = is58 ? 8 : 11;
  const contentWidth = pageWidth - marginX * 2;
  const isRtl = payload.language === 'ar';
  const baseDir: 'ltr' | 'rtl' = isRtl ? 'rtl' : 'ltr';
  const align: 'left' | 'right' = isRtl ? 'right' : 'left';
  const baseFontSize = is58 ? 7.2 : 8.2;
  const smallFontSize = is58 ? 6.4 : 7.2;

  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  const fonts = loadFontBundle();
  const fontReg = await pdfDoc.embedFont(fonts.regular, { subset: true });
  const fontBold = await pdfDoc.embedFont(fonts.bold, { subset: true });

  // Measure lines first so height fits exact receipt length without overflow or wasted paper
  type DrawOp =
    | { kind: 'text'; text: string; size: number; bold?: boolean; align?: 'left' | 'right' | 'center'; gapAfter?: number; color?: ReturnType<typeof rgb> }
    | { kind: 'kv'; label: string; value: string; bold?: boolean }
    | { kind: 'hr' };

  const ops: DrawOp[] = [];
  ops.push({ kind: 'text', text: payload.template.agencyName || 'Agence', size: baseFontSize + 1.4, bold: true, align: 'center', gapAfter: 2 });
  if (payload.template.agencyPhone) {
    ops.push({ kind: 'text', text: payload.template.agencyPhone, size: smallFontSize, align: 'center', gapAfter: 1 });
  }
  if (payload.template.agencyAddress) {
    ops.push({ kind: 'text', text: payload.template.agencyAddress, size: smallFontSize, align: 'center', gapAfter: 2 });
  }
  ops.push({ kind: 'hr' });
  ops.push({ kind: 'text', text: payload.title, size: baseFontSize + 0.6, bold: true, align: 'center', gapAfter: 2 });
  ops.push({ kind: 'text', text: applyNumeralPreference(payload.documentNumber, payload.numeralSystem), size: baseFontSize, bold: true, align: 'center', gapAfter: 2 });
  ops.push({ kind: 'text', text: payload.issueDateDisplay, size: smallFontSize, align: 'center', gapAfter: 2 });
  if (payload.isCopy) {
    ops.push({
      kind: 'text',
      text: isRtl ? `*** نسخة (#${payload.copyNumber ?? 1}) ***` : `*** COPIE (#${payload.copyNumber ?? 1}) ***`,
      size: baseFontSize,
      bold: true,
      align: 'center',
      color: PALETTE.copyRed,
      gapAfter: 2,
    });
  }
  ops.push({ kind: 'hr' });

  for (const sec of payload.sections) {
    if (sec.type === 'kv_grid') {
      if (sec.title) ops.push({ kind: 'text', text: sec.title, size: baseFontSize, bold: true, align, gapAfter: 2 });
      for (const item of sec.items) {
        ops.push({ kind: 'kv', label: item.label, value: item.value || '—', bold: item.emphasize });
      }
      ops.push({ kind: 'hr' });
    } else if (sec.type === 'table') {
      if (sec.title) ops.push({ kind: 'text', text: sec.title, size: baseFontSize, bold: true, align, gapAfter: 2 });
      for (const row of sec.rows) {
        const line = sec.columns.map((c) => String(row[c.key] ?? '—')).join(' · ');
        ops.push({ kind: 'text', text: line, size: smallFontSize, align, gapAfter: 2 });
      }
      ops.push({ kind: 'hr' });
    } else if (sec.type === 'summary_box') {
      if (sec.title) ops.push({ kind: 'text', text: sec.title, size: baseFontSize, bold: true, align, gapAfter: 2 });
      for (const r of sec.rows) {
        ops.push({ kind: 'kv', label: r.label, value: r.value, bold: r.highlight });
      }
      ops.push({ kind: 'hr' });
    } else if (sec.type === 'text_block') {
      if (sec.title) ops.push({ kind: 'text', text: sec.title, size: baseFontSize, bold: true, align, gapAfter: 2 });
      ops.push({ kind: 'text', text: sec.text, size: smallFontSize, align, gapAfter: 3 });
    }
  }

  const footerTxt = isRtl ? payload.template.footerAr : payload.template.footerFr;
  if (footerTxt) {
    ops.push({ kind: 'text', text: footerTxt, size: smallFontSize, align: 'center', gapAfter: 3 });
  }

  // First pass: measure exact vertical height
  let totalHeight = 24;
  const lineSpacing = 2.6;
  const computedLines: Array<
    | { kind: 'lines'; lines: string[]; size: number; bold: boolean; align: 'left' | 'right' | 'center'; gapAfter: number; color: ReturnType<typeof rgb> }
    | { kind: 'kv'; lblLines: string[]; valLines: string[]; bold: boolean }
    | { kind: 'hr' }
  > = [];

  for (const op of ops) {
    if (op.kind === 'hr') {
      totalHeight += 8;
      computedLines.push({ kind: 'hr' });
    } else if (op.kind === 'text') {
      const f = op.bold ? fontBold : fontReg;
      const wrapped = wrapTextForPdf(op.text, contentWidth, f, op.size, baseDir);
      totalHeight += wrapped.length * (op.size + lineSpacing) + (op.gapAfter ?? 2);
      computedLines.push({
        kind: 'lines',
        lines: wrapped,
        size: op.size,
        bold: Boolean(op.bold),
        align: op.align ?? align,
        gapAfter: op.gapAfter ?? 2,
        color: op.color ?? PALETTE.ink,
      });
    } else if (op.kind === 'kv') {
      const f = op.bold ? fontBold : fontReg;
      const lblLines = wrapTextForPdf(`${op.label}:`, contentWidth * 0.48, fontReg, smallFontSize, baseDir);
      const valLines = wrapTextForPdf(op.value, contentWidth * 0.5, f, baseFontSize, baseDir);
      const rows = Math.max(lblLines.length, valLines.length);
      totalHeight += rows * (baseFontSize + lineSpacing) + 2;
      computedLines.push({ kind: 'kv', lblLines, valLines, bold: Boolean(op.bold) });
    }
  }

  const pageHeight = Math.max(220, Math.ceil(totalHeight + 18));
  const page = pdfDoc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - 14;

  for (const item of computedLines) {
    if (item.kind === 'hr') {
      page.drawLine({
        start: { x: marginX, y: y - 3 },
        end: { x: pageWidth - marginX, y: y - 3 },
        thickness: 0.6,
        dashArray: [2, 2],
        color: PALETTE.slate,
      });
      y -= 8;
    } else if (item.kind === 'lines') {
      const f = item.bold ? fontBold : fontReg;
      for (const l of item.lines) {
        drawAlignedLine(page, l, marginX, y - item.size, contentWidth, f, item.size, item.align, item.color);
        y -= item.size + lineSpacing;
      }
      y -= item.gapAfter;
    } else if (item.kind === 'kv') {
      const rows = Math.max(item.lblLines.length, item.valLines.length);
      const valFont = item.bold ? fontBold : fontReg;
      for (let i = 0; i < rows; i++) {
        const ll = item.lblLines[i] ?? '';
        const vl = item.valLines[i] ?? '';
        if (isRtl) {
          drawAlignedLine(page, ll, marginX + contentWidth * 0.52, y - baseFontSize, contentWidth * 0.48, fontReg, smallFontSize, 'right', PALETTE.slate);
          drawAlignedLine(page, vl, marginX, y - baseFontSize, contentWidth * 0.5, valFont, baseFontSize, 'left', PALETTE.ink);
        } else {
          drawAlignedLine(page, ll, marginX, y - baseFontSize, contentWidth * 0.48, fontReg, smallFontSize, 'left', PALETTE.slate);
          drawAlignedLine(page, vl, marginX + contentWidth * 0.5, y - baseFontSize, contentWidth * 0.5, valFont, baseFontSize, 'right', PALETTE.ink);
        }
        y -= baseFontSize + lineSpacing;
      }
      y -= 2;
    }
  }

  return pdfDoc.save();
}
