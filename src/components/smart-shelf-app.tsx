"use client";

import { useEffect, useMemo, useState } from "react";
import {
  addInventory,
  archiveInventory,
  changeInventoryQuantity,
  createRack,
  createSlot,
  deleteInventory,
  deleteRack,
  deleteSlot,
  loadShelfData,
  moveInventory,
  renameRack,
  renameSection,
  updateProductDetails,
} from "@/lib/storage";
import { getCurrentUser, hasSupabaseEnv, supabase, type AuthUser } from "@/lib/supabase";
import type { Inventory, InventoryInsert, InventoryMovement, Section, ShelfData, Slot } from "@/lib/types";
import { seedData } from "@/lib/seed";

type AppMode = "table" | "gallery" | "admin";
type StockTone = "empty" | "low" | "watch" | "good";
type FilterMode = "all" | "inStock" | "lowStock" | "missingImage";
type ConfirmAction = {
  title: string;
  message: string;
  confirmLabel: string;
  tone?: "danger" | "warning";
  onConfirm: () => Promise<void>;
};
type CsvInventoryRow = {
  name: string;
  quantity: number;
  slotCode: string;
  image?: string | null;
};
type InventoryRowData = {
  item: Inventory;
  slot?: Slot;
  section?: Section;
  rack?: { id: string; name: string };
};

const quantityFormatter = new Intl.NumberFormat("zh-CN");

