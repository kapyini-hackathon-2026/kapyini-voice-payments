// The phone's fingerprint / Face ID through WebAuthn. The fingerprint never leaves the phone.
import { startRegistration, startAuthentication, browserSupportsWebAuthn, platformAuthenticatorIsAvailable } from '@simplewebauthn/browser';
import { api } from './format.js';

export async function passkeyAvailable() {
  try {
    return browserSupportsWebAuthn() && (await platformAuthenticatorIsAvailable());
  } catch {
    return false;
  }
}

/** Create the passkey for this device. Returns { ok } or { ok: false, error }. */
export async function registerPasskey() {
  const options = await api('/api/passkey/register/options', { body: {} });
  if (!options.ok) return { ok: false, error: 'NETWORK' };
  try {
    const response = await startRegistration({ optionsJSON: options });
    const r = await api('/api/passkey/register/verify', { body: { response } });
    return r.ok ? { ok: true } : { ok: false, error: r.errors?.[0] || 'PASSKEY_REFUSED' };
  } catch (e) {
    return { ok: false, error: e?.name === 'NotAllowedError' ? 'PASSKEY_CANCELLED' : 'PASSKEY_REFUSED' };
  }
}

/** Ask the sensor to sign THIS payment. Returns the signed response, or { error }. */
export async function signPayment(prepareId) {
  const options = await api('/api/passkey/confirm/options', { body: { prepareId } });
  if (!options.ok) return { error: options.errors?.[0] || 'NETWORK' };
  try {
    return { response: await startAuthentication({ optionsJSON: options }) };
  } catch (e) {
    return { error: e?.name === 'NotAllowedError' ? 'PASSKEY_CANCELLED' : 'PASSKEY_REFUSED' };
  }
}
