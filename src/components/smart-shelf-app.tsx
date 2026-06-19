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

    loadShelfData().then((loaded) => {
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
      setIsReady(true);
    });
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

  const visibleSlotInventory = useMemo(
    () => slotInventory.filter((item) => matchesFilter(item, filterMode)),
    [filterMode, slotInventory],
  );
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

  const selectSection = (section: Section) => {
    setSelectedSectionId(section.id);
    const nextSlot =
      rackSlots.find((slot) => slot.section_id === section.id && totalForSlot(slot.id) > 0) ??
      rackSlots.find((slot) => slot.section_id === section.id);
    if (nextSlot) setSelectedSlotId(nextSlot.id);
  };

  const selectSlot = (slot: Slot) => {
    setSelectedSlotId(slot.id);
  };

  const selectSearchResult = (slot?: Slot, section?: Section) => {
    if (section) setSelectedSectionId(section.id);
    if (slot) setSelectedSlotId(slot.id);
    setAppMode("table");
  };

  const updateData = async (operation: () => Promise<ShelfData>) => {
    setIsSaving(true);
    try {
      setData(await operation());
    } finally {
      setIsSaving(false);
    }
  };

  const updateQuantity = async (inventoryId: string, delta: number) => {
    await updateData(() => changeInventoryQuantity(data, inventoryId, delta));
  };

  const moveInventoryToSlot = async (inventoryId: string, targetSlotId: string) => {
    const current = data.inventory.find((item) => item.id === inventoryId);
    if (!current || current.slot_id === targetSlotId) return;
    await updateData(() => moveInventory(data, inventoryId, targetSlotId));
    setSelectedSlotId(targetSlotId);
  };

  const totalForSlot = (slotId: string) =>
    rackInventory
      .filter((item) => item.slot_id === slotId)
      .reduce((total, item) => total + item.quantity, 0);

  const productsForSlot = (slotId: string) =>
    rackInventory.filter((item) => item.slot_id === slotId).length;

  const totalForSection = (sectionId: string) =>
    rackSlots
      .filter((slot) => slot.section_id === sectionId)
      .reduce((total, slot) => total + totalForSlot(slot.id), 0);

  const filledSlotsForSection = (sectionId: string) =>
    rackSlots.filter((slot) => slot.section_id === sectionId && productsForSlot(slot.id) > 0).length;

  const totalInventory = rackInventory.reduce((total, item) => total + item.quantity, 0);
  const activeSlots = rackSlots.filter((slot) => productsForSlot(slot.id) > 0).length;

  return (
    <main className="min-h-[100dvh] bg-[var(--background)] text-[var(--text)]">
      <div className="mx-auto flex min-h-[100dvh] max-w-[1480px] flex-col">
        <TopBar
          racks={data.racks}
          selectedRackId={rack?.id ?? ""}
          appMode={appMode}
          isSaving={isSaving}
          userLabel={user ? user.email ?? "已登录" : "本地 Demo"}
          totalInventory={totalInventory}
          activeSlots={activeSlots}
          totalSlots={rackSlots.length}
          onSelectRack={(rackId) => {
            setSelectedRackId(rackId);
            const nextSection = data.sections.find((section) => section.rack_id === rackId);
            const nextSlot = data.slots.find((slot) => slot.section_id === nextSection?.id);
            if (nextSection) setSelectedSectionId(nextSection.id);
            if (nextSlot) setSelectedSlotId(nextSlot.id);
          }}
          onRenameRack={() => setRenameRackOpen(true)}
          onCreateRack={() => setCreateRackOpen(true)}
          onChangeMode={setAppMode}
          onAddInventory={() => setAddOpen(true)}
        />

        <section className="flex min-w-0 flex-1 flex-col pb-4">
          <div className="border-b border-[var(--border)] bg-[var(--background)]/70 px-4 py-4 md:px-6 lg:px-7">
            {appMode !== "admin" ? (
              <SearchAndFilters
                query={query}
                filterMode={filterMode}
                results={visibleInventoryRows}
                onQueryChange={setQuery}
                onFilterChange={setFilterMode}
                onSelectResult={selectSearchResult}
              />
            ) : null}
          </div>

          {appMode === "table" ? (
            <div className="grid flex-1 gap-4 px-4 py-4 md:px-6 xl:grid-cols-[minmax(620px,1fr)_380px] lg:gap-6 lg:px-7 lg:py-6">
              <section>
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
                  onArchive={(inventoryId) => updateData(() => archiveInventory(data, inventoryId))}
                  onDelete={(inventoryId) => updateData(() => deleteInventory(data, inventoryId))}
                />
              </section>

              <section className="space-y-4">
                <LocationOverviewPanel
                  rackName={rack?.name ?? "Rack-1"}
                  sections={rackSections}
                  slots={rackSlots}
                  selectedSectionId={selectedSectionId}
                  selectedSlotId={selectedSlot?.id ?? selectedSlotId}
                  totalForSection={totalForSection}
                  filledSlotsForSection={filledSlotsForSection}
                  productsForSlot={productsForSlot}
                  totalForSlot={totalForSlot}
                  onSelectSection={selectSection}
                  onSelectSlot={selectSlot}
                  onRename={(section) => {
                    setSelectedSectionId(section.id);
                    setRenameOpen(true);
                  }}
                />
                <InventoryPanel
                  slot={selectedSlot}
                  section={selectedSection}
                  inventory={visibleSlotInventory}
                  isReady={isReady}
                  total={slotInventory.reduce((sum, item) => sum + item.quantity, 0)}
                  filterMode={filterMode}
                  onChangeQuantity={updateQuantity}
                  onOpenAdd={() => setAddOpen(true)}
                  onOpenMove={() => setMoveOpen(true)}
                  onArchive={(inventoryId) => updateData(() => archiveInventory(data, inventoryId))}
                  onDelete={(inventoryId) => updateData(() => deleteInventory(data, inventoryId))}
                />
                <MovementPanel movements={data.movements ?? []} />
                {hasSupabaseEnv ? <SignOutPanel /> : null}
              </section>
            </div>
          ) : appMode === "gallery" ? (
            <ProductGalleryPage
              rows={visibleInventoryRows}
              onOpenDetail={(inventoryId) => setDetailInventoryId(inventoryId)}
            />
          ) : (
            <AdminPanel
              data={data}
              activeRack={rack}
              activeSections={rackSections}
              activeSlots={rackSlots}
              activeInventory={rackInventory}
              movements={data.movements ?? []}
              onCreateRack={() => setCreateRackOpen(true)}
              onRenameRack={() => setRenameRackOpen(true)}
              onCreateSlot={() => setCreateSlotOpen(true)}
              onDeleteSlot={(slotId) => updateData(() => deleteSlot(data, slotId))}
              onDeleteRack={(rackId) => updateData(() => deleteRack(data, rackId))}
              onSelectWorkbench={() => setAppMode("table")}
            />
          )}
        </section>
      </div>

      {addOpen && selectedSlot ? (
        <AddInventoryDialog
          slot={selectedSlot}
          isSaving={isSaving}
          onClose={() => setAddOpen(false)}
          onSave={async (input) => {
            await updateData(() => addInventory(data, input));
            setAddOpen(false);
          }}
        />
      ) : null}

      {moveOpen && selectedSlot ? (
        <MoveInventoryDialog
          inventory={slotInventory}
          slots={rackSlots}
          currentSlot={selectedSlot}
          onClose={() => setMoveOpen(false)}
          onMove={async (inventoryId, targetSlotId) => {
            await updateData(() => moveInventory(data, inventoryId, targetSlotId));
            setMoveOpen(false);
          }}
        />
      ) : null}

      {renameOpen && selectedSection ? (
        <RenameSectionDialog
          section={selectedSection}
          onClose={() => setRenameOpen(false)}
          onSave={async (name) => {
            await updateData(() => renameSection(data, selectedSection.id, name));
            setRenameOpen(false);
          }}
        />
      ) : null}

      {renameRackOpen && rack ? (
        <RenameRackDialog
          rackName={rack.name}
          onClose={() => setRenameRackOpen(false)}
          onSave={async (name) => {
            await updateData(() => renameRack(data, rack.id, name));
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
            });
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
            await updateData(() => createSlot(data, sectionId, code));
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
            await updateData(() => updateProductDetails(data, detailRow.item.product_id, input));
          }}
          onChangeQuantity={(delta) => updateQuantity(detailRow.item.id, delta)}
          onArchive={async () => {
            await updateData(() => archiveInventory(data, detailRow.item.id));
            setDetailInventoryId(null);
          }}
          onDelete={async () => {
            await updateData(() => deleteInventory(data, detailRow.item.id));
            setDetailInventoryId(null);
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
  appMode,
  isSaving,
  userLabel,
  totalInventory,
  activeSlots,
  totalSlots,
  onSelectRack,
  onRenameRack,
  onCreateRack,
  onChangeMode,
  onAddInventory,
}: {
  racks: Array<{ id: string; name: string }>;
  selectedRackId: string;
  appMode: AppMode;
  isSaving: boolean;
  userLabel: string;
  totalInventory: number;
  activeSlots: number;
  totalSlots: number;
  onSelectRack: (rackId: string) => void;
  onRenameRack: () => void;
  onCreateRack: () => void;
  onChangeMode: (mode: AppMode) => void;
  onAddInventory: () => void;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--background)]/94 px-4 py-3 backdrop-blur md:px-6 lg:px-7">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <AppMark />
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold">仓库库存管理</h1>
            <p className="text-xs text-[var(--muted)]">
              {quantityFormatter.format(totalInventory)} 件 · {activeSlots}/{totalSlots || 0} 位置有货
            </p>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-[minmax(160px,1fr)_auto_auto] lg:flex lg:flex-1 lg:flex-wrap lg:items-center lg:justify-end">
          <select
            className="min-h-10 min-w-0 rounded-[14px] border border-[var(--border)] bg-white px-3 text-sm font-semibold outline-none focus:border-[var(--accent)]"
            value={selectedRackId}
            onChange={(event) => onSelectRack(event.target.value)}
          >
            {racks.map((rack) => (
              <option key={rack.id} value={rack.id}>
                {rack.name}
              </option>
            ))}
          </select>
          <button className="rounded-[14px] border border-[var(--border)] bg-white px-3 py-2 text-sm font-semibold text-[var(--muted)]" onClick={onRenameRack}>
            改名
          </button>
          <button className="rounded-[14px] border border-[var(--border)] bg-white px-3 py-2 text-sm font-semibold text-[var(--muted)]" onClick={onCreateRack}>
            新建 Rack
          </button>
          <div className="grid grid-cols-3 rounded-[14px] border border-[var(--border)] bg-white p-1 sm:col-span-2 lg:col-span-1">
            {[
              ["table", "库存表"],
              ["gallery", "图片"],
              ["admin", "管理"],
            ].map(([mode, label]) => (
              <button
                key={mode}
                className="rounded-[11px] px-3 py-2 text-xs font-semibold transition"
                style={{
                  background: appMode === mode ? "var(--accent)" : "transparent",
                  color: appMode === mode ? "#fff" : "var(--muted)",
                }}
                onClick={() => onChangeMode(mode as AppMode)}
              >
                {label}
              </button>
            ))}
          </div>
          <button className="rounded-[14px] bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white" onClick={onAddInventory}>
            添加库存
          </button>
          <div className="hidden items-center gap-2 rounded-full border border-[var(--border)] bg-white px-3 py-2 text-xs text-[var(--muted)] lg:flex">
            <span className="h-2 w-2 rounded-full bg-[var(--accent)]" />
            {isSaving ? "保存中" : userLabel}
          </div>
        </div>
      </div>
    </header>
  );
}

