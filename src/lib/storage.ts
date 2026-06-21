"use client";

import { getCurrentUser, hasSupabaseEnv, supabase } from "./supabase";
import { seedData } from "./seed";
import type { Inventory, InventoryInsert, InventoryMovement, ShelfData } from "./types";

const STORAGE_KEY = "smart-shelf-v1-data";
const PRODUCT_IMAGE_BUCKET = "product-images";

const cloneSeed = (): ShelfData => JSON.parse(JSON.stringify(seedData)) as ShelfData;

const newId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const activeInventory = (inventory: Inventory[]) =>
  inventory.filter((item) => !item.deleted_at && !item.archived_at && !item.product.archived_at);

type UploadImage = {
  blob: Blob;
  contentType: "image/webp" | "image/jpeg" | "image/png";
  extension: "webp" | "jpg" | "png";
};

const supportedImageTypes = new Set(["image/webp", "image/jpeg", "image/png"]);

function getImageExtension(contentType: UploadImage["contentType"]): UploadImage["extension"] {
  if (contentType === "image/webp") return "webp";
  if (contentType === "image/png") return "png";
  return "jpg";
}

async function loadImageSource(file: File): Promise<{
  source: CanvasImageSource;
  width: number;
  height: number;
  cleanup: () => void;
}> {
  if ("createImageBitmap" in window) {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        cleanup: () => bitmap.close(),
      };
    } catch {
      // Fall back to an HTML image below for browsers/files that createImageBitmap cannot decode.
    }
  }

  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = "async";
  image.src = objectUrl;

  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Failed to read image file."));
  });

  return {
    source: image,
    width: image.naturalWidth,
    height: image.naturalHeight,
    cleanup: () => URL.revokeObjectURL(objectUrl),
  };
}

function canvasToBlob(canvas: HTMLCanvasElement, contentType: string, quality: number) {
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, contentType, quality);
  });
}

function createMovement(input: Omit<InventoryMovement, "id" | "created_at">): InventoryMovement {
  return {
    ...input,
    id: newId("movement"),
    created_at: new Date().toISOString(),
  };
}

export async function compressImageForUpload(file: File): Promise<UploadImage> {
  const image = await loadImageSource(file);
  const maxSide = 1400;
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  try {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is not available for image compression.");
    context.drawImage(image.source, 0, 0, width, height);
  } finally {
    image.cleanup();
  }

  const webp = await canvasToBlob(canvas, "image/webp", 0.82);
  if (webp?.type === "image/webp") {
    return { blob: webp, contentType: "image/webp", extension: "webp" };
  }

  const jpeg = await canvasToBlob(canvas, "image/jpeg", 0.84);
  if (jpeg?.type === "image/jpeg") {
    return { blob: jpeg, contentType: "image/jpeg", extension: "jpg" };
  }

  if (supportedImageTypes.has(file.type)) {
    const contentType = file.type as UploadImage["contentType"];
    return { blob: file, contentType, extension: getImageExtension(contentType) };
  }

  throw new Error("Only PNG, JPG, and WebP images are supported.");
}

