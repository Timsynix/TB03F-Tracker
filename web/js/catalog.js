// Embedded firmware catalog: index.json fields (scripts/verify_bins.py) plus a gzip "pack" of all
// images concatenated, both inlined into the standalone HTML by scripts/make_standalone.py.
import { fromBase64, fromHex, toHex } from './bytes.js';
import { sha256 } from './sha256.js';

export const PARAM_KEYS = ['adv_interval_ms', 'power', 'battery', 'rotation_min'];
const SCHEMA = 1;

// "battery" folds send_battery + battery_days into one choice: 'off' or N days between measurements.
export function paramValue(variant, key) {
  const c = variant.config;
  if (key === 'battery') return c.send_battery ? c.battery_days : 'off';
  return c[key];
}

export function parseCatalog(raw) {
  if (raw.schema !== SCHEMA) throw new Error(`unsupported catalog schema ${raw.schema}`);
  if (!Array.isArray(raw.variants) || raw.variants.length === 0) throw new Error('catalog lists no firmware');
  const marker = fromHex(raw.marker_hex);
  if (marker.length !== raw.key_len * raw.num_keys) throw new Error('catalog key-slot marker has wrong length');
  return { ...raw, marker };
}

export async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function unpackFirmware(packBase64) {
  return gunzip(fromBase64(packBase64.replace(/\s+/g, '')));
}

export function variantImage(pack, variant) {
  const image = pack.slice(variant.pack_offset, variant.pack_offset + variant.size);
  if (image.length !== variant.size) throw new Error(`${variant.id}: embedded image is truncated`);
  if (toHex(sha256(image)) !== variant.sha256) throw new Error(`${variant.id}: embedded image is corrupt (SHA-256 mismatch)`);
  return image;
}

const matches = (variant, selection, skipKey) =>
  PARAM_KEYS.every(k => k === skipKey || selection[k] === undefined || paramValue(variant, k) === selection[k]);

// Options for one parameter; `available` = some variant exists with this value and the other current choices.
export function optionsFor(catalog, selection, key) {
  return catalog.params[key].map(value => ({
    value,
    available: catalog.variants.some(v => paramValue(v, key) === value && matches(v, selection, key)),
  }));
}

export function resolveVariant(catalog, selection) {
  return catalog.variants.find(v => PARAM_KEYS.every(k => paramValue(v, k) === selection[k])) ?? null;
}

const PREFERRED = { adv_interval_ms: 2000, power: 'RF_POWER_P0p04dBm', battery: 1, rotation_min: 30 };

export function defaultSelection(catalog) {
  const preferred = resolveVariant(catalog, PREFERRED) ?? catalog.variants[0];
  return Object.fromEntries(PARAM_KEYS.map(k => [k, paramValue(preferred, k)]));
}

export function formatPower(macro) {
  const m = /^RF_POWER_([PN])(\d+)p(\d+)dBm$/.exec(macro);
  return m ? `${m[1] === 'P' ? '+' : '-'}${m[2]}.${m[3]} dBm` : macro;
}

export function formatParam(key, value) {
  switch (key) {
    case 'adv_interval_ms': return value >= 1000 ? `${value / 1000} s` : `${value} ms`;
    case 'power': return formatPower(value);
    case 'battery':
      if (value === 'off') return 'Off';
      return value === 1 ? 'On, measured daily' : `On, measured every ${value} days`;
    case 'rotation_min': return `Every ${value} min`;
    default: return String(value);
  }
}
