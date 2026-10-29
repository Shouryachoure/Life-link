import * as crypto from 'crypto';

/**
 * Verifies a 6-digit TOTP token against a text secret using constant-time comparison.
 * Allows a drift of 1 time-step (30 seconds) backward and forward.
 */
export function verifyTOTP(secret: string, token: string): boolean {
  if (!secret || !token || typeof token !== 'string') return false;
  const cleanToken = token.trim();
  if (!/^\d{6}$/.test(cleanToken)) return false;

  try {
    const timeStep = 30;
    const epoch = Math.floor(Date.now() / 1000);
    const counter = Math.floor(epoch / timeStep);
    const tokenBuffer = Buffer.from(cleanToken, 'utf8');

    // Check counter - 1, counter, counter + 1
    for (let i = -1; i <= 1; i++) {
      const calculatedToken = generateTOTP(secret, counter + i);
      const calculatedBuffer = Buffer.from(calculatedToken, 'utf8');

      if (
        tokenBuffer.length === calculatedBuffer.length &&
        crypto.timingSafeEqual(tokenBuffer, calculatedBuffer)
      ) {
        return true;
      }
    }
  } catch (err) {
    if (process.env.NODE_ENV !== 'test') {
      console.error('TOTP verification error:', err);
    }
  }
  return false;
}

/**
 * Generates the 6-digit TOTP code for a specific time counter and secret.
 */
export function generateTOTP(secret: string, counter: number): string {
  const key = Buffer.from(secret, 'ascii');
  const buffer = Buffer.alloc(8);
  // Write the counter as an 8-byte big-endian integer
  buffer.writeBigInt64BE(BigInt(counter), 0);

  const hmac = crypto.createHmac('sha1', key);
  hmac.update(buffer);
  const hash = hmac.digest();

  // Dynamic truncation
  const offset = hash[hash.length - 1] & 0xf;
  const binary =
    ((hash[offset] & 0x7f) << 24) |
    ((hash[offset + 1] & 0xff) << 16) |
    ((hash[offset + 2] & 0xff) << 8) |
    (hash[offset + 3] & 0xff);

  const otp = binary % 1000000;
  return otp.toString().padStart(6, '0');
}
