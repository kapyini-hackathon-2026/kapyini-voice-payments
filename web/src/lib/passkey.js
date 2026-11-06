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

/** Sign in with the finger: the passkey says which space it opens. Returns { ok, account } or { ok: false, error }. */
export async function loginWithPasskey() {
  const start = await api('/api/account/login/options', { body: {} });
  if (!start.ok) return { ok: false, error: 'NETWORK' };
  let response;
  try {
    response = await startAuthentication({ optionsJSON: start.options });
  } catch (e) {
    return { ok: false, error: e?.name === 'NotAllowedError' ? 'PASSKEY_CANCELLED' : 'PASSKEY_REFUSED' };
  }
  const r = await api('/api/account/login/verify', { body: { flowId: start.flowId, response } });
  return r.ok ? { ok: true, account: r.account } : { ok: false, error: r.errors?.[0] || 'PASSKEY_UNKNOWN' };
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
