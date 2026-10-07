import { createHash } from 'node:crypto';
import { crc32 } from '../../web/js/crc32.js';

// Same derivation as scripts/fwpatch.keyslot_marker()
export function testMarker() {
  const tag = Buffer.from('TB03F-KEYSLOT-v1');
  const parts = [tag];
  for (let i = 0; Buffer.concat(parts).length < 84; i++) {
    parts.push(createHash('sha256').update(Buffer.concat([tag, Buffer.from([i])])).digest());
  }
  return new Uint8Array(Buffer.concat(parts).subarray(0, 84));
}

// Header + filler + marker + CRC trailer, laid out like a tc32 image. Not real firmware.
export function syntheticImage({ size = 22808, marker = testMarker(), markerAt = 0x58c0, extraMarkerAt } = {}) {
  const img = new Uint8Array(size);
  for (let i = 0; i < size; i++) img[i] = (i * 7 + 3) & 0xff;
  img.set([0x4b, 0x4e, 0x4c, 0x54], 0x08);
  const view = new DataView(img.buffer);
  view.setUint32(0x18, size - 4, true);
  if (marker) img.set(marker, markerAt);
  if (marker && extraMarkerAt !== undefined) img.set(marker, extraMarkerAt);
  view.setUint32(size - 4, crc32(img.subarray(0, size - 4)), false);
  return img;
}
