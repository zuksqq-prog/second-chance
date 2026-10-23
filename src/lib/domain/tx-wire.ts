/**
 * Minimal Solana wire-format parsing (legacy + v0 transactions), dependency-free.
 * Used server-side to prove that the transaction a user signed is byte-for-byte
 * the transaction we quoted (same message), and that its fee payer is the
 * signed-in wallet. Signatures are not verified here; the chain does that.
 */

export function readCompactU16(buf: Uint8Array, offset: number): { value: number; size: number } {
  let value = 0;
  let size = 0;
  for (;;) {
    if (offset + size >= buf.length) throw new Error("Truncated compact-u16.");
    const byte = buf[offset + size];
    value |= (byte & 0x7f) << (7 * size);
    size += 1;
    if ((byte & 0x80) === 0) break;
    if (size > 3) throw new Error("Invalid compact-u16.");
  }
  return { value, size };
}

export interface ParsedWireTx {
  signatures: Uint8Array[];
  message: Uint8Array;
  version: "legacy" | 0;
  numRequiredSignatures: number;
  staticAccountKeys: Uint8Array[];
}

export function parseWireTx(bytes: Uint8Array): ParsedWireTx {
  const { value: nSigs, size } = readCompactU16(bytes, 0);
  if (nSigs < 1 || nSigs > 16) throw new Error("Unexpected signature count.");
  let o = size;
  const signatures: Uint8Array[] = [];
  for (let i = 0; i < nSigs; i++) {
    if (o + 64 > bytes.length) throw new Error("Truncated signatures.");
    signatures.push(bytes.subarray(o, o + 64));
    o += 64;
  }
  const message = bytes.subarray(o);
  if (message.length < 4) throw new Error("Truncated message.");
  let m = 0;
  let version: "legacy" | 0 = "legacy";
  if (message[0] & 0x80) {
    const v = message[0] & 0x7f;
    if (v !== 0) throw new Error(`Unsupported transaction version ${v}.`);
    version = 0;
    m = 1;
  }
  const numRequiredSignatures = message[m];
  m += 3; // header: numRequiredSignatures, numReadonlySigned, numReadonlyUnsigned
  const { value: nKeys, size: ks } = readCompactU16(message, m);
  m += ks;
  const staticAccountKeys: Uint8Array[] = [];
  for (let i = 0; i < nKeys; i++) {
    if (m + 32 > message.length) throw new Error("Truncated account keys.");
    staticAccountKeys.push(message.subarray(m, m + 32));
    m += 32;
  }
  if (numRequiredSignatures !== nSigs) throw new Error("Signature count does not match header.");
  return { signatures, message, version, numRequiredSignatures, staticAccountKeys };
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

export function isZero(a: Uint8Array): boolean {
  return a.every((x) => x === 0);
}
