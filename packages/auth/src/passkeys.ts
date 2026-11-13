// SEAM — passkeys as a second factor "on the same device" (S2). NOT IMPLEMENTED YET.
//
// What exists: the `passkey_credentials` table and `sessions.challenge` /
// `sessions.challenge_expires_at` for the WebAuthn challenge (both sides of the ceremony
// always have a session row: a signed-in one for registration, the pending one for sign-in).
//
// What to add here (with @simplewebauthn/server 14 + @simplewebauthn/browser 14):
//   beginPasskeyRegistration(ctx)            requireFreshAuth -> generateRegistrationOptions
//   finishPasskeyRegistration(ctx, response) verifyRegistrationResponse -> insert credential
//   beginPasskeyAssertion(ctx, sessionToken) generateAuthenticationOptions for the pending session
//   finishPasskeyAssertion(ctx, …)           verifyAuthenticationResponse -> same effect as
//                                            verifySecondFactor() in ./totp.ts
//   removePasskey(ctx, id)                   requireFreshAuth
// rpID = hostname of APP_URL, origin = APP_URL. Enrolling a passkey must also hand out the
// ten recovery codes when the account has none (replaceRecoveryCodes).
//
// Until then two-step sign-in is TOTP only and no passkey UI is shown anywhere.
export const PASSKEYS_AVAILABLE = false;
