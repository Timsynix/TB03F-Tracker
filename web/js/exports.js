// Files offered for download after key generation.
import { toBase64, toHex } from './bytes.js';
import { macFromAdvKey } from './firmware.js';

// Letters, digits, '_' and '-' only; everything else becomes '_'.
export function sanitizeName(raw) {
  return raw.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'tag';
}

export function randomAccessoryId(getRandomValues = b => crypto.getRandomValues(b)) {
  const [v] = getRandomValues(new Uint32Array(1));
  return 1000000 + (v % 9000000);
}

// Macless Haystack "Import from JSON File" format (AccessoryDTO.fromJson): one accessory per tag,
// key 1 as privateKey and keys 2/3 as additionalKeys.
export function keysJson(name, keys, id) {
  return [{
    id,
    colorComponents: [0, 1, 0, 1],
    name,
    privateKey: toBase64(keys[0].privateKey),
    icon: '',
    isActive: true,
    additionalKeys: keys.slice(1).map(k => toBase64(k.privateKey)),
  }];
}

export function keysJsonText(name, keys, id) {
  return JSON.stringify(keysJson(name, keys, id), null, 2) + '\n';
}

export function publicKeysText(name, keys, { variantId, generatedAt = new Date() } = {}) {
  const lines = [
    `# TB-03F public keys for "${name}"`,
    `# Firmware variant: ${variantId ?? 'unknown'}`,
    `# Generated: ${generatedAt.toISOString()}`,
    '# Contains NO private keys. These keys still identify the tag\'s broadcasts,',
    '# so only share them with tools you trust.',
    '',
  ];
  keys.forEach((k, i) => {
    lines.push(
      `Key ${i + 1}${i === 0 ? ' (broadcast first, then rotates 1 -> 2 -> 3)' : ''}`,
      `Advertisement key: ${toBase64(k.advertisementKey)}`,
      `Advertisement key (hex): ${toHex(k.advertisementKey)}`,
      `Hashed adv key: ${toBase64(k.hashedKey)}`,
      `BLE MAC: ${macFromAdvKey(k.advertisementKey)}`,
      '',
    );
  });
  return lines.join('\n');
}

// Same layout as macless-haystack/generate_keys.py's <prefix>.keys (includes private keys).
export function dotKeysText(keys) {
  return keys.map(k => [
    `Private key: ${toBase64(k.privateKey)}`,
    `Advertisement key: ${toBase64(k.advertisementKey)}`,
    `Hashed adv key: ${toBase64(k.hashedKey)}`,
  ].join('\n')).join('\n') + '\n';
}