function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[12px] bg-[var(--surface-soft)] px-3 py-2">
      <p className="text-[11px] text-[var(--muted)]">{label}</p>
      <p className="mt-1 text-sm font-semibold">{value}</p>
    </div>
  );
}

function SearchAndFilters({
  query,
  filterMode,
  results,
  onQueryChange,
  onFilterChange,
  onSelectResult,
}: {
  query: string;
  filterMode: FilterMode;
  results: Array<{ item: Inventory; slot?: Slot; section?: Section; rack?: { id: string; name: string } }>;
  onQueryChange: (query: string) => void;
  onFilterChange: (filterMode: FilterMode) => void;
  onSelectResult: (slot?: Slot, section?: Section) => void;
}) {
  return (
    <div className="mt-0 lg:mt-4">
      <div className="grid gap-3 lg:grid-cols-[minmax(280px,1fr)_auto]">
        <input
          className="min-h-11 rounded-[14px] border border-[var(--border)] bg-white px-4 text-sm outline-none focus:border-[var(--accent)]"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="搜索商品名，快速定位 Slot"
        />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ["all", "全部"],
            ["inStock", "有货"],
            ["lowStock", "低库存"],
            ["missingImage", "缺图片"],
          ].map(([value, label]) => (
            <button
              key={value}
              className="rounded-[14px] border px-3 py-2 text-xs font-medium"
              style={{
                borderColor: filterMode === value ? "var(--accent)" : "var(--border)",
                background: filterMode === value ? "var(--accent-soft)" : "#fff",
                color: filterMode === value ? "var(--accent-deep)" : "var(--muted)",
              }}
              onClick={() => onFilterChange(value as FilterMode)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {query.trim() ? (
        <div className="mt-3 rounded-[14px] border border-[var(--border)] bg-white p-2 shadow-[var(--soft-shadow)]">
          {results.length ? (
            <div className="max-h-48 space-y-1 overflow-auto">
              {results.slice(0, 8).map(({ item, slot, section, rack }) => (
                <button
                  key={item.id}
                  className="flex w-full items-center justify-between gap-3 rounded-[12px] px-3 py-2 text-left hover:bg-[var(--surface-soft)]"
                  onClick={() => onSelectResult(slot, section)}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{item.product.name}</span>
                    <span className="text-xs text-[var(--muted)]">
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
    <section className="rounded-[18px] border border-[var(--border)] bg-white shadow-[var(--soft-shadow)]">
      <div className="border-b border-[var(--border)] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <PanelTitle title="库存总表" subtitle={`${rackName} / 按商品和位置管理`} />
          <button className="rounded-[14px] bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white" onClick={onOpenAdd}>
            添加库存
          </button>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
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
          {item.product.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.product.image} alt="" className="h-full w-full object-cover" />
          ) : (
            "照片"
          )}
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
    <article className="p-4">
      <div className="flex gap-3">
        <button
          className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-[14px] bg-[var(--surface-soft)] text-xs font-semibold text-[var(--muted)]"
          onClick={() => onOpenDetail(item.id)}
        >
          {item.product.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.product.image} alt="" className="h-full w-full object-cover" />
          ) : (
            "照片"
          )}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start justify-between gap-2">
            <button className="min-w-0 text-left" onClick={() => onOpenDetail(item.id)}>
              <p className="truncate text-base font-semibold">{item.product.name}</p>
              <p className="mt-1 text-xs text-[var(--muted)]">{section?.code ?? "-"} / {slot?.code ?? "-"}</p>
            </button>
            <StockBadge tone={tone} label={getStockLabel(item.quantity)} />
          </div>

          <div className="mt-3 grid grid-cols-[auto_1fr] gap-2">
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
              className="min-w-0 rounded-[12px] border border-[var(--border)] bg-white px-3 text-sm outline-none focus:border-[var(--accent)]"
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

          <div className="mt-3 flex gap-1">
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

function LocationOverviewPanel({
  rackName,
  sections,
  slots,
  selectedSectionId,
  selectedSlotId,
  totalForSection,
  filledSlotsForSection,
  productsForSlot,
  totalForSlot,
  onSelectSection,
  onSelectSlot,
  onRename,
}: {
  rackName: string;
  sections: Section[];
  slots: Slot[];
  selectedSectionId: string;
  selectedSlotId: string;
  totalForSection: (sectionId: string) => number;
  filledSlotsForSection: (sectionId: string) => number;
  productsForSlot: (slotId: string) => number;
  totalForSlot: (slotId: string) => number;
  onSelectSection: (section: Section) => void;
  onSelectSlot: (slot: Slot) => void;
  onRename: (section: Section) => void;
}) {
  return (
    <section className="rounded-[18px] border border-[var(--border)] bg-white p-4 shadow-[var(--soft-shadow)]">
      <div className="flex items-start justify-between gap-3">
        <PanelTitle title="位置概览" subtitle={rackName} />
      </div>
      <div className="mt-4 space-y-3">
        {sections.map((section) => {
          const sectionSlots = slots.filter((slot) => slot.section_id === section.id);
          return (
            <div
              key={section.id}
              className="rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-3"
              style={{ borderColor: selectedSectionId === section.id ? "var(--accent)" : "var(--border)" }}
            >
              <div className="flex items-center justify-between gap-3">
                <button className="text-left" onClick={() => onSelectSection(section)}>
                  <p className="text-sm font-semibold">{section.code} {section.name}</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {filledSlotsForSection(section.id)} 个位置有货 · {totalForSection(section.id)} 件
                  </p>
                </button>
                <button className="rounded-full px-3 py-1 text-xs text-[var(--muted)] hover:bg-[var(--surface-soft)]" onClick={() => onRename(section)}>
                  改名
                </button>
              </div>
              <div className="mt-3 grid grid-cols-5 gap-1.5">
                {sectionSlots.map((slot) => (
                  <button
                    key={slot.id}
                    className="rounded-[10px] border px-2 py-2 text-left text-xs"
                    style={{
                      borderColor: selectedSlotId === slot.id ? "var(--accent)" : "var(--border)",
                      background: selectedSlotId === slot.id ? "var(--accent-soft)" : "#fff",
                    }}
                    onClick={() => onSelectSlot(slot)}
                  >
                    <span className="block font-semibold">{slot.code}</span>
                    <span className="mt-1 block text-[11px] text-[var(--muted)]">{productsForSlot(slot.id)} / {totalForSlot(slot.id)}</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
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
    <section className="px-4 py-4 md:px-6 lg:px-7 lg:py-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <PanelTitle title="图片视图" subtitle="通过商品图快速确认位置" />
        <span className="rounded-full bg-white px-3 py-2 text-xs font-semibold text-[var(--muted)]">{rows.length} 个库存记录</span>
      </div>
      {rows.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {rows.map(({ item, slot, section, rack }) => (
            <button
              key={item.id}
              className="overflow-hidden rounded-[16px] border border-[var(--border)] bg-white text-left shadow-[var(--soft-shadow)] transition hover:-translate-y-0.5"
              onClick={() => onOpenDetail(item.id)}
            >
              <div className="grid aspect-[4/3] place-items-center bg-[var(--surface-soft)] text-sm font-semibold text-[var(--muted)]">
                {item.product.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.product.image} alt="" className="h-full w-full object-cover" />
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

function InventoryPanel({
  slot,
  section,
  inventory,
  isReady,
  total,
  filterMode,
  onChangeQuantity,
  onOpenAdd,
  onOpenMove,
  onArchive,
  onDelete,
}: {
  slot?: Slot;
  section?: Section;
  inventory: Inventory[];
  isReady: boolean;
  total: number;
  filterMode: FilterMode;
  onChangeQuantity: (inventoryId: string, delta: number) => void;
  onOpenAdd: () => void;
  onOpenMove: () => void;
  onArchive: (inventoryId: string) => void;
  onDelete: (inventoryId: string) => void;
}) {
  const lowCount = inventory.filter((item) => item.quantity <= 2).length;
  const photoMissing = inventory.filter((item) => !item.product.image).length;

  return (
    <div className="rounded-[18px] border border-[var(--border)] bg-white p-4 shadow-[var(--soft-shadow)] lg:min-h-[calc(100dvh-150px)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-[var(--muted)]">{section?.code} {section?.name}</p>
          <h2 className="mt-1 text-2xl font-semibold">{slot?.code ?? "A2"} 库存</h2>
        </div>
        <div className="flex items-center gap-2">
          <div className="rounded-[14px] bg-[var(--accent-soft)] px-3 py-2 text-right">
            <p className="text-[11px] text-[var(--accent-deep)]">当前合计</p>
            <p className="text-sm font-semibold text-[var(--accent-deep)]">{total} 件</p>
          </div>
          <button
            className="hidden rounded-[14px] border border-[var(--border)] bg-white px-4 py-3 text-sm font-semibold text-[var(--muted)] disabled:opacity-40 lg:block"
            onClick={onOpenMove}
            disabled={!inventory.length}
          >
            移动
          </button>
          <button
            className="hidden rounded-[14px] bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white lg:block"
            onClick={onOpenAdd}
          >
            添加库存
          </button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <MetricPill label="当前显示" value={`${inventory.length}`} />
        <MetricPill label="低库存" value={`${lowCount}`} />
        <MetricPill label="缺图片" value={`${photoMissing}`} />
      </div>

      <div className="mt-5 space-y-3">
        {!isReady ? (
          <SkeletonRows />
        ) : inventory.length ? (
          inventory.map((item) => (
            <InventoryRow
              key={item.id}
              item={item}
              slotCode={slot?.code ?? "A2"}
              onChangeQuantity={onChangeQuantity}
              onArchive={onArchive}
              onDelete={onDelete}
            />
          ))
        ) : (
          <EmptySlotState
            slotCode={slot?.code ?? "当前 Slot"}
            filterMode={filterMode}
            onOpenAdd={onOpenAdd}
          />
        )}
      </div>
    </div>
  );
}

function InventoryRow({
  item,
  slotCode,
  onChangeQuantity,
  onArchive,
  onDelete,
}: {
  item: Inventory;
  slotCode: string;
  onChangeQuantity: (inventoryId: string, delta: number) => void;
  onArchive: (inventoryId: string) => void;
  onDelete: (inventoryId: string) => void;
}) {
  const tone = getStockTone(item.quantity);
  const status = getStockLabel(item.quantity);

  return (
    <article className="rounded-[14px] border border-[var(--border)] bg-white p-3">
      <div className="flex items-center gap-3">
        <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-[12px] bg-[var(--surface-soft)] text-xs font-semibold text-[var(--muted)]">
          {item.product.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.product.image} alt="" className="h-full w-full object-cover" />
          ) : (
            "照片"
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-sm font-semibold">{item.product.name}</p>
            <StockBadge tone={tone} label={status} />
          </div>
          <p className="mt-1 truncate text-xs text-[var(--muted)]">
            {slotCode} · {item.product.image ? "WebP 图片" : "待补图片"} · 库存记录
          </p>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="flex gap-1">
          <button
            className="rounded-full px-2.5 py-1 text-xs text-[var(--muted)] hover:bg-[var(--surface-soft)]"
            onClick={() => onArchive(item.id)}
          >
            归档
          </button>
          <button
            className="rounded-full px-2.5 py-1 text-xs text-[var(--danger)] hover:bg-[var(--danger-soft)]"
            onClick={() => onDelete(item.id)}
          >
            删除
          </button>
        </div>
        <div className="flex shrink-0 items-center gap-1 rounded-full bg-[var(--surface-soft)] p-1">
          <button
            className="grid h-8 w-8 place-items-center rounded-full bg-white text-lg active:scale-90 disabled:opacity-35"
            aria-label="减少"
            onClick={() => onChangeQuantity(item.id, -1)}
            disabled={item.quantity <= 0}
          >
            −
          </button>
          <span className="min-w-9 text-center text-sm font-semibold">{item.quantity}</span>
          <button
            className="grid h-8 w-8 place-items-center rounded-full bg-[var(--accent)] text-lg text-white active:scale-90"
            aria-label="增加"
            onClick={() => onChangeQuantity(item.id, 1)}
          >
            +
          </button>
        </div>
      </div>
    </article>
  );
}

function MovementPanel({ movements }: { movements: InventoryMovement[] }) {
  return (
    <div className="rounded-[18px] border border-[var(--border)] bg-white p-4 shadow-[var(--soft-shadow)]">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">最近操作</h2>
        <span className="text-xs text-[var(--muted)]">{movements.length} 条</span>
      </div>
      <div className="mt-3 space-y-2">
        {movements.length ? (
          movements.slice(0, 8).map((movement) => (
            <div key={movement.id} className="rounded-[14px] bg-[var(--surface-soft)] px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <p className="truncate text-sm font-medium">{movement.product_name}</p>
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
    </div>
  );
}

function AdminPanel({
  data,
  activeRack,
  activeSections,
  activeSlots,
  activeInventory,
  movements,
  onCreateRack,
  onRenameRack,
  onCreateSlot,
  onDeleteSlot,
  onDeleteRack,
  onSelectWorkbench,
}: {
  data: ShelfData;
  activeRack?: { id: string; name: string };
  activeSections: Section[];
  activeSlots: Slot[];
  activeInventory: Inventory[];
  movements: InventoryMovement[];
  onCreateRack: () => void;
  onRenameRack: () => void;
  onCreateSlot: () => void;
  onDeleteSlot: (slotId: string) => void;
  onDeleteRack: (rackId: string) => void;
  onSelectWorkbench: () => void;
}) {
  const productIds = new Set(activeInventory.map((item) => item.product_id));
  const lowStock = activeInventory.filter((item) => item.quantity > 0 && item.quantity <= 2);
  const missingImage = activeInventory.filter((item) => !item.product.image);
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
          <PanelTitle title="后台总览" subtitle="管理货架、库存异常和操作历史" />
          <button
            className="rounded-[14px] bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white"
            onClick={onSelectWorkbench}
          >
            回到工作台
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <AdminMetric label="当前 Rack" value={activeRack?.name ?? "Rack-1"} detail={`${activeSections.length} 区 / ${activeSlots.length} Slot`} />
          <AdminMetric label="库存总数" value={`${quantityFormatter.format(totalQuantity)} 件`} detail={`${activeInventory.length} 条库存记录`} />
          <AdminMetric label="商品数" value={`${productIds.size}`} detail="按 Product 去重" />
          <AdminMetric label="低库存" value={`${lowStock.length}`} detail="数量 1-2 的记录" tone={lowStock.length ? "warning" : "normal"} />
          <AdminMetric label="缺图片" value={`${missingImage.length}`} detail="需要补图的商品" tone={missingImage.length ? "danger" : "normal"} />
        </div>

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
              {rackDiagnostics.map(({ rack, sections, slots, quantity, inventory }) => (
                <div
                  key={rack.id}
                  className="grid grid-cols-[1fr_70px_70px_86px_78px] items-center border-t border-[var(--border)] px-3 py-3 text-sm"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{rack.name}</span>
                    <span className="mt-1 block truncate text-xs text-[var(--muted)]">{rack.id}</span>
                  </span>
                  <span>{sections.length}</span>
                  <span>{slots.length}</span>
                  <span className="text-right font-semibold">{quantity}</span>
                  <span className="text-right">
                    <button
                      className="rounded-full px-3 py-1.5 text-xs font-semibold text-[var(--danger)] hover:bg-[var(--danger-soft)] disabled:cursor-not-allowed disabled:opacity-35"
                      disabled={data.racks.length <= 1}
                      onClick={() => {
                        const confirmed = window.confirm(
                          `删除 ${rack.name}？这会删除 ${inventory.length} 条库存记录，不能在页面内恢复。`,
                        );
                        if (confirmed) onDeleteRack(rack.id);
                      }}
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

function AddInventoryDialog({
  slot,
  isSaving,
  onClose,
  onSave,
}: {
  slot: Slot;
  isSaving: boolean;
  onClose: () => void;
  onSave: (input: InventoryInsert) => void;
}) {
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [image, setImage] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);

  return (
    <Dialog title={`添加到 ${slot.code}`} onClose={onClose}>
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
        min="0"
        value={quantity}
        onChange={(event) => setQuantity(Number(event.target.value))}
      />
      <label className="mt-4 block text-sm font-medium">上传图片</label>
      <input
        className="mt-2 w-full rounded-[14px] border border-[var(--border)] bg-white px-4 py-3 text-sm outline-none file:mr-3 file:rounded-full file:border-0 file:bg-[var(--surface-soft)] file:px-3 file:py-1.5 file:text-sm"
        type="file"
        accept="image/*"
        onChange={(event) => setImageFile(event.target.files?.[0] ?? null)}
      />
      <p className="mt-2 text-xs text-[var(--muted)]">会在浏览器内压缩成 WebP 再上传。</p>
      <label className="mt-4 block text-sm font-medium">图片 URL</label>
      <input
        className="mt-2 w-full rounded-[14px] border border-[var(--border)] bg-white px-4 py-3 outline-none focus:border-[var(--accent)]"
        value={image}
        onChange={(event) => setImage(event.target.value)}
        placeholder="可选，上传文件优先"
      />
      <button
        className="mt-5 w-full rounded-[14px] bg-[var(--accent)] px-4 py-3 font-semibold text-white disabled:opacity-40"
        disabled={!name.trim() || isSaving}
        onClick={() =>
          onSave({
            name: name.trim(),
            quantity: Math.max(0, quantity),
            image: image.trim() || null,
            imageFile,
            slotId: slot.id,
          })
        }
      >
        {isSaving ? "保存中" : "添加库存"}
      </button>
    </Dialog>
  );
}

function MoveInventoryDialog({
  inventory,
  slots,
  currentSlot,
  onClose,
  onMove,
}: {
  inventory: Inventory[];
  slots: Slot[];
  currentSlot: Slot;
  onClose: () => void;
  onMove: (inventoryId: string, targetSlotId: string) => void;
}) {
  const [inventoryId, setInventoryId] = useState(inventory[0]?.id ?? "");
  const [targetSlotId, setTargetSlotId] = useState(slots.find((slot) => slot.id !== currentSlot.id)?.id ?? "");

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
          <label className="mt-4 block text-sm font-medium">目标 Slot</label>
          <select
            className="mt-2 w-full rounded-[14px] border border-[var(--border)] bg-white px-4 py-3 outline-none focus:border-[var(--accent)]"
            value={targetSlotId}
            onChange={(event) => setTargetSlotId(event.target.value)}
          >
            {slots
              .filter((slot) => slot.id !== currentSlot.id)
              .map((slot) => (
                <option key={slot.id} value={slot.id}>
                  {slot.code}
                </option>
              ))}
          </select>
          <button
            className="mt-5 w-full rounded-[14px] bg-[var(--accent)] px-4 py-3 font-semibold text-white disabled:opacity-40"
            disabled={!inventoryId || !targetSlotId}
            onClick={() => onMove(inventoryId, targetSlotId)}
          >
            移动库存
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
    <div className="fixed inset-0 z-40 bg-black/20">
      <aside className="ml-auto flex h-full w-full max-w-[440px] flex-col border-l border-[var(--border)] bg-[var(--background)] shadow-[var(--shadow)]">
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
                // eslint-disable-next-line @next/next/no-img-element
                <img src={row.item.product.image} alt="" className="h-full w-full object-cover" />
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
    <div className="fixed inset-0 z-40 grid place-items-end bg-black/20 p-4 lg:place-items-center">
      <section className="w-full max-w-md rounded-[18px] border border-[var(--border)] bg-[var(--background)] p-4 shadow-[var(--shadow)]">
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
