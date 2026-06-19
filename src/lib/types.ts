export type SectionCode = "A" | "B" | "C" | "D" | "E";

export type Rack = {
  id: string;
  name: string;
};

export type Section = {
  id: string;
  rack_id: string;
  code: SectionCode;
  name: string;
};

export type Slot = {
  id: string;
  section_id: string;
  code: string;
};

export type Product = {
  id: string;
  name: string;
  image?: string | null;
  archived_at?: string | null;
};

export type Inventory = {
  id: string;
  product_id: string;
  slot_id: string;
  quantity: number;
  archived_at?: string | null;
  deleted_at?: string | null;
  product: Product;
};

export type InventoryMovement = {
  id: string;
  inventory_id?: string | null;
  product_id?: string | null;
  product_name: string;
  from_slot_id?: string | null;
  to_slot_id?: string | null;
  from_slot_code?: string | null;
  to_slot_code?: string | null;
  quantity_snapshot: number;
  action: "moved" | "merged" | "archived" | "deleted" | string;
  note?: string | null;
  created_at: string;
};

export type ShelfData = {
  racks: Rack[];
  sections: Section[];
  slots: Slot[];
  inventory: Inventory[];
  movements: InventoryMovement[];
};

export type InventoryInsert = {
  name: string;
  quantity: number;
  image?: string | null;
  imageFile?: File | null;
  slotId: string;
};
