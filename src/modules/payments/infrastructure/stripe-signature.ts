import { createHmac, timingSafeEqual } from 'node:crypto';

const MILLISECONDS_PER_SECOND = 1000;
/** Stripe recomienda rechazar avisos con más de cinco minutos (SEC-66). */
const SIGNATURE_TOLERANCE_SECONDS = 300;

interface ParsedSignatureHeader {
  readonly timestamp: number;
  readonly signatures: readonly string[];
}

/** `t=1700000000,v1=abcd...,v1=...`: la marca de tiempo y las firmas v1. */
function parseSignatureHeader(header: string): ParsedSignatureHeader | null {
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const [key, value] = part.split('=');
    if (key === 't' && value !== undefined) timestamp = Number(value);
    if (key === 'v1' && value !== undefined) signatures.push(value);
  }
  if (timestamp === null || !Number.isFinite(timestamp) || signatures.length === 0) return null;
  return { timestamp, signatures };
}

function isEqualSignature(expectedHex: string, receivedHex: string): boolean {
  const expected = Buffer.from(expectedHex, 'hex');
  const received = Buffer.from(receivedHex, 'hex');
  return expected.length === received.length && timingSafeEqual(expected, received);
}

/**
 * Comprueba la cabecera `Stripe-Signature`: HMAC-SHA256 de `{t}.{cuerpo}` con el secreto del webhook,
 * en tiempo constante y dentro de la tolerancia de tiempo.
 */
export function isValidStripeSignature(input: {
  rawBody: Buffer;
  signatureHeader: string | undefined;
  secret: string;
  now: Date;
}): boolean {
  if (input.signatureHeader === undefined) return false;
  const parsed = parseSignatureHeader(input.signatureHeader);
  if (parsed === null) return false;
  const ageSeconds = Math.abs(input.now.getTime() / MILLISECONDS_PER_SECOND - parsed.timestamp);
  if (ageSeconds > SIGNATURE_TOLERANCE_SECONDS) return false;
  const signedPayload = Buffer.concat([Buffer.from(`${String(parsed.timestamp)}.`), input.rawBody]);
  const expected = createHmac('sha256', input.secret).update(signedPayload).digest('hex');
  return parsed.signatures.some((signature) => isEqualSignature(expected, signature));
}
