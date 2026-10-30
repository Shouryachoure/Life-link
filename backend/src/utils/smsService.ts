import twilio from 'twilio';

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioNumber = process.env.TWILIO_PHONE_NUMBER;

let twilioClient: twilio.Twilio | null = null;
if (accountSid && authToken && accountSid.startsWith('AC')) {
  try {
    twilioClient = twilio(accountSid, authToken);
  } catch (err) {
    console.warn('[SMS] Twilio client initialization failed, falling back to mock logger:', err);
  }
}

export function isSmsProviderConfigured(): boolean {
  return Boolean(twilioClient && twilioNumber);
}

export function getCarrierProviderStatus() {
  return {
    isConfigured: isSmsProviderConfigured(),
    provider: isSmsProviderConfigured() ? 'Twilio' : 'NONE',
    fromNumber: twilioNumber ? `${twilioNumber.slice(0, 4)}****${twilioNumber.slice(-3)}` : null,
  };
}

export interface SendSmsResult {
  recipient: string;
  success: boolean;
  messageId?: string;
  error?: string;
  mock: boolean;
  deliveryMode: 'SIMULATED_MOCK' | 'LIVE_CARRIER' | 'FAILED';
  deliveryStatus: 'QUEUED' | 'ATTEMPTED' | 'DELIVERED' | 'FAILED' | 'UNKNOWN';
}

export async function sendSMS(
  to: string,
  message: string,
  options?: { simulateFailure?: boolean; requireRealProvider?: boolean }
): Promise<SendSmsResult> {
  const cleanPhone = to.trim();
  if (!cleanPhone) {
    return {
      recipient: to,
      success: false,
      error: 'Empty phone number',
      mock: false,
      deliveryMode: 'FAILED',
      deliveryStatus: 'FAILED',
    };
  }

  if (options?.simulateFailure) {
    return {
      recipient: cleanPhone,
      success: false,
      error: 'Carrier delivery failed: Network route unavailable',
      mock: true,
      deliveryMode: 'FAILED',
      deliveryStatus: 'FAILED',
    };
  }

  // Strict check for test workflows: Never simulate successful delivery if live carrier is missing
  if (options?.requireRealProvider && (!twilioClient || !twilioNumber)) {
    return {
      recipient: cleanPhone,
      success: false,
      error: 'Automatic carrier delivery unavailable: No SMS/WhatsApp carrier (Twilio) configured in backend environment. Mock simulation is prohibited during emergency test workflow.',
      mock: false,
      deliveryMode: 'FAILED',
      deliveryStatus: 'FAILED',
    };
  }

  if (twilioClient && twilioNumber) {
    try {
      const res = await twilioClient.messages.create({
        body: message,
        from: twilioNumber,
        to: cleanPhone,
      });
      console.log(`[SMS TWILIO] Sent message to ${cleanPhone}: SID=${res.sid}, Status=${res.status}`);
      let deliveryStatus: 'QUEUED' | 'ATTEMPTED' | 'DELIVERED' | 'FAILED' | 'UNKNOWN' = 'ATTEMPTED';
      if (res.status === 'delivered') deliveryStatus = 'DELIVERED';
      else if (res.status === 'queued' || res.status === 'accepted') deliveryStatus = 'QUEUED';
      else if (res.status === 'sending' || res.status === 'sent') deliveryStatus = 'ATTEMPTED';
      else if (res.status === 'failed' || res.status === 'undelivered') deliveryStatus = 'FAILED';

      return {
        recipient: cleanPhone,
        success: deliveryStatus !== 'FAILED',
        messageId: res.sid,
        mock: false,
        deliveryMode: 'LIVE_CARRIER',
        deliveryStatus,
      };
    } catch (err: any) {
      console.error(`[SMS TWILIO ERROR] Failed sending to ${cleanPhone}:`, err.message);
      return {
        recipient: cleanPhone,
        success: false,
        error: err.message,
        mock: false,
        deliveryMode: 'FAILED',
        deliveryStatus: 'FAILED',
      };
    }
  }

  // Graceful fallback mock logger if Twilio credentials are not configured
  console.log(`\n================== [SMS DISPATCH (SIMULATED MOCK)] ==================`);
  console.log(`To:             ${cleanPhone}`);
  console.log(`Message:        ${message}`);
  console.log(`Time:           ${new Date().toISOString()}`);
  console.log(`DeliveryMode:   SIMULATED_MOCK (Zero-Cost Local Sandbox)`);
  console.log(`DeliveryStatus: DELIVERED (Simulated Mock)`);
  console.log(`Note:           Configure TWILIO_ACCOUNT_SID & TWILIO_PHONE_NUMBER in .env for live carrier delivery.`);
  console.log(`====================================================================\n`);
  return {
    recipient: cleanPhone,
    success: true,
    messageId: `mock_${Date.now()}`,
    mock: true,
    deliveryMode: 'SIMULATED_MOCK',
    deliveryStatus: 'DELIVERED',
  };
}

export async function sendEmergencyAlertToContacts(
  contacts: { name: string; phone: string }[],
  patientName: string,
  customMessage?: string | null,
  location?: { lat: number; lng: number }
): Promise<SendSmsResult[]> {
  const defaultBody = `${patientName} has triggered an SOS Emergency Alert via LifeLink!`;
  const custom = customMessage ? ` Message: "${customMessage}".` : '';
  const loc = location ? ` Location: https://maps.google.com/?q=${location.lat},${location.lng}` : '';
  const fullText = `EMERGENCY ALERT: ${defaultBody}${custom}${loc} Please check on them immediately.`;

  const results: SendSmsResult[] = [];
  for (const c of contacts) {
    if (c.phone) {
      const res = await sendSMS(c.phone, fullText);
      results.push(res);
    }
  }
  return results;
}
