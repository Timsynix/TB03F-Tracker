// Web Serial link for TelinkFlasher.
// bufferSize 240: a multiple of the 10 UART bytes per SWire byte that fits common USB-UART FIFOs
// (same as pvvx's flasher).

export const serialSupported = () => typeof navigator !== 'undefined' && 'serial' in navigator;

export async function openSerialLink(baudRate) {
  const port = await navigator.serial.requestPort();
  await port.open({ baudRate, bufferSize: 240 });
  const writer = port.writable.getWriter();
  await port.setSignals({ dataTerminalReady: false, requestToSend: false });
  return {
    info: port.getInfo(),
    write: data => writer.write(data),
    setSignals: signals => port.setSignals(signals),
    async close() {
      try {
        await writer.close();
      } catch {
        writer.releaseLock();
      }
      await port.close();
    },
  };
}
