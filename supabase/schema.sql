create extension if not exists "pgcrypto";

do $$ begin
  create type section_code as enum ('A', 'B', 'C', 'D', 'E');
exception
  when duplicate_object then null;
end $$;

create table if not exists racks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists sections (
  id uuid primary key default gen_random_uuid(),
  rack_id uuid not null references racks(id) on delete cascade,
  code section_code not null,
  name text not null,
  created_at timestamptz not null default now(),
  unique (rack_id, code)
);

create table if not exists slots (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references sections(id) on delete cascade,
  code text not null,
  created_at timestamptz not null default now(),
  unique (section_id, code)
);

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  name text not null,
  image text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists inventory (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  slot_id uuid not null references slots(id) on delete cascade,
  quantity integer not null default 0 check (quantity >= 0),
  archived_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists inventory_movements (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  inventory_id uuid,
  product_id uuid references products(id) on delete set null,
  product_name text not null,
  from_slot_id uuid references slots(id) on delete set null,
  to_slot_id uuid references slots(id) on delete set null,
  from_slot_code text,
  to_slot_code text,
  quantity_snapshot integer not null check (quantity_snapshot >= 0),
  action text not null default 'moved',
  note text,
  created_at timestamptz not null default now()
);

do $$ begin
  alter table racks add column if not exists owner_id uuid references auth.users(id) on delete cascade;
  alter table products add column if not exists owner_id uuid references auth.users(id) on delete cascade;
  alter table products add column if not exists image text;
  alter table products add column if not exists archived_at timestamptz;
  alter table products add column if not exists created_at timestamptz not null default now();
  alter table products add column if not exists updated_at timestamptz not null default now();
  alter table inventory add column if not exists archived_at timestamptz;
  alter table inventory add column if not exists deleted_at timestamptz;
  alter table inventory add column if not exists created_at timestamptz not null default now();
  alter table inventory add column if not exists updated_at timestamptz not null default now();
  alter table inventory_movements add column if not exists owner_id uuid references auth.users(id) on delete cascade;
  alter table inventory_movements add column if not exists product_id uuid references products(id) on delete set null;
  alter table inventory_movements add column if not exists product_name text;
  alter table inventory_movements add column if not exists from_slot_code text;
  alter table inventory_movements add column if not exists to_slot_code text;
  alter table inventory_movements add column if not exists action text not null default 'moved';
  alter table inventory_movements add column if not exists note text;
end $$;

update racks set owner_id = auth.uid() where owner_id is null and auth.uid() is not null;
update products set owner_id = auth.uid() where owner_id is null and auth.uid() is not null;
update inventory_movements set owner_id = auth.uid() where owner_id is null and auth.uid() is not null;

create index if not exists idx_racks_owner_id on racks(owner_id);
create index if not exists idx_sections_rack_id on sections(rack_id);
create index if not exists idx_slots_section_id on slots(section_id);
create index if not exists idx_slots_code on slots(code);
create index if not exists idx_products_owner_name on products(owner_id, name);
create index if not exists idx_inventory_slot_id on inventory(slot_id);
create index if not exists idx_inventory_product_id on inventory(product_id);
create index if not exists idx_inventory_active on inventory(slot_id, product_id) where deleted_at is null and archived_at is null;
create index if not exists idx_inventory_movements_owner_created_at on inventory_movements(owner_id, created_at desc);

do $$ begin
  alter table slots drop constraint if exists slots_code_is_deterministic;
end $$;

do $$ begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'products_owner_name_unique'
      and conrelid = 'products'::regclass
  ) then
    alter table products add constraint products_owner_name_unique unique (owner_id, name);
  end if;
end $$;

do $$ begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'inventory_product_slot_unique'
      and conrelid = 'inventory'::regclass
  ) then
    alter table inventory add constraint inventory_product_slot_unique unique (product_id, slot_id);
  end if;
end $$;

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists inventory_set_updated_at on inventory;
create trigger inventory_set_updated_at
before update on inventory
for each row execute function set_updated_at();

drop trigger if exists products_set_updated_at on products;
create trigger products_set_updated_at
before update on products
for each row execute function set_updated_at();

create or replace function current_user_owns_rack(p_rack_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from racks
    where racks.id = p_rack_id
      and racks.owner_id = auth.uid()
  );
$$;

create or replace function current_user_owns_section(p_section_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from sections
    join racks on racks.id = sections.rack_id
    where sections.id = p_section_id
      and racks.owner_id = auth.uid()
  );
$$;

create or replace function current_user_owns_slot(p_slot_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from slots
    join sections on sections.id = slots.section_id
    join racks on racks.id = sections.rack_id
    where slots.id = p_slot_id
      and racks.owner_id = auth.uid()
  );
$$;

alter table racks enable row level security;
alter table sections enable row level security;
alter table slots enable row level security;
alter table products enable row level security;
alter table inventory enable row level security;
alter table inventory_movements enable row level security;