export function SmartShelfApp() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(!hasSupabaseEnv);
  const [data, setData] = useState<ShelfData>(seedData);
  const [selectedRackId, setSelectedRackId] = useState(seedData.racks[0]?.id ?? "");
  const [selectedSectionId, setSelectedSectionId] = useState("section-a");
  const [selectedSlotId, setSelectedSlotId] = useState("slot-a-2");
  const [appMode, setAppMode] = useState<AppMode>("table");
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [query, setQuery] = useState("");
  const [isReady, setIsReady] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [createRackOpen, setCreateRackOpen] = useState(false);
  const [renameRackOpen, setRenameRackOpen] = useState(false);
  const [createSlotOpen, setCreateSlotOpen] = useState(false);
  const [detailInventoryId, setDetailInventoryId] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!hasSupabaseEnv || !supabase) {
      setAuthChecked(true);
      return;
    }

    getCurrentUser().then((currentUser) => {
      setUser(currentUser);
      setAuthChecked(true);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setAuthChecked(true);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (hasSupabaseEnv && !user) {
      setIsReady(true);
      return;
    }

    loadShelfData()
      .then((loaded) => {
        setData(loaded);
        const loadedRack = loaded.racks[0];
        if (loadedRack) setSelectedRackId(loadedRack.id);
        const loadedSections = loadedRack
          ? loaded.sections.filter((section) => section.rack_id === loadedRack.id)
          : loaded.sections;
        const loadedSlots = loaded.slots.filter((slot) =>
          loadedSections.some((section) => section.id === slot.section_id),
        );
        const firstSection = loadedSections.find((section) => section.code === "A") ?? loadedSections[0];
        const preferredSlot =
          loadedSlots.find((slot) => slot.code === "A2" && slot.section_id === firstSection?.id) ??
          loadedSlots.find((slot) => slot.section_id === firstSection?.id) ??
          loadedSlots[0];

        if (firstSection) setSelectedSectionId(firstSection.id);
        if (preferredSlot) setSelectedSlotId(preferredSlot.id);
        setActionError(null);
      })
      .catch((error) => {
        setActionError(getErrorMessage(error));
      })
      .finally(() => setIsReady(true));
  }, [user]);

  const rack = data.racks.find((entry) => entry.id === selectedRackId) ?? data.racks[0];
  const rackSections = useMemo(
    () => (rack ? data.sections.filter((section) => section.rack_id === rack.id) : data.sections),
    [data.sections, rack],
  );
  const rackSectionIds = useMemo(() => new Set(rackSections.map((section) => section.id)), [rackSections]);
  const rackSlots = useMemo(
    () => data.slots.filter((slot) => rackSectionIds.has(slot.section_id)),
    [data.slots, rackSectionIds],
  );
  const rackSlotIds = useMemo(() => new Set(rackSlots.map((slot) => slot.id)), [rackSlots]);
  const rackInventory = useMemo(
    () => data.inventory.filter((item) => rackSlotIds.has(item.slot_id)),
    [data.inventory, rackSlotIds],
  );
  const selectedSection =
    rackSections.find((section) => section.id === selectedSectionId) ?? rackSections[0] ?? data.sections[0];
  const selectedSlot =
    rackSlots.find((slot) => slot.id === selectedSlotId) ??
    rackSlots.find((slot) => slot.section_id === selectedSection?.id) ??
    data.slots[0];
  const slotInventory = useMemo(
    () => rackInventory.filter((item) => item.slot_id === selectedSlot?.id),
    [rackInventory, selectedSlot?.id],
  );

  useEffect(() => {
    const nextSection =
      rackSections.find((section) => section.id === selectedSectionId) ?? rackSections[0];
    const nextSlot =
      rackSlots.find((slot) => slot.id === selectedSlotId) ??
      rackSlots.find((slot) => slot.section_id === nextSection?.id) ??
      rackSlots[0];

    if (nextSection && nextSection.id !== selectedSectionId) setSelectedSectionId(nextSection.id);
    if (nextSlot && nextSlot.id !== selectedSlotId) setSelectedSlotId(nextSlot.id);
  }, [rackSections, rackSlots, selectedSectionId, selectedSlotId]);

  const inventoryRows = useMemo<InventoryRowData[]>(() => {
    return rackInventory.map((item) => {
      const slot = rackSlots.find((entry) => entry.id === item.slot_id);
      const section = rackSections.find((entry) => entry.id === slot?.section_id);
      const rackForResult = data.racks.find((entry) => entry.id === section?.rack_id);
      return { item, slot, section, rack: rackForResult };
    });
  }, [data.racks, rackInventory, rackSections, rackSlots]);

  const visibleInventoryRows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return inventoryRows
      .filter(({ item, slot, section }) => {
        const location = `${section?.code ?? ""} ${section?.name ?? ""} ${slot?.code ?? ""}`.toLowerCase();
        return item.product.name.toLowerCase().includes(normalized) || location.includes(normalized);
      })
      .filter(({ item }) => matchesFilter(item, filterMode));
  }, [filterMode, inventoryRows, query]);

  const detailRow = useMemo(
    () => inventoryRows.find((row) => row.item.id === detailInventoryId),
    [detailInventoryId, inventoryRows],
  );

  if (!authChecked) {
    return <FullScreenStatus title="正在检查登录状态" subtitle="Smart Shelf 正在连接 Supabase。" />;
  }

  if (hasSupabaseEnv && !user) {
    return <AuthGate />;
  }

  const selectSearchResult = (slot?: Slot, section?: Section) => {
    if (section) setSelectedSectionId(section.id);
    if (slot) setSelectedSlotId(slot.id);
    setAppMode("table");
  };

  const updateData = async (operation: () => Promise<ShelfData>, success?: string) => {
    setIsSaving(true);
    setActionError(null);
    setSuccessMessage(null);
    try {
      setData(await operation());
      if (success) setSuccessMessage(success);
    } catch (error) {
      setActionError(getErrorMessage(error));
      throw error;
    } finally {
      setIsSaving(false);
    }
  };

  const updateQuantity = async (inventoryId: string, delta: number) => {
    if (isSaving) return;
    await updateData(() => changeInventoryQuantity(data, inventoryId, delta), delta > 0 ? "库存已增加" : "库存已减少");
  };

  const confirmArchiveInventory = (inventoryId: string) => {
    if (isSaving) return;
    const item = data.inventory.find((entry) => entry.id === inventoryId);
    setConfirmAction({
      title: "归档这条库存？",
      message: `${item?.product.name ?? "这条库存"} 会从当前列表隐藏，但操作历史会保留。`,
      confirmLabel: "归档",
      tone: "warning",
      onConfirm: () => updateData(() => archiveInventory(data, inventoryId), "库存已归档"),
    });
  };

  const confirmDeleteInventory = (inventoryId: string) => {
    if (isSaving) return;
    const item = data.inventory.find((entry) => entry.id === inventoryId);
    setConfirmAction({
      title: "删除这条库存？",
      message: `${item?.product.name ?? "这条库存"} 会被隐藏并记录到操作历史，页面内不会直接恢复。`,
      confirmLabel: "删除",
      tone: "danger",
      onConfirm: () => updateData(() => deleteInventory(data, inventoryId), "库存已删除"),
    });
  };

  const moveInventoryToSlot = async (inventoryId: string, targetSlotId: string, quantity?: number) => {
    if (isSaving) return;
    const current = data.inventory.find((item) => item.id === inventoryId);
    if (!current || current.slot_id === targetSlotId) return;
    const targetSlot = rackSlots.find((entry) => entry.id === targetSlotId);
    await updateData(
      () => moveInventory(data, inventoryId, targetSlotId, quantity),
      `已移动到 ${targetSlot?.code ?? "目标 Slot"}`,
    );
    setSelectedSlotId(targetSlotId);
  };

  const importInventoryCsv = async (file: File) => {
    if (isSaving) return;
    const text = await file.text();
    const rows = parseInventoryCsv(text);

    await updateData(async () => {
      let nextData = data;
      for (const row of rows) {
        const slot = rackSlots.find((entry) => entry.code.trim().toLowerCase() === row.slotCode.toLowerCase());
        if (!slot) {
          throw new Error(`找不到 Slot：${row.slotCode}。请先在当前 Rack 新增这个 Slot，再导入。`);
        }
        nextData = await addInventory(nextData, {
          name: row.name,
          quantity: row.quantity,
          image: row.image ?? null,
          slotId: slot.id,
        });
      }
      return nextData;
    }, `已导入 ${rows.length} 条库存`);
  };

  const productsForSlot = (slotId: string) =>
    rackInventory.filter((item) => item.slot_id === slotId).length;

  const totalInventory = rackInventory.reduce((total, item) => total + item.quantity, 0);
  const activeSlots = rackSlots.filter((slot) => productsForSlot(slot.id) > 0).length;

  return (
    <main className="min-h-[100dvh] max-w-full overflow-x-hidden text-[var(--text)]">
      <div className="mx-auto flex min-h-[100dvh] max-w-[1480px] min-w-0 flex-col">
        <TopBar
          racks={data.racks}
          selectedRackId={rack?.id ?? ""}
          isSaving={isSaving}
          userLabel={user ? user.email ?? "已登录" : "本地 Demo"}
          totalInventory={totalInventory}
          activeSlots={activeSlots}
          totalSlots={rackSlots.length}
          query={query}
          filterMode={filterMode}
          results={visibleInventoryRows}
          onQueryChange={setQuery}
          onFilterChange={setFilterMode}
          onSelectResult={selectSearchResult}
          onSelectRack={(rackId) => {
            setSelectedRackId(rackId);
            const nextSection = data.sections.find((section) => section.rack_id === rackId);
            const nextSlot = data.slots.find((slot) => slot.section_id === nextSection?.id);
            if (nextSection) setSelectedSectionId(nextSection.id);
            if (nextSlot) setSelectedSlotId(nextSlot.id);
          }}
        />

        <section className="flex min-w-0 max-w-full flex-1 flex-col pb-28 sm:pb-32">
          {appMode === "table" ? (
            <div className="grid min-w-0 flex-1 gap-4 px-3 py-3 sm:px-4 md:px-6 lg:px-7 lg:py-5">
              <section className="min-w-0">
                <InventoryTablePanel
                  rackName={rack?.name ?? "Rack-1"}
                  rows={visibleInventoryRows}
                  slots={rackSlots}
                  isReady={isReady}
                  filterMode={filterMode}
                  onSelectRow={(slot, section) => {
                    if (section) setSelectedSectionId(section.id);
                    if (slot) setSelectedSlotId(slot.id);
                  }}
                  onOpenDetail={(inventoryId) => setDetailInventoryId(inventoryId)}
                  onChangeQuantity={updateQuantity}
                  onMoveInventory={moveInventoryToSlot}
                  onOpenAdd={() => setAddOpen(true)}
                  onArchive={confirmArchiveInventory}
                  onDelete={confirmDeleteInventory}
                />
              </section>
            </div>
          ) : appMode === "gallery" ? (
            <ProductGalleryPage
              rows={visibleInventoryRows}
              onOpenDetail={(inventoryId) => setDetailInventoryId(inventoryId)}
            />
          ) : (
            <>
              <AdminPanel
                data={data}
                activeRack={rack}
                activeSections={rackSections}
                activeSlots={rackSlots}
                activeInventory={rackInventory}
                movements={data.movements ?? []}
                isSaving={isSaving}
                onCreateRack={() => setCreateRackOpen(true)}
                onRenameRack={() => setRenameRackOpen(true)}
                onCreateSlot={() => setCreateSlotOpen(true)}
                onImportCsv={importInventoryCsv}
                onDeleteSlot={(slotId) => {
                  const slot = data.slots.find((entry) => entry.id === slotId);
                  setConfirmAction({
                    title: "删除空 Slot？",
                    message: `${slot?.code ?? "这个 Slot"} 删除后不会影响已有库存。`,
                    confirmLabel: "删除 Slot",
                    tone: "danger",
                    onConfirm: () => updateData(() => deleteSlot(data, slotId), "Slot 已删除"),
                  });
                }}
                onDeleteRack={(rackId) => {
                  const rackToDelete = data.racks.find((entry) => entry.id === rackId);
                  setConfirmAction({
                    title: "删除 Rack？",
                    message: `${rackToDelete?.name ?? "这个 Rack"} 和里面的 Slot/库存记录会一起删除，页面内不能直接恢复。`,
                    confirmLabel: "删除 Rack",
                    tone: "danger",
                    onConfirm: () => updateData(() => deleteRack(data, rackId), "Rack 已删除"),
                  });
                }}
              />
              {hasSupabaseEnv ? (
                <div className="px-4 pb-4 md:px-6 lg:px-7">
                  <div className="mx-auto max-w-[1160px]">
                    <SignOutPanel />
                  </div>
                </div>
              ) : null}
            </>
          )}
        </section>
      </div>

      {successMessage ? <SuccessToast message={successMessage} onDismiss={() => setSuccessMessage(null)} /> : null}
      {actionError ? <ActionErrorToast message={actionError} onDismiss={() => setActionError(null)} /> : null}

      <BottomNavigation
        appMode={appMode}
        isSaving={isSaving}
        onChangeMode={setAppMode}
        onAddInventory={() => {
          setActionError(null);
          setAddOpen(true);
        }}
      />

      {addOpen && selectedSlot ? (
        <AddInventoryDialog
          slot={selectedSlot}
          slots={rackSlots}
          isSaving={isSaving}
          errorMessage={actionError}
          onClose={() => {
            setActionError(null);
            setAddOpen(false);
          }}
          onSave={async (input) => {
            try {
              const targetSlot = rackSlots.find((entry) => entry.id === input.slotId);
              await updateData(() => addInventory(data, input), `已添加到 ${targetSlot?.code ?? "Slot"}`);
              setAddOpen(false);
            } catch {
              // The dialog renders the error message from updateData.
            }
          }}
        />
      ) : null}

      {moveOpen && selectedSlot ? (
        <MoveInventoryDialog
          inventory={slotInventory}
          slots={rackSlots}
          currentSlot={selectedSlot}
          isSaving={isSaving}
          onClose={() => setMoveOpen(false)}
          onMove={async (inventoryId, targetSlotId, quantity) => {
            const targetSlot = rackSlots.find((entry) => entry.id === targetSlotId);
            await updateData(() => moveInventory(data, inventoryId, targetSlotId, quantity), `已移动到 ${targetSlot?.code ?? "目标 Slot"}`);
            setSelectedSlotId(targetSlotId);
            setMoveOpen(false);
          }}
        />
      ) : null}

      {renameOpen && selectedSection ? (
        <RenameSectionDialog
          section={selectedSection}
          onClose={() => setRenameOpen(false)}
          onSave={async (name) => {
            await updateData(() => renameSection(data, selectedSection.id, name), "分区名称已保存");
            setRenameOpen(false);
          }}
        />
      ) : null}

      {renameRackOpen && rack ? (
        <RenameRackDialog
          rackName={rack.name}
          onClose={() => setRenameRackOpen(false)}
          onSave={async (name) => {
            await updateData(() => renameRack(data, rack.id, name), "Rack 名称已保存");
            setRenameRackOpen(false);
          }}
        />
      ) : null}

      {createRackOpen ? (
        <CreateRackDialog
          isSaving={isSaving}
          defaultName={`Rack-${data.racks.length + 1}`}
          onClose={() => setCreateRackOpen(false)}
          onSave={async (name) => {
            await updateData(async () => {
              const nextData = await createRack(data, name);
              const createdRack = [...nextData.racks].reverse().find((entry) => entry.name === name);
              if (createdRack) setSelectedRackId(createdRack.id);
              return nextData;
            }, "Rack 已创建");
            setCreateRackOpen(false);
          }}
        />
      ) : null}

      {createSlotOpen ? (
        <CreateSlotDialog
          sections={rackSections}
          defaultSectionId={selectedSection?.id ?? rackSections[0]?.id ?? ""}
          existingSlots={rackSlots}
          isSaving={isSaving}
          onClose={() => setCreateSlotOpen(false)}
          onSave={async (sectionId, code) => {
            await updateData(() => createSlot(data, sectionId, code), "Slot 已创建");
            setCreateSlotOpen(false);
          }}
        />
      ) : null}

      {detailRow ? (
        <InventoryDetailDrawer
          row={detailRow}
          movements={data.movements ?? []}
          isSaving={isSaving}
          onClose={() => setDetailInventoryId(null)}
          onSaveProduct={async (input) => {
            await updateData(() => updateProductDetails(data, detailRow.item.product_id, input), "商品已保存");
          }}
          onChangeQuantity={(delta) => updateQuantity(detailRow.item.id, delta)}
          onArchive={() => {
            setConfirmAction({
              title: "归档这条库存？",
              message: `${detailRow.item.product.name} 会从当前列表隐藏，但操作历史会保留。`,
              confirmLabel: "归档",
              tone: "warning",
              onConfirm: async () => {
                await updateData(() => archiveInventory(data, detailRow.item.id), "库存已归档");
                setDetailInventoryId(null);
              },
            });
          }}
          onDelete={() => {
            setConfirmAction({
              title: "删除这条库存？",
              message: `${detailRow.item.product.name} 会被隐藏并记录到操作历史，页面内不会直接恢复。`,
              confirmLabel: "删除",
              tone: "danger",
              onConfirm: async () => {
                await updateData(() => deleteInventory(data, detailRow.item.id), "库存已删除");
                setDetailInventoryId(null);
              },
            });
          }}
        />
      ) : null}

      {confirmAction ? (
        <ConfirmDialog
          action={confirmAction}
          isSaving={isSaving}
          onClose={() => setConfirmAction(null)}
          onConfirm={async () => {
            try {
              await confirmAction.onConfirm();
              setConfirmAction(null);
            } catch {
              // updateData renders the error toast.
            }
          }}
        />
      ) : null}
    </main>
  );
}

function AppMark() {
  return (
    <div className="grid h-10 w-10 place-items-center rounded-[14px] bg-[var(--accent)] text-sm font-bold text-white">
      SS
    </div>
  );
}

function FullScreenStatus({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <main className="grid min-h-[100dvh] place-items-center bg-[var(--background)] px-4 text-[var(--text)]">
      <section className="w-full max-w-sm rounded-[18px] border border-[var(--border)] bg-white p-5 shadow-[var(--soft-shadow)]">
        <AppMark />
        <h1 className="mt-5 text-xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{subtitle}</p>
      </section>
    </main>
  );
}

