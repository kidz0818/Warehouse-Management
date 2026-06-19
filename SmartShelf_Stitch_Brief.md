# Smart Shelf V1 Stitch Brief

Project: `projects/16932391593237944643`

Design read: fixed-structure inventory PWA and desktop web tool for real shelf memory. Visual language is iOS Settings + Notion Card Hybrid, with Apple Store spacing, calm single-task screens, and a restrained neon orange accent.

## Locked Product Rules

- Product definition: Smart Shelf V1 is a visual inventory tool for remembering real shelf locations.
- Only navigation path: Rack -> Section -> Slot -> Inventory.
- Sections are fixed: A, B, C, D, E.
- Default section names:
  - A 海报区
  - B 拍立得区
  - C 周边区
  - D 包材区
  - E 备用区
- Section cannot be added or deleted. Only name can be edited.
- Every section has exactly five slots: 1, 2, 3, 4, 5.
- Slot codes are deterministic: A1-A5, B1-B5, C1-C5, D1-D5, E1-E5.
- Slot is a container, not a hierarchy.
- Inventory is the record inside a slot.
- Same slot can contain multiple products.
- Quantity belongs to Inventory.
- Product cannot be moved directly. Only Inventory can move to another Slot.

## Visual Lock

- Style: iOS Settings + Notion Card Hybrid.
- Spacing: Apple Store-like, generous but still functional.
- Background: `#F7F7F8`.
- Surface: `#FFFFFF`.
- Text: `#111113`.
- Muted text: `#6B6B72`.
- Border: `#E7E7EA`.
- Accent: `#FF6A3D`.
- Card radius: `14px`.
- One screen does one thing.
- No dense tables.
- Primary actions live in a bottom floating action bar.
- No AI recognition, auto classification, tags, warehouse maps, complex permissions, or batch logic trees.

## Mobile PWA Prompt

Create a polished mobile PWA product design for Smart Shelf V1, a visual inventory tool that maps real shelf positions. It must be an actual app interface, not a marketing page.

Core product definition: Smart Shelf V1 is a visual inventory tool for remembering real shelf locations using a fixed structure. The only path is Rack -> Section -> Slot -> Inventory.

Frozen structure:
- Multiple Rack records exist, but show Rack-1 as current.
- Every rack has exactly 5 sections, fixed codes A, B, C, D, E.
- Section names can be edited, but sections cannot be added or deleted.
- Default section names in Chinese:
  A 海报区
  B 拍立得区
  C 周边区
  D 包材区
  E 备用区
- Every section has exactly 5 slots. For section A, slots are A1 A2 A3 A4 A5. Slot is only a container.
- Inventory records live inside slots. Same slot can contain multiple products. Quantity belongs to Inventory.
- Product cannot be moved directly. Only Inventory can be moved to another Slot.

Design language, locked:
- iOS Settings + Notion Card Hybrid.
- Apple Store spacing, calm and premium but work-focused.
- Background #F7F7F8.
- White cards #FFFFFF.
- Text #111113, muted text #6B6B72, border #E7E7EA.
- Single accent #FF6A3D used sparingly for active slot, primary add button, quantity adjustment emphasis.
- Card corner radius exactly 14px.
- One screen does one thing. No dense tables.
- All primary operations use a bottom floating action bar, safe-area aware.
- No purple gradients, no decorative blobs, no busy dashboard widgets, no marketing hero.
- Use clean SF Pro / system font style.

Make one mobile artboard showing the core PWA experience in a realistic composite: current state is Slot page A2, with a back path and context that makes the Rack -> Section -> Slot hierarchy clear.