drop policy if exists "Public read racks" on racks;
drop policy if exists "Public write racks" on racks;
drop policy if exists "Public read sections" on sections;
drop policy if exists "Public write sections" on sections;
drop policy if exists "Public read slots" on slots;
drop policy if exists "Public write slots" on slots;
drop policy if exists "Public read products" on products;
drop policy if exists "Public write products" on products;
drop policy if exists "Public read inventory" on inventory;
drop policy if exists "Public write inventory" on inventory;
drop policy if exists "Public read inventory movements" on inventory_movements;
drop policy if exists "Public write inventory movements" on inventory_movements;
drop policy if exists "Owner read racks" on racks;
drop policy if exists "Owner write racks" on racks;
drop policy if exists "Owner read sections" on sections;
drop policy if exists "Owner write sections" on sections;
drop policy if exists "Owner read slots" on slots;
drop policy if exists "Owner write slots" on slots;
drop policy if exists "Owner read products" on products;
drop policy if exists "Owner write products" on products;
drop policy if exists "Owner read inventory" on inventory;
drop policy if exists "Owner write inventory" on inventory;
drop policy if exists "Owner read inventory movements" on inventory_movements;
drop policy if exists "Owner write inventory movements" on inventory_movements;

create policy "Owner read racks" on racks
for select using (owner_id = auth.uid());

create policy "Owner write racks" on racks
for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "Owner read sections" on sections
for select using (current_user_owns_rack(rack_id));

create policy "Owner write sections" on sections
for all using (current_user_owns_rack(rack_id)) with check (current_user_owns_rack(rack_id));

create policy "Owner read slots" on slots
for select using (current_user_owns_section(section_id));

create policy "Owner write slots" on slots
for all using (current_user_owns_section(section_id)) with check (current_user_owns_section(section_id));

create policy "Owner read products" on products
for select using (owner_id = auth.uid());

create policy "Owner write products" on products
for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "Owner read inventory" on inventory
for select using (
  exists (
    select 1
    from products
    where products.id = inventory.product_id
      and products.owner_id = auth.uid()
  )
);

create policy "Owner write inventory" on inventory
for all using (
  exists (
    select 1
    from products
    where products.id = inventory.product_id
      and products.owner_id = auth.uid()
  )
) with check (
  exists (
    select 1
    from products
    where products.id = inventory.product_id
      and products.owner_id = auth.uid()
  )
  and current_user_owns_slot(slot_id)
);

create policy "Owner read inventory movements" on inventory_movements
for select using (owner_id = auth.uid());

