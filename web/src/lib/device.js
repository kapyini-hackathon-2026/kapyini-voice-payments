// Which kind of device this is, to tell the user how it will check who they are.
// With passkeys (WebAuthn) the DEVICE chooses the method (fingerprint, face, or its code):
// a web page cannot force one. Kapyiŋi only says what to expect on this device.
export function deviceKind() {
  if (typeof navigator === 'undefined') return 'other';
  const ua = navigator.userAgent || '';
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPod/.test(ua)) return 'iphone';
  if (/iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ipad';
  if (/Macintosh|Mac OS X/.test(ua)) return 'mac';
  if (/Windows/.test(ua)) return 'windows';
  return 'other';
}
