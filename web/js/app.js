import { toBase64, toHex } from './bytes.js';
import {
  defaultSelection, formatParam, optionsFor, PARAM_KEYS, parseCatalog, resolveVariant, unpackFirmware, variantImage,
} from './catalog.js';
import { dotKeysText, keysJsonText, publicKeysText, randomAccessoryId, sanitizeName } from './exports.js';
import { advPayload, macFromAdvKey, patchKeys } from './firmware.js';
import { generateKeySet } from './p224.js';
import { openSerialLink, serialSupported } from './serial.js';
import { TelinkFlasher } from './sws.js';

const $ = id => document.getElementById(id);

const state = {
  catalog: null,
  pack: null,         // all embedded images, decompressed
  selection: {},
  variant: null,
  image: null,        // unpatched image for the selected variant
  keys: null,         // [{ privateKey, advertisementKey, hashedKey }] x3, memory only
  accessoryId: null,
  patched: null,      // { image, offset }
  keysSaved: false,
  flashing: false,
  flashed: false,
  abort: null,
};
let statusText = 'Ready';

function setMsg(el, text, kind = '') {
  el.textContent = text;
  el.className = el.className.replace(/\b(ok|error)\b/g, '').trim() + (kind ? ` ${kind}` : '');
}

function setStatusBar(text) {
  statusText = text;
  $('sb-main').textContent = text;
}

function environmentProblems() {
  const problems = [];
  if (!serialSupported()) {
    problems.push('This browser has no Web Serial, so it cannot flash. Open this file in desktop Chrome, Edge or Opera, '
      + 'or save the patched .bin and use tb03f-pyflasher.py.');
  }
  if (typeof DecompressionStream === 'undefined') {
    problems.push('This browser is too old to unpack the embedded firmware. Use a current Chrome, Edge or Opera.');
  }
  return problems;
}

// ── Step 1: firmware ────────────────────────────────────────────────────────

function renderParams() {
  for (const key of PARAM_KEYS) {
    const options = optionsFor(state.catalog, state.selection, key).map(o => {
      const option = new Option(formatParam(key, o.value) + (o.available ? '' : ' (not built)'), String(o.value));
      option.selected = o.value === state.selection[key];
      return option;
    });
    $(`p-${key}`).replaceChildren(...options);
  }
}

function onParamChange(event) {
  const key = event.target.dataset.param;
  state.selection[key] = state.catalog.params[key].find(v => String(v) === event.target.value);
  renderParams();
  selectVariant();
}

function selectVariant() {
  const status = $('variant-status');
  const variant = resolveVariant(state.catalog, state.selection);
  Object.assign(state, { variant, image: null, patched: null, flashed: false });
  if (!variant) {
    setMsg(status, 'not built - pick a value without "(not built)"', 'error');
  } else {
    try {
      state.image = variantImage(state.pack, variant);
      if (state.keys) repatch();
      setMsg(status, `${variant.id}.bin  ${state.image.length} bytes  sha256 ${variant.sha256.slice(0, 12)}`, 'ok');
    } catch (err) {
      setMsg(status, err.message, 'error');
    }
  }
  refresh();
}

// ── Step 2: keys ────────────────────────────────────────────────────────────

function repatch() {
  state.patched = patchKeys(state.image, state.catalog.marker, state.keys.map(k => k.advertisementKey),
    { expectedOffset: state.variant.key_offset });
}

async function generateKeys() {
  if (state.keys && !confirm('Replace the current keys with new ones?\n\n'
    + 'A tag already flashed with the current keys can only be found with the keys.json saved for it.')) return;
  const status = $('keys-status');
  setMsg(status, 'Generating...');
  setStatusBar('Generating P-224 keys...');
  await new Promise(resolve => setTimeout(resolve, 30)); // let the message paint; keygen blocks briefly
  try {
    state.keys = generateKeySet(3);
    state.accessoryId = randomAccessoryId();
    Object.assign(state, { keysSaved: false, flashed: false });
    repatch();
    renderKeys();
    setMsg(status, `Patched into image at 0x${state.patched.offset.toString(16).toUpperCase()}.`, 'ok');
    setStatusBar('Keys generated. Save keys.json next.');
  } catch (err) {
    Object.assign(state, { keys: null, patched: null });
    setMsg(status, err.message, 'error');
    setStatusBar('Key generation failed.');
  }
  document.querySelectorAll('button.saved').forEach(b => b.classList.remove('saved'));
  refresh();
}

