import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';
import { toBase64, toHex } from '../../web/js/bytes.js';
import {
  defaultSelection, formatParam, optionsFor, parseCatalog, resolveVariant, unpackFirmware, variantImage,
} from '../../web/js/catalog.js';
import { syntheticImage, testMarker } from './helpers.mjs';

function variant(adv, power, battery, rot) {
  const id = `adv${adv}_${power}_${battery}_${rot}`;
  return {
    id, size: 22808, sha256: '', key_offset: 0x58c0, pack_offset: 0,
    config: { adv_interval_ms: adv, power, send_battery: battery !== 'off',
      battery_days: battery === 'off' ? null : battery, rotation_min: rot },
  };
}

const RAW = {
  schema: 1, marker_hex: toHex(testMarker()), key_len: 28, num_keys: 3,
  params: { adv_interval_ms: [500, 2000], power: ['RF_POWER_P0p04dBm', 'RF_POWER_P10p29dBm'],
    battery: [1, 7, 'off'], rotation_min: [10, 30] },
  variants: [
    variant(2000, 'RF_POWER_P0p04dBm', 1, 30),
    variant(2000, 'RF_POWER_P0p04dBm', 'off', 30),
    variant(2000, 'RF_POWER_P10p29dBm', 7, 10),
    variant(500, 'RF_POWER_P10p29dBm', 1, 30),
  ],
};

test('parseCatalog validates and decodes the marker', () => {
  assert.equal(parseCatalog(RAW).marker.length, 84);
  assert.throws(() => parseCatalog({ ...RAW, schema: 9 }), /schema/);
  assert.throws(() => parseCatalog({ ...RAW, variants: [] }), /no firmware/);
  assert.throws(() => parseCatalog({ ...RAW, marker_hex: 'abcd' }), /marker/);
});

test('selection: defaults, resolution, availability', () => {
  const cat = parseCatalog(RAW);
  const sel = defaultSelection(cat);
  assert.deepEqual(sel, { adv_interval_ms: 2000, power: 'RF_POWER_P0p04dBm', battery: 1, rotation_min: 30 });
  assert.equal(resolveVariant(cat, sel).id, RAW.variants[0].id);
  assert.equal(resolveVariant(cat, { ...sel, battery: 'off' }).id, RAW.variants[1].id);
  assert.equal(resolveVariant(cat, { ...sel, rotation_min: 10 }), null);
  assert.deepEqual(optionsFor(cat, sel, 'rotation_min'), [{ value: 10, available: false }, { value: 30, available: true }]);
  const adv = optionsFor(cat, { ...sel, power: 'RF_POWER_P10p29dBm' }, 'adv_interval_ms');
  assert.deepEqual(adv.map(o => o.available), [true, false]); // battery 1 + rot 30 + P10 exists only at 500 ms
});

test('embedded pack: gunzip, slice, SHA-256 check', async () => {
  const a = syntheticImage();
  const b = syntheticImage({ size: 22696, markerAt: 22696 - 4 - 84 });
  const pack = await unpackFirmware(toBase64(gzipSync(Buffer.concat([a, b]))));
  const sha = img => createHash('sha256').update(img).digest('hex');
  const va = { id: 'a', pack_offset: 0, size: a.length, sha256: sha(a) };
  const vb = { id: 'b', pack_offset: a.length, size: b.length, sha256: sha(b) };
  assert.deepEqual(variantImage(pack, va), a);
  assert.deepEqual(variantImage(pack, vb), b);
  assert.throws(() => variantImage(pack, { ...vb, sha256: '00' }), /corrupt/);
  assert.throws(() => variantImage(pack, { ...vb, pack_offset: a.length + 1 }), /truncated/);
});

test('labels', () => {
  assert.equal(formatParam('power', 'RF_POWER_P10p29dBm'), '+10.29 dBm');
  assert.equal(formatParam('adv_interval_ms', 500), '500 ms');
  assert.equal(formatParam('adv_interval_ms', 2000), '2 s');
  assert.equal(formatParam('battery', 'off'), 'Off');
  assert.equal(formatParam('battery', 7), 'On, measured every 7 days');
});
