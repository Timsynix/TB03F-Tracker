import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fromBase64, toBase64 } from '../../web/js/bytes.js';
import { dotKeysText, keysJson, keysJsonText, publicKeysText, randomAccessoryId, sanitizeName } from '../../web/js/exports.js';
import { generateKeySet } from '../../web/js/p224.js';

const keys = generateKeySet(3);

test('keys.json matches the Macless Haystack AccessoryDTO import format', () => {
  const parsed = JSON.parse(keysJsonText('Bike', keys, 4242424));
  assert.equal(parsed.length, 1, 'one accessory per tag');
  const [a] = parsed;
  assert.deepEqual(Object.keys(a).sort(),
    ['additionalKeys', 'colorComponents', 'icon', 'id', 'isActive', 'name', 'privateKey']);
  assert.ok(Number.isInteger(a.id));
  assert.deepEqual(a.colorComponents, [0, 1, 0, 1]);
  assert.equal(a.name, 'Bike');
  assert.equal(a.icon, '');
  assert.equal(a.isActive, true);
  assert.equal(a.privateKey, toBase64(keys[0].privateKey));
  assert.deepEqual(a.additionalKeys, keys.slice(1).map(k => toBase64(k.privateKey)));
  for (const k of [a.privateKey, ...a.additionalKeys]) assert.equal(fromBase64(k).length, 28);
});

test('public keys file carries no private key material', () => {
  const text = publicKeysText('Bike', keys, { variantId: 'adv2000_p0p04_bat1d_rot30', generatedAt: new Date(0) });
  for (const k of keys) {
    assert.ok(!text.includes(toBase64(k.privateKey)));
    assert.ok(text.includes(toBase64(k.advertisementKey)));
    assert.ok(text.includes(toBase64(k.hashedKey)));
  }
  assert.match(text, /BLE MAC: [0-9A-F]{2}(:[0-9A-F]{2}){5}/);
});

test('.keys file uses the generate_keys.py layout', () => {
  const lines = dotKeysText(keys).trim().split('\n');
  assert.equal(lines.length, 9);
  assert.deepEqual(lines.map(l => l.split(': ')[0]),
    Array(3).fill(['Private key', 'Advertisement key', 'Hashed adv key']).flat());
});

test('helpers', () => {
  assert.equal(sanitizeName('  my bike #1 '), 'my_bike_1');
  assert.equal(sanitizeName('***'), 'tag');
  const id = randomAccessoryId();
  assert.ok(id >= 1000000 && id <= 9999999);
  assert.deepEqual(keysJson('x', keys, 1)[0].additionalKeys.length, 2);
});
