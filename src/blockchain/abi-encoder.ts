const MASK_64_BITS = (1n << 64n) - 1n;
const MAX_UINT256 = (1n << 256n) - 1n;
const WORD_BYTES = 32;

const KECCAK_ROUND_CONSTANTS = [
  0x0000000000000001n,
  0x0000000000008082n,
  0x800000000000808an,
  0x8000000080008000n,
  0x000000000000808bn,
  0x0000000080000001n,
  0x8000000080008081n,
  0x8000000000008009n,
  0x000000000000008an,
  0x0000000000000088n,
  0x0000000080008009n,
  0x000000008000000an,
  0x000000008000808bn,
  0x800000000000008bn,
  0x8000000000008089n,
  0x8000000000008003n,
  0x8000000000008002n,
  0x8000000000000080n,
  0x000000000000800an,
  0x800000008000000an,
  0x8000000080008081n,
  0x8000000000008080n,
  0x0000000080000001n,
  0x8000000080008008n,
] as const;

const KECCAK_ROTATIONS = [
  0, 1, 62, 28, 27,
  36, 44, 6, 55, 20,
  3, 10, 43, 25, 39,
  41, 45, 15, 21, 8,
  18, 2, 61, 56, 14,
] as const;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export type AbiType = "address" | "uint256" | "bool" | "bytes32" | "string";

export function functionSelector(name: string, types: readonly string[]): string {
  return functionSelectorFromSignature(`${name}(${types.join(",")})`);
}

export function functionSelectorFromSignature(signature: string): string {
  const hash = keccak256Hex(signature);
  return `0x${hash.slice(0, 8)}`;
}

export function encodeFunction(name: string, types: readonly AbiType[], values: readonly unknown[]): string {
  if (types.length !== values.length) {
    throw new Error(`encodeFunction expected ${types.length} values but received ${values.length}`);
  }

  const selector = functionSelector(name, types).slice(2);
  const head = new Array<string>(types.length).fill("");
  const tail: string[] = [];
  let dynamicOffsetBytes = types.length * WORD_BYTES;

  for (let index = 0; index < types.length; index++) {
    const type = types[index];
    const value = values[index];
    if (!type) {
      throw new Error(`Missing type at index ${index}`);
    }

    if (isDynamicType(type)) {
      const encodedDynamic = encodeDynamic(type, value);
      head[index] = encodeValueWord("uint256", BigInt(dynamicOffsetBytes));
      tail.push(encodedDynamic);
      dynamicOffsetBytes += encodedDynamic.length / 2;
      continue;
    }

    head[index] = encodeValueWord(type, value);
  }

  return `0x${selector}${head.join("")}${tail.join("")}`;
}

export function decodeFunctionResult(types: readonly AbiType[], data: string): unknown[] {
  const hex = stripHexPrefix(data);
  if (hex.length % 2 !== 0) {
    throw new Error("Invalid hex string length");
  }
  if (hex.length % (WORD_BYTES * 2) !== 0) {
    throw new Error("ABI data must be 32-byte aligned");
  }

  const values: unknown[] = [];
  for (let index = 0; index < types.length; index++) {
    const type = types[index];
    if (!type) {
      throw new Error(`Missing type at index ${index}`);
    }

    const word = readWord(hex, index);
    if (isDynamicType(type)) {
      const offsetBytes = decodeUint256Word(word);
      const offsetWordIndex = toSafeNumber(offsetBytes / BigInt(WORD_BYTES));
      const stringLength = toSafeNumber(decodeUint256Word(readWord(hex, offsetWordIndex)));
      const stringDataStart = (offsetWordIndex + 1) * WORD_BYTES * 2;
      const stringDataEnd = stringDataStart + stringLength * 2;
      if (stringDataEnd > hex.length) {
        throw new Error("Encoded string exceeds ABI payload");
      }
      const stringHex = hex.slice(stringDataStart, stringDataEnd);
      values.push(textDecoder.decode(hexToBytes(stringHex)));
      continue;
    }

    values.push(decodeStaticWord(type, word));
  }

  return values;
}