function AuthGate() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const signIn = async (mode: "login" | "signup") => {
    if (!supabase || !email.trim() || !password) return;
    setIsSubmitting(true);
    setMessage("");
    const { error } =
      mode === "signup"
        ? await supabase.auth.signUp({ email: email.trim(), password })
        : await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setIsSubmitting(false);
    setMessage(error ? error.message : mode === "signup" ? "账号已创建，如果 Supabase 要求邮箱确认，请先确认邮箱。" : "");
  };

  return (
    <main className="grid min-h-[100dvh] place-items-center bg-[var(--background)] px-4 text-[var(--text)]">
      <section className="w-full max-w-sm rounded-[18px] border border-[var(--border)] bg-white p-5 shadow-[var(--soft-shadow)]">
        <AppMark />
        <h1 className="mt-5 text-xl font-semibold">登录 Smart Shelf</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          这个库存系统只给你自己使用。输入邮箱和密码即可进入。
        </p>
        <label className="mt-5 block text-sm font-medium">邮箱</label>
        <input
          className="mt-2 w-full rounded-[14px] border border-[var(--border)] bg-white px-4 py-3 outline-none focus:border-[var(--accent)]"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
        />
        <label className="mt-4 block text-sm font-medium">密码</label>
        <input
          className="mt-2 w-full rounded-[14px] border border-[var(--border)] bg-white px-4 py-3 outline-none focus:border-[var(--accent)]"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="输入密码"
        />
        <button
          className="mt-4 w-full rounded-[14px] bg-[var(--accent)] px-4 py-3 font-semibold text-white disabled:opacity-40"
          disabled={!email.trim() || !password || isSubmitting}
          onClick={() => signIn("login")}
        >
          {isSubmitting ? "登录中" : "登录"}
        </button>
        <button
          className="mt-2 w-full rounded-[14px] bg-[var(--surface-soft)] px-4 py-3 text-sm font-semibold text-[var(--muted)] disabled:opacity-40"
          disabled={!email.trim() || !password || isSubmitting}
          onClick={() => signIn("signup")}
        >
          首次使用，创建账号
        </button>
        {message ? <p className="mt-3 text-sm leading-6 text-[var(--muted)]">{message}</p> : null}
      </section>
    </main>
  );
}

function SignOutPanel() {
  return (
    <div className="rounded-[18px] border border-[var(--border)] bg-white p-4 shadow-[var(--soft-shadow)]">
      <button
        className="w-full rounded-[14px] bg-[var(--surface-soft)] px-4 py-3 text-sm font-semibold text-[var(--muted)]"
        onClick={() => supabase?.auth.signOut()}
      >
        退出登录
      </button>
    </div>
  );
}

function TopBar({
  racks,
  selectedRackId,
  isSaving,
  userLabel,
  totalInventory,
  activeSlots,
  totalSlots,
  query,
  filterMode,
  results,
  onQueryChange,
  onFilterChange,
  onSelectResult,
  onSelectRack,
}: {
  racks: Array<{ id: string; name: string }>;
  selectedRackId: string;
  isSaving: boolean;
  userLabel: string;
  totalInventory: number;
  activeSlots: number;
  totalSlots: number;
  query: string;
  filterMode: FilterMode;
  results: InventoryRowData[];
  onQueryChange: (query: string) => void;
  onFilterChange: (filterMode: FilterMode) => void;
  onSelectResult: (slot?: Slot, section?: Section) => void;
  onSelectRack: (rackId: string) => void;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--background)]/92 px-3 py-2 backdrop-blur md:px-6 lg:px-7">
      <div className="relative mx-auto max-w-[1480px]">
        <div className="grid min-w-0 grid-cols-[96px_minmax(0,1fr)_82px] gap-2 sm:grid-cols-[minmax(140px,220px)_minmax(0,1fr)_120px]">
          <select
            className="min-h-10 min-w-0 rounded-[12px] border border-[var(--border)] bg-white px-2 text-xs font-semibold outline-none focus:border-[var(--accent)] sm:px-3 sm:text-sm"
            value={selectedRackId}
            onChange={(event) => onSelectRack(event.target.value)}
            aria-label="选择 Rack"
          >
            {racks.map((rack) => (
              <option key={rack.id} value={rack.id}>
                {rack.name}
              </option>
            ))}
          </select>
          <input
            className="min-h-10 min-w-0 rounded-[12px] border border-[var(--border)] bg-white/95 px-3 text-sm outline-none focus:border-[var(--accent)]"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="搜索商品或 Slot"
          />
          <select
            className="min-h-10 min-w-0 rounded-[12px] border border-[var(--border)] bg-white px-2 text-xs font-semibold outline-none focus:border-[var(--accent)] sm:px-3 sm:text-sm"
            value={filterMode}
            onChange={(event) => onFilterChange(event.target.value as FilterMode)}
            aria-label="筛选库存"
          >
            <option value="all">全部</option>
            <option value="inStock">有货</option>
            <option value="lowStock">低库存</option>
            <option value="missingImage">缺图片</option>
          </select>
        </div>
        <p className="mt-1 truncate px-1 text-[11px] text-[var(--muted)]">
          {quantityFormatter.format(totalInventory)} 件 · {activeSlots}/{totalSlots || 0} 位置有货 ·{" "}
          {isSaving ? "保存中" : userLabel}
        </p>
        {query.trim() ? (
          <div className="absolute inset-x-0 top-[calc(100%+8px)] z-40 rounded-[14px] border border-[var(--border)] bg-white p-2 shadow-[var(--shadow)]">
            {results.length ? (
              <div className="max-h-56 space-y-1 overflow-auto">
                {results.slice(0, 8).map(({ item, slot, section, rack }) => (
                  <button
                    key={item.id}
                    className="flex w-full min-w-0 items-center justify-between gap-3 rounded-[12px] px-3 py-2 text-left hover:bg-[var(--surface-soft)]"
                    onClick={() => onSelectResult(slot, section)}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{item.product.name}</span>
                      <span className="block truncate text-xs text-[var(--muted)]">
                        {rack?.name ?? "Rack-1"} / {section?.code} {section?.name} / {slot?.code}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm font-semibold">{item.quantity} 件</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="px-3 py-2 text-sm text-[var(--muted)]">没有匹配结果</p>
            )}
          </div>
        ) : null}
      </div>
    </header>
  );
}

function BottomNavigation({
  appMode,
  isSaving,
  onChangeMode,
  onAddInventory,
}: {
  appMode: AppMode;
  isSaving: boolean;
  onChangeMode: (mode: AppMode) => void;
  onAddInventory: () => void;
}) {
  const items: Array<[AppMode, string]> = [
    ["table", "库存"],
    ["gallery", "图片"],
    ["admin", "后台"],
  ];

  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-[var(--border)] bg-white/92 px-3 pb-[calc(env(safe-area-inset-bottom)+10px)] pt-2 shadow-[0_-12px_35px_rgb(17_17_19_/_0.08)] backdrop-blur">
      <div className="relative mx-auto grid w-full max-w-md grid-cols-[minmax(0,1fr)_64px_minmax(0,1fr)] items-end gap-1.5">
        <div className="grid min-w-0 grid-cols-2 gap-1">
          {items.slice(0, 2).map(([mode, label]) => (
            <button
              key={mode}
              className="min-w-0 rounded-[14px] px-2 py-2 text-xs font-semibold"
              style={{
                background: appMode === mode ? "var(--accent-soft)" : "transparent",
                color: appMode === mode ? "var(--accent-deep)" : "var(--muted)",
              }}
              onClick={() => onChangeMode(mode)}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[var(--accent)] text-center text-[10px] font-bold leading-tight text-white shadow-[0_10px_24px_rgb(216_77_36_/_0.32)] disabled:opacity-60"
          disabled={isSaving}
          onClick={onAddInventory}
          aria-label="拍照加库存"
        >
          拍照
          <br />
          加库存
        </button>
        <div className="grid min-w-0 grid-cols-1 gap-1">
          {items.slice(2).map(([mode, label]) => (
            <button
              key={mode}
              className="min-w-0 rounded-[14px] px-2 py-2 text-xs font-semibold"
              style={{
                background: appMode === mode ? "var(--accent-soft)" : "transparent",
                color: appMode === mode ? "var(--accent-deep)" : "var(--muted)",
              }}
              onClick={() => onChangeMode(mode)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </nav>
  );
}

function ActionErrorToast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+86px)] z-[90] px-3">
      <div className="pointer-events-auto mx-auto flex max-w-md items-start justify-between gap-3 rounded-[16px] border border-[var(--danger)] bg-[var(--danger-soft)] px-4 py-3 text-sm text-[var(--danger)] shadow-[var(--shadow)]">
        <p className="min-w-0 leading-5">{message}</p>
        <button className="shrink-0 rounded-full px-2 font-semibold" onClick={onDismiss} aria-label="关闭错误提示">
          ×
        </button>
      </div>
    </div>
  );
}

function SuccessToast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onDismiss, 2200);
    return () => window.clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+86px)] z-[90] px-3">
      <div className="pointer-events-auto mx-auto flex max-w-md items-center justify-between gap-3 rounded-[16px] border border-[var(--success)] bg-[var(--success-soft)] px-4 py-3 text-sm text-[var(--success)] shadow-[var(--shadow)]">
        <p className="min-w-0 font-semibold">{message}</p>
        <button className="shrink-0 rounded-full px-2 font-semibold" onClick={onDismiss} aria-label="关闭成功提示">
          ×
        </button>
      </div>
    </div>
  );
}

function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-[12px] bg-[var(--surface-soft)] px-2 py-2 sm:px-3">
      <p className="truncate text-[11px] text-[var(--muted)]">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold">{value}</p>
    </div>
  );
}

function PanelTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <p className="text-sm text-[var(--muted)]">{subtitle}</p>
      <h2 className="mt-1 text-[22px] font-semibold tracking-normal">{title}</h2>
    </div>
  );
}

