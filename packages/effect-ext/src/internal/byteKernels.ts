/**
 * Indexed loops over bytes for the hot paths of `Str` and `String`: a
 * callback per byte costs far more than the comparison it makes.
 *
 * @internal
 */

export const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a === b) return true;
  const n = a.byteLength;
  if (n !== b.byteLength) return false;
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};

export const compareBytes = (a: Uint8Array, b: Uint8Array): -1 | 0 | 1 => {
  const n = Math.min(a.byteLength, b.byteLength);
  for (let i = 0; i < n; i++) {
    const x = a[i];
    const y = b[i];
    if (x !== y) return x < y ? -1 : 1;
  }
  return a.byteLength < b.byteLength ? -1 : a.byteLength > b.byteLength ? 1 : 0;
};

/**
 * The longest input {@link decodeWith} decodes without the decoder. Measured on V8,
 * `TextDecoder#decode` costs about the same at every short length, while
 * `String.fromCharCode` with one argument per byte grows with the length
 * and stops winning past about a dozen bytes.
 */
const SHORT_ASCII_MAX = 12;

const fromCharCode = globalThis.String.fromCharCode;

/**
 * `decoder.decode(b)`, without the decoder when `b` is at most
 * {@link SHORT_ASCII_MAX} bytes of ASCII (every byte below 0x80), which
 * every UTF-8 decoder maps byte for byte to the same code units.
 */
export const decodeWith = (b: Uint8Array, decoder: TextDecoder): string => {
  const n = b.byteLength;
  if (n > SHORT_ASCII_MAX) return decoder.decode(b);
  let any = 0;
  for (let i = 0; i < n; i++) any |= b[i];
  if (any >= 0x80) return decoder.decode(b);
  // One call with an argument per byte: building the string a character at a
  // time, or `apply` over the array, costs more than the decoder does.
  switch (n) {
    case 0:
      return "";
    case 1:
      return fromCharCode(b[0]);
    case 2:
      return fromCharCode(b[0], b[1]);
    case 3:
      return fromCharCode(b[0], b[1], b[2]);
    case 4:
      return fromCharCode(b[0], b[1], b[2], b[3]);
    case 5:
      return fromCharCode(b[0], b[1], b[2], b[3], b[4]);
    case 6:
      return fromCharCode(b[0], b[1], b[2], b[3], b[4], b[5]);
    case 7:
      return fromCharCode(b[0], b[1], b[2], b[3], b[4], b[5], b[6]);
    case 8:
      return fromCharCode(b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7]);
    case 9:
      return fromCharCode(b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8]);
    case 10:
      return fromCharCode(b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8], b[9]);
    case 11:
      return fromCharCode(b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8], b[9], b[10]);
    default:
      return fromCharCode(b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8], b[9], b[10], b[11]);
  }
};
