# Smart Shelf V1

Smart Shelf V1 is a fixed-structure visual inventory PWA for real shelf positions.

The product path is locked:

```text
Rack -> Section -> Slot -> Inventory
```

## What Is Included

- Next.js App Router app
- Responsive mobile PWA and desktop web UI
- Local demo mode backed by `localStorage`
- Supabase mode when public Supabase env vars are configured
- Supabase Auth gate for private single-person use
- PWA manifest and service worker
- Supabase-ready SQL schema and seed data
- Inventory merge rules and movement history table
- Supabase Storage image upload with browser-side WebP compression
- Product search, stock filters, archive/delete, and recent operation history
- Vercel-ready project config

## Local Development

```bash
pnpm install
pnpm run dev
```

Open `http://127.0.0.1:3000`.

Without Supabase environment variables, the app runs in local demo mode and stores inventory in the browser.

## Supabase Setup

1. Create a Supabase project.
2. In Authentication, enable Email OTP / magic link sign-in.
3. Add your app URL to Authentication redirect URLs. For local development, include `http://127.0.0.1:3000`.
4. Open the Supabase SQL editor.
5. Run `supabase/schema.sql`.
6. Copy your project URL and anon key.
7. Create `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

This project is configured as a private single-person inventory app. Users must sign in with Supabase Auth before reading or writing data. Row-level security uses `auth.uid()` ownership, so anonymous visitors cannot read or mutate your inventory.

On first login, the app calls `ensure_default_shelf()` to create your default `Rack-1`, sections `A-E`, and slots `A1-E5`.

The schema creates a public Supabase Storage bucket:

```text
product-images
```

Uploaded images are compressed in the browser to WebP before upload. The bucket only allows `image/webp` and caps files at 5 MB.

The schema also enforces:

- Product names are unique.
- The same product can appear only once inside the same slot.
- Adding the same product to the same slot increases quantity instead of creating a duplicate row.
- Moving inventory into a slot that already has the same product merges the quantity.
- Inventory moves, merges, archives, and deletes are recorded in `inventory_movements`.
- Archive and delete are soft actions. Archived/deleted inventory is hidden from the main UI.

## Runtime Cache Fix

If Next.js dev mode shows an error like `Cannot find module './607.js'`, stop the dev server and remove the generated cache:

```bash
Remove-Item -LiteralPath .next -Recurse -Force
pnpm run dev
```

This happens when the dev server keeps a stale `.next/server` chunk after hot updates.

## Vercel Deploy

1. Import this repository into Vercel.
2. Set the same environment variables:

```bash
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
```

3. In Supabase Authentication redirect URLs, add your Vercel production URL.
4. Deploy with the default Next.js settings.

## Product Rules

- Sections are fixed: `A`, `B`, `C`, `D`, `E`.
- Section names can be edited.
- Sections cannot be added or deleted.
- Each section has exactly five deterministic slots, such as `A1` through `A5`.
- A slot is only a container.
- Inventory records live inside slots.
- Quantity belongs to inventory, not to the product globally.
- Product is not moved directly. Only inventory records move between slots.
- Duplicate product inventory in the same slot is merged into one inventory record.
- Zero-quantity inventory remains visible unless it is archived or deleted.
