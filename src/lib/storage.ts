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

function createMovement(input: Omit<InventoryMovement, "id" | "created_at">): InventoryMovement {
  return {
    ...input,
    id: newId("movement"),
    created_at: new Date().toISOString(),
  };
}

export async function compressImageToWebp(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const maxSide = 1400;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is not available for image compression.");
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Failed to compress image."));
          return;
        }
        resolve(blob);
      },
      "image/webp",
      0.82,
    );
  });
}

async function uploadProductImage(file: File): Promise<string> {
  if (!hasSupabaseEnv || !supabase) {
    return URL.createObjectURL(file);
  }

  const user = await getCurrentUser();
  if (!user) throw new Error("Please sign in before uploading images.");

  const webp = await compressImageToWebp(file);
  const path = `${user.id}/products/${Date.now().toString(36)}-${crypto.randomUUID()}.webp`;

  const { error } = await supabase.storage
    .from(PRODUCT_IMAGE_BUCKET)
    .upload(path, webp, {
      cacheControl: "31536000",
      contentType: "image/webp",
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
