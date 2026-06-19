"use client";

import { useEffect, useMemo, useState } from "react";
import {
  addInventory,
  archiveInventory,
  changeInventoryQuantity,
  deleteInventory,
  loadShelfData,
  moveInventory,
  renameSection,
} from "@/lib/storage";
import { getCurrentUser, hasSupabaseEnv, supabase, type AuthUser } from "@/lib/supabase";
import type { Inventory, InventoryInsert, InventoryMovement, Section, ShelfData, Slot } from "@/lib/types";
import { seedData } from "@/lib/seed";

type ViewMode = "rack" | "section" | "slot";
type AppMode = "workbench" | "admin";
type StockTone = "empty" | "low" | "watch" | "good";
type FilterMode = "all" | "inStock" | "lowStock" | "missingImage";

const quantityFormatter = new Intl.NumberFormat("zh-CN");

export function SmartShelfApp() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(!hasSupabaseEnv);
  const [data, setData] = useState<ShelfData>(seedData);
  const [selectedSectionId, setSelectedSectionId] = useState("section-a");
  const [selectedSlotId, setSelectedSlotId] = useState("slot-a-2");
  const [viewMode, setViewMode] = useState<ViewMode>("slot");
  const [appMode, setAppMode] = useState<AppMode>("workbench");
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [query, setQuery] = useState("");
  const [isReady, setIsReady] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);

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

  const rack = data.racks[0];
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
  const sectionSlots = useMemo(
    () => rackSlots.filter((slot) => slot.section_id === selectedSection?.id),
    [rackSlots, selectedSection?.id],
  );
  const slotInventory = useMemo(
    () => rackInventory.filter((item) => item.slot_id === selectedSlot?.id),
    [rackInventory, selectedSlot?.id],
  );

  const searchResults = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return rackInventory
      .filter((item) => item.product.name.toLowerCase().includes(normalized))
      .filter((item) => matchesFilter(item, filterMode))
      .map((item) => {
        const slot = rackSlots.find((entry) => entry.id === item.slot_id);
        const section = rackSections.find((entry) => entry.id === slot?.section_id);
        const rackForResult = data.racks.find((entry) => entry.id === section?.rack_id);
        return { item, slot, section, rack: rackForResult };
      });
  }, [data.racks, filterMode, query, rackInventory, rackSections, rackSlots]);

  const visibleSlotInventory = useMemo(
    () => slotInventory.filter((item) => matchesFilter(item, filterMode)),
    [filterMode, slotInventory],
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
    setViewMode("section");
  };

  const selectSlot = (slot: Slot) => {
    setSelectedSlotId(slot.id);
    setViewMode("slot");
  };

  const selectSearchResult = (slot?: Slot, section?: Section) => {
    if (section) setSelectedSectionId(section.id);
    if (slot) setSelectedSlotId(slot.id);
    setViewMode("slot");
    setAppMode("workbench");
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
  const hasDuplicateRacks = data.racks.length > 1;

  return (
    <main className="min-h-[100dvh] bg-[var(--background)] text-[var(--text)]">
      <div className="mx-auto flex min-h-[100dvh] max-w-[1480px] flex-col lg:grid lg:grid-cols-[272px_1fr]">
        <aside className="hidden border-r border-[var(--border)] bg-white/72 px-5 py-6 lg:block">
          <div className="mb-7 flex items-center gap-3">
            <AppMark />
            <div>
              <p className="text-[15px] font-semibold">Smart Shelf</p>
              <p className="text-xs text-[var(--muted)]">Rack / Section / Slot</p>
            </div>
          </div>

          <ModeSwitch appMode={appMode} onChange={setAppMode} />

          <div className="rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs text-[var(--muted)]">当前货架</p>
                <p className="mt-1 text-lg font-semibold">{rack?.name ?? "Rack-1"}</p>
              </div>
              <ModeBadge />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <MetricPill label="库存总数" value={quantityFormatter.format(totalInventory)} />
              <MetricPill label="有货 Slot" value={`${activeSlots}/${rackSlots.length || 25}`} />
            </div>
          </div>

          {hasDuplicateRacks ? (
            <DuplicateRackNotice rackCount={data.racks.length} onOpenAdmin={() => setAppMode("admin")} />
          ) : null}

          <div className="mt-6 flex items-center justify-between px-1">
            <p className="text-xs font-medium text-[var(--muted)]">分区</p>
            <button
              className="rounded-full px-3 py-1 text-xs text-[var(--muted)] hover:bg-[var(--surface-soft)]"
              onClick={() => selectedSection && setRenameOpen(true)}
            >
              改当前名称
            </button>
          </div>

          <div className="mt-3 space-y-2">
            {rackSections.map((section) => (
              <SectionNavItem
                key={section.id}
                section={section}
                active={section.id === selectedSectionId}
                total={totalForSection(section.id)}
                filledSlots={filledSlotsForSection(section.id)}
                onSelect={() => selectSection(section)}
              />
            ))}
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col pb-[calc(94px+env(safe-area-inset-bottom))] lg:pb-0">
          <MobileHeader
            section={selectedSection}
            slot={selectedSlot}
            viewMode={viewMode}
            appMode={appMode}
            onModeChange={setAppMode}
            onBack={() => setViewMode(viewMode === "slot" ? "section" : "rack")}
          />

          <div className="border-b border-[var(--border)] bg-[var(--background)]/70 px-4 py-4 md:px-6 lg:px-7">
            <div className="hidden items-center justify-between lg:flex">
              <div>
                <p className="text-sm text-[var(--muted)]">
                  {rack?.name ?? "Rack-1"} / {selectedSection?.code} {selectedSection?.name} /{" "}
                  {selectedSlot?.code}
                </p>
                <h1 className="mt-1 text-2xl font-semibold tracking-normal">货架库存工作台</h1>
              </div>
              <div className="flex items-center gap-3">
                <ModeSwitch appMode={appMode} onChange={setAppMode} compact />
                <div className="flex items-center gap-2 rounded-full border border-[var(--border)] bg-white px-3 py-2 text-xs text-[var(--muted)]">
                  <span className="h-2 w-2 rounded-full bg-[var(--accent)]" />
                  {isSaving ? "保存中" : user ? user.email : "本地 Demo"}
                </div>
              </div>
            </div>
            {appMode === "workbench" ? (
              <SearchAndFilters
                query={query}
                filterMode={filterMode}
                results={searchResults}
                onQueryChange={setQuery}
                onFilterChange={setFilterMode}
                onSelectResult={selectSearchResult}
              />
            ) : null}
          </div>

          {appMode === "workbench" ? (
            <div className="grid flex-1 gap-4 px-4 py-4 md:px-6 lg:grid-cols-[minmax(430px,1fr)_420px] lg:gap-6 lg:px-7 lg:py-6">
              <section className={viewMode === "rack" ? "block" : "hidden lg:block"}>
                <MobileSectionList
                  rackName={rack?.name ?? "Rack-1"}
                  sections={rackSections}
                  selectedSectionId={selectedSectionId}
                  totalForSection={totalForSection}
                  filledSlotsForSection={filledSlotsForSection}
                  onSelect={selectSection}
                  onRename={(section) => {
                    setSelectedSectionId(section.id);
                    setRenameOpen(true);
                  }}
                />
              </section>

              <section className={viewMode === "section" || viewMode === "slot" ? "block" : "hidden lg:block"}>
                <ShelfMapPanel
                  section={selectedSection}
                  slots={sectionSlots}
                  selectedSlotId={selectedSlot?.id ?? selectedSlotId}
                  productsForSlot={productsForSlot}
                  totalForSlot={totalForSlot}
                  onSelectSlot={selectSlot}
                />
              </section>

              <section className={viewMode === "slot" ? "space-y-4" : "hidden lg:block lg:space-y-4"}>
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
          ) : (
            <AdminPanel
              data={data}
              activeRack={rack}
              activeSections={rackSections}
              activeSlots={rackSlots}
              activeInventory={rackInventory}
              movements={data.movements ?? []}
              onSelectWorkbench={() => setAppMode("workbench")}
            />
          )}
        </section>
      </div>

      {appMode === "workbench" ? (
        <BottomActionBar
          onAdd={() => setAddOpen(true)}
          onMove={() => setMoveOpen(true)}
          disabled={!selectedSlot}
          hasInventory={slotInventory.length > 0}
        />
      ) : null}

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
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const signIn = async () => {
    if (!supabase || !email.trim()) return;
    setIsSubmitting(true);
    setMessage("");
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: window.location.origin,
      },
    });
    setIsSubmitting(false);
    setMessage(error ? error.message : "登录链接已发送，请打开邮箱完成登录。");
  };

  return (
    <main className="grid min-h-[100dvh] place-items-center bg-[var(--background)] px-4 text-[var(--text)]">
      <section className="w-full max-w-sm rounded-[18px] border border-[var(--border)] bg-white p-5 shadow-[var(--soft-shadow)]">
        <AppMark />
        <h1 className="mt-5 text-xl font-semibold">登录 Smart Shelf</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          这个库存系统只给你自己使用。请输入 Supabase Auth 允许登录的邮箱。
        </p>
        <label className="mt-5 block text-sm font-medium">邮箱</label>
        <input
          className="mt-2 w-full rounded-[14px] border border-[var(--border)] bg-white px-4 py-3 outline-none focus:border-[var(--accent)]"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
        />
        <button
          className="mt-4 w-full rounded-[14px] bg-[var(--accent)] px-4 py-3 font-semibold text-white disabled:opacity-40"
          disabled={!email.trim() || isSubmitting}
          onClick={signIn}
        >
          {isSubmitting ? "发送中" : "发送登录链接"}
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

function ModeSwitch({
  appMode,
  onChange,
  compact = false,
}: {
  appMode: AppMode;
  onChange: (mode: AppMode) => void;
  compact?: boolean;
}) {
  return (
    <div className={`grid grid-cols-2 rounded-[14px] border border-[var(--border)] bg-white p-1 ${compact ? "w-[164px]" : "mb-5"}`}>
      {[
        ["workbench", "工作台"],
        ["admin", "后台"],
      ].map(([mode, label]) => (
        <button
          key={mode}
          className="rounded-[11px] px-3 py-2 text-xs font-semibold transition"
          style={{
            background: appMode === mode ? "var(--accent)" : "transparent",
            color: appMode === mode ? "#fff" : "var(--muted)",
          }}
          onClick={() => onChange(mode as AppMode)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function DuplicateRackNotice({ rackCount, onOpenAdmin }: { rackCount: number; onOpenAdmin: () => void }) {
  return (
    <button
      className="mt-3 w-full rounded-[14px] border border-[var(--warning)] bg-[var(--warning-soft)] px-4 py-3 text-left"
      onClick={onOpenAdmin}
    >
      <p className="text-sm font-semibold text-[var(--text)]">检测到 {rackCount} 个 Rack</p>
      <p className="mt-1 text-xs leading-5 text-[var(--muted)]">主工作台已只显示当前 Rack。进后台可查看重复来源。</p>
    </button>
  );
}

function ModeBadge() {
  return (
    <div className="rounded-full bg-[var(--surface-soft)] px-3 py-1.5 text-xs text-[var(--muted)]">
      {hasSupabaseEnv ? "Supabase" : "Demo"}
    </div>
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
        <div className="grid grid-cols-4 gap-2">
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

function MobileHeader({
  section,
  slot,
  viewMode,
  appMode,
  onModeChange,
  onBack,
}: {
  section?: Section;
  slot?: Slot;
  viewMode: ViewMode;
  appMode: AppMode;
  onModeChange: (mode: AppMode) => void;
  onBack: () => void;
}) {
  const title =
    appMode === "admin"
      ? "后台"
      : viewMode === "rack"
        ? "货架"
        : viewMode === "section"
          ? `${section?.code} | ${section?.name}`
          : slot?.code;
  const activeStep = viewMode === "rack" ? "货架" : viewMode === "section" ? "分区" : "储位";

  return (
    <header className="sticky top-0 z-20 border-b border-[var(--border)] bg-[var(--background)]/94 px-4 py-3 backdrop-blur lg:hidden">
      <div className="flex items-center gap-3">
        <button
          className="grid h-10 w-10 place-items-center rounded-full bg-white text-xl shadow-sm active:scale-95 disabled:opacity-35"
          onClick={onBack}
          disabled={viewMode === "rack"}
          aria-label="返回"
        >
          ‹
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold">{title ?? "A2"}</h1>
          <p className="truncate text-sm text-[var(--muted)]">Rack-1 / {section?.code} {section?.name}</p>
        </div>
        <button
          className="rounded-full bg-white px-3 py-2 text-xs font-semibold text-[var(--muted)] shadow-sm"
          onClick={() => onModeChange(appMode === "admin" ? "workbench" : "admin")}
        >
          {appMode === "admin" ? "工作台" : "后台"}
        </button>
      </div>
      {appMode === "workbench" ? <div className="mt-3 grid grid-cols-4 gap-2 text-center text-xs text-[var(--muted)]">
        {["货架", "分区", "储位", "库存"].map((label) => (
          <span
            key={label}
            className="rounded-full bg-white px-2 py-1.5 data-[active=true]:bg-[var(--accent-soft)] data-[active=true]:font-medium data-[active=true]:text-[var(--accent-deep)]"
            data-active={label === activeStep || (viewMode === "slot" && label === "库存")}
          >
            {label}
          </span>
        ))}
      </div> : null}
    </header>
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

function SectionNavItem({
  section,
  active,
  total,
  filledSlots,
  onSelect,
}: {
  section: Section;
  active: boolean;
  total: number;
  filledSlots: number;
  onSelect: () => void;
}) {
  return (
    <button
      className="w-full rounded-[14px] border bg-white p-3 text-left transition active:scale-[0.99]"
      style={{
        borderColor: active ? "var(--accent)" : "var(--border)",
        background: active ? "var(--accent-soft)" : "var(--surface)",
      }}
      onClick={onSelect}
    >
      <div className="flex items-center gap-3">
        <span
          className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] text-sm font-semibold"
          style={{
            background: active ? "var(--accent)" : "var(--surface-soft)",
            color: active ? "#fff" : "var(--text)",
          }}
        >
          {section.code}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{section.name}</span>
          <span className="mt-1 block text-xs text-[var(--muted)]">
            {filledSlots}/5 Slot 有货 · {quantityFormatter.format(total)} 件
          </span>
        </span>
      </div>
    </button>
  );
}

function MobileSectionList({
  rackName,
  sections,
  selectedSectionId,
  totalForSection,
  filledSlotsForSection,
  onSelect,
  onRename,
}: {
  rackName: string;
  sections: Section[];
  selectedSectionId: string;
  totalForSection: (sectionId: string) => number;
  filledSlotsForSection: (sectionId: string) => number;
  onSelect: (section: Section) => void;
  onRename: (section: Section) => void;
}) {
  return (
    <div>
      <PanelTitle title={rackName} subtitle="选择一个固定分区" />
      <div className="mt-4 space-y-3">
        {sections.map((section) => (
          <div key={section.id} className="rounded-[14px] border border-[var(--border)] bg-white p-1">
            <SectionNavItem
              section={section}
              active={section.id === selectedSectionId}
              total={totalForSection(section.id)}
              filledSlots={filledSlotsForSection(section.id)}
              onSelect={() => onSelect(section)}
            />
            <button
              className="ml-auto mr-2 block rounded-full px-3 py-1 text-xs text-[var(--muted)] hover:bg-[var(--surface-soft)]"
              onClick={() => onRename(section)}
            >
              改名
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ShelfMapPanel({
  section,
  slots,
  selectedSlotId,
  productsForSlot,
  totalForSlot,
  onSelectSlot,
}: {
  section?: Section;
  slots: Slot[];
  selectedSlotId: string;
  productsForSlot: (slotId: string) => number;
  totalForSlot: (slotId: string) => number;
  onSelectSlot: (slot: Slot) => void;
}) {
  const sectionTotal = slots.reduce((total, slot) => total + totalForSlot(slot.id), 0);
  const filled = slots.filter((slot) => productsForSlot(slot.id) > 0).length;

  return (
    <div className="rounded-[18px] border border-[var(--border)] bg-white p-4 shadow-[var(--soft-shadow)] lg:min-h-[calc(100dvh-150px)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PanelTitle
          title={`${section?.code ?? "A"} | ${section?.name ?? "海报区"}`}
          subtitle="固定 5 个 Slot"
        />
        <div className="flex gap-2">
          <MetricPill label="本区库存" value={`${sectionTotal} 件`} />
          <MetricPill label="占用" value={`${filled}/5`} />
        </div>
      </div>

      <div className="mt-5 grid grid-cols-5 gap-2 lg:grid-cols-1 xl:grid-cols-5">
        {slots.map((slot) => (
          <SlotTile
            key={slot.id}
            slot={slot}
            active={slot.id === selectedSlotId}
            products={productsForSlot(slot.id)}
            total={totalForSlot(slot.id)}
            onSelect={() => onSelectSlot(slot)}
          />
        ))}
      </div>

      <div className="mt-5 grid gap-2 sm:grid-cols-3">
        <ShelfRule label="分区固定" value="A-E" />
        <ShelfRule label="Slot 固定" value="每区 1-5" />
        <ShelfRule label="移动对象" value="Inventory" />
      </div>
    </div>
  );
}

function ShelfRule({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[14px] bg-[var(--surface-soft)] px-3 py-3">
      <p className="text-[11px] text-[var(--muted)]">{label}</p>
      <p className="mt-1 text-sm font-semibold">{value}</p>
    </div>
  );
}

function SlotTile({
  slot,
  active,
  products,
  total,
  onSelect,
}: {
  slot: Slot;
  active: boolean;
  products: number;
  total: number;
  onSelect: () => void;
}) {
  const tone = getStockTone(total);

  return (
    <button
      className="min-h-[116px] rounded-[14px] border bg-white p-3 text-left transition active:scale-[0.98]"
      style={{
        borderColor: active ? "var(--accent)" : "var(--border)",
        boxShadow: active ? "0 0 0 3px color-mix(in srgb, var(--accent) 14%, transparent)" : "none",
      }}
      onClick={onSelect}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-base font-semibold">{slot.code}</span>
        <StockDot tone={tone} />
      </div>
      <div className="mt-5">
        <p className="text-2xl font-semibold leading-none">{total}</p>
        <p className="mt-2 text-xs text-[var(--muted)]">{products} 个商品记录</p>
      </div>
    </button>
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
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-[var(--muted)]">{section?.code} {section?.name}</p>
          <h2 className="mt-1 text-2xl font-semibold">{slot?.code ?? "A2"} 库存</h2>
        </div>
        <div className="rounded-[14px] bg-[var(--accent-soft)] px-3 py-2 text-right">
          <p className="text-[11px] text-[var(--accent-deep)]">当前合计</p>
          <p className="text-sm font-semibold text-[var(--accent-deep)]">{total} 件</p>
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

      <div className="mt-5 hidden rounded-[14px] border border-[var(--border)] bg-[var(--background)] p-2 lg:flex">
        <button className="flex-1 rounded-[12px] px-4 py-3 text-sm font-medium text-[var(--muted)]" onClick={onOpenAdd}>
          上传图片
        </button>
        <button
          className="flex-1 rounded-[12px] px-4 py-3 text-sm font-medium text-[var(--muted)] disabled:opacity-40"
          onClick={onOpenMove}
          disabled={!inventory.length}
        >
          移动库存
        </button>
        <button className="flex-1 rounded-[12px] bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white" onClick={onOpenAdd}>
          添加库存
        </button>
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
  onSelectWorkbench,
}: {
  data: ShelfData;
  activeRack?: { id: string; name: string };
  activeSections: Section[];
  activeSlots: Slot[];
  activeInventory: Inventory[];
  movements: InventoryMovement[];
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
          <PanelTitle title="后台总览" subtitle="数据诊断、操作历史和整理规则" />
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

        <div className="grid gap-5 xl:grid-cols-[1fr_390px]">
          <section className="rounded-[18px] border border-[var(--border)] bg-white p-4 shadow-[var(--soft-shadow)]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">Rack 诊断</h2>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  主工作台只显示第一组 Rack。这里保留所有可见 Rack，方便确认重复 A 的来源。
                </p>
              </div>
              <span className="rounded-full bg-[var(--surface-soft)] px-3 py-1.5 text-xs text-[var(--muted)]">
                共 {data.racks.length} 个 Rack
              </span>
            </div>

            <div className="mt-4 overflow-hidden rounded-[14px] border border-[var(--border)]">
              <div className="grid grid-cols-[1fr_88px_88px_96px] bg-[var(--surface-soft)] px-3 py-2 text-xs font-medium text-[var(--muted)]">
                <span>Rack</span>
                <span>Section</span>
                <span>Slot</span>
                <span className="text-right">库存</span>
              </div>
              {rackDiagnostics.map(({ rack, sections, slots, quantity }) => (
                <div
                  key={rack.id}
                  className="grid grid-cols-[1fr_88px_88px_96px] border-t border-[var(--border)] px-3 py-3 text-sm"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{rack.name}</span>
                    <span className="mt-1 block truncate text-xs text-[var(--muted)]">{rack.id}</span>
                  </span>
                  <span>{sections.length}</span>
                  <span>{slots.length}</span>
                  <span className="text-right font-semibold">{quantity}</span>
                </div>
              ))}
            </div>

            {data.racks.length > 1 ? (
              <div className="mt-4 rounded-[14px] border border-[var(--warning)] bg-[var(--warning-soft)] p-4">
                <p className="text-sm font-semibold">你看到多个 A，是因为数据库里有多组 Rack/Section。</p>
                <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                  我已经让工作台只使用当前 Rack，所以页面不会再混在一起。是否删除空的重复 Rack 要看里面有没有库存，建议先在 Supabase SQL 里确认再清理。
                </p>
              </div>
            ) : null}
          </section>

          <section className="rounded-[18px] border border-[var(--border)] bg-white p-4 shadow-[var(--soft-shadow)]">
            <h2 className="text-base font-semibold">整理规则</h2>
            <div className="mt-4 space-y-3">
              <RuleRow title="归档库存" detail="从工作台隐藏，保留历史记录，适合暂时不用但不想丢的数据。" />
              <RuleRow title="删除库存" detail="软删除并写入操作历史，不直接物理删除数据库行。" />
              <RuleRow title="0 库存" detail="保留在当前 Slot，筛选“有货”时隐藏，方便以后继续加数量。" />
              <RuleRow title="商品图片" detail="上传文件会先压缩为 WebP，再进入 Supabase Storage。" />
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

function RuleRow({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-[14px] bg-[var(--surface-soft)] px-3 py-3">
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{detail}</p>
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

function StockDot({ tone }: { tone: StockTone }) {
  return (
    <span
      className="mt-1 h-2.5 w-2.5 rounded-full"
      style={{ background: getStockColor(tone) }}
      aria-hidden="true"
    />
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

function BottomActionBar({
  onAdd,
  onMove,
  disabled,
  hasInventory,
}: {
  onAdd: () => void;
  onMove: () => void;
  disabled: boolean;
  hasInventory: boolean;
}) {
  return (
    <nav className="fixed inset-x-4 bottom-[calc(14px+env(safe-area-inset-bottom))] z-30 rounded-[18px] border border-[var(--border)] bg-white/94 p-2 shadow-[var(--shadow)] backdrop-blur lg:hidden">
      <div className="grid grid-cols-[1fr_1fr_1.25fr] gap-2">
        <button className="rounded-[14px] px-3 py-3 text-sm font-medium text-[var(--muted)]" onClick={onAdd}>
          图片
        </button>
        <button
          className="rounded-[14px] px-3 py-3 text-sm font-medium text-[var(--muted)] disabled:opacity-40"
          onClick={onMove}
          disabled={disabled || !hasInventory}
        >
          移动
        </button>
        <button
          className="rounded-[14px] bg-[var(--accent)] px-3 py-3 text-sm font-semibold text-white active:scale-[0.98] disabled:opacity-40"
          onClick={onAdd}
          disabled={disabled}
        >
          添加库存
        </button>
      </div>
    </nav>
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
