export interface NbtLong { readonly __nbtLong: true; readonly hi: number; readonly lo: number; }
export type NbtValue = string | number | NbtLong | Int8Array | Int32Array | NbtLong[] | NbtValue[] | NbtCompound;
export interface NbtCompound { [key: string]: NbtValue; }

class NbtReader {
  private offset = 0;
  private readonly view: DataView;
  private readonly bytes: Uint8Array;
  private readonly decoder = new TextDecoder("utf-8");

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  readRoot(): NbtCompound {
    const type = this.u8();
    if (type !== 10) throw new Error(`NBT 根标签必须是 Compound，实际为 ${type}`);
    this.string();
    return this.payload(10) as NbtCompound;
  }

  private ensure(length: number) {
    if (length < 0 || this.offset + length > this.bytes.length) throw new Error("NBT 数据不完整或长度非法");
  }
  private u8() { this.ensure(1); return this.view.getUint8(this.offset++); }
  private i8() { this.ensure(1); return this.view.getInt8(this.offset++); }
  private i16() { this.ensure(2); const v = this.view.getInt16(this.offset); this.offset += 2; return v; }
  private u16() { this.ensure(2); const v = this.view.getUint16(this.offset); this.offset += 2; return v; }
  private i32() { this.ensure(4); const v = this.view.getInt32(this.offset); this.offset += 4; return v; }
  private f32() { this.ensure(4); const v = this.view.getFloat32(this.offset); this.offset += 4; return v; }
  private f64() { this.ensure(8); const v = this.view.getFloat64(this.offset); this.offset += 8; return v; }
  private i64(): NbtLong {
    this.ensure(8);
    const hi = this.view.getUint32(this.offset), lo = this.view.getUint32(this.offset + 4);
    this.offset += 8;
    return { __nbtLong: true, hi, lo };
  }
  private string() {
    const length = this.u16(); this.ensure(length);
    const result = this.decoder.decode(this.bytes.subarray(this.offset, this.offset + length));
    this.offset += length; return result;
  }
  private arrayLength() {
    const length = this.i32();
    if (length < 0 || length > 100_000_000) throw new Error(`NBT 数组长度非法：${length}`);
    return length;
  }

  private payload(type: number): NbtValue {
    switch (type) {
      case 1: return this.i8();
      case 2: return this.i16();
      case 3: return this.i32();
      case 4: return this.i64();
      case 5: return this.f32();
      case 6: return this.f64();
      case 7: { const n = this.arrayLength(); this.ensure(n); const v = new Int8Array(n); for (let i = 0; i < n; i++) v[i] = this.i8(); return v; }
      case 8: return this.string();
      case 9: { const childType = this.u8(); const n = this.arrayLength(); const v: NbtValue[] = []; for (let i = 0; i < n; i++) v.push(this.payload(childType)); return v; }
      case 10: { const v: NbtCompound = {}; while (true) { const childType = this.u8(); if (childType === 0) return v; const name = this.string(); v[name] = this.payload(childType); } }
      case 11: { const n = this.arrayLength(); const v = new Int32Array(n); for (let i = 0; i < n; i++) v[i] = this.i32(); return v; }
      case 12: { const n = this.arrayLength(); const v: NbtLong[] = []; for (let i = 0; i < n; i++) v.push(this.i64()); return v; }
      default: throw new Error(`不支持的 NBT 标签类型：${type}`);
    }
  }
}

export function parseNbt(bytes: Uint8Array): NbtCompound {
  return new NbtReader(bytes).readRoot();
}

export function compound(value: NbtValue | undefined, label: string): NbtCompound {
  if (!value || Array.isArray(value) || typeof value !== "object" || ArrayBuffer.isView(value)) {
    throw new Error(`缺少或无效的 ${label}`);
  }
  return value as NbtCompound;
}
