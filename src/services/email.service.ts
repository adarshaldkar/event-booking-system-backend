import { Resend } from 'resend';
import nodemailer from 'nodemailer';
import { env } from '../config/env';
import { prisma } from '../config/database';
import { NotificationType, NotificationStatus } from '@prisma/client';
import { logger } from '../utils/logger';
import { escapeHtml } from '../utils/sanitize';

export interface SendBookingEmailOptions {
  to: string;
  fullName: string;
  bookingReference: string;
  eventTitle: string;
  eventDate: Date | string;
  location: string;
  ticketCount: number;
  totalAmount: number | string;
  qrDataUrl: string;
  bookingId: string;
  eventId: string;
  notificationLogId?: string;
  currentAttempt?: number;
  maxAttempts?: number;
}

export interface SendEventUpdateEmailOptions {
  to: string;
  fullName: string;
  eventTitle: string;
  eventDate: Date | string;
  location: string;
  onlineLink?: string | null;
  changedFields: string[];
  eventId: string;
  notificationLogId?: string;
  currentAttempt?: number;
  maxAttempts?: number;
}

export class EmailService {
  private resendClient: Resend | null = null;
  private smtpTransporter: nodemailer.Transporter | null = null;

  constructor() {
    if (env.EMAIL_PROVIDER === 'resend' && env.RESEND_API_KEY) {
      this.resendClient = new Resend(env.RESEND_API_KEY);
    } else if (env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS) {
      this.smtpTransporter = nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        auth: {
          user: env.SMTP_USER,
          pass: env.SMTP_PASS,
        },
      });
    }
  }

  /**
   * Send 6-digit OTP verification email
   */
  public async sendOtpEmail(options: {
    to: string;
    fullName: string;
    otp: string;
    notificationLogId?: string;
    currentAttempt?: number;
    maxAttempts?: number;
  }) {
    const { to, fullName, otp, notificationLogId, currentAttempt, maxAttempts } = options;
    const safeName = escapeHtml(fullName);
    const safeOtp = escapeHtml(otp);
    const subject = 'Your Verification Code - Event Booking System';
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
        <h2 style="color: #4F46E5; margin-bottom: 8px;">Welcome to Event Booking System</h2>
        <p style="color: #374151; font-size: 16px;">Hello <strong>${safeName}</strong>,</p>
        <p style="color: #4B5563; font-size: 15px;">Your one-time verification code is:</p>
        <div style="background-color: #F3F4F6; padding: 16px; border-radius: 6px; text-align: center; margin: 20px 0;">
          <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #111827;">${safeOtp}</span>
        </div>
        <p style="color: #6B7280; font-size: 14px;">This code is valid for <strong>10 minutes</strong>. Do not share this code with anyone.</p>
        <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 20px 0;" />
        <p style="color: #9CA3AF; font-size: 12px; text-align: center;">If you didn't request this code, you can safely ignore this email.</p>
      </div>
    `;

    return this.deliverWithLogging({
      to,
      subject,
      html,
      type: NotificationType.AUTH_OTP,
      notificationLogId,
      currentAttempt,
      maxAttempts,
    });
  }

  /**
   * Send booking confirmation email with embedded signed QR code e-ticket
   */
  public async sendBookingConfirmationEmail(options: SendBookingEmailOptions) {
    const {
      to,
      fullName,
      bookingReference,
      eventTitle,
      eventDate,
      location,
      ticketCount,
      totalAmount,
      qrDataUrl,
      bookingId,
      eventId,
      notificationLogId,
      currentAttempt,
      maxAttempts,
    } = options;

    const safeName = escapeHtml(fullName);
    const safeRef = escapeHtml(bookingReference);
    const safeTitle = escapeHtml(eventTitle);
    const safeLocation = escapeHtml(location);

    const formattedDate = new Date(eventDate).toLocaleString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    const subject = `Booking Confirmed: ${eventTitle} (Ref: #${bookingReference})`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e0e0e0; border-radius: 8px; background-color: #ffffff;">
        <div style="background: linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%); padding: 20px; border-radius: 6px; text-align: center; color: white;">
          <h1 style="margin: 0; font-size: 24px;">🎟️ Booking Confirmed!</h1>
          <p style="margin: 6px 0 0 0; opacity: 0.9;">Your e-ticket is ready</p>
        </div>

        <div style="padding: 20px 0;">
          <p style="font-size: 16px; color: #1f2937;">Hello <strong>${safeName}</strong>,</p>
          <p style="color: #4b5563;">Thank you for your purchase! Below are your booking and ticket details:</p>

          <table style="width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 15px;">
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 8px 0; color: #6b7280;">Event:</td>
              <td style="padding: 8px 0; font-weight: bold; color: #111827; text-align: right;">${safeTitle}</td>
            </tr>
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 8px 0; color: #6b7280;">Date & Time:</td>
              <td style="padding: 8px 0; font-weight: bold; color: #111827; text-align: right;">${formattedDate}</td>
            </tr>
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 8px 0; color: #6b7280;">Venue:</td>
              <td style="padding: 8px 0; font-weight: bold; color: #111827; text-align: right;">${safeLocation}</td>
            </tr>
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 8px 0; color: #6b7280;">Tickets:</td>
              <td style="padding: 8px 0; font-weight: bold; color: #111827; text-align: right;">${Number(ticketCount)} ticket(s)</td>
            </tr>
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 8px 0; color: #6b7280;">Total Paid:</td>
              <td style="padding: 8px 0; font-weight: bold; color: #059669; text-align: right;">$${Number(totalAmount).toFixed(2)}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #6b7280;">Booking Reference:</td>
              <td style="padding: 8px 0; font-family: monospace; font-weight: bold; color: #4F46E5; text-align: right;">${safeRef}</td>
            </tr>
          </table>

          <div style="text-align: center; margin: 24px 0; padding: 20px; background-color: #f9fafb; border-radius: 8px; border: 1px dashed #d1d5db;">
            <p style="margin: 0 0 12px 0; font-size: 14px; font-weight: bold; color: #374151;">Scan this QR code at the venue entrance:</p>
            <img src="${qrDataUrl}" alt="E-Ticket QR Code" style="width: 200px; height: 200px; display: block; margin: 0 auto; border-radius: 4px;" />
            <p style="margin: 10px 0 0 0; font-size: 12px; color: #9ca3af;">Cryptographically signed authentic e-ticket</p>
          </div>
        </div>

        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 16px 0;" />
        <p style="font-size: 12px; color: #9ca3af; text-align: center;">Need to make changes? You can view or cancel your booking through your account profile.</p>
      </div>
    `;

    return this.deliverWithLogging({
      to,
      subject,
      html,
      type: NotificationType.BOOKING_CONFIRMATION,
      bookingId,
      eventId,
      notificationLogId,
      currentAttempt,
      maxAttempts,
    });
  }

  /**
   * Send event update broadcast email to confirmed attendees
   */
  public async sendEventUpdateBroadcastEmail(options: SendEventUpdateEmailOptions) {
    const {
      to,
      fullName,
      eventTitle,
      eventDate,
      location,
      onlineLink,
      changedFields,
      eventId,
      notificationLogId,
      currentAttempt,
      maxAttempts,
    } = options;

    const safeName = escapeHtml(fullName);
    const safeTitle = escapeHtml(eventTitle);
    const safeLocation = escapeHtml(location);
    const safeChanged = changedFields.map((f) => escapeHtml(f)).join(', ');
    const safeOnlineLink = onlineLink ? escapeHtml(onlineLink) : null;

    const formattedDate = new Date(eventDate).toLocaleString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    const subject = `📢 Important Update: "${eventTitle}"`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
        <div style="background-color: #FEF3C7; border-left: 4px solid #F59E0B; padding: 12px 16px; border-radius: 4px; margin-bottom: 20px;">
          <h3 style="margin: 0; color: #92400E;">Event Update Notice</h3>
        </div>
        <p style="color: #374151; font-size: 16px;">Hello <strong>${safeName}</strong>,</p>
        <p style="color: #4B5563;">The organizer has made important updates to <strong>${safeTitle}</strong> for which you hold a confirmed ticket.</p>
        
        <p style="font-weight: bold; color: #374151;">Updated details (${safeChanged}):</p>
        <ul>
          <li><strong>Event Date:</strong> ${formattedDate}</li>
          <li><strong>Venue / Location:</strong> ${safeLocation}</li>
          ${safeOnlineLink ? `<li><strong>Online Meeting / Stream:</strong> <a href="${safeOnlineLink}" style="color: #4F46E5;">${safeOnlineLink}</a></li>` : ''}
        </ul>
        <p style="color: #6B7280; font-size: 14px;">Your existing ticket QR code and booking reference remain valid for admission.</p>
        <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 20px 0;" />
        <p style="color: #9CA3AF; font-size: 12px; text-align: center;">Event Booking System Notifications</p>
      </div>
    `;

    return this.deliverWithLogging({
      to,
      subject,
      html,
      type: NotificationType.EVENT_UPDATE_BROADCAST,
      eventId,
      notificationLogId,
      currentAttempt,
      maxAttempts,
    });
  }

  /**
   * Internal delivery helper: updates a SINGLE persistent NotificationLog across attempts 1 -> 2 -> 3
   * Never masks delivery failures with fake message IDs.
   */
  public async deliverWithLogging(params: {
    to: string;
    subject: string;
    html: string;
    type: NotificationType;
    eventId?: string;
    bookingId?: string;
    notificationLogId?: string;
    currentAttempt?: number;
    maxAttempts?: number;
  }) {
    const {
      to,
      subject,
      html,
      type,
      eventId,
      bookingId,
      notificationLogId,
      currentAttempt = 1,
      maxAttempts = 3,
    } = params;

    let logId = notificationLogId;

    // If no existing outbox log was passed, create one (PENDING)
    if (!logId) {
      try {
        const logRecord = await prisma.notificationLog.create({
          data: {
            recipientEmail: to,
            notificationType: type,
            deliveryStatus: NotificationStatus.PENDING,
            eventId,
            bookingId,
            attempts: currentAttempt,
          },
        });
        logId = logRecord.id;
      } catch (err: any) {
        logger.warn('Failed to create notification log record', { error: err.message });
      }
    }

    try {
      let messageId: string | undefined;

      if (this.resendClient) {
        const response = await this.resendClient.emails.send({
          from: env.EMAIL_FROM,
          to,
          subject,
          html,
        });

        if (response.error) {
          throw new Error(response.error.message);
        }
        messageId = response.data?.id;
      } else if (this.smtpTransporter) {
        const info = await this.smtpTransporter.sendMail({
          from: env.EMAIL_FROM,
          to,
          subject,
          html,
        });
        messageId = info.messageId;
      } else {
        throw new Error('No email delivery provider configured (Resend API key or SMTP settings required).');
      }

      // Mark single record as SENT on success
      if (logId) {
        await prisma.notificationLog.update({
          where: { id: logId },
          data: {
            deliveryStatus: NotificationStatus.SENT,
            providerMessageId: messageId,
            attempts: currentAttempt,
            sentAt: new Date(),
          },
        });
      }

      logger.info(`📧 Email delivered to ${to} (Type: ${type}, MsgID: ${messageId})`);
      return { success: true, messageId, notificationLogId: logId };
    } catch (err: any) {
      logger.error(
        `❌ Email delivery failure to ${to} (Attempt ${currentAttempt}/${maxAttempts}): ${err.message}`
      );

      if (logId) {
        // Transition: PENDING on intermediate retries, FAILED only on final attempt
        const isFinalAttempt = currentAttempt >= maxAttempts;
        await prisma.notificationLog.update({
          where: { id: logId },
          data: {
            deliveryStatus: isFinalAttempt ? NotificationStatus.FAILED : NotificationStatus.PENDING,
            errorMessage: err.message,
            attempts: currentAttempt,
          },
        });
      }

      throw err;
    }
  }
}

export const emailService = new EmailService();
