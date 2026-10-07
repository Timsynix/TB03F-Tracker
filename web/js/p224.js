// NIST P-224 (secp224r1) key generation for FindMy / OpenHaystack tags, matching
// macless-haystack/generate_keys.py. WebCrypto has no P-224, so the curve arithmetic is plain
// BigInt in affine coordinates. It runs once per tag on the user's machine, so constant-time
// execution is not a goal; the randomness comes from crypto.getRandomValues.
import { toBase64 } from './bytes.js';
import { sha256 } from './sha256.js';

export const KEY_LEN = 28;
export const P = 2n ** 224n - 2n ** 96n + 1n;
export const N = 0xffffffffffffffffffffffffffff16a2e0b8f03e13dd29455c5c2a3dn;
const A = P - 3n;
const B = 0xb4050a850c04b3abf54132565044b0b7d7bfd8ba270b39432355ffb4n;
export const G = [
  0xb70e0cbd6bb4bf7f321390b94a03c1d356c21122343280d6115c1d21n,
  0xbd376388b5f723fb4c22dfe6cd4375a05a07476444d5819985007e34n,
];

const mod = (a, m = P) => ((a % m) + m) % m;

function invert(a, m = P) {
  let [r0, r1] = [m, mod(a, m)];
  let [t0, t1] = [0n, 1n];
  while (r1 !== 0n) {
    const q = r0 / r1;
    [r0, r1] = [r1, r0 - q * r1];
    [t0, t1] = [t1, t0 - q * t1];
  }
  if (r0 !== 1n) throw new Error('value not invertible');
  return mod(t0, m);
}

// Points are [x, y]; null is the point at infinity.
function add(p1, p2) {
  if (p1 === null) return p2;
  if (p2 === null) return p1;
  const [x1, y1] = p1;
  const [x2, y2] = p2;
  if (x1 === x2 && mod(y1 + y2) === 0n) return null;
  const l = x1 === x2
    ? mod((3n * x1 * x1 + A) * invert(2n * y1))
    : mod((y2 - y1) * invert(x2 - x1));
  const x3 = mod(l * l - x1 - x2);
  return [x3, mod(l * (x1 - x3) - y1)];
}

export function multiply(k, point = G) {
  let result = null;
  let addend = point;
  for (; k > 0n; k >>= 1n) {
    if (k & 1n) result = add(result, addend);
    addend = add(addend, addend);
  }
  return result;
}

export function isOnCurve([x, y]) {
  return mod(y * y - (x * x * x + A * x + B)) === 0n;
}

export function bytesToBigInt(bytes) {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  return n;
}

export function bigIntToBytes(n, len = KEY_LEN) {
  const out = new Uint8Array(len);
  for (let i = len - 1; i >= 0; i--, n >>= 8n) out[i] = Number(n & 0xffn);
  if (n !== 0n) throw new RangeError(`value does not fit in ${len} bytes`);
  return out;
}

const defaultRandom = bytes => crypto.getRandomValues(bytes);

export function randomPrivateKey(getRandomValues = defaultRandom) {
  for (;;) {
    const bytes = getRandomValues(new Uint8Array(KEY_LEN));
    const d = bytesToBigInt(bytes);
    if (d >= 1n && d < N) return bytes;
  }
}

// "Advertisement key": X coordinate of d*G, 28 bytes big-endian. This is what the firmware broadcasts.
export function advertisementKey(privateKey) {
  const d = bytesToBigInt(privateKey);
  if (d < 1n || d >= N) throw new RangeError('private key out of range');
  const point = multiply(d);
  if (point === null || !isOnCurve(point)) throw new Error('P-224 point multiplication failed');
  return bigIntToBytes(point[0]);
}

// generate_keys.py regenerates a key when the base64 hashed key has '/' in its first 7 characters.
export function hashedKeyAcceptable(hashedB64) {
  return !hashedB64.slice(0, 7).includes('/');
}

export function generateKeyPair({ getRandomValues = defaultRandom } = {}) {
  for (;;) {
    const privateKey = randomPrivateKey(getRandomValues);
    const advKey = advertisementKey(privateKey);
    const hashedKey = sha256(advKey);
    if (hashedKeyAcceptable(toBase64(hashedKey))) return { privateKey, advertisementKey: advKey, hashedKey };
  }
}

export function generateKeySet(count = 3, options) {
  const keys = [];
  while (keys.length < count) keys.push(generateKeyPair(options));
  return keys;
}
