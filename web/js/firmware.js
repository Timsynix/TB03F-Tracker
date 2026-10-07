// TB-03F / Telink TLSR825x firmware image handling: header checks, key-slot patching, CRC trailer.
//   0x08      "KNLT" boot marker
//   0x18      u32 LE image size excluding the 4-byte CRC trailer
//   len-4     CRC-32 (zlib) of [0, len-4), big-endian
import { crc32 } from './crc32.js';
import { equalBytes, toHex } from './bytes.js';

export const KEY_LEN = 28;
export const NUM_KEYS = 3;
export const SLOT_LEN = KEY_LEN * NUM_KEYS;
const MAGIC = [0x4b, 0x4e, 0x4c, 0x54];
const MAGIC_OFFSET = 0x08;
const SIZE_OFFSET = 0x18;

const view = img => new DataView(img.buffer, img.byteOffset, img.byteLength);
const bodyCrc = img => crc32(img.subarray(0, img.length - 4));

export function inspectImage(img) {
  if (img.length < 0x40) return { ok: false, errors: ['image too small to be Telink firmware'] };
  const errors = [];
  const magicOk = MAGIC.every((b, i) => img[MAGIC_OFFSET + i] === b);
  const sizeField = view(img).getUint32(SIZE_OFFSET, true);
  const crcStored = view(img).getUint32(img.length - 4, false);
  const crcCalc = bodyCrc(img);
  if (!magicOk) errors.push('no KNLT boot marker at 0x08 (not a Telink image)');
  if (sizeField !== img.length - 4) errors.push(`size field ${sizeField} does not match image length ${img.length} - 4`);
  if (crcStored !== crcCalc) errors.push('CRC-32 trailer mismatch');
  return { ok: errors.length === 0, magicOk, sizeField, crcStored, crcCalc, errors };
}

export function writeCrcTrailer(img) {
  view(img).setUint32(img.length - 4, bodyCrc(img), false);
  return img;
}

export function findAll(haystack, needle) {
  const hits = [];
  const last = haystack.length - needle.length;
  outer: for (let i = haystack.indexOf(needle[0]); i !== -1 && i <= last; i = haystack.indexOf(needle[0], i + 1)) {
    for (let j = 1; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    hits.push(i);
  }
  return hits;
}

// Replace the 84-byte key-slot marker with the three advertisement keys and fix the CRC trailer.
// Returns a new image; the input is not modified.
export function patchKeys(image, marker, advKeys, { expectedOffset } = {}) {
  if (marker.length !== SLOT_LEN) throw new Error(`key-slot marker must be ${SLOT_LEN} bytes`);
  if (advKeys.length !== NUM_KEYS || advKeys.some(k => k.length !== KEY_LEN)) {
    throw new Error(`need ${NUM_KEYS} advertisement keys of ${KEY_LEN} bytes`);
  }
  const before = inspectImage(image);
  if (!before.ok) throw new Error(`firmware image invalid: ${before.errors.join('; ')}`);

  const hits = findAll(image, marker);
  if (hits.length === 0) throw new Error('key slot not found in firmware image (zero-key build or foreign image)');
  if (hits.length > 1) throw new Error(`key-slot marker found ${hits.length} times; refusing to patch`);
  const [offset] = hits;
  if (expectedOffset !== undefined && offset !== expectedOffset) {
    throw new Error(`key slot at 0x${offset.toString(16)}, catalog says 0x${expectedOffset.toString(16)}`);
  }

  const out = image.slice();
  advKeys.forEach((key, i) => out.set(key, offset + i * KEY_LEN));
  writeCrcTrailer(out);

  const after = inspectImage(out);
  const written = advKeys.every((key, i) => equalBytes(out.subarray(offset + i * KEY_LEN, offset + (i + 1) * KEY_LEN), key));
  if (!after.ok || !written) throw new Error('patched image failed self-check');
  return { image: out, offset };
}

// BLE address the firmware derives from a key (app.c derive_mac_from_key), MSB first.
export function macFromAdvKey(adv) {
  return toHex([adv[0] | 0xc0, adv[1], adv[2], adv[3], adv[4], adv[5]], ':').toUpperCase();
}

// Advertising data the firmware broadcasts for a key (app.c tbl_advData).
// status: bits 7..6 battery level, bit 5 "battery updates supported".
export function advPayload(adv, status = 0) {
  const p = new Uint8Array(31);
  p.set([0x1e, 0xff, 0x4c, 0x00, 0x12, 0x19, status]);
  p.set(adv.subarray(6, KEY_LEN), 7);
  p[29] = adv[0] >> 6;
  return p;
}
