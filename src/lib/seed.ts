import type { Inventory, Rack, Section, ShelfData, Slot } from "./types";

export const SECTION_CODES = ["A", "B", "C", "D", "E"] as const;

export const defaultRack: Rack = {
  id: "rack-1",
  name: "Rack-1",
};

export const defaultSections: Section[] = [
  { id: "section-a", rack_id: defaultRack.id, code: "A", name: "海报区" },
  { id: "section-b", rack_id: defaultRack.id, code: "B", name: "拍立得区" },
  { id: "section-c", rack_id: defaultRack.id, code: "C", name: "周边区" },
  { id: "section-d", rack_id: defaultRack.id, code: "D", name: "包材区" },
  { id: "section-e", rack_id: defaultRack.id, code: "E", name: "备用区" },
];

export const defaultSlots: Slot[] = defaultSections.flatMap((section) =>
  [1, 2, 3, 4, 5].map((number) => ({
    id: `slot-${section.code.toLowerCase()}-${number}`,
    section_id: section.id,
    code: `${section.code}${number}`,
  })),
);

export const defaultInventory: Inventory[] = [
  {
    id: "inventory-lisa-a2",
    product_id: "product-lisa",
    slot_id: "slot-a-2",
    quantity: 10,
    product: {
      id: "product-lisa",
      name: "LiSA 海报",
      image: null,
    },
  },
  {
    id: "inventory-tomorin-a2",
    product_id: "product-tomorin",
    slot_id: "slot-a-2",
    quantity: 5,
    product: {
      id: "product-tomorin",
      name: "Tomorin 海报",
      image: null,
    },
  },
  {
    id: "inventory-mygo-a2",
    product_id: "product-mygo",
    slot_id: "slot-a-2",
    quantity: 2,
    product: {
      id: "product-mygo",
      name: "MyGO!!!!! 海报",
      image: null,
    },
  },
];

export const seedData: ShelfData = {
  racks: [defaultRack],
  sections: defaultSections,
  slots: defaultSlots,
  inventory: defaultInventory,
  movements: [],
};
