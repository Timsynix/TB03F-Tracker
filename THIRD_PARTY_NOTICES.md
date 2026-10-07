# Third-party notices

## TB-03F OpenHaystack firmware (in the firmware images)

The firmware images embedded in `TB03F-Flasher.html` are compiled from
[stefexec/TB-03F-OpenHaystack-Firmware](https://github.com/stefexec/TB-03F-OpenHaystack-Firmware), commit
`c96e672914bf6e0f55426baf6425f219ec818939`. The build applies the parameter and power-saving changes in
`scripts/fwpatch.py`.

- License: the upstream repository does not state a license (checked 2026-10-07).
- The upstream firmware includes the **Telink BLE SDK** for the TLSR825x, © Telink Semiconductor (Shanghai) Co., Ltd.,
  under the terms that come with the SDK.

## pvvx TLSR825x USB-COM Flash Writer

`scripts/USBCOMFlashTx.html` is a copy of pvvx's flash writer, and `web/js/sws.js` ports its SWire flashing protocol to
JavaScript. Source: [pvvx/ATC_MiThermometer](https://github.com/pvvx/ATC_MiThermometer). License as published there:

```
Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the "Software"),
to deal in the Software without restriction, including without limitation the
rights to use, copy, modify, merge, publish, distribute, sublicense,
and/or sell copies of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## Macless Haystack and OpenHaystack (not included)

No code from these projects is included. The flasher writes `keys.json` in the import format of
[Macless Haystack](https://github.com/dchristl/macless-haystack) (AGPL-3.0). Its key generation follows the same
scheme as Macless Haystack's `generate_keys.py`: NIST P-224 keys, with the public key's X coordinate as the
advertisement key. The approach comes from [OpenHaystack](https://github.com/seemoo-lab/openhaystack) by SEEMOO,
TU Darmstadt.
