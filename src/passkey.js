// Fingerprint / Face ID / Windows Hello for Kapyiŋi, with the official web standard (WebAuthn passkeys).
//
// What it proves: the person confirming is the owner of this device's passkey, checked by the
// phone's own biometric sensor. The fingerprint never leaves the phone; the server only checks a
// signature. What it does NOT do: log in to PayPal. PayPal still authorises the payment on its page.
//
// Prototype scope: one demo user per deployment (no Kapyiŋi accounts yet).
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
} from '@simplewebauthn/server';

const USER_ID = new TextEncoder().encode('kapyini-demo-user');
const toB64 = (bytes) => Buffer.from(bytes).toString('base64url');
const fromB64 = (s) => new Uint8Array(Buffer.from(s, 'base64url'));

export function createPasskeys({ store, origins }) {
  const allowed = origins.map((o) => o.replace(/\/$/, ''));
  const rpID = new URL(allowed[0]).hostname;

  const list = async () => (await store.kvGet('passkeys')) || [];

  return {
    rpID,
    async registered() {
      return (await list()).length > 0;
    },

    async registrationOptions() {
      const existing = await list();
      const options = await generateRegistrationOptions({
        rpName: 'Kapyiŋi (Sandbox demo)',
        rpID,
        userID: USER_ID,
        userName: 'kapyini-demo',
        userDisplayName: 'Kapyiŋi',
        attestationType: 'none',
        excludeCredentials: existing.map((c) => ({ id: c.id, transports: c.transports })),
        // The phone's own sensor, and it must check who is there (not just presence).
        authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'preferred', userVerification: 'required' },
      });
      await store.kvSet('passkey-reg-challenge', { challenge: options.challenge, at: Date.now() });
      return options;
    },

    async verifyRegistration(response) {
      const saved = await store.kvGet('passkey-reg-challenge');
      if (!saved || Date.now() - saved.at > 5 * 60 * 1000) return { ok: false, error: 'PASSKEY_EXPIRED' };
      let result;
      try {
        result = await verifyRegistrationResponse({
          response, expectedChallenge: saved.challenge, expectedOrigin: allowed, expectedRPID: rpID, requireUserVerification: true,
        });
      } catch {
        return { ok: false, error: 'PASSKEY_REFUSED' };
      }
      if (!result.verified) return { ok: false, error: 'PASSKEY_REFUSED' };
      const { credential } = result.registrationInfo;
      const all = await list();
      all.push({ id: credential.id, publicKey: toB64(credential.publicKey), counter: credential.counter, transports: credential.transports || [] });
      await store.kvSet('passkeys', all);
      await store.kvSet('passkey-reg-challenge', null);
      return { ok: true };
    },

    // A challenge bound to one prepared payment: the signature is valid for that payment only.
    async confirmationOptions(prepareId) {
      const options = await generateAuthenticationOptions({
        rpID,
        userVerification: 'required',
        allowCredentials: (await list()).map((c) => ({ id: c.id, transports: c.transports })),
      });
      await store.markPrepared(prepareId, { challenge: options.challenge });
      return options;
    },

    async verifyConfirmation(prepared, response) {
      if (!prepared?.challenge || !response?.id) return false;
      const all = await list();
      const cred = all.find((c) => c.id === response.id);
      if (!cred) return false;
      try {
        const result = await verifyAuthenticationResponse({
          response,
          expectedChallenge: prepared.challenge,
          expectedOrigin: allowed,
          expectedRPID: rpID,
          requireUserVerification: true,
          credential: { id: cred.id, publicKey: fromB64(cred.publicKey), counter: cred.counter, transports: cred.transports },
        });
        if (!result.verified) return false;
        cred.counter = result.authenticationInfo.newCounter;
        await store.kvSet('passkeys', all);
        return true;
      } catch {
        return false;
      }
    },

    async reset() {
      await store.kvSet('passkeys', []);
    },
  };
}
