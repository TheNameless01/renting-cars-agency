import path from 'node:path';
import { AuthError } from '../security/rbac.ts';

export type AllowedUploadMime = 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';

const MAX_UPLOAD_BYTES_DEFAULT = 8 * 1024 * 1024; // 8 MB decoded ceiling

/**
 * Sanitizes an untrusted original file name by stripping path segments and control characters.
 */
export function sanitizeUploadedFileName(rawName: string, fallback = 'document'): string {
  const base = path.basename(String(rawName || '').replace(/\\/g, '/')).trim();
  const cleaned = base
    .replace(/[\u0000-\u001f<>:"/|?*]/g, '_')
    .replace(/\.{2,}/g, '.')
    .slice(0, 180);
  return cleaned || fallback;
}

function isJpeg(buf: Buffer): boolean {
  return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

function isPng(buf: Buffer): boolean {
  return (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  );
}

function isWebp(buf: Buffer): boolean {
  return (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  );
}

function isPdf(buf: Buffer): boolean {
  if (buf.length < 5) return false;
  // Allow rare UTF-8 BOM or leading whitespace before %PDF-
  const headerWindow = buf.subarray(0, Math.min(buf.length, 64)).toString('latin1');
  return headerWindow.includes('%PDF-');
}

function looksDangerousExecutableOrScript(buf: Buffer): boolean {
  if (buf.length >= 2 && buf[0] === 0x4d && buf[1] === 0x5a) return true; // PE / MZ (.exe / .dll)
  if (buf.length >= 4 && buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46) return true; // ELF
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) return true; // ZIP
  const head = buf.subarray(0, Math.min(buf.length, 256)).toString('utf8').trimStart().toLowerCase();
  if (
    head.startsWith('<svg') ||
    head.startsWith('<!doctype html') ||
    head.startsWith('<html') ||
    head.startsWith('<script') ||
    head.startsWith('<?xml')
  ) {
    return true;
  }
  return false;
}

/**
 * Decodes base64 upload content, checks size bounds, inspects binary magic bytes against the declared MIME type,
 * and rejects disguised executables, archives, HTML, or SVG payloads.
 */
export function validateAndDecodeUpload(input: {
  originalFileName: string;
  mimeType: string;
  base64Data: string;
  allowedMimes?: readonly AllowedUploadMime[];
  maxBytes?: number;
}): { bytes: Buffer; safeFileName: string; mimeType: AllowedUploadMime } {
  const allowed: readonly AllowedUploadMime[] = input.allowedMimes ?? [
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
  ];

  if (!allowed.includes(input.mimeType as AllowedUploadMime)) {
    throw new AuthError('VALIDATION_ERROR', `Type de fichier non autorisé (${input.mimeType})`);
  }

  const declaredMime = input.mimeType as AllowedUploadMime;
  const maxBytes = input.maxBytes ?? MAX_UPLOAD_BYTES_DEFAULT;
  const cleanB64 = String(input.base64Data || '').replace(/^data:[^;]+;base64,/i, '').replace(/\s+/g, '');
  if (!cleanB64) {
    throw new AuthError('VALIDATION_ERROR', 'Le contenu du fichier est vide');
  }

  const bytes = Buffer.from(cleanB64, 'base64');
  if (bytes.length === 0) {
    throw new AuthError('VALIDATION_ERROR', 'Le fichier décodé est vide');
  }
  if (bytes.length > maxBytes) {
    throw new AuthError(
      'VALIDATION_ERROR',
      `Fichier trop volumineux (${(bytes.length / (1024 * 1024)).toFixed(2)} Mo, maximum ${(maxBytes / (1024 * 1024)).toFixed(1)} Mo)`
    );
  }

  if (looksDangerousExecutableOrScript(bytes)) {
    throw new AuthError(
      'VALIDATION_ERROR',
      'Contenu rejeté par contrôle de sécurité : signature exécutable, archive ou script détectée'
    );
  }

  const magicValid =
    (declaredMime === 'image/jpeg' && isJpeg(bytes)) ||
    (declaredMime === 'image/png' && isPng(bytes)) ||
    (declaredMime === 'image/webp' && isWebp(bytes)) ||
    (declaredMime === 'application/pdf' && isPdf(bytes));

  if (!magicValid) {
    throw new AuthError(
      'VALIDATION_ERROR',
      `Signature binaire invalide : le contenu réel du fichier ne correspond pas au type ${declaredMime}`
    );
  }

  return {
    bytes,
    safeFileName: sanitizeUploadedFileName(input.originalFileName),
    mimeType: declaredMime,
  };
}
