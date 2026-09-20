import QRCode from 'qrcode';
import crypto from 'crypto';
import { env } from '../config/env';
import { logger } from '../utils/logger';

export interface QrTicketPayload {
  ref: string;
  eventId: string;
  tickets: number;
  holder: string;
  sig: string;
}

export class QrService {
  /**
   * Generates an HMAC-SHA256 signature for the booking ticket payload
   */
  public generateSignature(data: { ref: string; eventId: string; tickets: number; holder: string }): string {
    const raw = `${data.ref}:${data.eventId}:${data.tickets}:${data.holder}`;
    return crypto.createHmac('sha256', env.QR_SIGNING_SECRET).update(raw).digest('hex');
  }

  /**
   * Generates a signed QR ticket payload
   */
  public createSignedPayload(data: {
    ref: string;
    eventId: string;
    tickets: number;
    holder: string;
  }): QrTicketPayload {
    const sig = this.generateSignature(data);
    return {
      ref: data.ref,
      eventId: data.eventId,
      tickets: data.tickets,
      holder: data.holder,
      sig,
    };
  }

  /**
   * Verifies the HMAC-SHA256 signature of a QR ticket payload
   */
  public verifySignedPayload(payload: QrTicketPayload): boolean {
    if (!payload.ref || !payload.eventId || !payload.tickets || !payload.holder || !payload.sig) {
      return false;
    }

    const expectedSig = this.generateSignature({
      ref: payload.ref,
      eventId: payload.eventId,
      tickets: payload.tickets,
      holder: payload.holder,
    });

    try {
      return crypto.timingSafeEqual(Buffer.from(payload.sig, 'hex'), Buffer.from(expectedSig, 'hex'));
    } catch {
      return false;
    }
  }

  /**
   * Generates a high-quality Base64 Data URI PNG for the signed QR payload
   */
  public async generateQrCodeDataUrl(data: {
    ref: string;
    eventId: string;
    tickets: number;
    holder: string;
  }): Promise<string> {
    const signedPayload = this.createSignedPayload(data);
    const jsonString = JSON.stringify(signedPayload);

    try {
      const dataUrl = await QRCode.toDataURL(jsonString, {
        errorCorrectionLevel: 'M',
        type: 'image/png',
        margin: 2,
        width: 250,
        color: {
          dark: '#000000',
          light: '#ffffff',
        },
      });
      return dataUrl;
    } catch (err: any) {
      logger.error('Failed to generate QR Code Data URL', { error: err.message });
      throw err;
    }
  }
}

export const qrService = new QrService();
