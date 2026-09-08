const B64 =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Hermes-safe base64 encode (no atob/btoa dependency). */
export function b64encode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (a << 16) | (b << 8) | c;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? B64[n & 63] : '=';
  }
  return out;
}

const REV = new Map<string, number>([...B64].map((c, i) => [c, i]));

/** Hermes-safe base64 decode. Throws on invalid input. */
export function b64decode(s: string): Uint8Array {
  const clean = s.replace(/[\r\n\s]/g, '');
  if (clean.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(clean)) {
    throw new Error('Invalid base64 audio frame.');
  }
  const pad = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  const out = new Uint8Array(((clean.length / 4) | 0) * 3 - pad);
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      ((REV.get(clean[i]) ?? 0) << 18) |
      ((REV.get(clean[i + 1]) ?? 0) << 12) |
      ((REV.get(clean[i + 2]) ?? 0) << 6) |
      (REV.get(clean[i + 3]) ?? 0);
    out[o++] = (n >> 16) & 255;
    if (o < out.length) {
      out[o++] = (n >> 8) & 255;
    }
    if (o < out.length) {
      out[o++] = n & 255;
    }
  }
  return out;
}

/**
 * Linear-interpolation resample of 16-bit LE mono PCM.
 * Used for OpenAI Realtime, which wants 24 kHz while we capture 16 kHz.
 */
export function resamplePcm16(data: Uint8Array, fromHz: number, toHz: number): Uint8Array {
  if (fromHz === toHz) {
    return data.slice();
  }
  if (data.length % 2 !== 0) {
    throw new Error('PCM16 length must be even.');
  }
  const nIn = data.length / 2;
  const nOut = Math.floor((nIn * toHz) / fromHz);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const out = new Uint8Array(nOut * 2);
  const oview = new DataView(out.buffer);
  const get = (i: number): number => {
    const clamped = Math.max(0, Math.min(nIn - 1, i));
    return view.getInt16(clamped * 2, true);
  };
  for (let i = 0; i < nOut; i++) {
    const pos = (i * fromHz) / toHz;
    const i0 = Math.floor(pos);
    const frac = pos - i0;
    const v = Math.round(get(i0) * (1 - frac) + get(i0 + 1) * frac);
    oview.setInt16(i * 2, Math.max(-32768, Math.min(32767, v)), true);
  }
  return out;
}
