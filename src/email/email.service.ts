import { Injectable, Logger } from '@nestjs/common';

/**
 * Thin, provider-agnostic email abstraction. Callers depend only on this
 * class; the delivery mechanism (Resend, via its REST API over fetch) lives
 * behind it and is swappable without touching call sites.
 *
 * Security: the raw reset token travels only inside `resetLink`, over email —
 * its intended channel. It is NEVER written to a log. When no provider is
 * configured (local/dev, or missing secret) we log the recipient only and skip
 * sending. Delivery failures are swallowed (logged without the link) so the
 * caller's response can stay generic and never leak whether an account exists.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly apiKey = process.env.RESEND_API_KEY;
  private readonly from =
    process.env.EMAIL_FROM || 'Inflique <no-reply@inflique.com>';

  async sendPasswordResetEmail(
    to: string,
    resetLink: string,
    name?: string | null,
  ): Promise<void> {
    if (!this.apiKey) {
      // Unconfigured (dev/CI) — recipient only, never the token/link.
      this.logger.warn(
        `RESEND_API_KEY not set — password-reset email for ${to} not sent.`,
      );
      return;
    }

    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.from,
          to,
          subject: 'Reset your Inflique password',
          html: this.buildResetHtml(resetLink, name),
        }),
      });

      if (!res.ok) {
        // Log status + recipient only — never the response body could echo the
        // link, and never the link itself.
        this.logger.error(
          `Resend returned ${res.status} sending a password-reset email to ${to}.`,
        );
      }
    } catch (err) {
      this.logger.error(
        `Failed to send a password-reset email to ${to}.`,
        err instanceof Error ? err.stack : undefined,
      );
    }
  }

  /** Minimal, self-contained HTML — neutral accent (pre-auth, role unknown). */
  private buildResetHtml(resetLink: string, name?: string | null): string {
    const greeting = name ? `Hi ${this.escapeHtml(name)},` : 'Hi,';
    const safeLink = this.escapeHtml(resetLink);
    return `
      <div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;color:#0F172A;">
        <h1 style="font-size:20px;margin:0 0 16px;">Reset your password</h1>
        <p style="margin:0 0 12px;">${greeting}</p>
        <p style="margin:0 0 20px;">We received a request to reset your Inflique password. Click the button below to choose a new one. This link expires in 30 minutes and can be used once.</p>
        <p style="margin:0 0 24px;">
          <a href="${safeLink}" style="display:inline-block;background:#F0512E;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:bold;">Reset password</a>
        </p>
        <p style="margin:0 0 8px;font-size:13px;color:#64748B;">If you didn't request this, you can safely ignore this email — your password won't change.</p>
        <p style="margin:0;font-size:13px;color:#64748B;">If the button doesn't work, paste this link into your browser:<br>${safeLink}</p>
      </div>
    `;
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