Layout requirements:
- iPhone-sized mobile screen.
- Top navigation: back chevron, title "A2", subtitle "Rack-1 / A 海报区".
- A small horizontal breadcrumb or compact step indicator showing Rack, Section, Slot, Inventory. Keep it subtle, not decorative.
- A compact section strip showing fixed slots A1 A2 A3 A4 A5, with A2 selected using #FF6A3D ring/fill. Stable fixed tile sizes.
- Main content: Inventory list inside A2. Use 2-3 realistic product rows:
  1. LiSA 海报, quantity 10
  2. Tomorin 海报, quantity 5
  3. MyGO!!!!! 海报, quantity 2
- Each inventory row has a small image thumbnail placeholder that looks like a real uploaded product photo slot, product name, slot code A2, and a quantity stepper with minus and plus icon buttons. Quantity must be visually tied to inventory, not product globally.
- Include an empty/add product affordance but keep it calm.
- Bottom floating bar: Upload image, Move inventory, primary Add button. Use icon-style controls where possible. Move inventory should look secondary and not imply moving product directly.
- Include an overflow menu affordance for secondary actions such as edit section name.

Chinese UI labels preferred: 货架, 海报区, 商品, 增加, 减少, 上传图片, 移动, 添加.

Output should look like a high-fidelity app design ready for development. Avoid wireframe gray boxes except for photo placeholders. Ensure text fits and does not overlap.

## Desktop Web Prompt

Create a polished desktop web product design for Smart Shelf V1, a visual inventory tool that maps real shelf positions. It must be a usable desktop app interface, not a marketing page and not a dense admin dashboard.

Core path is locked: Rack -> Section -> Slot -> Inventory. Preserve this path visually and behaviorally.

Frozen structure:
- Show Rack-1 as selected.
- Rack has exactly 5 sections: A 海报区, B 拍立得区, C 周边区, D 包材区, E 备用区.
- Sections cannot be added or deleted. Only names can be edited.
- Each section has exactly 5 slots. Selected section A shows A1 A2 A3 A4 A5.
- Slot is a container.
- Inventory records live inside slots. Same slot can contain multiple products.
- Quantity belongs to Inventory.
- Product cannot be moved directly. Only Inventory can move to another Slot.

Design language, locked:
- iOS Settings + Notion Card Hybrid adapted for desktop.
- Apple Store spacing, calm scan rhythm, no spreadsheet feel.
- Background #F7F7F8.
- White cards #FFFFFF.
- Text #111113, muted text #6B6B72, border #E7E7EA.
- Accent #FF6A3D used only for selected state and primary action.
- Card radius exactly 14px.
- No dense tables, no dashboard metric clutter, no purple gradients, no decorative blobs.
- Keep the app work-focused and visually quiet.

Desktop layout requirements:
- 1440px desktop artboard.
- Left rail: app name Smart Shelf, Rack-1 selected, small Rack-2 placeholder as future expansion, but Rack-1 is active.
- Main column: Section list for Rack-1 with five fixed section cards:
  A 海报区
  B 拍立得区
  C 周边区
  D 包材区
  E 备用区
  Each card should show fixed slot count "5 slots" and a subtle inventory total.
- Center workspace: selected section A 海报区 with a five-slot shelf strip/grid: A1 A2 A3 A4 A5. A2 is selected. Use stable tile sizes and show product count / total quantity inside each tile.
- Right inspector panel: selected Slot A2 with inventory list:
  1. LiSA 海报 x10
  2. Tomorin 海报 x5
  3. MyGO!!!!! 海报 x2
  Each inventory row has a thumbnail, product name, quantity stepper, and overflow menu.
- Bottom floating action bar inside the right inspector or spanning the workspace: Upload image, Move inventory, Add inventory. Add is primary orange #FF6A3D. Move is secondary and must say Move inventory or 移动库存, not move product.
- Include a compact breadcrumb at top: Rack-1 / A 海报区 / A2 / Inventory.
- Include an edit affordance for section name but do not imply adding or deleting sections.

Chinese UI labels preferred: 货架, 区域, 海报区, 商品, 增加, 减少, 上传图片, 移动库存, 添加库存.

Output should feel ready for development as a desktop web app and should remain visually aligned with the mobile PWA.
