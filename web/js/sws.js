// Telink TLSR825x flash writer over SWire, bit-banged through a USB-UART's TX line.
// 1:1 port of pvvx's TLSR825x USB-COM Flash Writer (scripts/USBCOMFlashTx.html); the emitted
// byte stream is checked against that file in test/js/sws.test.mjs. TX only, so there is no
// readback: success has to be verified by scanning for the tag's BLE advertisements.

export const SECTOR_SIZE = 0x1000;
export const PAGE_SIZE = 256; // max SPI flash FIFO

const REG = {
  SPI_DATA: 0x000c,
  SPI_CS: 0x000d,     // 0x00 = CS low, 0x01 = CS high
  SOFT_RESET: 0x006f,
  SWS_SPEED: 0x00b2,
  SWS_FIFO: 0x00b3,   // 0x80 = FIFO mode (repeat writes to one address), 0x00 = normal
  CPU_STOP: 0x0602,
};
const FLASH = { WRITE_STATUS: 0x01, PAGE_PROGRAM: 0x02, WRITE_ENABLE: 0x06, SECTOR_ERASE: 0x20, WAKE_UP: 0xab };

// One SWire bit per UART byte (0x80 = 1, 0xFE = 0), 10 UART bytes per SWire byte.
// Packet: 0x5A (command bit set), addr[23:16], addr[15:8], addr[7:0], 0x00 (write), data..., 0xFF end.
export function swsWrAddr(addr, data) {
  const bytes = Uint8Array.from(data);
  const d = new Uint8Array(10);
  const pkt = new Uint8Array((bytes.length + 6) * 10);
  const encode = value => {
    for (let i = 1, m = 0x80; m; i++, m >>= 1) d[i] = value & m ? 0x80 : 0xfe;
  };
  d[0] = 0x80; // command start bit
  d[9] = 0xfe; // stop bit
  [0x5a, (addr >> 16) & 0xff, (addr >> 8) & 0xff, addr & 0xff, 0x00].forEach((b, n) => {
    encode(b);
    pkt.set(d, n * 10);
    d[0] = 0xfe; // data start bit
  });
  bytes.forEach((b, n) => {
    encode(b);
    pkt.set(d, (n + 5) * 10);
  });
  d.fill(0x80, 0, 9); // end: 0xFF with command bit
  pkt.set(d, (bytes.length + 5) * 10);
  return pkt;
}

const defaultClock = {
  now: () => performance.now(),
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
};

export class TelinkFlasher {
  // link: { write(Uint8Array): Promise, setSignals({dataTerminalReady, requestToSend}): Promise }
  constructor(link, { clock = defaultClock, log = () => {}, signal } = {}) {
    this.link = link;
    this.clock = clock;
    this.log = log;
    this.signal = signal;
  }

  async write(addr, data) {
    this.signal?.throwIfAborted();
    await this.link.write(swsWrAddr(addr, data));
  }

  async sleep(ms) {
    this.signal?.throwIfAborted();
    await this.clock.sleep(ms);
  }

  async flashCommand(cmd) {
    await this.write(REG.SPI_CS, [0x00]);
    await this.write(REG.SPI_DATA, [cmd & 0xff, 0x01]); // command + CS high
  }

  async writeStatus(value) {
    await this.flashCommand(FLASH.WRITE_ENABLE);
    await this.write(REG.SPI_CS, [0x00]);
    await this.write(REG.SPI_DATA, [FLASH.WRITE_STATUS]);
    await this.write(REG.SPI_DATA, [value & 0xff, 0x01]);
    await this.sleep(3);
  }

  async sectorErase(addr) {
    await this.flashCommand(FLASH.WRITE_ENABLE);
    await this.write(REG.SPI_CS, [0x00]);
    await this.write(REG.SPI_DATA, [FLASH.SECTOR_ERASE]);
    await this.write(REG.SPI_DATA, [(addr >> 16) & 0xff]);
    await this.write(REG.SPI_DATA, [(addr >> 8) & 0xff]);
    await this.write(REG.SPI_DATA, [addr & 0xff, 0x01]);
    await this.sleep(300);
  }

  async writeBlock(addr, data) {
    await this.flashCommand(FLASH.WRITE_ENABLE);
    await this.write(REG.SPI_CS, [0x00]);
    const blk = new Uint8Array(4 + data.length);
    blk.set([FLASH.PAGE_PROGRAM, (addr >> 16) & 0xff, (addr >> 8) & 0xff, addr & 0xff]);
    blk.set(data, 4);
    await this.write(REG.SWS_FIFO, [0x80]);
    await this.write(REG.SPI_DATA, blk);
    await this.write(REG.SWS_FIFO, [0x00]);
    await this.write(REG.SPI_CS, [0x01]);
    await this.sleep(10);
  }

  async softReset() {
    await this.write(REG.SOFT_RESET, [0x20]);
  }

  // The chip spends most of its time in deep-sleep retention, where SWS does not respond, so the
  // CPU-stop command is repeated for activationMs (longer than the advertising interval unless
  // RTS is wired to RST).
  async activate(activationMs) {
    this.log('Reset DTR/RTS (100 ms)');
    await this.link.setSignals({ dataTerminalReady: true, requestToSend: true });
    await this.sleep(100);
    await this.link.setSignals({ dataTerminalReady: false, requestToSend: false });
    await this.softReset();
    this.log(`Activate (${activationMs / 1000} s)...`);
    const cpuStop = [0x05];
    const t0 = this.clock.now();
    while (this.clock.now() - t0 < activationMs) await this.write(REG.CPU_STOP, cpuStop);
    await this.write(REG.SWS_SPEED, [55]);
    await this.write(REG.CPU_STOP, cpuStop);
    await this.flashCommand(FLASH.WAKE_UP);
  }

  async flash(image, { activationMs = 5000, onProgress = () => {} } = {}) {
    const total = image.length;
    onProgress({ phase: 'activate', done: 0, total });
    await this.activate(activationMs);
    this.log(`Write ${total} bytes to flash...`);
    if (total > 0) {
      await this.writeStatus(0); // clear block protection
      await this.writeStatus(0);
    }
    let addr = 0;
    let blockSize = PAGE_SIZE;
    for (let remaining = total; remaining > 0; remaining -= blockSize, addr += blockSize) {
      if ((addr & (SECTOR_SIZE - 1)) === 0) {
        onProgress({ phase: 'erase', done: addr, total });
        await this.sectorErase(addr);
      }
      if (remaining < blockSize) blockSize = remaining;
      await this.writeBlock(addr, image.subarray(addr, addr + blockSize));
      onProgress({ phase: 'write', done: addr + blockSize, total });
    }
    this.log('Soft reset MCU');
    await this.softReset();
    onProgress({ phase: 'done', done: total, total });
  }
}
