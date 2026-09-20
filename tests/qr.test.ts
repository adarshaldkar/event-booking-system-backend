import { describe, it, expect } from 'vitest';
import { qrService } from '../src/services/qr.service';

describe('Phase 4: QR Code & Cryptographic HMAC Signature Verification', () => {
  const sampleTicket = {
    ref: 'BK-TEST-123456',
    eventId: 'e9b422a1-06cb-4a1d-84e3-519001b97b0d',
    tickets: 2,
    holder: 'Alice Walker',
  };

  it('TC-QR-01: should generate a valid Data URI PNG QR code', async () => {
    const dataUrl = await qrService.generateQrCodeDataUrl(sampleTicket);

    expect(dataUrl).toBeDefined();
    expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true);
    expect(dataUrl.length).toBeGreaterThan(100);
  });

  it('TC-QR-02: signed payload should contain all booking metadata and signature', () => {
    const payload = qrService.createSignedPayload(sampleTicket);

    expect(payload.ref).toBe(sampleTicket.ref);
    expect(payload.eventId).toBe(sampleTicket.eventId);
    expect(payload.tickets).toBe(sampleTicket.tickets);
    expect(payload.holder).toBe(sampleTicket.holder);
    expect(payload.sig).toBeDefined();
    expect(payload.sig.length).toBe(64); // SHA-256 hex length
  });

  it('TC-QR-03: authentic signed payload should pass HMAC verification', () => {
    const payload = qrService.createSignedPayload(sampleTicket);
    const isValid = qrService.verifySignedPayload(payload);

    expect(isValid).toBe(true);
  });

  it('TC-QR-04: tampered or forged QR payload should fail HMAC verification', () => {
    const payload = qrService.createSignedPayload(sampleTicket);

    // Tamper with ticket count (e.g. attendee forged 2 tickets into 10)
    const forgedPayload = {
      ...payload,
      tickets: 10,
    };

    const isValid = qrService.verifySignedPayload(forgedPayload);
    expect(isValid).toBe(false);

    // Tamper with holder name
    const forgedHolder = {
      ...payload,
      holder: 'Eve Hacker',
    };
    expect(qrService.verifySignedPayload(forgedHolder)).toBe(false);
  });
});
