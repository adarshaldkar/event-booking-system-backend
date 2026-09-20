import { Resend } from 'resend';
import nodemailer from 'nodemailer';
import { env } from '../config/env';
import { prisma } from '../config/database';
import { NotificationType, NotificationStatus } from '@prisma/client';
import { logger } from '../utils/logger';

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
}

export interface SendEventUpdateEmailOptions {
  to: string;
  fullName: string;
  eventTitle: string;
  eventDate: Date | string;
  location: string;
  changedFields: string[];
  eventId: string;
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
  public async sendOtpEmail(options: { to: string; fullName: string; otp: string }) {
    const { to, fullName, otp } = options;
    const subject = 'Your Verification Code - Event Booking System';
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
        <h2 style="color: #4F46E5; margin-bottom: 8px;">Welcome to Event Booking System</h2>
        <p style="color: #374151; font-size: 16px;">Hello <strong>${fullName}</strong>,</p>
        <p style="color: #4B5563; font-size: 15px;">Your one-time verification code is:</p>
        <div style="background-color: #F3F4F6; padding: 16px; border-radius: 6px; text-align: center; margin: 20px 0;">
          <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #111827;">${otp}</span>
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
    } = options;

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
          <p style="font-size: 16px; color: #1f2937;">Hello <strong>${fullName}</strong>,</p>
          <p style="color: #4b5563;">Thank you for your purchase! Below are your booking and ticket details:</p>

          <table style="width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 15px;">
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 8px 0; color: #6b7280;">Event:</td>
              <td style="padding: 8px 0; font-weight: bold; color: #111827; text-align: right;">${eventTitle}</td>
            </tr>
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 8px 0; color: #6b7280;">Date & Time:</td>
              <td style="padding: 8px 0; font-weight: bold; color: #111827; text-align: right;">${formattedDate}</td>
            </tr>
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 8px 0; color: #6b7280;">Venue:</td>
              <td style="padding: 8px 0; font-weight: bold; color: #111827; text-align: right;">${location}</td>
            </tr>
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 8px 0; color: #6b7280;">Tickets:</td>
              <td style="padding: 8px 0; font-weight: bold; color: #111827; text-align: right;">${ticketCount} ticket(s)</td>
            </tr>
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 8px 0; color: #6b7280;">Total Paid:</td>
              <td style="padding: 8px 0; font-weight: bold; color: #059669; text-align: right;">$${Number(totalAmount).toFixed(2)}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #6b7280;">Booking Reference:</td>
              <td style="padding: 8px 0; font-family: monospace; font-weight: bold; color: #4F46E5; text-align: right;">${bookingReference}</td>
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
    });
  }

  /**
   * Send event update broadcast email to confirmed attendees
   */
  public async sendEventUpdateBroadcastEmail(options: SendEventUpdateEmailOptions) {
    const { to, fullName, eventTitle, eventDate, location, changedFields, eventId } = options;

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
        <p style="color: #374151; font-size: 16px;">Hello <strong>${fullName}</strong>,</p>
        <p style="color: #4B5563;">The organizer has made important updates to <strong>${eventTitle}</strong> for which you hold a confirmed ticket.</p>
        
        <p style="font-weight: bold; color: #374151;">Updated details (${changedFields.join(', ')}):</p>
        <ul>
          <li><strong>Event Date:</strong> ${formattedDate}</li>
          <li><strong>Venue / Location:</strong> ${location}</li>
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
    });
  }

  /**
   * Internal delivery helper with NotificationLog status tracking and retry support
   */
  public async deliverWithLogging(params: {
    to: string;
    subject: string;
    html: string;
    type: NotificationType;
    eventId?: string;
    bookingId?: string;
    currentAttempt?: number;
    maxAttempts?: number;
  }) {
    const { to, subject, html, type, eventId, bookingId, currentAttempt = 1, maxAttempts = 3 } = params;

    let logRecord;
    try {
      logRecord = await prisma.notificationLog.create({
        data: {
          recipientEmail: to,
          notificationType: type,
          deliveryStatus: NotificationStatus.PENDING,
          eventId,
          bookingId,
          attempts: currentAttempt,
        },
      });
    } catch (err: any) {
      logger.warn('Failed to create notification log record', { error: err.message });
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
        messageId = `simulated-msg-${Date.now()}`;
      }

      // Mark SENT on success
      if (logRecord) {
        await prisma.notificationLog.update({
          where: { id: logRecord.id },
          data: {
            deliveryStatus: NotificationStatus.SENT,
            providerMessageId: messageId,
            sentAt: new Date(),
          },
        });
      }

      logger.info(`📧 Email delivered to ${to} (Type: ${type}, MsgID: ${messageId})`);
      return { success: true, messageId };
    } catch (err: any) {
      logger.error(`❌ Email delivery failure to ${to} (Attempt ${currentAttempt}/${maxAttempts}): ${err.message}`);

      if (logRecord) {
        // Only mark FAILED when max attempts are reached; otherwise keep PENDING
        const isFinalAttempt = currentAttempt >= maxAttempts;
        await prisma.notificationLog.update({
          where: { id: logRecord.id },
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