async function uploadProductImage(file: File): Promise<string> {
  if (!hasSupabaseEnv || !supabase) {
    return URL.createObjectURL(file);
  }

  const user = await getCurrentUser();
  if (!user) throw new Error("Please sign in before uploading images.");

  const image = await compressImageForUpload(file);
  const path = `${user.id}/products/${Date.now().toString(36)}-${crypto.randomUUID()}.${image.extension}`;

  const { error } = await supabase.storage
    .from(PRODUCT_IMAGE_BUCKET)
    .upload(path, image.blob, {
      cacheControl: "31536000",
      contentType: image.contentType,
      upsert: false,
    });

  if (error) throw error;

  const { data } = supabase.storage.from(PRODUCT_IMAGE_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

export async function loadShelfData(): Promise<ShelfData> {
  if (hasSupabaseEnv && supabase) {
    const user = await getCurrentUser();
    if (!user) {
      return { ...cloneSeed(), inventory: [], movements: [] };
    }

    const { error: bootstrapError } = await supabase.rpc("ensure_default_shelf");
    if (bootstrapError) throw bootstrapError;

    const [{ data: racks }, { data: sections }, { data: slots }, { data: inventoryRows }, { data: movements }] =
      await Promise.all([
        supabase.from("racks").select("id, name").order("created_at"),
        supabase.from("sections").select("id, rack_id, code, name").order("code"),
        supabase.from("slots").select("id, section_id, code").order("code"),
        supabase
          .from("inventory")
          .select("id, product_id, slot_id, quantity, archived_at, deleted_at, product:products(id, name, image, archived_at)")
          .is("deleted_at", null)
          .is("archived_at", null)
          .order("created_at"),
        supabase
          .from("inventory_movements")
          .select("id, inventory_id, product_id, product_name, from_slot_id, to_slot_id, from_slot_code, to_slot_code, quantity_snapshot, action, note, created_at")
          .order("created_at", { ascending: false })
          .limit(20),
      ]);

    return {
      racks: racks ?? [],
      sections: (sections ?? []) as ShelfData["sections"],
      slots: slots ?? [],
      inventory: activeInventory(
        ((inventoryRows ?? []) as unknown as Inventory[]).map((item) => ({
          ...item,
          product: Array.isArray(item.product) ? item.product[0] : item.product,
        })),
      ),
      movements: (movements ?? []) as InventoryMovement[],
    };
  }

  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    const initial = cloneSeed();
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
    return initial;
  }

  const parsed = JSON.parse(stored) as ShelfData;
  return {
    ...parsed,
    inventory: activeInventory(parsed.inventory ?? []),
    movements: parsed.movements ?? [],
  };
}

export async function saveLocalShelfData(data: ShelfData) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export async function changeInventoryQuantity(
  data: ShelfData,
  inventoryId: string,
  delta: number,
): Promise<ShelfData> {
  if (hasSupabaseEnv && supabase) {
    const current = data.inventory.find((item) => item.id === inventoryId);
    if (!current) return data;
    const nextQuantity = Math.max(0, current.quantity + delta);
    await supabase.from("inventory").update({ quantity: nextQuantity }).eq("id", inventoryId);
    return loadShelfData();
  }

  const nextData = {
    ...data,
    inventory: data.inventory.map((item) =>
      item.id === inventoryId ? { ...item, quantity: Math.max(0, item.quantity + delta) } : item,
    ),
  };
  await saveLocalShelfData(nextData);
  return nextData;
}

export async function addInventory(data: ShelfData, input: InventoryInsert): Promise<ShelfData> {
  const image = input.imageFile ? await uploadProductImage(input.imageFile) : input.image;

  if (hasSupabaseEnv && supabase) {
    const user = await getCurrentUser();
    if (!user) throw new Error("Please sign in before adding inventory.");

    const { data: existingProduct, error: productLookupError } = await supabase
      .from("products")
      .select("id, image, archived_at")
      .eq("name", input.name)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (productLookupError) throw productLookupError;

    let productId = existingProduct?.id;

    if (productId) {
      const existingImage = existingProduct?.image ?? null;
      const { error: productUpdateError } = await supabase
        .from("products")
        .update({ image: image ?? existingImage, archived_at: null })
        .eq("id", productId);

      if (productUpdateError) throw productUpdateError;
    }

    if (!productId) {
      const { data: product, error: productError } = await supabase
        .from("products")
        .insert({ owner_id: user.id, name: input.name, image: image ?? null })
        .select("id")
        .single();

      if (productError) throw productError;
      productId = product.id;
    }

    const { data: existingInventory, error: inventoryLookupError } = await supabase
      .from("inventory")
      .select("id, quantity")
      .eq("product_id", productId)
      .eq("slot_id", input.slotId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (inventoryLookupError) throw inventoryLookupError;

    if (existingInventory) {
      const { error: inventoryUpdateError } = await supabase
        .from("inventory")
        .update({
          quantity: existingInventory.quantity + input.quantity,
          archived_at: null,
          deleted_at: null,
        })
        .eq("id", existingInventory.id);

      if (inventoryUpdateError) throw inventoryUpdateError;
      return loadShelfData();
    }

    const { error: inventoryError } = await supabase.from("inventory").insert({
      product_id: productId,
      slot_id: input.slotId,
      quantity: input.quantity,
    });

    if (inventoryError) throw inventoryError;
    return loadShelfData();
  }

  const existingInventory = data.inventory.find(
    (item) => item.slot_id === input.slotId && item.product.name.trim() === input.name.trim(),
  );

  if (existingInventory) {
    const nextData: ShelfData = {
      ...data,
      inventory: data.inventory.map((item) =>
        item.id === existingInventory.id
          ? {
              ...item,
              quantity: item.quantity + input.quantity,
              archived_at: null,
              deleted_at: null,
              product: {
                ...item.product,
                image: image ?? item.product.image,
                archived_at: null,
              },
            }
          : item,
      ),
    };
    await saveLocalShelfData(nextData);
    return nextData;
  }

  const existingProduct = data.inventory.find((item) => item.product.name.trim() === input.name.trim())?.product;
  const productId = existingProduct?.id ?? newId("product");
  const nextData: ShelfData = {
    ...data,
    inventory: [
      ...data.inventory,
      {
        id: newId("inventory"),
        product_id: productId,
        slot_id: input.slotId,
        quantity: input.quantity,
        archived_at: null,
        deleted_at: null,
        product: {
          id: productId,
          name: input.name,
          image: image ?? existingProduct?.image ?? null,
          archived_at: null,
        },
      },
    ],
  };
  await saveLocalShelfData(nextData);
  return nextData;
}

export async function moveInventory(
  data: ShelfData,
  inventoryId: string,
  targetSlotId: string,
): Promise<ShelfData> {
  if (hasSupabaseEnv && supabase) {
    const { error } = await supabase.rpc("move_inventory_record", {
      p_inventory_id: inventoryId,
      p_target_slot_id: targetSlotId,
    });

    if (error) throw error;
    return loadShelfData();
  }

  const movingItem = data.inventory.find((item) => item.id === inventoryId);
  if (!movingItem) return data;

  const fromSlot = data.slots.find((slot) => slot.id === movingItem.slot_id);
  const toSlot = data.slots.find((slot) => slot.id === targetSlotId);
  const mergeTarget = data.inventory.find(
    (item) =>
      item.id !== inventoryId &&
      item.slot_id === targetSlotId &&
      item.product_id === movingItem.product_id,
  );

  const movement = createMovement({
    inventory_id: mergeTarget?.id ?? movingItem.id,
    product_id: movingItem.product_id,
    product_name: movingItem.product.name,
    from_slot_id: movingItem.slot_id,
    to_slot_id: targetSlotId,
    from_slot_code: fromSlot?.code ?? null,
    to_slot_code: toSlot?.code ?? null,
    quantity_snapshot: movingItem.quantity,
    action: mergeTarget ? "merged" : "moved",
    note: mergeTarget ? "merged into existing inventory" : "moved",
  });

  const nextData: ShelfData = mergeTarget
    ? {
        ...data,
        inventory: data.inventory
          .filter((item) => item.id !== inventoryId)
          .map((item) =>
            item.id === mergeTarget.id
              ? { ...item, quantity: item.quantity + movingItem.quantity }
              : item,
          ),
        movements: [movement, ...(data.movements ?? [])].slice(0, 20),
      }
    : {
        ...data,
        inventory: data.inventory.map((item) =>
          item.id === inventoryId ? { ...item, slot_id: targetSlotId } : item,
        ),
        movements: [movement, ...(data.movements ?? [])].slice(0, 20),
      };
  await saveLocalShelfData(nextData);
  return nextData;
}

export async function archiveInventory(data: ShelfData, inventoryId: string): Promise<ShelfData> {
  if (hasSupabaseEnv && supabase) {
    const { error } = await supabase.rpc("archive_inventory_record", {
      p_inventory_id: inventoryId,
    });

    if (error) throw error;
    return loadShelfData();
  }

  const item = data.inventory.find((entry) => entry.id === inventoryId);
  if (!item) return data;
  const slot = data.slots.find((entry) => entry.id === item.slot_id);
  const movement = createMovement({
    inventory_id: item.id,
    product_id: item.product_id,
    product_name: item.product.name,
    from_slot_id: item.slot_id,
    from_slot_code: slot?.code ?? null,
    quantity_snapshot: item.quantity,
    action: "archived",
    note: "archived inventory record",
  });

  const nextData: ShelfData = {
    ...data,
    inventory: data.inventory.filter((entry) => entry.id !== inventoryId),
    movements: [movement, ...(data.movements ?? [])].slice(0, 20),
  };
  await saveLocalShelfData(nextData);
  return nextData;
}

export async function deleteInventory(data: ShelfData, inventoryId: string): Promise<ShelfData> {
  if (hasSupabaseEnv && supabase) {
    const { error } = await supabase.rpc("delete_inventory_record", {
      p_inventory_id: inventoryId,
    });

    if (error) throw error;
    return loadShelfData();
  }

  const item = data.inventory.find((entry) => entry.id === inventoryId);
  if (!item) return data;
  const slot = data.slots.find((entry) => entry.id === item.slot_id);
  const movement = createMovement({
    inventory_id: item.id,
    product_id: item.product_id,
    product_name: item.product.name,
    from_slot_id: item.slot_id,
    from_slot_code: slot?.code ?? null,
    quantity_snapshot: item.quantity,
    action: "deleted",
    note: "soft deleted inventory record",
  });

  const nextData: ShelfData = {
    ...data,
    inventory: data.inventory.filter((entry) => entry.id !== inventoryId),
    movements: [movement, ...(data.movements ?? [])].slice(0, 20),
  };
  await saveLocalShelfData(nextData);
  return nextData;
}

export async function updateProductDetails(
  data: ShelfData,
  productId: string,
  input: { name: string; image?: string | null; imageFile?: File | null },
): Promise<ShelfData> {
  const image = input.imageFile ? await uploadProductImage(input.imageFile) : input.image;

  if (hasSupabaseEnv && supabase) {
    const updates: { name: string; image?: string | null; archived_at: null } = {
      name: input.name,
      archived_at: null,
    };
    if (image !== undefined) updates.image = image || null;

    const { error } = await supabase.from("products").update(updates).eq("id", productId);
    if (error) throw error;
    return loadShelfData();
  }

  const nextData: ShelfData = {
    ...data,
    inventory: data.inventory.map((item) =>
      item.product_id === productId
        ? {
            ...item,
            product: {
              ...item.product,
              name: input.name,
              image: image !== undefined ? image || null : item.product.image,
              archived_at: null,
            },
          }
        : item,
    ),
  };
  await saveLocalShelfData(nextData);
  return nextData;
}

export async function deleteRack(data: ShelfData, rackId: string): Promise<ShelfData> {
  if (hasSupabaseEnv && supabase) {
    const { error } = await supabase.from("racks").delete().eq("id", rackId);
    if (error) throw error;
    return loadShelfData();
  }

  const deletedSections = data.sections.filter((section) => section.rack_id === rackId);
  const deletedSectionIds = new Set(deletedSections.map((section) => section.id));
  const deletedSlots = data.slots.filter((slot) => deletedSectionIds.has(slot.section_id));
  const deletedSlotIds = new Set(deletedSlots.map((slot) => slot.id));
  const nextData: ShelfData = {
    ...data,
    racks: data.racks.filter((rack) => rack.id !== rackId),
    sections: data.sections.filter((section) => section.rack_id !== rackId),
    slots: data.slots.filter((slot) => !deletedSectionIds.has(slot.section_id)),
    inventory: data.inventory.filter((item) => !deletedSlotIds.has(item.slot_id)),
  };
  await saveLocalShelfData(nextData);
  return nextData;
}

export async function createRack(data: ShelfData, name: string): Promise<ShelfData> {
  if (hasSupabaseEnv && supabase) {
    const user = await getCurrentUser();
    if (!user) throw new Error("Please sign in before creating racks.");

    const { error } = await supabase.from("racks").insert({ owner_id: user.id, name });
    if (error) throw error;
    return loadShelfData();
  }

  const rackId = newId("rack");
  const sectionNames: Record<string, string> = {
    A: "海报区",
    B: "拍立得区",
    C: "周边区",
    D: "包材区",
    E: "备用区",
  };
  const sections = Object.entries(sectionNames).map(([code, sectionName]) => ({
    id: `${rackId}-section-${code.toLowerCase()}`,
    rack_id: rackId,
    code: code as ShelfData["sections"][number]["code"],
    name: sectionName,
  }));
  const slots = sections.flatMap((section) =>
    [1].map((slotNumber) => ({
      id: `${section.id}-slot-${slotNumber}`,
      section_id: section.id,
      code: `${section.code}${slotNumber}`,
    })),
  );
  const nextData: ShelfData = {
    ...data,
    racks: [...data.racks, { id: rackId, name }],
    sections: [...data.sections, ...sections],
    slots: [...data.slots, ...slots],
  };
  await saveLocalShelfData(nextData);
  return nextData;
}

export async function renameRack(data: ShelfData, rackId: string, name: string): Promise<ShelfData> {
  if (hasSupabaseEnv && supabase) {
    const { error } = await supabase.from("racks").update({ name }).eq("id", rackId);
    if (error) throw error;
    return loadShelfData();
  }

  const nextData: ShelfData = {
    ...data,
    racks: data.racks.map((rack) => (rack.id === rackId ? { ...rack, name } : rack)),
  };
  await saveLocalShelfData(nextData);
  return nextData;
}

export async function createSlot(data: ShelfData, sectionId: string, code: string): Promise<ShelfData> {
  if (hasSupabaseEnv && supabase) {
    const { error } = await supabase.from("slots").insert({ section_id: sectionId, code });
    if (error) throw error;
    return loadShelfData();
  }

  const nextData: ShelfData = {
    ...data,
    slots: [
      ...data.slots,
      {
        id: newId("slot"),
        section_id: sectionId,
        code,
      },
    ],
  };
  await saveLocalShelfData(nextData);
  return nextData;
}

export async function deleteSlot(data: ShelfData, slotId: string): Promise<ShelfData> {
  const hasInventory = data.inventory.some((item) => item.slot_id === slotId);
  if (hasInventory) {
    throw new Error("这个 Slot 还有库存，先移动或删除库存后再删除 Slot。");
  }

  if (hasSupabaseEnv && supabase) {
    const { error } = await supabase.from("slots").delete().eq("id", slotId);
    if (error) throw error;
    return loadShelfData();
  }

  const nextData: ShelfData = {
    ...data,
    slots: data.slots.filter((slot) => slot.id !== slotId),
  };
  await saveLocalShelfData(nextData);
  return nextData;
}

export async function renameSection(
  data: ShelfData,
  sectionId: string,
  name: string,
): Promise<ShelfData> {
  if (hasSupabaseEnv && supabase) {
    await supabase.from("sections").update({ name }).eq("id", sectionId);
    return loadShelfData();
  }

  const nextData = {
    ...data,
    sections: data.sections.map((section) =>
      section.id === sectionId ? { ...section, name } : section,
    ),
  };
  await saveLocalShelfData(nextData);
  return nextData;
}