function renderKeys() {
  const rows = state.keys.map((k, i) => {
    const tr = document.createElement('tr');
    const hashed = toBase64(k.hashedKey);
    for (const text of [`${i + 1}`, macFromAdvKey(k.advertisementKey), toBase64(k.advertisementKey), `${hashed.slice(0, 10)}...`]) {
      tr.append(Object.assign(document.createElement('td'), { textContent: text }));
    }
    tr.lastChild.title = hashed;
    return tr;
  });
  $('keys-table').replaceChildren(...rows);
  $('keys-table-wrap').hidden = false;
}

// ── Step 3: downloads ───────────────────────────────────────────────────────

function download(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  setStatusBar(`Saved ${filename}`);
}

const tagName = () => sanitizeName($('tag-name').value);

const downloads = {
  'dl-keys-json': () => {
    download(`${tagName()}_keys.json`, keysJsonText(tagName(), state.keys, state.accessoryId), 'application/json');
    state.keysSaved = true;
  },
  'dl-public': () => download(`${tagName()}_public_keys.txt`,
    publicKeysText(tagName(), state.keys, { variantId: state.variant.id }), 'text/plain'),
  'dl-dotkeys': () => download(`${tagName()}.keys`, dotKeysText(state.keys), 'text/plain'),
  'dl-bin': () => download(`${tagName()}_${state.variant.id}.bin`, state.patched.image, 'application/octet-stream'),
};

// ── Step 4: flash ───────────────────────────────────────────────────────────

function log(line) {
  const pre = $('flash-log');
  pre.textContent += `${new Date().toLocaleTimeString()}  ${line}\n`;
  pre.scrollTop = pre.scrollHeight;
}

function setProgress(percent, busy = false) {
  $('flash-progress').classList.toggle('busy', busy);
  $('flash-progress').firstElementChild.style.width = `${percent}%`;
}

function onProgress({ phase, done, total }) {
  const status = $('flash-status');
  if (phase === 'activate') {
    setProgress(0, true);
    setMsg(status, `Activating (${Number($('activation').value) / 1000} s)...`);
    return;
  }
  const pct = Math.round((done / total) * 100);
  setProgress(pct);
  const where = `0x${done.toString(16).toUpperCase().padStart(5, '0')}`;
  if (phase === 'erase') setMsg(status, `Erasing sector at ${where}...`);
  if (phase === 'write') setMsg(status, `Writing ${done} / ${total} bytes`);
  setStatusBar(`Flashing... ${pct}%`);
}

async function flash() {
  const controller = new AbortController();
  Object.assign(state, { flashing: true, abort: controller });
  $('flash-log').textContent = '';
  setProgress(0);
  refresh();
  let link;
  try {
    link = await openSerialLink(Number($('baud').value));
    const { usbVendorId: vid, usbProductId: pid } = link.info;
    log(`Port open${vid ? ` (USB ${toHex([vid >> 8, vid & 0xff])}:${toHex([pid >> 8, pid & 0xff])})` : ''}, ${$('baud').value} baud`);
    const flasher = new TelinkFlasher(link, { log, signal: controller.signal });
    await flasher.flash(state.patched.image, { activationMs: Number($('activation').value), onProgress });
    state.flashed = true;
    log('Done');
    setMsg($('flash-status'), 'Written. The module has been reset - check it in step 5.', 'ok');
    setStatusBar('Flash complete.');
  } catch (err) {
    const message = err.name === 'NotFoundError' ? 'No serial port selected.'
      : err.name === 'AbortError' ? 'Aborted. Power-cycle the module before trying again.'
        : `Flashing failed: ${err.message}`;
    log(message);
    setProgress(0);
    setMsg($('flash-status'), message, 'error');
    setStatusBar(message);
  } finally {
    await link?.close().catch(() => {});
    Object.assign(state, { flashing: false, abort: null });
    refresh();
  }
}

function startOver() {
  Object.assign(state, { keys: null, patched: null, accessoryId: null, keysSaved: false, flashed: false });
  $('keys-table-wrap').hidden = true;
  $('flash-log').textContent = '';
  setProgress(0);
  for (const id of ['keys-status', 'flash-status']) setMsg($(id), '');
  document.querySelectorAll('button.saved').forEach(b => b.classList.remove('saved'));
  setStatusBar('Ready for the next tag. Generate new keys.');
  refresh();
  $('step-keys').scrollIntoView({ behavior: 'smooth' });
}

// ── State → DOM ─────────────────────────────────────────────────────────────

function setStep(id, unlocked, done) {
  $(id).disabled = !unlocked;
  $(id).classList.toggle('done', !!done);
}

function flashBlocker() {
  if (state.catalog?.dev) return 'Disabled: this is a development build with synthetic images, not firmware.';
  if (!serialSupported()) return 'Web Serial is not available in this browser.';
  if (!state.keysSaved) return 'Save keys.json first (step 3).';
  return '';
}