function InventoryTablePanel({
  rackName,
  rows,
  slots,
  isReady,
  filterMode,
  onSelectRow,
  onOpenDetail,
  onChangeQuantity,
  onMoveInventory,
  onOpenAdd,
  onArchive,
  onDelete,
}: {
  rackName: string;
  rows: InventoryRowData[];
  slots: Slot[];
  isReady: boolean;
  filterMode: FilterMode;
  onSelectRow: (slot?: Slot, section?: Section) => void;
  onOpenDetail: (inventoryId: string) => void;
  onChangeQuantity: (inventoryId: string, delta: number) => void;
  onMoveInventory: (inventoryId: string, targetSlotId: string) => void;
  onOpenAdd: () => void;
  onArchive: (inventoryId: string) => void;
  onDelete: (inventoryId: string) => void;
}) {
  const totalQuantity = rows.reduce((total, row) => total + row.item.quantity, 0);
  const lowCount = rows.filter((row) => row.item.quantity > 0 && row.item.quantity <= 2).length;
  const missingImage = rows.filter((row) => !row.item.product.image).length;

  return (
    <section className="min-w-0 overflow-hidden rounded-[18px] border border-[var(--border)] bg-white shadow-[var(--soft-shadow)]">
      <div className="border-b border-[var(--border)] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <PanelTitle title="库存总表" subtitle={`${rackName} / 按商品和位置管理`} />
        </div>
        <div className="mt-4 grid min-w-0 grid-cols-3 gap-2">
          <MetricPill label="当前显示" value={`${rows.length} 条`} />
          <MetricPill label="总数量" value={`${quantityFormatter.format(totalQuantity)} 件`} />
          <MetricPill label="异常" value={`${lowCount + missingImage} 条`} />
        </div>
      </div>

      <div className="divide-y divide-[var(--border)] lg:hidden">
        {!isReady ? (
          <div className="p-4">
            <SkeletonRows />
          </div>
        ) : rows.length ? (
          rows.map(({ item, slot, section }) => (
            <InventoryMobileCard
              key={item.id}
              item={item}
              slot={slot}
              section={section}
              slots={slots}
              onOpenDetail={onOpenDetail}
              onChangeQuantity={onChangeQuantity}
              onMoveInventory={onMoveInventory}
              onArchive={onArchive}
              onDelete={onDelete}
            />
          ))
        ) : (
          <div className="p-4">
            <EmptySlotState slotCode="库存总表" filterMode={filterMode} onOpenAdd={onOpenAdd} />
          </div>
        )}
      </div>

      <div className="hidden overflow-x-auto lg:block">
        <div className="min-w-[900px]">
          <div className="grid grid-cols-[minmax(220px,1.25fr)_120px_96px_120px_150px_170px] bg-[var(--surface-soft)] px-4 py-2 text-xs font-medium text-[var(--muted)]">
            <span>商品</span>
            <span>位置</span>
            <span className="text-right">数量</span>
            <span>状态</span>
            <span>移动到</span>
            <span className="text-right">操作</span>
          </div>
          {!isReady ? (
            <div className="p-4">
              <SkeletonRows />
            </div>
          ) : rows.length ? (
            rows.map(({ item, slot, section }) => (
              <InventoryTableRow
                key={item.id}
                item={item}
                slot={slot}
                section={section}
                onSelect={() => onSelectRow(slot, section)}
                slots={slots}
                onOpenDetail={onOpenDetail}
                onChangeQuantity={onChangeQuantity}
                onMoveInventory={onMoveInventory}
                onArchive={onArchive}
                onDelete={onDelete}
              />
            ))
          ) : (
            <div className="p-4">
              <EmptySlotState slotCode="库存总表" filterMode={filterMode} onOpenAdd={onOpenAdd} />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function InventoryTableRow({
  item,
  slot,
  section,
  slots,
  onSelect,
  onOpenDetail,
  onChangeQuantity,
  onMoveInventory,
  onArchive,
  onDelete,
}: {
  item: Inventory;
  slot?: Slot;
  section?: Section;
  slots: Slot[];
  onSelect: () => void;
  onOpenDetail: (inventoryId: string) => void;
  onChangeQuantity: (inventoryId: string, delta: number) => void;
  onMoveInventory: (inventoryId: string, targetSlotId: string) => void;
  onArchive: (inventoryId: string) => void;
  onDelete: (inventoryId: string) => void;
}) {
  const tone = getStockTone(item.quantity);

  return (
    <div className="grid grid-cols-[minmax(220px,1.25fr)_120px_96px_120px_150px_170px] items-center border-t border-[var(--border)] px-4 py-3 text-sm">
      <button className="flex min-w-0 items-center gap-3 text-left" onClick={() => onOpenDetail(item.id)}>
        <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-[10px] bg-[var(--surface-soft)] text-xs font-semibold text-[var(--muted)]">
          <ProductImage src={item.product.image} />
        </div>
        <span className="min-w-0">
          <span className="block truncate font-semibold">{item.product.name}</span>
          <span className="mt-1 block truncate text-xs text-[var(--muted)]">{item.product.image ? "已上传图片" : "缺图片"}</span>
        </span>
      </button>
      <button className="text-left font-semibold text-[var(--accent-deep)]" onClick={onSelect}>
        {section?.code ?? "-"} / {slot?.code ?? "-"}
      </button>
      <div className="flex items-center justify-end gap-1">
        <button
          className="grid h-8 w-8 place-items-center rounded-full bg-[var(--surface-soft)] text-base disabled:opacity-35"
          onClick={() => onChangeQuantity(item.id, -1)}
          disabled={item.quantity <= 0}
          aria-label="减少"
        >
          −
        </button>
        <span className="min-w-8 text-center font-semibold">{item.quantity}</span>
        <button
          className="grid h-8 w-8 place-items-center rounded-full bg-[var(--accent)] text-base text-white"
          onClick={() => onChangeQuantity(item.id, 1)}
          aria-label="增加"
        >
          +
        </button>
      </div>
      <StockBadge tone={tone} label={getStockLabel(item.quantity)} />
      <select
        className="w-full rounded-[10px] border border-[var(--border)] bg-white px-2 py-2 text-xs outline-none focus:border-[var(--accent)]"
        value={slot?.id ?? ""}
        onChange={(event) => onMoveInventory(item.id, event.target.value)}
      >
        {[...slots].sort((left, right) => left.code.localeCompare(right.code)).map((targetSlot) => (
          <option key={targetSlot.id} value={targetSlot.id}>
            {targetSlot.code}
          </option>
        ))}
      </select>
      <div className="flex justify-end gap-1">
        <button className="rounded-full px-3 py-1.5 text-xs text-[var(--muted)] hover:bg-[var(--surface-soft)]" onClick={() => onOpenDetail(item.id)}>
          查看
        </button>
        <button className="rounded-full px-3 py-1.5 text-xs text-[var(--muted)] hover:bg-[var(--surface-soft)]" onClick={() => onArchive(item.id)}>
          归档
        </button>
        <button className="rounded-full px-3 py-1.5 text-xs text-[var(--danger)] hover:bg-[var(--danger-soft)]" onClick={() => onDelete(item.id)}>
          删除
        </button>
      </div>
    </div>
  );
}

function InventoryMobileCard({
  item,
  slot,
  section,
  slots,
  onOpenDetail,
  onChangeQuantity,
  onMoveInventory,
  onArchive,
  onDelete,
}: {
  item: Inventory;
  slot?: Slot;
  section?: Section;
  slots: Slot[];
  onOpenDetail: (inventoryId: string) => void;
  onChangeQuantity: (inventoryId: string, delta: number) => void;
  onMoveInventory: (inventoryId: string, targetSlotId: string) => void;
  onArchive: (inventoryId: string) => void;
  onDelete: (inventoryId: string) => void;
}) {
  const tone = getStockTone(item.quantity);

  return (
    <article className="min-w-0 p-3 sm:p-4">
      <div className="flex min-w-0 gap-3">
        <button
          className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-[14px] bg-[var(--surface-soft)] text-xs font-semibold text-[var(--muted)] sm:h-20 sm:w-20"
          onClick={() => onOpenDetail(item.id)}
        >
          {item.product.image ? (
            <ProductImage src={item.product.image} />
          ) : (
            "照片"
          )}
        </button>
        <div className="min-w-0 flex-1 overflow-hidden">
          <div className="flex min-w-0 items-start justify-between gap-2">
            <button className="min-w-0 text-left" onClick={() => onOpenDetail(item.id)}>
              <p className="truncate text-base font-semibold">{item.product.name}</p>
              <p className="mt-1 text-xs text-[var(--muted)]">{section?.code ?? "-"} / {slot?.code ?? "-"}</p>
            </button>
            <span className="shrink-0">
              <StockBadge tone={tone} label={getStockLabel(item.quantity)} />
            </span>
          </div>

          <div className="mt-3 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-[auto_minmax(0,1fr)]">
            <div className="flex items-center gap-1 rounded-full bg-[var(--surface-soft)] p-1">
              <button
                className="grid h-8 w-8 place-items-center rounded-full bg-white text-base disabled:opacity-35"
                onClick={() => onChangeQuantity(item.id, -1)}
                disabled={item.quantity <= 0}
                aria-label="减少"
              >
                −
              </button>
              <span className="min-w-8 text-center text-sm font-semibold">{item.quantity}</span>
              <button
                className="grid h-8 w-8 place-items-center rounded-full bg-[var(--accent)] text-base text-white"
                onClick={() => onChangeQuantity(item.id, 1)}
                aria-label="增加"
              >
                +
              </button>
            </div>
            <select
              className="w-full min-w-0 rounded-[12px] border border-[var(--border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
              value={slot?.id ?? ""}
              onChange={(event) => onMoveInventory(item.id, event.target.value)}
            >
              {[...slots].sort((left, right) => left.code.localeCompare(right.code)).map((targetSlot) => (
                <option key={targetSlot.id} value={targetSlot.id}>
                  {targetSlot.code}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-3 flex min-w-0 flex-wrap gap-1">
            <button className="rounded-full px-3 py-1.5 text-xs text-[var(--muted)] hover:bg-[var(--surface-soft)]" onClick={() => onOpenDetail(item.id)}>
              查看
            </button>
            <button className="rounded-full px-3 py-1.5 text-xs text-[var(--muted)] hover:bg-[var(--surface-soft)]" onClick={() => onArchive(item.id)}>
              归档
            </button>
            <button className="rounded-full px-3 py-1.5 text-xs text-[var(--danger)] hover:bg-[var(--danger-soft)]" onClick={() => onDelete(item.id)}>
              删除
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

function ProductGalleryPage({
  rows,
  onOpenDetail,
}: {
  rows: InventoryRowData[];
  onOpenDetail: (inventoryId: string) => void;
}) {
  return (
    <section className="min-w-0 px-3 py-3 sm:px-4 md:px-6 lg:px-7 lg:py-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <PanelTitle title="图片视图" subtitle="通过商品图快速确认位置" />
        <span className="rounded-full bg-white px-3 py-2 text-xs font-semibold text-[var(--muted)]">{rows.length} 个库存记录</span>
      </div>
      {rows.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {rows.map(({ item, slot, section, rack }) => (
            <button
              key={item.id}
              className="min-w-0 overflow-hidden rounded-[16px] border border-[var(--border)] bg-white text-left shadow-[var(--soft-shadow)] transition hover:-translate-y-0.5"
              onClick={() => onOpenDetail(item.id)}
            >
              <div className="grid aspect-[4/3] place-items-center bg-[var(--surface-soft)] text-sm font-semibold text-[var(--muted)]">
                {item.product.image ? (
                  <ProductImage src={item.product.image} emptyLabel="暂无图片" />
                ) : (
                  "暂无图片"
                )}
              </div>
              <div className="p-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 truncate text-sm font-semibold">{item.product.name}</p>
                  <span className="shrink-0 rounded-full bg-[var(--surface-soft)] px-2 py-1 text-xs font-semibold">{item.quantity}</span>
                </div>
                <p className="mt-2 text-xs text-[var(--muted)]">
                  {rack?.name ?? "Rack"} / {section?.code ?? "-"} / {slot?.code ?? "-"}
                </p>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="rounded-[18px] border border-dashed border-[var(--border)] bg-white p-8 text-center text-sm text-[var(--muted)]">
          当前筛选下没有商品
        </div>
      )}
    </section>
  );
}

function AdminPanel({
  data,
  activeRack,
  activeSections,
  activeSlots,
  activeInventory,
  movements,
  isSaving,
  onCreateRack,
  onRenameRack,
  onCreateSlot,
  onImportCsv,
  onDeleteSlot,
  onDeleteRack,
}: {
  data: ShelfData;
  activeRack?: { id: string; name: string };
  activeSections: Section[];
  activeSlots: Slot[];
  activeInventory: Inventory[];
  movements: InventoryMovement[];
  isSaving: boolean;
  onCreateRack: () => void;
  onRenameRack: () => void;
  onCreateSlot: () => void;
  onImportCsv: (file: File) => void;
  onDeleteSlot: (slotId: string) => void;
  onDeleteRack: (rackId: string) => void;
}) {
  const productIds = new Set(activeInventory.map((item) => item.product_id));
  const lowStock = activeInventory.filter((item) => item.quantity > 0 && item.quantity <= 2);
  const missingImage = activeInventory.filter((item) => !item.product.image);
  const emptySlots = activeSlots.filter((slot) => !activeInventory.some((item) => item.slot_id === slot.id));
  const zeroQuantity = activeInventory.filter((item) => item.quantity === 0);
  const orphanInventory = activeInventory.filter((item) => !activeSlots.some((slot) => slot.id === item.slot_id));
  const activeKeys = new Map<string, number>();
  activeInventory.forEach((item) => {
    const key = `${item.product_id}:${item.slot_id}`;
    activeKeys.set(key, (activeKeys.get(key) ?? 0) + 1);
  });
  const duplicateActive = [...activeKeys.values()].filter((count) => count > 1).length;
  const healthItems = [
    { label: "空 Slot", value: emptySlots.length, tone: emptySlots.length > 12 ? "warning" : "normal" },
    { label: "0 库存", value: zeroQuantity.length, tone: zeroQuantity.length ? "warning" : "normal" },
    { label: "重复活跃记录", value: duplicateActive, tone: duplicateActive ? "danger" : "normal" },
    { label: "位置异常", value: orphanInventory.length, tone: orphanInventory.length ? "danger" : "normal" },
  ] as const;
  const totalQuantity = activeInventory.reduce((total, item) => total + item.quantity, 0);
  const rackDiagnostics = data.racks.map((rack) => {
    const sections = data.sections.filter((section) => section.rack_id === rack.id);
    const sectionIds = new Set(sections.map((section) => section.id));
    const slots = data.slots.filter((slot) => sectionIds.has(slot.section_id));
    const slotIds = new Set(slots.map((slot) => slot.id));
    const inventory = data.inventory.filter((item) => slotIds.has(item.slot_id));
    const quantity = inventory.reduce((total, item) => total + item.quantity, 0);

    return {
      rack,
      sections,
      slots,
      inventory,
      quantity,
    };
  });

  return (
    <div className="flex-1 px-4 py-4 md:px-6 lg:px-7 lg:py-6">
      <div className="mx-auto max-w-[1160px] space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <PanelTitle title="维护" subtitle="Rack / Slot / 导入 / 数据健康" />
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <AdminMetric label="当前 Rack" value={activeRack?.name ?? "Rack-1"} detail={`${activeSections.length} 区 / ${activeSlots.length} Slot`} />
          <AdminMetric label="库存总数" value={`${quantityFormatter.format(totalQuantity)} 件`} detail={`${activeInventory.length} 条库存记录`} />
          <AdminMetric label="商品数" value={`${productIds.size}`} detail="按 Product 去重" />
          <AdminMetric label="低库存" value={`${lowStock.length}`} detail="数量 1-2 的记录" tone={lowStock.length ? "warning" : "normal"} />
          <AdminMetric label="缺图片" value={`${missingImage.length}`} detail="需要补图的商品" tone={missingImage.length ? "danger" : "normal"} />
        </div>

        <section className="rounded-[18px] border border-[var(--border)] bg-white p-4 shadow-[var(--soft-shadow)]">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">数据健康</h2>
            <span className="text-xs text-[var(--muted)]">当前 Rack</span>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-4">
            {healthItems.map((item) => (
              <div
                key={item.label}
                className="rounded-[14px] border border-[var(--border)] px-3 py-3"
                style={{
                  background:
                    item.tone === "danger"
                      ? "var(--danger-soft)"
                      : item.tone === "warning"
                        ? "var(--warning-soft)"
                        : "var(--surface-soft)",
                }}
              >
                <p className="text-xs text-[var(--muted)]">{item.label}</p>
                <p className="mt-1 text-lg font-semibold">{item.value}</p>
              </div>
            ))}
          </div>
        </section>

        <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
          <section className="rounded-[18px] border border-[var(--border)] bg-white p-4 shadow-[var(--soft-shadow)]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">货架管理</h2>
                <p className="mt-1 text-sm text-[var(--muted)]">Rack 可以代表货架、箱子、地面区域或任何收纳位置。</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-[var(--surface-soft)] px-3 py-1.5 text-xs text-[var(--muted)]">
                  共 {data.racks.length} 个 Rack
                </span>
                <button
                  className="rounded-[12px] bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-white"
                  onClick={onCreateRack}
                >
                  新建 Rack
                </button>
                <button
                  className="rounded-[12px] border border-[var(--border)] bg-white px-3 py-2 text-xs font-semibold text-[var(--muted)]"
                  onClick={onRenameRack}
                >
                  当前改名
                </button>
              </div>
            </div>

            <div className="mt-4 overflow-hidden rounded-[14px] border border-[var(--border)]">
              <div className="grid grid-cols-[1fr_70px_70px_86px_78px] bg-[var(--surface-soft)] px-3 py-2 text-xs font-medium text-[var(--muted)]">
                <span>Rack</span>
                <span>Section</span>
                <span>Slot</span>
                <span className="text-right">库存</span>
                <span className="text-right">操作</span>
              </div>
              {rackDiagnostics.map(({ rack, sections, slots, quantity }) => (
                <div
                  key={rack.id}
                  className="grid grid-cols-[1fr_70px_70px_86px_78px] items-center border-t border-[var(--border)] px-3 py-3 text-sm"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{rack.name}</span>
                    <span className="mt-1 block truncate text-xs text-[var(--muted)]">
                      {rack.id === activeRack?.id ? "当前 Rack" : "未选中"}
                    </span>
                  </span>
                  <span>{sections.length}</span>
                  <span>{slots.length}</span>
                  <span className="text-right font-semibold">{quantity}</span>
                  <span className="text-right">
                    <button
                      className="rounded-full px-3 py-1.5 text-xs font-semibold text-[var(--danger)] hover:bg-[var(--danger-soft)] disabled:cursor-not-allowed disabled:opacity-35"
                      disabled={data.racks.length <= 1}
                      onClick={() => onDeleteRack(rack.id)}
                    >
                      删除
                    </button>
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-[18px] border border-[var(--border)] bg-white p-4 shadow-[var(--soft-shadow)]">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">位置管理</h2>
              <span className="rounded-full bg-[var(--accent-soft)] px-3 py-1.5 text-xs font-semibold text-[var(--accent-deep)]">
                {activeRack?.name ?? "Rack-1"}
              </span>
            </div>
            <button className="mt-4 w-full rounded-[14px] bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white" onClick={onCreateSlot}>
              新增自定义 Slot
            </button>
            <div className="mt-4 space-y-3">
              {activeSections.map((section) => {
                const sectionSlots = activeSlots.filter((slot) => slot.section_id === section.id);

                return (
                  <div key={section.id} className="rounded-[14px] bg-[var(--surface-soft)] p-3">
                    <p className="text-sm font-semibold">{section.code} {section.name}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {sectionSlots.map((slot) => {
                        const count = activeInventory.filter((item) => item.slot_id === slot.id).length;
                        return (
                          <button
                            key={slot.id}
                            className="rounded-full border border-[var(--border)] bg-white px-2.5 py-1 text-xs"
                            onClick={() => {
                              if (!count) onDeleteSlot(slot.id);
                            }}
                            title={count ? "有库存，不能直接删除" : "点击删除空 Slot"}
                          >
                            {slot.code} · {count}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        <div className="grid gap-5 xl:grid-cols-[1fr_390px]">
          <AdminList
            title="低库存"
            empty="当前没有低库存记录"
            items={lowStock.map((item) => ({
              id: item.id,
              title: item.product.name,
              meta: `${slotLabelForInventory(item, data)} / ${item.quantity} 件`,
            }))}
          />
          <AdminList
            title="缺图片"
            empty="当前没有缺图片商品"
            items={missingImage.map((item) => ({
              id: item.id,
              title: item.product.name,
              meta: `${slotLabelForInventory(item, data)} / ${item.quantity} 件`,
            }))}
          />
        </div>

        <section className="rounded-[18px] border border-[var(--border)] bg-white p-4 shadow-[var(--soft-shadow)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">批量导入</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">CSV 字段：product、quantity、slot、image</p>
            </div>
            <label className="rounded-[14px] bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white">
              {isSaving ? "导入中" : "选择 CSV"}
              <input
                className="sr-only"
                type="file"
                accept=".csv,text/csv"
                disabled={isSaving}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) onImportCsv(file);
                }}
              />
            </label>
          </div>
        </section>

        <section className="rounded-[18px] border border-[var(--border)] bg-white p-4 shadow-[var(--soft-shadow)]">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">最近移动和整理</h2>
            <span className="text-xs text-[var(--muted)]">{movements.length} 条</span>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {movements.length ? (
              movements.slice(0, 12).map((movement) => (
                <div key={movement.id} className="rounded-[14px] bg-[var(--surface-soft)] px-3 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="truncate text-sm font-semibold">{movement.product_name}</p>
                    <span className="shrink-0 text-xs text-[var(--muted)]">{formatMovementAction(movement.action)}</span>
                  </div>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {movement.from_slot_code ?? "无"} → {movement.to_slot_code ?? "无"} · {movement.quantity_snapshot} 件 ·{" "}
                    {formatTime(movement.created_at)}
                  </p>
                </div>
              ))
            ) : (
              <p className="rounded-[14px] bg-[var(--surface-soft)] px-3 py-3 text-sm text-[var(--muted)]">
                还没有移动、归档或删除记录
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function AdminMetric({
  label,
  value,
  detail,
  tone = "normal",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "normal" | "warning" | "danger";
}) {
  const background = tone === "danger" ? "var(--danger-soft)" : tone === "warning" ? "var(--warning-soft)" : "#fff";

  return (
    <div className="rounded-[18px] border border-[var(--border)] p-4 shadow-[var(--soft-shadow)]" style={{ background }}>
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <p className="mt-2 truncate text-2xl font-semibold">{value}</p>
      <p className="mt-2 text-xs text-[var(--muted)]">{detail}</p>
    </div>
  );
}

function AdminList({
  title,
  empty,
  items,
}: {
  title: string;
  empty: string;
  items: Array<{ id: string; title: string; meta: string }>;
}) {
  return (
    <section className="rounded-[18px] border border-[var(--border)] bg-white p-4 shadow-[var(--soft-shadow)]">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">{title}</h2>
        <span className="text-xs text-[var(--muted)]">{items.length} 条</span>
      </div>
      <div className="mt-3 space-y-2">
        {items.length ? (
          items.slice(0, 8).map((item) => (
            <div key={item.id} className="rounded-[14px] bg-[var(--surface-soft)] px-3 py-2">
              <p className="truncate text-sm font-semibold">{item.title}</p>
              <p className="mt-1 text-xs text-[var(--muted)]">{item.meta}</p>
            </div>
          ))
        ) : (
          <p className="rounded-[14px] bg-[var(--surface-soft)] px-3 py-3 text-sm text-[var(--muted)]">{empty}</p>
        )}
      </div>
    </section>
  );
}

function EmptySlotState({
  slotCode,
  filterMode,
  onOpenAdd,
}: {
  slotCode: string;
  filterMode: FilterMode;
  onOpenAdd: () => void;
}) {
  const isFiltered = filterMode !== "all";
  return (
    <div className="rounded-[14px] border border-dashed border-[var(--border)] bg-[var(--background)] p-6 text-center">
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-[14px] bg-white text-sm font-semibold text-[var(--muted)]">
        {slotCode}
      </div>
      <p className="mt-4 font-semibold">{isFiltered ? "当前筛选下没有库存" : "这个 Slot 还没有库存"}</p>
      <p className="mx-auto mt-2 max-w-[260px] text-sm leading-6 text-[var(--muted)]">
        {isFiltered ? "切回全部，或添加一条符合条件的库存记录。" : "添加后，商品只会记录在这个 Slot 容器里。"}
      </p>
      <button
        className="mt-4 rounded-[14px] bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white active:scale-95"
        onClick={onOpenAdd}
      >
        添加库存
      </button>
    </div>
  );
}

function StockBadge({ tone, label }: { tone: StockTone; label: string }) {
  return (
    <span
      className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{
        background: getStockSoftColor(tone),
        color: getStockColor(tone),
      }}
    >
      {label}
    </span>
  );
}

function SkeletonRows() {
  return (
    <>
      {[1, 2, 3].map((item) => (
        <div key={item} className="h-28 animate-pulse rounded-[14px] bg-[var(--surface-soft)]" />
      ))}
    </>
  );
}

function ProductImage({ src, emptyLabel = "照片" }: { src?: string | null; emptyLabel?: string }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (src && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt="" className="h-full w-full object-cover" onError={() => setFailed(true)} />
    );
  }

  return <span className="px-2 text-center">{src ? "图片失效" : emptyLabel}</span>;
}

function SlotPicker({
  slots,
  selectedSlotId,
  onSelectSlot,
  excludeSlotId,
}: {
  slots: Slot[];
  selectedSlotId: string;
  onSelectSlot: (slotId: string) => void;
  excludeSlotId?: string;
}) {
  const [query, setQuery] = useState("");
  const visibleSlots = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return slots
      .filter((slot) => slot.id !== excludeSlotId)
      .filter((slot) => slot.code.toLowerCase().includes(normalized))
      .sort((left, right) => left.code.localeCompare(right.code));
  }, [excludeSlotId, query, slots]);

  return (
    <div>
      <input
        className="w-full rounded-[14px] border border-[var(--border)] bg-white px-4 py-3 text-sm outline-none focus:border-[var(--accent)]"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="搜索 Slot"
      />
      <div className="mt-3 grid max-h-[38dvh] grid-cols-3 gap-2 overflow-auto pr-1 sm:grid-cols-4">
        {visibleSlots.map((slot) => (
          <button
            key={slot.id}
            className="min-w-0 rounded-[12px] border px-3 py-2 text-sm font-semibold"
            style={{
              borderColor: selectedSlotId === slot.id ? "var(--accent)" : "var(--border)",
              background: selectedSlotId === slot.id ? "var(--accent-soft)" : "#fff",
              color: selectedSlotId === slot.id ? "var(--accent-deep)" : "var(--text)",
            }}
            onClick={() => onSelectSlot(slot.id)}
          >
            <span className="block truncate">{slot.code}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function AddInventoryDialog({
  slot,
  slots,
  isSaving,
  errorMessage,
  onClose,
  onSave,
}: {
  slot: Slot;
  slots: Slot[];
  isSaving: boolean;
  errorMessage?: string | null;
  onClose: () => void;
  onSave: (input: InventoryInsert) => Promise<void>;
}) {
  const [step, setStep] = useState<"product" | "slot">("product");
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [image, setImage] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [slotId, setSlotId] = useState(slot.id);
  const selectedSlot = slots.find((entry) => entry.id === slotId) ?? slot;
  const canContinue = name.trim() && quantity >= 1;

  return (
    <Dialog title={step === "product" ? "添加库存" : "选择位置"} onClose={onClose}>
      <div className="mb-4 grid grid-cols-2 gap-2 text-xs font-semibold">
        <button
          className="rounded-full px-3 py-2"
          style={{
            background: step === "product" ? "var(--accent-soft)" : "var(--surface-soft)",
            color: step === "product" ? "var(--accent-deep)" : "var(--muted)",
          }}
          onClick={() => setStep("product")}
        >
          1 商品
        </button>
        <button
          className="rounded-full px-3 py-2 disabled:opacity-40"
          style={{
            background: step === "slot" ? "var(--accent-soft)" : "var(--surface-soft)",
            color: step === "slot" ? "var(--accent-deep)" : "var(--muted)",
          }}
          disabled={!canContinue}
          onClick={() => setStep("slot")}
        >
          2 位置
        </button>
      </div>

      {step === "product" ? (
        <>
          <label className="block text-sm font-medium">商品名称</label>
          <input
            className="mt-2 w-full rounded-[14px] border border-[var(--border)] bg-white px-4 py-3 outline-none focus:border-[var(--accent)]"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="例如：新海报"
          />
          <label className="mt-4 block text-sm font-medium">数量</label>
          <input
            className="mt-2 w-full rounded-[14px] border border-[var(--border)] bg-white px-4 py-3 outline-none focus:border-[var(--accent)]"
            type="number"
            min="1"
            value={quantity}
            onChange={(event) => setQuantity(Number(event.target.value))}
          />
          <label className="mt-4 block text-sm font-medium">上传图片</label>
          <input
            className="mt-2 w-full rounded-[14px] border border-[var(--border)] bg-white px-4 py-3 text-sm outline-none file:mr-3 file:rounded-full file:border-0 file:bg-[var(--surface-soft)] file:px-3 file:py-1.5 file:text-sm"
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(event) => setImageFile(event.target.files?.[0] ?? null)}
          />
          <details className="mt-4 rounded-[14px] bg-[var(--surface-soft)] px-3 py-2">
            <summary className="text-sm font-medium text-[var(--muted)]">高级：图片 URL</summary>
            <input
              className="mt-3 w-full rounded-[12px] border border-[var(--border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
              value={image}
              onChange={(event) => setImage(event.target.value)}
              placeholder="可选，上传文件优先"
            />
          </details>
        </>
      ) : (
        <SlotPicker slots={slots} selectedSlotId={slotId} onSelectSlot={setSlotId} />
      )}

      {errorMessage ? (
        <p className="mt-4 rounded-[14px] border border-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">
          {errorMessage}
        </p>
      ) : null}
      <button
        className="mt-5 w-full rounded-[14px] bg-[var(--accent)] px-4 py-3 font-semibold text-white disabled:opacity-40"
        disabled={!canContinue || isSaving}
        onClick={() => {
          if (step === "product") {
            setStep("slot");
            return;
          }
          onSave({
            name: name.trim(),
            quantity: Math.max(1, quantity),
            image: image.trim() || null,
            imageFile,
            slotId: selectedSlot.id,
          });
        }}
      >
        {isSaving ? "保存中" : step === "product" ? `下一步：${selectedSlot.code}` : `添加到 ${selectedSlot.code}`}
      </button>
    </Dialog>
  );
}

function MoveInventoryDialog({
  inventory,
  slots,
  currentSlot,
  isSaving,
  onClose,
  onMove,
}: {
  inventory: Inventory[];
  slots: Slot[];
  currentSlot: Slot;
  isSaving: boolean;
  onClose: () => void;
  onMove: (inventoryId: string, targetSlotId: string, quantity: number) => void;
}) {
  const [inventoryId, setInventoryId] = useState(inventory[0]?.id ?? "");
  const [targetSlotId, setTargetSlotId] = useState(slots.find((slot) => slot.id !== currentSlot.id)?.id ?? "");
  const selectedInventory = inventory.find((item) => item.id === inventoryId);
  const [quantity, setQuantity] = useState(selectedInventory?.quantity ?? 1);

  useEffect(() => {
    setQuantity(selectedInventory?.quantity ?? 1);
  }, [selectedInventory?.id, selectedInventory?.quantity]);

  return (
    <Dialog title="移动库存" onClose={onClose}>
      {inventory.length ? (
        <>
          <p className="mb-4 text-sm leading-6 text-[var(--muted)]">
            这里只移动当前 Slot 里的库存记录，Product 本身不会离开商品库。
          </p>
          <label className="block text-sm font-medium">库存记录</label>
          <select
            className="mt-2 w-full rounded-[14px] border border-[var(--border)] bg-white px-4 py-3 outline-none focus:border-[var(--accent)]"
            value={inventoryId}
            onChange={(event) => setInventoryId(event.target.value)}
          >
            {inventory.map((item) => (
              <option key={item.id} value={item.id}>
                {item.product.name} x{item.quantity}
              </option>
            ))}
          </select>
          <label className="mt-4 block text-sm font-medium">移动数量</label>
          <input
            className="mt-2 w-full rounded-[14px] border border-[var(--border)] bg-white px-4 py-3 outline-none focus:border-[var(--accent)]"
            type="number"
            min="1"
            max={selectedInventory?.quantity ?? 1}
            value={quantity}
            onChange={(event) => setQuantity(Number(event.target.value))}
          />
          <label className="mt-4 block text-sm font-medium">目标 Slot</label>
          <div className="mt-2">
            <SlotPicker
              slots={slots}
              selectedSlotId={targetSlotId}
              excludeSlotId={currentSlot.id}
              onSelectSlot={setTargetSlotId}
            />
          </div>
          <button
            className="mt-5 w-full rounded-[14px] bg-[var(--accent)] px-4 py-3 font-semibold text-white disabled:opacity-40"
            disabled={isSaving || !inventoryId || !targetSlotId || quantity < 1 || quantity > (selectedInventory?.quantity ?? 0)}
            onClick={() => onMove(inventoryId, targetSlotId, quantity)}
          >
            {isSaving ? "移动中" : "移动库存"}
          </button>
        </>
      ) : (
        <div className="rounded-[14px] border border-dashed border-[var(--border)] bg-white p-5 text-center">
          <p className="font-semibold">当前 Slot 没有可移动库存</p>
          <p className="mt-2 text-sm text-[var(--muted)]">先添加库存记录，再移动到其他 Slot。</p>
        </div>
      )}
    </Dialog>
  );
}

function RenameSectionDialog({
  section,
  onClose,
  onSave,
}: {
  section: Section;
  onClose: () => void;
  onSave: (name: string) => void;
}) {
  const [name, setName] = useState(section.name);

  return (
    <Dialog title={`${section.code} 区改名`} onClose={onClose}>
      <p className="mb-4 text-sm text-[var(--muted)]">Code 固定为 {section.code}，这里只改显示名称。</p>
      <input
        className="w-full rounded-[14px] border border-[var(--border)] bg-white px-4 py-3 outline-none focus:border-[var(--accent)]"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <button
        className="mt-5 w-full rounded-[14px] bg-[var(--accent)] px-4 py-3 font-semibold text-white disabled:opacity-40"
        disabled={!name.trim()}
        onClick={() => onSave(name.trim())}
      >
        保存名称
      </button>
    </Dialog>
  );
}

function RenameRackDialog({
  rackName,
  onClose,
  onSave,
}: {
  rackName: string;
  onClose: () => void;
  onSave: (name: string) => void;
}) {
  const [name, setName] = useState(rackName);

  return (
    <Dialog title="Rack 改名" onClose={onClose}>
      <input
        className="w-full rounded-[14px] border border-[var(--border)] bg-white px-4 py-3 outline-none focus:border-[var(--accent)]"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <button
        className="mt-5 w-full rounded-[14px] bg-[var(--accent)] px-4 py-3 font-semibold text-white disabled:opacity-40"
        disabled={!name.trim()}
        onClick={() => onSave(name.trim())}
      >
        保存名称
      </button>
    </Dialog>
  );
}

function CreateRackDialog({
  defaultName,
  isSaving,
  onClose,
  onSave,
}: {
  defaultName: string;
  isSaving: boolean;
  onClose: () => void;
  onSave: (name: string) => void;
}) {
  const [name, setName] = useState(defaultName);

  return (
    <Dialog title="新建 Rack" onClose={onClose}>
      <label className="block text-sm font-medium">Rack 名称</label>
      <input
        className="mt-2 w-full rounded-[14px] border border-[var(--border)] bg-white px-4 py-3 outline-none focus:border-[var(--accent)]"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <button
        className="mt-5 w-full rounded-[14px] bg-[var(--accent)] px-4 py-3 font-semibold text-white disabled:opacity-40"
        disabled={!name.trim() || isSaving}
        onClick={() => onSave(name.trim())}
      >
        {isSaving ? "创建中" : "创建 Rack"}
      </button>
    </Dialog>
  );
}

function CreateSlotDialog({
  sections,
  defaultSectionId,
  existingSlots,
  isSaving,
  onClose,
  onSave,
}: {
  sections: Section[];
  defaultSectionId: string;
  existingSlots: Slot[];
  isSaving: boolean;
  onClose: () => void;
  onSave: (sectionId: string, code: string) => void;
}) {
  const [sectionId, setSectionId] = useState(defaultSectionId);
  const [code, setCode] = useState("");
  const duplicate = existingSlots.some(
    (slot) => slot.section_id === sectionId && slot.code.trim().toLowerCase() === code.trim().toLowerCase(),
  );

  useEffect(() => {
    if (!sectionId && defaultSectionId) setSectionId(defaultSectionId);
  }, [defaultSectionId, sectionId]);

  return (
    <Dialog title="新增 Slot" onClose={onClose}>
      <label className="block text-sm font-medium">所属分区</label>
      <select
        className="mt-2 w-full rounded-[14px] border border-[var(--border)] bg-white px-4 py-3 outline-none focus:border-[var(--accent)]"
        value={sectionId}
        onChange={(event) => setSectionId(event.target.value)}
      >
        {sections.map((section) => (
          <option key={section.id} value={section.id}>
            {section.code} {section.name}
          </option>
        ))}
      </select>
      <label className="mt-4 block text-sm font-medium">Slot 名称</label>
      <input
        className="mt-2 w-full rounded-[14px] border border-[var(--border)] bg-white px-4 py-3 outline-none focus:border-[var(--accent)]"
        value={code}
        onChange={(event) => setCode(event.target.value)}
        placeholder="例如：A-POSTER-01、箱子-1、桌下"
      />
      {duplicate ? <p className="mt-2 text-xs text-[var(--danger)]">这个分区里已经有同名 Slot。</p> : null}
      <button
        className="mt-5 w-full rounded-[14px] bg-[var(--accent)] px-4 py-3 font-semibold text-white disabled:opacity-40"
        disabled={!sectionId || !code.trim() || duplicate || isSaving}
        onClick={() => onSave(sectionId, code.trim())}
      >
        {isSaving ? "创建中" : "创建 Slot"}
      </button>
    </Dialog>
  );
}

function InventoryDetailDrawer({
  row,
  movements,
  isSaving,
  onClose,
  onSaveProduct,
  onChangeQuantity,
  onArchive,
  onDelete,
}: {
  row: InventoryRowData;
  movements: InventoryMovement[];
  isSaving: boolean;
  onClose: () => void;
  onSaveProduct: (input: { name: string; image?: string | null; imageFile?: File | null }) => void;
  onChangeQuantity: (delta: number) => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(row.item.product.name);
  const [image, setImage] = useState(row.item.product.image ?? "");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const relatedMovements = movements.filter(
    (movement) =>
      movement.inventory_id === row.item.id ||
      movement.product_id === row.item.product_id ||
      movement.product_name === row.item.product.name,
  );

  useEffect(() => {
    setName(row.item.product.name);
    setImage(row.item.product.image ?? "");
    setImageFile(null);
  }, [row.item.id, row.item.product.image, row.item.product.name]);

  return (
    <div className="fixed inset-0 z-[70] bg-black/20">
      <aside className="ml-auto flex h-full w-full max-w-[min(440px,100vw)] flex-col border-l border-[var(--border)] bg-[var(--background)] shadow-[var(--shadow)]">
        <div className="flex items-center justify-between border-b border-[var(--border)] bg-white px-5 py-4">
          <div>
            <p className="text-sm text-[var(--muted)]">{row.section?.code ?? "-"} / {row.slot?.code ?? "-"}</p>
            <h2 className="mt-1 text-xl font-semibold">商品详情</h2>
          </div>
          <button className="grid h-9 w-9 place-items-center rounded-full bg-[var(--surface-soft)] text-xl" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-auto p-5">
          <div className="overflow-hidden rounded-[18px] border border-[var(--border)] bg-white">
            <div className="grid aspect-[4/3] place-items-center bg-[var(--surface-soft)] text-sm font-semibold text-[var(--muted)]">
              {row.item.product.image ? (
                <ProductImage src={row.item.product.image} emptyLabel="暂无图片" />
              ) : (
                "暂无图片"
              )}
            </div>
            <div className="p-4">
              <div className="grid grid-cols-3 gap-2">
                <MetricPill label="数量" value={`${row.item.quantity}`} />
                <MetricPill label="位置" value={row.slot?.code ?? "-"} />
                <MetricPill label="状态" value={getStockLabel(row.item.quantity)} />
              </div>
            </div>
          </div>

          <section className="rounded-[18px] border border-[var(--border)] bg-white p-4">
            <h3 className="text-base font-semibold">编辑商品</h3>
            <label className="mt-4 block text-sm font-medium">商品名称</label>
            <input
              className="mt-2 w-full rounded-[14px] border border-[var(--border)] bg-white px-4 py-3 outline-none focus:border-[var(--accent)]"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <label className="mt-4 block text-sm font-medium">上传新图片</label>
            <input
              className="mt-2 w-full rounded-[14px] border border-[var(--border)] bg-white px-4 py-3 text-sm outline-none file:mr-3 file:rounded-full file:border-0 file:bg-[var(--surface-soft)] file:px-3 file:py-1.5 file:text-sm"
              type="file"
              accept="image/*"
              onChange={(event) => setImageFile(event.target.files?.[0] ?? null)}
            />
            <label className="mt-4 block text-sm font-medium">图片 URL</label>
            <input
              className="mt-2 w-full rounded-[14px] border border-[var(--border)] bg-white px-4 py-3 outline-none focus:border-[var(--accent)]"
              value={image}
              onChange={(event) => setImage(event.target.value)}
              placeholder="可选"
            />
            <button
              className="mt-5 w-full rounded-[14px] bg-[var(--accent)] px-4 py-3 font-semibold text-white disabled:opacity-40"
              disabled={!name.trim() || isSaving}
              onClick={() =>
                onSaveProduct({
                  name: name.trim(),
                  image: image.trim() || null,
                  imageFile,
                })
              }
            >
              {isSaving ? "保存中" : "保存商品"}
            </button>
          </section>

          <section className="rounded-[18px] border border-[var(--border)] bg-white p-4">
            <h3 className="text-base font-semibold">最近记录</h3>
            <div className="mt-3 space-y-2">
              {relatedMovements.length ? (
                relatedMovements.slice(0, 6).map((movement) => (
                  <div key={movement.id} className="rounded-[14px] bg-[var(--surface-soft)] px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{formatMovementAction(movement.action)}</span>
                      <span className="text-xs text-[var(--muted)]">{formatTime(movement.created_at)}</span>
                    </div>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      {movement.from_slot_code ?? "无"} → {movement.to_slot_code ?? "无"} · {movement.quantity_snapshot} 件
                    </p>
                  </div>
                ))
              ) : (
                <p className="rounded-[14px] bg-[var(--surface-soft)] px-3 py-3 text-sm text-[var(--muted)]">暂无操作记录</p>
              )}
            </div>
          </section>
        </div>

        <div className="border-t border-[var(--border)] bg-white p-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-[auto_auto_1fr_auto]">
            <button className="rounded-[14px] bg-[var(--surface-soft)] px-4 py-3 text-sm font-semibold" onClick={() => onChangeQuantity(-1)}>
              -1
            </button>
            <button className="rounded-[14px] bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white" onClick={() => onChangeQuantity(1)}>
              +1
            </button>
            <button className="rounded-[14px] bg-[var(--surface-soft)] px-4 py-3 text-sm font-semibold text-[var(--muted)]" onClick={onArchive}>
              归档
            </button>
            <button className="rounded-[14px] bg-[var(--danger-soft)] px-4 py-3 text-sm font-semibold text-[var(--danger)]" onClick={onDelete}>
              删除
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}

function Dialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[70] grid place-items-end bg-black/20 p-3 pb-[calc(env(safe-area-inset-bottom)+12px)] lg:place-items-center lg:p-4">
      <section className="max-h-[calc(100dvh-24px-env(safe-area-inset-bottom))] w-full max-w-[calc(100vw-24px)] overflow-y-auto rounded-[18px] border border-[var(--border)] bg-[var(--background)] p-4 shadow-[var(--shadow)] sm:max-w-md">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button className="grid h-9 w-9 place-items-center rounded-full bg-white text-xl" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

function ConfirmDialog({
  action,
  isSaving,
  onClose,
  onConfirm,
}: {
  action: ConfirmAction;
  isSaving: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const danger = action.tone === "danger";

  return (
    <Dialog title={action.title} onClose={onClose}>
      <p className="text-sm leading-6 text-[var(--muted)]">{action.message}</p>
      <div className="mt-5 grid grid-cols-2 gap-2">
        <button
          className="rounded-[14px] bg-white px-4 py-3 text-sm font-semibold text-[var(--muted)]"
          onClick={onClose}
          disabled={isSaving}
        >
          取消
        </button>
        <button
          className="rounded-[14px] px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
          style={{ background: danger ? "var(--danger)" : "var(--accent)" }}
          onClick={onConfirm}
          disabled={isSaving}
        >
          {isSaving ? "处理中" : action.confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}

function matchesFilter(item: Inventory, filterMode: FilterMode) {
  if (filterMode === "inStock") return item.quantity > 0;
  if (filterMode === "lowStock") return item.quantity > 0 && item.quantity <= 2;
  if (filterMode === "missingImage") return !item.product.image;
  return true;
}

function getStockTone(quantity: number): StockTone {
  if (quantity <= 0) return "empty";
  if (quantity <= 2) return "low";
  if (quantity <= 5) return "watch";
  return "good";
}

function getStockLabel(quantity: number) {
  if (quantity <= 0) return "空";
  if (quantity <= 2) return "低";
  if (quantity <= 5) return "注意";
  return "充足";
}

function getStockColor(tone: StockTone) {
  if (tone === "low") return "var(--danger)";
  if (tone === "watch") return "var(--warning)";
  if (tone === "good") return "var(--success)";
  return "var(--muted)";
}

function getStockSoftColor(tone: StockTone) {
  if (tone === "low") return "var(--danger-soft)";
  if (tone === "watch") return "var(--warning-soft)";
  if (tone === "good") return "var(--success-soft)";
  return "var(--surface-soft)";
}

function formatMovementAction(action: string) {
  if (action === "merged") return "合并";
  if (action === "archived") return "归档";
  if (action === "deleted") return "删除";
  return "移动";
}

function slotLabelForInventory(item: Inventory, data: ShelfData) {
  const slot = data.slots.find((entry) => entry.id === item.slot_id);
  const section = data.sections.find((entry) => entry.id === slot?.section_id);
  const rack = data.racks.find((entry) => entry.id === section?.rack_id);

  return `${rack?.name ?? "Rack-1"} / ${section?.code ?? "-"} / ${slot?.code ?? "-"}`;
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function parseInventoryCsv(text: string): CsvInventoryRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    throw new Error("CSV 至少需要表头和一行库存。");
  }

  const headers = parseCsvLine(lines[0]).map((header) => header.trim().toLowerCase());
  const getIndex = (...names: string[]) => names.map((name) => headers.indexOf(name)).find((index) => index >= 0) ?? -1;
  const nameIndex = getIndex("product", "product_name", "name", "商品", "商品名称");
  const quantityIndex = getIndex("quantity", "qty", "数量");
  const slotIndex = getIndex("slot", "slot_code", "location", "位置");
  const imageIndex = getIndex("image", "image_url", "图片", "图片url");

  if (nameIndex < 0 || quantityIndex < 0 || slotIndex < 0) {
    throw new Error("CSV 缺少必要字段：product、quantity、slot。");
  }

  return lines.slice(1).map((line, index) => {
    const values = parseCsvLine(line);
    const name = values[nameIndex]?.trim();
    const quantity = Number(values[quantityIndex]);
    const slotCode = values[slotIndex]?.trim();
    const image = imageIndex >= 0 ? values[imageIndex]?.trim() : "";

    if (!name) throw new Error(`CSV 第 ${index + 2} 行缺少商品名称。`);
    if (!Number.isFinite(quantity) || quantity < 1) throw new Error(`CSV 第 ${index + 2} 行数量必须大于 0。`);
    if (!slotCode) throw new Error(`CSV 第 ${index + 2} 行缺少 Slot。`);

    return {
      name,
      quantity: Math.floor(quantity),
      slotCode,
      image: image || null,
    };
  });
}

function parseCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === "\"" && inQuotes && next === "\"") {
      current += "\"";
      index += 1;
    } else if (char === "\"") {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  values.push(current);
  return values;
}

function getErrorMessage(error: unknown) {
  const rawMessage =
    error instanceof Error && error.message
      ? error.message
      : typeof error === "object" && error && "message" in error
        ? String((error as { message?: unknown }).message)
        : "";

  const message = rawMessage.trim();
  const normalized = message.toLowerCase();

  if (normalized.includes("mime type")) {
    return "图片格式被 Supabase 拒绝了。请先运行最新的 schema.sql，或把 product-images bucket 允许 PNG/JPG/WebP。";
  }

  if (normalized.includes("row-level security") || normalized.includes("violates row-level security")) {
    return "没有写入权限。请确认已经登录，并且 Supabase 已经运行最新的 schema.sql。";
  }

  if (normalized.includes("jwt") || normalized.includes("auth session missing") || normalized.includes("please sign in")) {
    return "登录状态已失效，请重新登录后再操作。";
  }

  if (normalized.includes("failed to fetch") || normalized.includes("network")) {
    return "连接 Supabase 失败，请检查网络或稍后再试。";
  }

  if (normalized.includes("duplicate key")) {
    return "这条记录已经存在，请刷新后再试一次。";
  }

  if (normalized.includes("only png") || normalized.includes("failed to read image")) {
    return "图片读取失败，请换一张 PNG、JPG 或 WebP 图片。";
  }

  if (message) return message;

  if (typeof error === "object" && error && "message" in error) {
    return String((error as { message?: unknown }).message);
  }
  return "保存失败，请刷新后再试。";
}
