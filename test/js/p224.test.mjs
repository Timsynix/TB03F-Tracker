import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fromBase64, toBase64 } from '../../web/js/bytes.js';
import {
  advertisementKey, bytesToBigInt, G, generateKeyPair, generateKeySet, hashedKeyAcceptable, isOnCurve,
  multiply, N, randomPrivateKey,
} from '../../web/js/p224.js';
import { sha256 } from '../../web/js/sha256.js';

const { vectors } = JSON.parse(readFileSync(new URL('../fixtures/p224_vectors.json', import.meta.url)));

test('curve constants', () => {
  assert.ok(isOnCurve(G));
  assert.equal(multiply(N), null);
});

test('advertisement keys match the `cryptography` reference vectors', () => {
  assert.ok(vectors.length >= 10);
  for (const v of vectors) {
    const adv = advertisementKey(fromBase64(v.privateKey));
    assert.equal(toBase64(adv), v.advertisementKey);
    assert.equal(toBase64(sha256(adv)), v.hashedAdvKey);
  }
});

test('private key range is enforced', () => {
  assert.throws(() => advertisementKey(new Uint8Array(28)), RangeError);
  const nBytes = Uint8Array.from(N.toString(16).match(/../g), h => parseInt(h, 16));
  assert.throws(() => advertisementKey(nBytes), RangeError);
});

test('randomPrivateKey rejects out-of-range draws', () => {
  const draws = [new Uint8Array(28).fill(0xff), new Uint8Array(28), new Uint8Array(28).fill(0x11)];
  const key = randomPrivateKey(buf => (buf.set(draws.shift()), buf));
  assert.equal(bytesToBigInt(key), bytesToBigInt(new Uint8Array(28).fill(0x11)));
});

test("hashed-key filter mirrors generate_keys.py ('/' in first 7 chars)", () => {
  assert.equal(hashedKeyAcceptable('abc/efgh='), false);
  assert.equal(hashedKeyAcceptable('abcdef/h='), false);
  assert.equal(hashedKeyAcceptable('abcdefg/='), true);
});

test('generateKeySet yields 3 distinct valid pairs', () => {
  const keys = generateKeySet(3);
  assert.equal(keys.length, 3);
  assert.equal(new Set(keys.map(k => toBase64(k.privateKey))).size, 3);
  for (const k of keys) {
    assert.equal(k.privateKey.length, 28);
    assert.equal(toBase64(k.advertisementKey), toBase64(advertisementKey(k.privateKey)));
    assert.ok(hashedKeyAcceptable(toBase64(k.hashedKey)));
  }
});

test('generateKeyPair regenerates when the hashed key is rejected', () => {
  // Find a scalar whose hashed key starts with a '/' within 7 chars, then feed it first.
  let bad;
  for (let i = 1; !bad; i++) {
    const priv = new Uint8Array(28);
    new DataView(priv.buffer).setUint32(24, i);
    if (!hashedKeyAcceptable(toBase64(sha256(advertisementKey(priv))))) bad = priv;
  }
  const good = new Uint8Array(28).fill(0x22);
  const queue = [bad, good];
  const pair = generateKeyPair({ getRandomValues: buf => (buf.set(queue.shift()), buf) });
  assert.deepEqual(pair.privateKey, good);
});
