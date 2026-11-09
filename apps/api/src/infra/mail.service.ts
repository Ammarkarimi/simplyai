import { Injectable, Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger('Mail');
  private transport: Transporter | null = null;

  get configured(): boolean {
    return !!process.env.SMTP_HOST;
  }

  private getTransport(): Transporter {
    this.transport ??= nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
    });
    return this.transport;
  }

  async send(to: string, subject: string, text: string, html?: string): Promise<void> {
    if (!this.configured) {
      this.logger.log(`[email not sent: SMTP not configured] To: ${to} | ${subject}\n${text}`);
      return;
    }
    try {
      await this.getTransport().sendMail({ from: process.env.MAIL_FROM ?? 'SimplyAI <no-reply@simplyai.local>', to, subject, text, html });
    } catch (err) {
      this.logger.error(`Failed to send email to ${to}: ${(err as Error).message}`);
    }
  }

  layout(title: string, body: string, cta?: { label: string; url: string }): string {
    const button = cta ? `<p style="margin:28px 0"><a href="${cta.url}" style="background:#6d28d9;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">${cta.label}</a></p><p style="color:#64748b;font-size:12px">Or open: ${cta.url}</p>` : '';
    return `<div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:auto;padding:32px;color:#0f172a"><h2 style="color:#6d28d9;margin:0 0 4px">SimplyAI</h2><h3>${title}</h3><p>${body}</p>${button}</div>`;
  }
}