create policy "Owner write inventory movements" on inventory_movements
for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 5242880, array['image/webp'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public read product images" on storage.objects;
drop policy if exists "Public upload product images" on storage.objects;
drop policy if exists "Public update product images" on storage.objects;
drop policy if exists "Public delete product images" on storage.objects;
drop policy if exists "Owner read product images" on storage.objects;
drop policy if exists "Owner upload product images" on storage.objects;
drop policy if exists "Owner update product images" on storage.objects;
drop policy if exists "Owner delete product images" on storage.objects;

create policy "Owner read product images" on storage.objects
for select using (bucket_id = 'product-images');

create policy "Owner upload product images" on storage.objects
for insert with check (
  bucket_id = 'product-images'
  and auth.role() = 'authenticated'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Owner update product images" on storage.objects
for update using (
  bucket_id = 'product-images'
  and (storage.foldername(name))[1] = auth.uid()::text
) with check (
  bucket_id = 'product-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Owner delete product images" on storage.objects
for delete using (
  bucket_id = 'product-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create or replace function ensure_default_shelf()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid := auth.uid();
  v_rack_id uuid;
begin
  if v_owner is null then
    raise exception 'Not authenticated';
  end if;

  select id into v_rack_id
  from racks
  where owner_id = v_owner
  order by created_at
  limit 1;

  if v_rack_id is null then
    insert into racks (owner_id, name)
    values (v_owner, 'Rack-1')
    returning id into v_rack_id;
  end if;

  insert into sections (rack_id, code, name)
  select racks.id, section_seed.code::section_code, section_seed.name
  from racks
  cross join (
    values
      ('A', '海报区'),
      ('B', '拍立得区'),
      ('C', '周边区'),
      ('D', '包材区'),
      ('E', '备用区')
  ) as section_seed(code, name)
  where racks.owner_id = v_owner
  on conflict (rack_id, code) do update set name = excluded.name;

  insert into slots (section_id, code)
  select sections.id, sections.code::text || '1'
  from sections
  join racks on racks.id = sections.rack_id
  where racks.owner_id = v_owner
    and not exists (
      select 1
      from slots
      where slots.section_id = sections.id
    )
  on conflict (section_id, code) do nothing;
end;
$$;

create or replace function move_inventory_record(p_inventory_id uuid, p_target_slot_id uuid)
returns uuid
language plpgsql
security invoker
as $$
declare
  v_owner uuid := auth.uid();
  v_product_id uuid;
  v_product_name text;
  v_from_slot_id uuid;
  v_from_slot_code text;
  v_to_slot_code text;
  v_quantity integer;
  v_existing_inventory_id uuid;
begin
  if v_owner is null then
    raise exception 'Not authenticated';
  end if;

  select inventory.product_id, products.name, inventory.slot_id, slots.code, inventory.quantity
  into v_product_id, v_product_name, v_from_slot_id, v_from_slot_code, v_quantity
  from inventory
  join products on products.id = inventory.product_id
  join slots on slots.id = inventory.slot_id
  where inventory.id = p_inventory_id
    and products.owner_id = v_owner
    and inventory.deleted_at is null;

  if not found then
    raise exception 'Inventory record % does not exist', p_inventory_id;
  end if;

  if not current_user_owns_slot(p_target_slot_id) then
    raise exception 'Target slot % does not belong to current user', p_target_slot_id;
  end if;

  select code into v_to_slot_code
  from slots
  where id = p_target_slot_id;

  if v_from_slot_id = p_target_slot_id then
    return p_inventory_id;
  end if;

  select inventory.id
  into v_existing_inventory_id
  from inventory
  join products on products.id = inventory.product_id
  where inventory.product_id = v_product_id
    and inventory.slot_id = p_target_slot_id
    and inventory.id <> p_inventory_id
    and products.owner_id = v_owner
    and inventory.deleted_at is null
    and inventory.archived_at is null
  limit 1;

  if v_existing_inventory_id is not null then
    update inventory
    set quantity = quantity + v_quantity
    where id = v_existing_inventory_id;

    update inventory
    set deleted_at = now()
    where id = p_inventory_id;

    insert into inventory_movements (
      owner_id,
      inventory_id,
      product_id,
      product_name,
      from_slot_id,
      to_slot_id,
      from_slot_code,
      to_slot_code,
      quantity_snapshot,
      action,
      note
    )
    values (
      v_owner,
      v_existing_inventory_id,
      v_product_id,
      v_product_name,
      v_from_slot_id,
      p_target_slot_id,
      v_from_slot_code,
      v_to_slot_code,
      v_quantity,
      'merged',
      'merged into existing inventory'
    );

    return v_existing_inventory_id;
  end if;

  update inventory
  set slot_id = p_target_slot_id
  where id = p_inventory_id;

  insert into inventory_movements (
    owner_id,
    inventory_id,
    product_id,
    product_name,
    from_slot_id,
    to_slot_id,
    from_slot_code,
    to_slot_code,
    quantity_snapshot,
    action,
    note
  )
  values (
    v_owner,
    p_inventory_id,
    v_product_id,
    v_product_name,
    v_from_slot_id,
    p_target_slot_id,
    v_from_slot_code,
    v_to_slot_code,
    v_quantity,
    'moved',
    'moved'
  );

  return p_inventory_id;
end;
$$;

create or replace function archive_inventory_record(p_inventory_id uuid)
returns void
language plpgsql
security invoker
as $$
declare
  v_owner uuid := auth.uid();
  v_product_id uuid;
  v_product_name text;
  v_slot_id uuid;
  v_slot_code text;
  v_quantity integer;
begin
  if v_owner is null then
    raise exception 'Not authenticated';
  end if;

  select inventory.product_id, products.name, inventory.slot_id, slots.code, inventory.quantity
  into v_product_id, v_product_name, v_slot_id, v_slot_code, v_quantity
  from inventory
  join products on products.id = inventory.product_id
  join slots on slots.id = inventory.slot_id
  where inventory.id = p_inventory_id
    and products.owner_id = v_owner
    and inventory.deleted_at is null;

  if not found then
    return;
  end if;

  update inventory
  set archived_at = now()
  where id = p_inventory_id;

  insert into inventory_movements (
    owner_id,
    inventory_id,
    product_id,
    product_name,
    from_slot_id,
    from_slot_code,
    quantity_snapshot,
    action,
    note
  )
  values (
    v_owner,
    p_inventory_id,
    v_product_id,
    v_product_name,
    v_slot_id,
    v_slot_code,
    v_quantity,
    'archived',
    'archived inventory record'
  );
end;
$$;

create or replace function delete_inventory_record(p_inventory_id uuid)
returns void
language plpgsql
security invoker
as $$
declare
  v_owner uuid := auth.uid();
  v_product_id uuid;
  v_product_name text;
  v_slot_id uuid;
  v_slot_code text;
  v_quantity integer;
begin
  if v_owner is null then
    raise exception 'Not authenticated';
  end if;

  select inventory.product_id, products.name, inventory.slot_id, slots.code, inventory.quantity
  into v_product_id, v_product_name, v_slot_id, v_slot_code, v_quantity
  from inventory
  join products on products.id = inventory.product_id
  join slots on slots.id = inventory.slot_id
  where inventory.id = p_inventory_id
    and products.owner_id = v_owner
    and inventory.deleted_at is null;

  if not found then
    return;
  end if;

  update inventory
  set deleted_at = now()
  where id = p_inventory_id;

  insert into inventory_movements (
    owner_id,
    inventory_id,
    product_id,
    product_name,
    from_slot_id,
    from_slot_code,
    quantity_snapshot,
    action,
    note
  )
  values (
    v_owner,
    p_inventory_id,
    v_product_id,
    v_product_name,
    v_slot_id,
    v_slot_code,
    v_quantity,
    'deleted',
    'soft deleted inventory record'
  );
end;
$$;