function refresh() {
  const { image, keys, patched, keysSaved, flashing, flashed, variant } = state;

  PARAM_KEYS.forEach(k => { $(`p-${k}`).disabled = !state.catalog || flashing; });
  setStep('step-firmware', true, !!image);
  setStep('step-keys', !!image && !flashing, !!keys);
  setStep('step-save', !!patched && !flashing, keysSaved);
  setStep('step-flash', !!patched, flashed);
  setStep('step-verify', flashed && !flashing, false);

  $('btn-generate').disabled = !$('ack-own').checked;
  $('btn-generate').textContent = keys ? 'New keys' : 'Generate keys';
  $('dl-keys-json').classList.toggle('saved', keysSaved);
  $('ack-saved').checked = keysSaved;

  const blocker = flashBlocker();
  $('btn-flash').disabled = flashing || !!blocker;
  $('flash-blocker').textContent = patched ? blocker : '';
  $('btn-abort').hidden = !flashing;
  for (const id of ['baud', 'activation']) $(id).disabled = flashing;

  const adv = variant?.config.adv_interval_ms;
  $('activation-hint').textContent = adv && Number($('activation').value) <= adv
    ? `Activation should exceed the ${formatParam('adv_interval_ms', adv)} advertising interval unless RTS/DTR is wired to RST.`
    : '';

  $('sb-serial').textContent = `Web Serial: ${serialSupported() ? 'OK' : 'n/a'}`;
  $('sb-keys').textContent = `Keys: ${!keys ? 'none' : keysSaved ? 'saved' : 'NOT saved'}`;

  if (keys && variant) {
    const first = keys[0].advertisementKey;
    $('verify-mac').textContent = macFromAdvKey(first);
    $('verify-payload').textContent = `${toHex(advPayload(first).subarray(2, 6), ' ').toUpperCase()} xx ${
      toHex(first.subarray(6, 10), ' ').toUpperCase()} ...`;
    $('verify-rotation').textContent = `${variant.config.rotation_min} min`;
  }
}

// ── Boot ────────────────────────────────────────────────────────────────────

function wireEvents() {
  PARAM_KEYS.forEach(k => $(`p-${k}`).addEventListener('change', onParamChange));
  $('ack-own').addEventListener('change', refresh);
  $('btn-generate').addEventListener('click', generateKeys);
  for (const [id, fn] of Object.entries(downloads)) {
    $(id).addEventListener('click', () => {
      fn();
      $(id).classList.add('saved');
      refresh();
    });
  }
  $('ack-saved').addEventListener('change', e => { state.keysSaved = e.target.checked; refresh(); });
  $('activation').addEventListener('change', refresh);
  $('btn-flash').addEventListener('click', flash);
  $('btn-abort').addEventListener('click', () => state.abort?.abort());
  $('btn-next').addEventListener('click', startOver);

  // Old-school hints: hovering or focusing a control shows its description in the status bar.
  for (const el of document.querySelectorAll('[data-hint]')) {
    const show = () => { $('sb-main').textContent = el.dataset.hint; };
    const hide = () => { $('sb-main').textContent = statusText; };
    el.addEventListener('mouseenter', show);
    el.addEventListener('focus', show);
    el.addEventListener('mouseleave', hide);
    el.addEventListener('blur', hide);
  }

  window.addEventListener('beforeunload', e => {
    if (state.flashing || (state.keys && !state.keysSaved)) e.preventDefault();
  });
}

async function init() {
  wireEvents();
  const problems = environmentProblems();
  if (problems.length) {
    $('notice-env').hidden = false;
    $('notice-env').append(...problems.map(p => Object.assign(document.createElement('p'), { textContent: p })));
  }
  refresh();
  try {
    const raw = $('fw-catalog').textContent.trim();
    if (raw.startsWith('__')) throw new Error('this is the unbuilt template; create the page with scripts/make_standalone.py');
    state.catalog = parseCatalog(JSON.parse(raw));
    state.pack = await unpackFirmware($('fw-pack').textContent);
  } catch (err) {
    state.catalog = null;
    setMsg($('variant-status'), `No firmware: ${err.message}`, 'error');
    setStatusBar('No firmware available.');
    refresh();
    return;
  }
  $('build-info').textContent = `Build ${state.catalog.built_at ?? ''} · ${state.catalog.variants.length} firmware variants`;
  if (state.catalog.dev) {
    $('notice-dev').hidden = false;
    $('notice-dev').textContent = 'Development build: the embedded images are synthetic test data, not firmware. Flashing is disabled.';
  }
  state.selection = defaultSelection(state.catalog);
  renderParams();
  selectVariant();
  setStatusBar(`Ready. ${state.catalog.variants.length} firmware variants loaded.`);
}

init();
