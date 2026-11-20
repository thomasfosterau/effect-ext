/**
 * Reading and writing a record field by field: the hot path of every struct
 * `Layout`, `Vec` of structs and `StructOfArrays`. Plain loops over a field
 * table, with no closure or intermediate array per field.
 *
 * @internal
 */
import type * as Layout from "../Layout.ts";

/**
 * Where one field of a record lives: at `offset + index * stride` bytes. A
 * struct layout's slot has `stride` 0 (its fields are at fixed offsets from
 * the record); a `StructOfArrays` column's has the field size, and its
 * `offset` moves when the block is resized.
 */
export interface Slot<F extends Layout.Fields = Layout.Fields> {
  readonly key: keyof F & string;
  readonly layout: Layout.Any;
  readonly stride: number;
  offset: number;
}

/**
 * Reads the record whose fields are at `base + slot.offset + index *
 * slot.stride`, with its keys in slot order. The slots hold one entry per key
 * of `F`.
 */
export const read = <F extends Layout.Fields>(
  view: DataView,
  slots: ReadonlyArray<Slot<F>>,
  base: number,
  index: number,
): Layout.StructType<F> => {
  const out: Partial<Layout.StructType<F>> = {};
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    out[slot.key] = slot.layout.read(view, base + slot.offset + index * slot.stride);
  }
  // SAFETY: the loop above set every key of `F`, each through its own layout.
  return out as Layout.StructType<F>;
};

/** Writes `value` field by field, the inverse of {@link read}. */
export const write = <F extends Layout.Fields>(
  view: DataView,
  slots: ReadonlyArray<Slot<F>>,
  base: number,
  index: number,
  value: Layout.StructType<F>,
): void => {
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    slot.layout.write(view, base + slot.offset + index * slot.stride, value[slot.key]);
  }
};
