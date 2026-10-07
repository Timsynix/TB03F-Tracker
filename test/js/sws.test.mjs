import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import { swsWrAddr, TelinkFlasher } from '../../web/js/sws.js';

const PVVX_HTML = new URL('../../scripts/USBCOMFlashTx.html', import.meta.url);
const BAUD = 460800;

// Virtual clock shared by both implementations: sleeps advance time, writes advance it by wire time.
function makeRecorder() {
  const clock = { t: 0 };
  const events = [];
  return {
    clock,
    events,
    write(data) {
      events.push(['w', Buffer.from(data).toString('hex')]);
      clock.t += (data.length * 10 * 1000) / BAUD;
    },
    signals(s) { events.push(['sig', !!s.dataTerminalReady, !!s.requestToSend]); },
    sleep(ms) { events.push(['sleep', Number(ms)]); clock.t += Number(ms); },
  };
}

// Run pvvx's original page script with stubbed DOM + Web Serial, return its event log.
async function runPvvx(image, activationMs, action = 'FlashWrite') {
  const rec = makeRecorder();
  const html = readFileSync(PVVX_HTML, 'latin1');
  const script = html.match(/<script type="text\/javascript">([\s\S]*?)<\/script>/)[1];
  const element = () => ({ value: String(activationMs), opened: true, disabled: false, innerHTML: '',
    addEventListener() {}, set onclick(_) {} });
  const elements = {};
  class FakeDate {
    getTime() { return rec.clock.t; }
    toLocaleTimeString() { return ''; }
  }
  const ctx = vm.createContext({
    document: { getElementById: id => (elements[id] ??= element()), querySelector: () => element() },
    window: {}, console: { log() {} }, alert() {}, navigator: {}, Date: FakeDate,
    Uint8Array, Uint32Array, Promise, setTimeout,
  });
  vm.runInContext(script, ctx);
  ctx.delay = async ms => rec.sleep(ms);
  ctx.serialController.port = { setSignals: async s => rec.signals(s) };
  ctx.serialController.writer = { write: async d => rec.write(d) };
  ctx.firmwareArray = image.buffer.slice(image.byteOffset, image.byteOffset + image.byteLength);
  await vm.runInContext(`${action}()`, ctx);
  return rec.events;
}

async function runOurs(image, activationMs) {
  const rec = makeRecorder();
  const link = { write: async d => rec.write(d), setSignals: async s => rec.signals(s) };
  const clock = { now: () => rec.clock.t, sleep: async ms => rec.sleep(ms) };
  await new TelinkFlasher(link, { clock }).flash(image, { activationMs });
  return rec.events;
}

function testImage(len) {
  const img = new Uint8Array(len);
  for (let i = 0; i < len; i++) img[i] = (i * 31 + 7) & 0xff;
  return img;
}

test('swsWrAddr: packet layout', () => {
  const pkt = swsWrAddr(0x0602, [0x05]);
  assert.equal(pkt.length, (1 + 6) * 10);
  assert.equal(pkt[0], 0x80);          // command start bit
  assert.equal(pkt[10], 0xfe);         // data start bit
  assert.deepEqual([...pkt.subarray(1, 9)], [0, 1, 0, 1, 1, 0, 1, 0].map(b => (b ? 0x80 : 0xfe))); // 0x5A
  assert.deepEqual([...pkt.subarray(60, 69)], Array(9).fill(0x80)); // end marker
  assert.equal(pkt[69], 0xfe);
});

for (const [len, activation] of [[22808, 1000], [4096 * 2 + 17, 300], [100, 0]]) {
  test(`flash stream is byte-identical to pvvx USBCOMFlashTx.html (${len} B, ${activation} ms activation)`, async () => {
    const image = testImage(len);
    const [theirs, ours] = [await runPvvx(image, activation), await runOurs(image, activation)];
    assert.ok(theirs.length > 20);
    assert.equal(ours.length, theirs.length);
    assert.deepEqual(ours, theirs);
  });
}

test('flash reports progress and honours abort', async () => {
  const rec = makeRecorder();
  const link = { write: async d => rec.write(d), setSignals: async s => rec.signals(s) };
  const clock = { now: () => rec.clock.t, sleep: async ms => rec.sleep(ms) };
  const controller = new AbortController();
  const phases = [];
  const flasher = new TelinkFlasher(link, { clock, signal: controller.signal });
  await assert.rejects(flasher.flash(testImage(9000), {
    activationMs: 10,
    onProgress: p => { phases.push(p.phase); if (p.phase === 'write' && p.done >= 4096) controller.abort(); },
  }), { name: 'AbortError' });
  assert.deepEqual([...new Set(phases)], ['activate', 'erase', 'write']);
});
