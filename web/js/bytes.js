export function toHex(bytes, sep = '') {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(sep);
}

export function fromHex(hex) {
  if (hex.length % 2 || /[^0-9a-f]/i.test(hex)) throw new Error('invalid hex string');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function toBase64(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function fromBase64(b64) {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

export function equalBytes(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
