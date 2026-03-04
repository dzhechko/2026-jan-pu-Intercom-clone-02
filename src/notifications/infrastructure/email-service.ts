/**
 * Email Notification Service — stub implementation for FR-11.
 * Logs email content to console; replace with real SMTP/Resend when ready.
 *
 * Reference: FR-11 PQL Pulse Notifications
 */

export interface EmailPayload {
  to: string
  subject: string
  html: string
}

export interface EmailService {
  send(payload: EmailPayload): Promise<boolean>
}

/**
 * Stub email service — logs email content instead of sending.
 * Toggle real sending via SMTP_HOST env var.
 */
export class StubEmailService implements EmailService {
  async send(payload: EmailPayload): Promise<boolean> {
    const smtpHost = process.env.SMTP_HOST

    if (smtpHost) {
      // Future: integrate with Resend or nodemailer here
      console.log(`[email-service] Would send via ${smtpHost}:`)
    } else {
      console.log('[email-service] STUB — no SMTP_HOST configured:')
    }

    console.log(`  To: ${payload.to}`)
    console.log(`  Subject: ${payload.subject}`)
    console.log(`  Body length: ${payload.html.length} chars`)

    return true
  }
}

/**
 * Format a PQL detection into an email for the operator.
 */
export function formatPQLNotificationEmail(detection: {
  dialogId: string
  score: number
  tier: 'HOT' | 'WARM' | 'COLD'
  topSignals: Array<{ type: string; weight: number }>
  contactEmail?: string | null
}, tenant: { name?: string; baseUrl?: string }): EmailPayload {
  const baseUrl = tenant.baseUrl || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const dialogLink = `${baseUrl}/?dialog=${detection.dialogId}`
  const tierEmoji = detection.tier === 'HOT' ? '🔥' : detection.tier === 'WARM' ? '🟡' : '🔵'
  const signalsList = detection.topSignals
    .map((s) => `<li><strong>${s.type}</strong> (weight: ${s.weight.toFixed(2)})</li>`)
    .join('\n')

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #1a1a2e;">${tierEmoji} New ${detection.tier} PQL Lead Detected</h2>
      <div style="background: #f8f9fa; border-radius: 8px; padding: 16px; margin: 16px 0;">
        <p><strong>PQL Score:</strong> ${(detection.score * 100).toFixed(0)}%</p>
        <p><strong>Tier:</strong> ${detection.tier}</p>
        ${detection.contactEmail ? `<p><strong>Contact:</strong> ${detection.contactEmail}</p>` : ''}
        <p><strong>Top Signals:</strong></p>
        <ul>${signalsList}</ul>
      </div>
      <a href="${dialogLink}" style="display: inline-block; background: #4f46e5; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600;">
        Open Dialog
      </a>
      <p style="color: #6b7280; font-size: 12px; margin-top: 24px;">
        KommuniQ Revenue Intelligence — ${tenant.name || 'Your workspace'}
      </p>
    </div>
  `

  return {
    to: '', // Caller fills this in
    subject: `${tierEmoji} ${detection.tier} PQL Lead — Score ${(detection.score * 100).toFixed(0)}%`,
    html,
  }
}
