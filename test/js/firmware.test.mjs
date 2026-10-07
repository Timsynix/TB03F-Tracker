import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { crc32 } from '../../web/js/crc32.js';
import { advPayload, findAll, inspectImage, macFromAdvKey, patchKeys, SLOT_LEN } from '../../web/js/firmware.js';
import { syntheticImage, testMarker } from './helpers.mjs';

test('crc32 check value', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('valid synthetic image passes inspection', () => {
  assert.deepEqual(inspectImage(syntheticImage()).errors, []);
});

test('patchKeys writes the keys, fixes the CRC, leaves the input untouched', () => {
  const marker = testMarker();
  const image = syntheticImage({ marker, markerAt: 0x58c0 });
  const keys = [1, 2, 3].map(n => new Uint8Array(28).fill(n));
  const { image: out, offset } = patchKeys(image, marker, keys, { expectedOffset: 0x58c0 });
  assert.equal(offset, 0x58c0);
  assert.deepEqual(inspectImage(out).errors, []);
  assert.deepEqual([...out.subarray(offset, offset + SLOT_LEN)], [...keys.flatMap(k => [...k])]);
  assert.equal(findAll(out, marker).length, 0);
  assert.equal(findAll(image, marker).length, 1);
  const diff = out.reduce((n, b, i) => n + (b !== image[i]), 0);
  assert.ok(diff <= SLOT_LEN + 4);
});

test('patchKeys refuses unsafe images', () => {
  const marker = testMarker();
  const keys = [1, 2, 3].map(n => new Uint8Array(28).fill(n));
  assert.throws(() => patchKeys(syntheticImage({ marker: null }), marker, keys), /key slot not found/);
  const twice = syntheticImage({ marker, extraMarkerAt: 1000 });
  assert.throws(() => patchKeys(twice, marker, keys), /found 2 times/);
  assert.throws(() => patchKeys(syntheticImage({ marker, markerAt: 0x4000 }), marker, keys, { expectedOffset: 0x58c0 }),
    /catalog says/);
  const corrupt = syntheticImage({ marker });
  corrupt[200] ^= 1;
  assert.throws(() => patchKeys(corrupt, marker, keys), /CRC-32/);
  assert.throws(() => patchKeys(syntheticImage({ marker }), marker, keys.slice(0, 2)), /need 3/);
});

test('MAC and advertising payload follow app.c', () => {
  const adv = Uint8Array.from({ length: 28 }, (_, i) => i + 0x10);
  assert.equal(macFromAdvKey(adv), 'D0:11:12:13:14:15');
  const p = advPayload(adv, 0x20);
  assert.deepEqual([...p.subarray(0, 7)], [0x1e, 0xff, 0x4c, 0x00, 0x12, 0x19, 0x20]);
  assert.deepEqual([...p.subarray(7, 29)], [...adv.subarray(6)]);
  assert.equal(p[29], 0x10 >> 6);
});

const CATALOG_DIR = new URL('../../web/firmware/', import.meta.url);

test('every built catalog image patches cleanly', { skip: !existsSync(new URL('index.json', CATALOG_DIR)) }, () => {
  const index = JSON.parse(readFileSync(new URL('index.json', CATALOG_DIR)));
  const marker = Uint8Array.from(Buffer.from(index.marker_hex, 'hex'));
  const keys = [1, 2, 3].map(n => new Uint8Array(28).fill(n));
  for (const v of index.variants) {
    const image = new Uint8Array(readFileSync(new URL(v.file, CATALOG_DIR)));
    const { image: out, offset } = patchKeys(image, marker, keys, { expectedOffset: v.key_offset });
    assert.equal(offset, v.key_offset, v.id);
    assert.deepEqual(inspectImage(out).errors, [], v.id);
  }
});
