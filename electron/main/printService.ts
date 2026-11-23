import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DocumentFormat, SystemPrinterInfo } from '../../shared/types/domain.ts';

export interface PrintPdfRequest {
  pdfBytes: Buffer;
  documentNumber: string;
  format: DocumentFormat;
  printerName?: string | null;
  silent?: boolean;
  copies?: number;
}

export interface PrintPdfResult {
  printed: boolean;
  printerName: string | null;
  copies: number;
  message: string;
}

export interface DesktopPrintAdapter {
  listPrinters(): Promise<SystemPrinterInfo[]>;
  printPdf(req: PrintPdfRequest): Promise<PrintPdfResult>;
}

/**
 * Default adapter used when running headless/tests/preview without an Electron BrowserWindow.
 * Desktop main process injects `createElectronPrintAdapter(BrowserWindow)`.
 */
export function createNoopPrintAdapter(): DesktopPrintAdapter {
  return {
    async listPrinters(): Promise<SystemPrinterInfo[]> {
      return [];
    },
    async printPdf(): Promise<PrintPdfResult> {
      throw new Error(
        'Impression OS directe indisponible dans cet environnement. Utilisez la prévisualisation ou l’export PDF.'
      );
    },
  };
}

/**
 * Electron main-process printer discovery & printing via an isolated hidden BrowserWindow.
 */
export function createElectronPrintAdapter(electronModule: {
  BrowserWindow: any;
}): DesktopPrintAdapter {
  const { BrowserWindow } = electronModule;

  return {
    async listPrinters(): Promise<SystemPrinterInfo[]> {
      const windows = BrowserWindow.getAllWindows();
      const targetWin = windows[0];
      if (targetWin && !targetWin.isDestroyed()) {
        const list = await targetWin.webContents.getPrintersAsync();
        return (list || []).map((p: any) => ({
          name: String(p.name),
          displayName: String(p.displayName || p.name),
          description: String(p.description || ''),
          status: Number(p.status ?? 0),
          isDefault: Boolean(p.isDefault),
        }));
      }

      const tempWin = new BrowserWindow({
        show: false,
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
      });
      try {
        await tempWin.loadURL('about:blank');
        const list = await tempWin.webContents.getPrintersAsync();
        return (list || []).map((p: any) => ({
          name: String(p.name),
          displayName: String(p.displayName || p.name),
          description: String(p.description || ''),
          status: Number(p.status ?? 0),
          isDefault: Boolean(p.isDefault),
        }));
      } finally {
        if (!tempWin.isDestroyed()) tempWin.destroy();
      }
    },

    async printPdf(req: PrintPdfRequest): Promise<PrintPdfResult> {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-print-'));
      const tempPdfPath = path.join(tempDir, `${req.documentNumber.replace(/[^A-Za-z0-9_-]/g, '_')}_${crypto.randomUUID()}.pdf`);
      fs.writeFileSync(tempPdfPath, req.pdfBytes, { mode: 0o600 });

      const printWin = new BrowserWindow({
        show: false,
        width: 820,
        height: 1100,
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          plugins: true,
        },
      });

      try {
        await printWin.loadFile(tempPdfPath);
        await new Promise((resolve) => setTimeout(resolve, 250));

        const copies = Math.max(1, Math.min(10, req.copies ?? 1));
        const landscape = req.format === 'A4_LANDSCAPE_PDF';

        const result = await new Promise<PrintPdfResult>((resolve, reject) => {
          printWin.webContents.print(
            {
              silent: Boolean(req.silent),
              printBackground: true,
              deviceName: req.printerName || undefined,
              copies,
              landscape,
            },
            (success: boolean, failureReason: string) => {
              if (!success) {
                reject(new Error(failureReason || 'Impression annulée ou échouée par le spouler système.'));
                return;
              }
              resolve({
                printed: true,
                printerName: req.printerName || null,
                copies,
                message: 'Document envoyé à l’imprimante.',
              });
            }
          );
        });

        return result;
      } finally {
        if (!printWin.isDestroyed()) printWin.destroy();
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
        } catch {
          // best-effort temp file cleanup
        }
      }
    },
  };
}
