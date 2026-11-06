// Fingerprint / Face ID / Windows Hello for Kapyiŋi, with the official web standard (WebAuthn passkeys).
//
// What it proves: the person confirming is the owner of this device's passkey, checked by the
// phone's own biometric sensor. The fingerprint never leaves the phone; the server only checks a
// signature. What it does NOT do: log in to PayPal. PayPal still authorises the payment on its page.
//
// Each Kapyiŋi space has its own passkeys (one per device). A passkey is used for two things:
//   - signing in: "put your finger" and Kapyiŋi opens the space that passkey belongs to;
//   - confirming one voice payment: a challenge bound to that payment, for that user's passkeys only.
import { randomUUID } from 'node:crypto';
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
} from '@simplewebauthn/server';

const CHALLENGE_MS = 5 * 60 * 1000;
const toB64 = (bytes) => Buffer.from(bytes).toString('base64url');
const fromB64 = (s) => new Uint8Array(Buffer.from(s, 'base64url'));

export function createPasskeys({ store, origins }) {
  const allowed = origins.map((o) => o.replace(/\/$/, ''));
  const rpID = new URL(allowed[0]).hostname;

  const space = (user) => store.forUser(user.id);
  const list = async (user) => (await space(user).kvGet('passkeys')) || [];

  // Checks a signature from one of this user's passkeys, and keeps its counter up to date.
  async function verifySignature(user, response, challenge) {
    const all = await list(user);
    const cred = all.find((c) => c.id === response?.id);
    if (!cred || !challenge) return false;
    try {
      const result = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: allowed,
        expectedRPID: rpID,
        requireUserVerification: true,
        credential: { id: cred.id, publicKey: fromB64(cred.publicKey), counter: cred.counter, transports: cred.transports },
      });
      if (!result.verified) return false;
      cred.counter = result.authenticationInfo.newCounter;
      cred.usedAt = Date.now();
      await space(user).kvSet('passkeys', all);
      return true;
    } catch {
      return false;
    }
  }

  return {
    rpID,
    async registered(user) {
      return Boolean(user) && (await list(user)).length > 0;
    },
    async count(user) {
      return user ? (await list(user)).length : 0;
    },

    async registrationOptions(user) {
      const existing = await list(user);
      const label = user.name || 'Kapyiŋi';
      const options = await generateRegistrationOptions({
        rpName: 'Kapyiŋi (Sandbox)',
        rpID,
        userID: new TextEncoder().encode(user.id),
        userName: label,
        userDisplayName: label,
        attestationType: 'none',
        excludeCredentials: existing.map((c) => ({ id: c.id, transports: c.transports })),
        // The phone's own sensor, and it must check who is there (not just presence).
        // A discoverable passkey: signing in needs no name or e-mail, only the finger.
        authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'required', userVerification: 'required' },
      });
      await space(user).kvSet('passkey-reg-challenge', { challenge: options.challenge, at: Date.now() });
      return options;
    },

    async verifyRegistration(user, response) {
      const saved = await space(user).kvGet('passkey-reg-challenge');
      if (!saved || Date.now() - saved.at > CHALLENGE_MS) return { ok: false, error: 'PASSKEY_EXPIRED' };
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
      // A passkey opens one space only.
      const owner = await store.kvGet(`cred:${credential.id}`);
      if (owner && owner.userId !== user.id) return { ok: false, error: 'PASSKEY_REFUSED' };
      const all = await list(user);
      all.push({ id: credential.id, publicKey: toB64(credential.publicKey), counter: credential.counter, transports: credential.transports || [], createdAt: Date.now() });
      await space(user).kvSet('passkeys', all);
      await store.kvSet(`cred:${credential.id}`, { userId: user.id });
      await space(user).kvDel('passkey-reg-challenge');
      return { ok: true };
    },

    // ----- signing in with the finger: no user is known yet -----
    async loginOptions() {
      const options = await generateAuthenticationOptions({ rpID, userVerification: 'required' });
      const flowId = randomUUID();
      await store.kvSet(`login:${flowId}`, { challenge: options.challenge, at: Date.now() });
      return { flowId, options };
    },

    /** @returns the id of the space this passkey opens, or null. */
    async verifyLogin(flowId, response) {
      if (typeof flowId !== 'string' || !response?.id) return null;
      const saved = await store.kvGet(`login:${flowId}`);
      await store.kvDel(`login:${flowId}`); // a sign-in challenge works once
      if (!saved || Date.now() - saved.at > CHALLENGE_MS) return null;
      const owner = await store.kvGet(`cred:${response.id}`);
      if (!owner) return null;
      return (await verifySignature({ id: owner.userId }, response, saved.challenge)) ? owner.userId : null;
    },

    // ----- confirming one payment -----
    // A challenge bound to one prepared payment: the signature is valid for that payment only.
    async confirmationOptions(user, prepareId) {
      const options = await generateAuthenticationOptions({
        rpID,
        userVerification: 'required',
        allowCredentials: (await list(user)).map((c) => ({ id: c.id, transports: c.transports })),
      });
      await space(user).markPrepared(prepareId, { challenge: options.challenge });
      return options;
    },

    async verifyConfirmation(user, prepared, response) {
      if (!prepared?.challenge || prepared.userId !== user.id) return false;
      return verifySignature(user, response, prepared.challenge);
    },

    async reset(user) {
      for (const c of await list(user)) await store.kvDel(`cred:${c.id}`);
      await space(user).kvSet('passkeys', []);
    },
  };
}
