import nodemailer, { Transporter } from 'nodemailer';

export interface SendEmailResult {
  success: boolean;
  recipient: string;
  providerConfigured: boolean;
  messageId?: string;
  error?: string;
  devNotice?: string;
  mockCode?: string;
}

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : 587;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_SECURE = process.env.SMTP_SECURE === 'true' || SMTP_PORT === 465;
const EMAIL_FROM = process.env.EMAIL_FROM || 'LifeLink Security <no-reply@lifelink.org>';

export function isEmailProviderConfigured(): boolean {
  return Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);
}

let cachedTransporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (!isEmailProviderConfigured()) {
    return null;
  }
  if (!cachedTransporter) {
    cachedTransporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS,
      },
      tls: {
        rejectUnauthorized: process.env.NODE_ENV === 'production',
      },
    });
  }
  return cachedTransporter;
}

export function buildOtpEmailHtml(code: string, purpose: string, expiresInMinutes: number = 10): string {
  const purposeTitle =
    purpose === 'REGISTRATION'
      ? 'Activate Your LifeLink Account'
      : purpose === 'PASSWORD_RESET'
      ? 'Reset Your LifeLink Password'
      : 'Verify Your LifeLink Identity';

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${purposeTitle}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f8fafc; color: #0f172a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; padding: 40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 520px; background-color: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; box-shadow: 0 4px 12px rgba(15, 23, 42, 0.05); overflow: hidden;">
          
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #0f766e 0%, #0d9488 100%); padding: 32px 32px 28px; text-align: center;">
              <div style="display: inline-block; width: 44px; height: 44px; background: rgba(255, 255, 255, 0.2); border-radius: 12px; line-height: 44px; margin-bottom: 12px;">
                <span style="font-size: 24px; color: #ffffff;">✚</span>
              </div>
              <h1 style="margin: 0; font-size: 22px; font-weight: 700; color: #ffffff; letter-spacing: -0.5px;">
                LifeLink Emergency Care
              </h1>
              <p style="margin: 6px 0 0; font-size: 13px; color: #ccfbf1; font-weight: 500;">
                Rapid Emergency Dispatch & Medical Response Network
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding: 36px 32px 28px;">
              <h2 style="margin: 0 0 12px; font-size: 18px; font-weight: 600; color: #0f172a;">
                ${purposeTitle}
              </h2>
              <p style="margin: 0 0 24px; font-size: 14px; line-height: 22px; color: #475569;">
                You recently requested verification for your LifeLink healthcare profile. Use the 6-digit verification code below to complete your request.
              </p>

              <!-- OTP Code Display Card -->
              <div style="background-color: #f0fdfa; border: 2px dashed #0d9488; border-radius: 12px; padding: 20px; text-align: center; margin-bottom: 24px;">
                <span style="font-size: 12px; text-transform: uppercase; letter-spacing: 1.5px; color: #0f766e; font-weight: 700;">
                  Your Verification Code
                </span>
                <div style="font-family: 'Courier New', Courier, monospace; font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #0f766e; margin-top: 8px;">
                  ${code}
                </div>
                <p style="margin: 8px 0 0; font-size: 12px; color: #115e59;">
                  Expires in <strong>${expiresInMinutes} minutes</strong>
                </p>
              </div>

              <!-- Security Checklist -->
              <div style="background-color: #f8fafc; border-radius: 8px; padding: 14px 16px; margin-bottom: 24px; border: 1px solid #e2e8f0;">
                <p style="margin: 0 0 6px; font-size: 12px; font-weight: 600; color: #334155;">
                  🔒 Security Guidelines:
                </p>
                <ul style="margin: 0; padding-left: 18px; font-size: 12px; line-height: 18px; color: #64748b;">
                  <li>LifeLink medical dispatchers will never ask for this code over the phone.</li>
                  <li>Do not share this OTP with anyone, including emergency responders.</li>
                  <li>If you did not initiate this request, your account may be at risk. Contact support immediately.</li>
                </ul>
              </div>

              <p style="margin: 0; font-size: 12px; line-height: 18px; color: #94a3b8;">
                This automated security alert was generated by LifeLink Central Dispatch Services.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f8fafc; border-top: 1px solid #f1f5f9; padding: 20px 32px; text-align: center;">
              <p style="margin: 0; font-size: 11px; color: #94a3b8;">
                &copy; ${new Date().getFullYear()} LifeLink Emergency Network. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

/**
 * Dispatches an Email OTP to the specified recipient.
 * If SMTP credentials are configured, sends real email via SMTP.
 * If unconfigured, clearly returns providerConfigured: false and logs to server console.
 */
export async function sendEmailOTP(
  toEmail: string,
  code: string,
  purpose: string = 'REGISTRATION',
  expiresInMinutes: number = 10
): Promise<SendEmailResult> {
  const recipient = toEmail.trim().toLowerCase();
  const transporter = getTransporter();

  if (transporter && isEmailProviderConfigured()) {
    try {
      const subject =
        purpose === 'REGISTRATION'
          ? 'Your LifeLink Verification Code'
          : purpose === 'PASSWORD_RESET'
          ? 'LifeLink Password Reset Code'
          : 'LifeLink Security Verification Code';

      const info = await transporter.sendMail({
        from: EMAIL_FROM,
        to: recipient,
        subject,
        text: `Your LifeLink verification code is: ${code}. It expires in ${expiresInMinutes} minutes. LifeLink staff will never ask for this code.`,
        html: buildOtpEmailHtml(code, purpose, expiresInMinutes),
      });

      console.log(`[EMAIL SMTP] Dispatched verification code to ${recipient}: MessageID=${info.messageId}`);
      return {
        success: true,
        recipient,
        providerConfigured: true,
        messageId: info.messageId,
      };
    } catch (err: any) {
      console.error(`[EMAIL SMTP ERROR] Failed to send email to ${recipient}:`, err.message);
      return {
        success: false,
        recipient,
        providerConfigured: true,
        error: `SMTP delivery failed: ${err.message}`,
      };
    }
  }

  // Graceful zero-cost sandbox logger when SMTP is not configured
  const isTestOrDev = process.env.NODE_ENV !== 'production';
  console.log('\n================== [EMAIL OTP DISPATCH (LOCAL SANDBOX)] ==================');
  console.log(`To:                  ${recipient}`);
  console.log(`Purpose:             ${purpose}`);
  console.log(`Verification Code:   ${code}`);
  console.log(`Expires in:          ${expiresInMinutes} minutes`);
  console.log(`SMTP Configured:     NO (Set SMTP_HOST, SMTP_USER, SMTP_PASS in .env for live email)`);
  console.log('=========================================================================\n');

  return {
    success: true,
    recipient,
    providerConfigured: false,
    devNotice: 'SMTP provider is not configured in .env. Code logged to server console in local sandbox mode.',
    mockCode: isTestOrDev ? code : undefined,
  };
}