export function encodeValueWord(type: Exclude<AbiType, "string">, value: unknown): string {
  switch (type) {
    case "address": {
      const normalized = normalizeAddress(value);
      return leftPadToWord(stripHexPrefix(normalized));
    }
    case "uint256": {
      const bigintValue = normalizeUint256(value);
      return leftPadToWord(bigintValue.toString(16));
    }
    case "bool": {
      const boolValue = normalizeBool(value);
      return leftPadToWord(boolValue ? "1" : "0");
    }
    case "bytes32": {
      const normalized = normalizeBytes32(value);
      return stripHexPrefix(normalized);
    }
  }
}

export function keccak256Hex(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? textEncoder.encode(input) : input;
  const state = new Array<bigint>(25).fill(0n);
  const rateInBytes = 136;
  const padded = keccakPad(bytes, rateInBytes);

  for (let offset = 0; offset < padded.length; offset += rateInBytes) {
    for (let laneIndex = 0; laneIndex < rateInBytes / 8; laneIndex++) {
      state[laneIndex] = (state[laneIndex] ?? 0n) ^ readLaneLittleEndian(padded, offset + laneIndex * 8);
    }
    keccakF1600(state);
  }

  const output = new Uint8Array(32);
  let outputOffset = 0;
  let laneIndex = 0;
  while (outputOffset < output.length) {
    const lane = state[laneIndex] ?? 0n;
    for (let byteOffset = 0; byteOffset < 8 && outputOffset < output.length; byteOffset++) {
      output[outputOffset] = Number((lane >> BigInt(byteOffset * 8)) & 0xffn);
      outputOffset += 1;
    }
    laneIndex += 1;
  }

  return bytesToHex(output);
}

function encodeDynamic(type: "string", value: unknown): string {
  switch (type) {
    case "string": {
      if (typeof value !== "string") {
        throw new Error(`Expected string value, received ${typeof value}`);
      }
      const encoded = textEncoder.encode(value);
      const lengthWord = encodeValueWord("uint256", BigInt(encoded.length));
      const dataHex = bytesToHex(encoded);
      const paddedHex = rightPadToWordBoundary(dataHex);
      return `${lengthWord}${paddedHex}`;
    }
  }
}

function decodeStaticWord(type: Exclude<AbiType, "string">, word: string): unknown {
  switch (type) {
    case "address":
      return `0x${word.slice(24).toLowerCase()}`;
    case "uint256":
      return decodeUint256Word(word);
    case "bool":
      return decodeUint256Word(word) !== 0n;
    case "bytes32":
      return `0x${word.toLowerCase()}`;
  }
}

function isDynamicType(type: AbiType): type is "string" {
  return type === "string";
}

function normalizeAddress(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error(`Address must be a string, received ${typeof value}`);
  }
  const normalized = value.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(normalized)) {
    throw new Error(`Invalid address: ${value}`);
  }
  return normalized;
}

function normalizeBytes32(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error(`bytes32 value must be a string, received ${typeof value}`);
  }
  const normalized = value.toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(normalized)) {
    throw new Error(`Invalid bytes32 value: ${value}`);
  }
  return normalized;
}

function normalizeBool(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (value === 0 || value === 1) {
    return Boolean(value);
  }
  throw new Error(`Boolean value must be true/false or 0/1, received ${String(value)}`);
}

function normalizeUint256(value: unknown): bigint {
  let numericValue: bigint;
  if (typeof value === "bigint") {
    numericValue = value;
  } else if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`Invalid uint256 number value: ${value}`);
    }
    numericValue = BigInt(value);
  } else if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      throw new Error("Invalid uint256 string value: empty");
    }
    if (/^0x[0-9a-fA-F]+$/.test(trimmed) || /^\d+$/.test(trimmed)) {
      numericValue = BigInt(trimmed);
    } else {
      throw new Error(`Invalid uint256 string value: ${value}`);
    }
  } else {
    throw new Error(`Invalid uint256 value type: ${typeof value}`);
  }

  if (numericValue < 0n || numericValue > MAX_UINT256) {
    throw new Error(`uint256 value out of range: ${numericValue}`);
  }

  return numericValue;
}

function leftPadToWord(hexWithoutPrefix: string): string {
  if (hexWithoutPrefix.length > WORD_BYTES * 2) {
    throw new Error("Value exceeds 32 bytes");
  }
  return hexWithoutPrefix.padStart(WORD_BYTES * 2, "0");
}

