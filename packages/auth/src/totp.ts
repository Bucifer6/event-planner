import * as OTPAuth from 'otpauth';

// S2: standard TOTP (any user-chosen authenticator app, no lock-in).
export function generateTotpSecret(): { secret: string; otpauthUrl: string } {
  const totp = new OTPAuth.TOTP({
    issuer: 'EventDesk.ro',
    label: 'EventDesk',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
  });
  const secret = totp.secret.base32;
  return { secret, otpauthUrl: totp.toString() };
}

export function verifyTotp(secretBase32: string, token: string): boolean {
  const totp = new OTPAuth.TOTP({
    issuer: 'EventDesk.ro',
    label: 'EventDesk',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
  // window of 1 period each side for clock drift
  return totp.validate({ token, window: 1 }) !== null;
}
