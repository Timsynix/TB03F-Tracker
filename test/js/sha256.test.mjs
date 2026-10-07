import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { toHex } from '../../web/js/bytes.js';
import { sha256 } from '../../web/js/sha256.js';

test('known answers', () => {
  assert.equal(toHex(sha256(new Uint8Array(0))), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(toHex(sha256(new TextEncoder().encode('abc'))),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('matches node:crypto across block boundaries', () => {
  for (const len of [1, 55, 56, 63, 64, 65, 119, 120, 1000, 22808]) {
    const data = randomBytes(len);
    assert.equal(toHex(sha256(data)), createHash('sha256').update(data).digest('hex'), `length ${len}`);
  }
});