function rightPadToWordBoundary(hexWithoutPrefix: string): string {
  if (hexWithoutPrefix.length === 0) {
    return "";
  }
  const bytes = Math.ceil(hexWithoutPrefix.length / 2);
  const paddedBytes = Math.ceil(bytes / WORD_BYTES) * WORD_BYTES;
  return hexWithoutPrefix.padEnd(paddedBytes * 2, "0");
}

function readWord(hex: string, wordIndex: number): string {
  const start = wordIndex * WORD_BYTES * 2;
  const end = start + WORD_BYTES * 2;
  if (end > hex.length) {
    throw new Error(`Word index ${wordIndex} out of bounds for ABI payload`);
  }
  return hex.slice(start, end);
}

function decodeUint256Word(word: string): bigint {
  return BigInt(`0x${word}`);
}

function stripHexPrefix(value: string): string {
  return value.startsWith("0x") || value.startsWith("0X") ? value.slice(2) : value;
}

function hexToBytes(hexWithoutPrefix: string): Uint8Array {
  if (hexWithoutPrefix.length % 2 !== 0) {
    throw new Error("Hex string must have even length");
  }
  const bytes = new Uint8Array(hexWithoutPrefix.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    const pair = hexWithoutPrefix.slice(i * 2, i * 2 + 2);
    bytes[i] = Number.parseInt(pair, 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

function toSafeNumber(value: bigint): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`Value cannot be represented safely as number: ${value}`);
  }
  return Number(value);
}

function keccakPad(input: Uint8Array, blockSizeBytes: number): Uint8Array {
  const paddingZeroCount = (blockSizeBytes - ((input.length + 1) % blockSizeBytes)) % blockSizeBytes;
  const output = new Uint8Array(input.length + 1 + paddingZeroCount);
  output.set(input, 0);
  output[input.length] = 0x01;
  output[output.length - 1] |= 0x80;
  return output;
}

function readLaneLittleEndian(bytes: Uint8Array, offset: number): bigint {
  let lane = 0n;
  for (let i = 0; i < 8; i++) {
    lane |= BigInt(bytes[offset + i] ?? 0) << BigInt(i * 8);
  }
  return lane;
}

function rotateLeft64(value: bigint, shift: number): bigint {
  if (shift === 0) {
    return value & MASK_64_BITS;
  }
  const bigintShift = BigInt(shift);
  return ((value << bigintShift) | (value >> (64n - bigintShift))) & MASK_64_BITS;
}

function keccakF1600(state: bigint[]): void {
  const c = new Array<bigint>(5).fill(0n);
  const d = new Array<bigint>(5).fill(0n);
  const b = new Array<bigint>(25).fill(0n);

  for (let round = 0; round < 24; round++) {
    for (let x = 0; x < 5; x++) {
      c[x] =
        (state[x] ?? 0n)
        ^ (state[x + 5] ?? 0n)
        ^ (state[x + 10] ?? 0n)
        ^ (state[x + 15] ?? 0n)
        ^ (state[x + 20] ?? 0n);
    }

    for (let x = 0; x < 5; x++) {
      const left = c[(x + 4) % 5] ?? 0n;
      const right = rotateLeft64(c[(x + 1) % 5] ?? 0n, 1);
      d[x] = left ^ right;
    }

    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        const index = x + 5 * y;
        state[index] = (state[index] ?? 0n) ^ (d[x] ?? 0n);
      }
    }

    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        const index = x + 5 * y;
        const rotation = KECCAK_ROTATIONS[index] ?? 0;
        const newX = y;
        const newY = (2 * x + 3 * y) % 5;
        b[newX + 5 * newY] = rotateLeft64(state[index] ?? 0n, rotation);
      }
    }

    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        const index = x + 5 * y;
        const current = b[index] ?? 0n;
        const next = b[((x + 1) % 5) + 5 * y] ?? 0n;
        const nextNext = b[((x + 2) % 5) + 5 * y] ?? 0n;
        state[index] = (current ^ ((~next & MASK_64_BITS) & nextNext)) & MASK_64_BITS;
      }
    }

    state[0] = ((state[0] ?? 0n) ^ (KECCAK_ROUND_CONSTANTS[round] ?? 0n)) & MASK_64_BITS;
  }
}
