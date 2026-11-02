-- 0052 · Contactos: cruce de cuentas con personas fuera del hogar.
--
--  · contacts: la lista privada de cada persona (ej. "Juan"). Solo la ve su dueño.
--  · contact_ledger: los asientos con cada contacto. in_favor = true → el contacto le debe al dueño;
--    false → el dueño le debe al contacto. Tipos: SPLIT (parte de una compra), LOAN, ERRAND, PAYMENT, FORGIVEN.
--  · Una parte de un gasto puede quedar a cargo de un contacto (transaction_splits.contact_id): no tiene categoría,
--    no cuenta en presupuestos y deja el asiento a favor de quien pagó.
--  · Vínculo entre hogares: si el contacto usa la app (en otro hogar), el dueño le comparte un código; al escribirlo,
--    los dos contactos quedan enlazados y cada uno ve los asientos del otro (al revés). Así cruzan cuentas sin ver
--    nada más del otro hogar. Cualquiera de los dos puede desvincular: los asientos vuelven a ser privados.
--  · Con un contacto vinculado, el pago lo registra quien paga; quien recibe marca en qué cuenta le entró.
-- Se puede correr más de una vez.

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 60),
  linked_user_id uuid references auth.users (id) on delete set null,
  link_code text unique,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  check (linked_user_id is null or linked_user_id <> owner_user_id)
);
create index if not exists contacts_owner_idx on public.contacts (owner_user_id);
create unique index if not exists contacts_link_unique on public.contacts (owner_user_id, linked_user_id) where linked_user_id is not null;

create table if not exists public.contact_ledger (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts (id) on delete cascade,
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  amount bigint not null check (amount > 0),
  in_favor boolean not null,
  kind text not null check (kind in ('SPLIT', 'LOAN', 'ERRAND', 'PAYMENT', 'FORGIVEN')),
  transaction_id uuid references public.transactions (id) on delete cascade,
  split_id uuid references public.transaction_splits (id) on delete cascade,
  -- Con un contacto vinculado: el ajuste con que quien recibió el pago lo anotó en su cuenta
  received_transaction_id uuid references public.transactions (id) on delete set null,
  description text,
  occurred_on date not null default public.today_bogota(),
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists contact_ledger_contact_idx on public.contact_ledger (contact_id);
create index if not exists contact_ledger_owner_idx on public.contact_ledger (owner_user_id);
create index if not exists contact_ledger_tx_idx on public.contact_ledger (transaction_id);

alter table public.transaction_splits add column if not exists contact_id uuid references public.contacts (id) on delete restrict;

-- ¿Puedo ver los asientos de este contacto? Si es mío, o si es el contacto que me tiene a mí y yo lo tengo a él.
create or replace function public.can_see_contact(p_contact uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.mfa_ok() and exists (
    select 1 from contacts c
     where c.id = p_contact
       and (c.owner_user_id = auth.uid()
            or (c.linked_user_id = auth.uid()
                and exists (select 1 from contacts m where m.owner_user_id = auth.uid() and m.linked_user_id = c.owner_user_id)))
  )
$$;
revoke all on function public.can_see_contact(uuid) from public, anon;
grant execute on function public.can_see_contact(uuid) to authenticated;

alter table public.contacts enable row level security;
alter table public.contact_ledger enable row level security;
drop policy if exists "ver mis contactos" on public.contacts;
create policy "ver mis contactos" on public.contacts for select to authenticated using (owner_user_id = auth.uid());
drop policy if exists "ver asientos de contactos" on public.contact_ledger;
create policy "ver asientos de contactos" on public.contact_ledger for select to authenticated using (public.can_see_contact(contact_id));
-- Los cambios pasan por las funciones de abajo; igual que el resto de tablas, se exige la verificación en dos pasos
drop policy if exists "verificacion en dos pasos" on public.contacts;
create policy "verificacion en dos pasos" on public.contacts as restrictive for all to authenticated
  using ((select public.mfa_ok())) with check ((select public.mfa_ok()));
drop policy if exists "verificacion en dos pasos" on public.contact_ledger;
create policy "verificacion en dos pasos" on public.contact_ledger as restrictive for all to authenticated
  using ((select public.mfa_ok())) with check ((select public.mfa_ok()));
revoke insert, update, delete on public.contacts, public.contact_ledger from authenticated, anon;

-- Neto con un contacto desde el punto de vista de su dueño: positivo = el contacto le debe.
-- Si está vinculado, suma también (al revés) los asientos que el otro anotó en su contacto.
create or replace function public.contact_net(p_contact uuid)
returns bigint
language sql stable security definer set search_path = public
as $$
  select coalesce((select sum(case when l.in_favor then l.amount else -l.amount end) from contact_ledger l where l.contact_id = c.id), 0)
       - coalesce((select sum(case when l.in_favor then l.amount else -l.amount end)
                     from contact_ledger l join contacts m on m.id = l.contact_id
                    where c.linked_user_id is not null and m.owner_user_id = c.linked_user_id and m.linked_user_id = c.owner_user_id), 0)
  from contacts c where c.id = p_contact and c.owner_user_id = auth.uid()
$$;
revoke all on function public.contact_net(uuid) from public, anon;
grant execute on function public.contact_net(uuid) to authenticated;

-- Crear, renombrar o archivar un contacto. Devuelve su id.
create or replace function public.save_contact(p jsonb)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_name text := nullif(trim(coalesce(p->>'name', '')), '');
  v_archived boolean := coalesce((p->>'archived')::boolean, false);
begin
  if my_household_id() is null then raise exception 'Primero crea o únete a un hogar'; end if;
  if v_name is null then raise exception 'Escribe el nombre'; end if;
  if v_id is null then
    insert into contacts (owner_user_id, name) values (v_uid, v_name) returning id into v_id;
  else
    update contacts set name = v_name, archived = v_archived where id = v_id and owner_user_id = v_uid;
    if not found then raise exception 'Ese contacto no existe'; end if;
  end if;
  return v_id;
end;
$$;
revoke all on function public.save_contact(jsonb) from public, anon;
grant execute on function public.save_contact(jsonb) to authenticated;

-- Borrar un contacto sin asientos ni compras (si tiene, se archiva).
create or replace function public.delete_contact(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if my_household_id() is null then raise exception 'Primero crea o únete a un hogar'; end if;
  if not exists (select 1 from contacts where id = p_id and owner_user_id = auth.uid()) then
    raise exception 'Ese contacto no existe';
  end if;
  if exists (select 1 from contact_ledger where contact_id = p_id)
     or exists (select 1 from transaction_splits where contact_id = p_id)
     or exists (select 1 from contacts where id = p_id and linked_user_id is not null) then
    raise exception 'Este contacto tiene asientos o está vinculado: archívalo en vez de borrarlo';
  end if;
  delete from contacts where id = p_id;
end;
$$;
revoke all on function public.delete_contact(uuid) from public, anon;
grant execute on function public.delete_contact(uuid) to authenticated;

-- Préstamo o encargo con un contacto (no mueve plata, como en el cruce del hogar).
create or replace function public.add_contact_entry(p jsonb)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_contact uuid := nullif(p->>'contact_id', '')::uuid;
  v_kind text := p->>'kind';
  v_amount bigint := nullif(p->>'amount', '')::bigint;
  v_id uuid;
begin
  if my_household_id() is null then raise exception 'Primero crea o únete a un hogar'; end if;
  if v_kind not in ('LOAN', 'ERRAND') then raise exception 'Tipo no válido'; end if;
  if v_amount is null or v_amount <= 0 then raise exception 'El monto debe ser mayor que cero'; end if;
  if not exists (select 1 from contacts where id = v_contact and owner_user_id = v_uid and not archived) then
    raise exception 'Ese contacto no existe';
  end if;
  insert into contact_ledger (contact_id, owner_user_id, amount, in_favor, kind, description, occurred_on, created_by)
  values (v_contact, v_uid, v_amount, coalesce((p->>'in_favor')::boolean, true), v_kind,
          nullif(trim(coalesce(p->>'description', '')), ''),
          coalesce(nullif(p->>'occurred_on', '')::date, today_bogota()), v_uid)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.add_contact_entry(jsonb) from public, anon;
grant execute on function public.add_contact_entry(jsonb) to authenticated;

-- Saldar con un contacto:
--   RECEIVED → me pagó: entra la plata a mi cuenta (ajuste, no es ingreso). Con un contacto vinculado no se usa:
--              el pago lo registra quien paga y aquí se marca con receive_contact_payment().
--   PAID     → le pagué: sale la plata de mi cuenta (ajuste, no es gasto).
--   FORGIVEN → le condono lo que me debe: no se mueve plata.
-- Nunca por más de lo que se debe.
create or replace function public.settle_contact(p jsonb)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_contact contacts;
  v_mode text := p->>'mode';
  v_amount bigint := nullif(p->>'amount', '')::bigint;
  v_date date := coalesce(nullif(p->>'occurred_on', '')::date, today_bogota());
  v_note text := nullif(trim(coalesce(p->>'note', '')), '');
  v_account uuid := nullif(p->>'account_id', '')::uuid;
  v_net bigint;
  v_tx uuid;
  v_id uuid;
begin
  if my_household_id() is null then raise exception 'Primero crea o únete a un hogar'; end if;
  if v_mode not in ('RECEIVED', 'PAID', 'FORGIVEN') then raise exception 'Elige qué pasó'; end if;
  if v_amount is null or v_amount <= 0 then raise exception 'El monto debe ser mayor que cero'; end if;
  select * into v_contact from contacts where id = nullif(p->>'contact_id', '')::uuid and owner_user_id = v_uid;
  if not found then raise exception 'Ese contacto no existe'; end if;
  v_net := contact_net(v_contact.id);

  if v_mode in ('RECEIVED', 'FORGIVEN') then
    if v_net <= 0 then raise exception '% no te debe nada', v_contact.name; end if;
    if v_amount > v_net then raise exception '% te debe % en total: no puedes saldar más', v_contact.name, v_net; end if;
  else
    if v_net >= 0 then raise exception 'No le debes nada a %', v_contact.name; end if;
    if v_amount > -v_net then raise exception 'Le debes % en total a %: no puedes pagar más', -v_net, v_contact.name; end if;
  end if;
  if v_mode = 'RECEIVED' and v_contact.linked_user_id is not null then
    raise exception '% usa la app: el pago lo registra quien paga y tú marcas en qué cuenta te entró', v_contact.name;
  end if;

  if v_mode in ('RECEIVED', 'PAID') then
    if v_account is null then raise exception 'Elige la cuenta'; end if;
    v_tx := save_transaction(jsonb_build_object(
      'kind', 'ADJUSTMENT', 'direction', case when v_mode = 'RECEIVED' then 'IN' else 'OUT' end,
      'amount', v_amount, 'occurred_on', v_date, 'account_id', v_account,
      'description', coalesce(v_note, case when v_mode = 'RECEIVED' then 'Pago de ' else 'Pago a ' end || v_contact.name)));
  end if;

  insert into contact_ledger (contact_id, owner_user_id, amount, in_favor, kind, transaction_id, description, occurred_on, created_by)
  values (v_contact.id, v_uid, v_amount, v_mode = 'PAID', case when v_mode = 'FORGIVEN' then 'FORGIVEN' else 'PAYMENT' end,
          v_tx, v_note, v_date, v_uid)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.settle_contact(jsonb) from public, anon;
grant execute on function public.settle_contact(jsonb) to authenticated;

-- Contacto vinculado: el otro registró que me pagó; anoto en qué cuenta entró (ajuste, no es ingreso).
create or replace function public.receive_contact_payment(p jsonb)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_entry contact_ledger;
  v_name text;
  v_tx uuid;
begin
  if my_household_id() is null then raise exception 'Primero crea o únete a un hogar'; end if;
  select l.* into v_entry from contact_ledger l join contacts c on c.id = l.contact_id
   where l.id = nullif(p->>'entry_id', '')::uuid and l.kind = 'PAYMENT' and l.in_favor
     and c.linked_user_id = auth.uid() and public.can_see_contact(c.id)
   for update of l;
  if not found then raise exception 'Ese pago no existe'; end if;
  if v_entry.received_transaction_id is not null then raise exception 'Ese pago ya está en una de tus cuentas'; end if;
  if nullif(p->>'account_id', '') is null then raise exception 'Elige en qué cuenta entró'; end if;
  select name into v_name from contacts where owner_user_id = auth.uid() and linked_user_id = v_entry.owner_user_id;
  v_tx := save_transaction(jsonb_build_object(
    'kind', 'ADJUSTMENT', 'direction', 'IN', 'amount', v_entry.amount, 'account_id', p->>'account_id',
    'occurred_on', coalesce(nullif(p->>'occurred_on', ''), v_entry.occurred_on::text),
    'description', 'Pago de ' || coalesce(v_name, 'un contacto')));
  update contact_ledger set received_transaction_id = v_tx where id = v_entry.id;
  return v_tx;
end;
$$;
revoke all on function public.receive_contact_payment(jsonb) from public, anon;
grant execute on function public.receive_contact_payment(jsonb) to authenticated;

-- Borrar préstamos, encargos o perdones propios. Un pago se deshace borrando su movimiento; una compra, editándola.
create or replace function public.delete_contact_entry(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if my_household_id() is null then raise exception 'Primero crea o únete a un hogar'; end if;
  delete from contact_ledger where id = p_id and owner_user_id = auth.uid() and kind in ('LOAN', 'ERRAND', 'FORGIVEN');
  if not found then
    raise exception 'Solo puedes borrar préstamos, encargos o perdones que registraste tú. Las compras se corrigen editando el movimiento.';
  end if;
end;
$$;
revoke all on function public.delete_contact_entry(uuid) from public, anon;
grant execute on function public.delete_contact_entry(uuid) to authenticated;

-- ---------------------------------------------------------------
-- Vínculo entre hogares
-- ---------------------------------------------------------------

-- Código para que el contacto (si usa la app) se vincule. Se reutiliza mientras no se use.
create or replace function public.contact_link_code(p_contact uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_c contacts;
  v_code text;
begin
  if my_household_id() is null then raise exception 'Primero crea o únete a un hogar'; end if;
  select * into v_c from contacts where id = p_contact and owner_user_id = auth.uid() for update;
  if not found then raise exception 'Ese contacto no existe'; end if;
  if v_c.linked_user_id is not null then raise exception 'Este contacto ya está vinculado'; end if;
  if v_c.link_code is not null then return v_c.link_code; end if;
  loop
    v_code := '';
    for i in 1..10 loop
      v_code := v_code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from contacts where link_code = v_code);
  end loop;
  update contacts set link_code = v_code where id = p_contact;
  return v_code;
end;
$$;
revoke all on function public.contact_link_code(uuid) from public, anon;
grant execute on function public.contact_link_code(uuid) to authenticated;

-- Quién compartió el código (solo su nombre), para confirmar antes de vincular.
create or replace function public.contact_link_preview(p_code text)
returns text
language sql stable security definer set search_path = public
as $$
  select m.display_name
    from contacts c join household_members m on m.user_id = c.owner_user_id
   where c.link_code = upper(trim(p_code)) and c.linked_user_id is null and c.owner_user_id <> auth.uid()
     and public.my_household_id() is not null
$$;
revoke all on function public.contact_link_preview(text) from public, anon;
grant execute on function public.contact_link_preview(text) to authenticated;

-- Escribir el código: enlaza el contacto de quien lo compartió con uno mío (uno que ya tenga o uno nuevo).
create or replace function public.link_contact(p jsonb)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_hh uuid := my_household_id();
  v_their contacts;
  v_mine uuid := nullif(p->>'contact_id', '')::uuid;
  v_name text := nullif(trim(coalesce(p->>'name', '')), '');
begin
  if v_hh is null then raise exception 'Primero crea o únete a un hogar'; end if;
  select * into v_their from contacts where link_code = upper(trim(coalesce(p->>'code', ''))) and linked_user_id is null for update;
  if not found then raise exception 'Ese código no existe o ya se usó'; end if;
  if v_their.owner_user_id = v_uid then raise exception 'Ese código es tuyo: compártelo con tu contacto'; end if;
  if exists (select 1 from household_members where household_id = v_hh and user_id = v_their.owner_user_id) then
    raise exception 'Esa persona es de tu hogar: ya cruzan cuentas en el Cruce';
  end if;
  if exists (select 1 from contacts where owner_user_id = v_uid and linked_user_id = v_their.owner_user_id) then
    raise exception 'Ya tienes un contacto vinculado con esa persona';
  end if;

  if v_mine is not null then
    if not exists (select 1 from contacts where id = v_mine and owner_user_id = v_uid and linked_user_id is null) then
      raise exception 'Ese contacto no existe';
    end if;
    update contacts set linked_user_id = v_their.owner_user_id, link_code = null, archived = false where id = v_mine;
  else
    if v_name is null then
      select display_name into v_name from household_members where user_id = v_their.owner_user_id;
    end if;
    insert into contacts (owner_user_id, name, linked_user_id) values (v_uid, coalesce(v_name, 'Contacto'), v_their.owner_user_id)
    returning id into v_mine;
  end if;
  update contacts set linked_user_id = v_uid, link_code = null where id = v_their.id;
  return v_mine;
end;
$$;
revoke all on function public.link_contact(jsonb) from public, anon;
grant execute on function public.link_contact(jsonb) to authenticated;

-- Desvincular (cualquiera de los dos): los asientos de cada uno vuelven a ser solo suyos.
create or replace function public.unlink_contact(p_contact uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_other uuid;
begin
  if my_household_id() is null then raise exception 'Primero crea o únete a un hogar'; end if;
  select linked_user_id into v_other from contacts where id = p_contact and owner_user_id = auth.uid() for update;
  if not found then raise exception 'Ese contacto no existe'; end if;
  if v_other is null then return; end if;
  update contacts set linked_user_id = null where id = p_contact;
  update contacts set linked_user_id = null where owner_user_id = v_other and linked_user_id = auth.uid();
end;
$$;
revoke all on function public.unlink_contact(uuid) from public, anon;
grant execute on function public.unlink_contact(uuid) to authenticated;

-- ---------------------------------------------------------------
-- save_transaction: una parte de un gasto puede quedar a cargo de un contacto
-- (sin categoría, a cargo de quien pagó para el hogar, y el asiento a su favor con el contacto).
-- Si la pareja ajusta el movimiento, no puede tocarlo: los contactos son privados.
-- ---------------------------------------------------------------
do $$
declare v_src text;
begin
  select pg_get_functiondef('public.save_transaction(jsonb)'::regprocedure) into v_src;
  if position('v_contact uuid' in v_src) > 0 then return; end if;

  v_src := replace(v_src, $r$  v_split_amount bigint;
begin$r$, $r$  v_split_amount bigint;
  v_contact uuid;
begin$r$);

  v_src := replace(v_src, $r$      v_other_edit := true;$r$, $r$      if exists (select 1 from transaction_splits s where s.transaction_id = v_id and s.contact_id is not null) then
        raise exception 'Este movimiento tiene una parte de un contacto; solo quien lo registró puede editarlo';
      end if;
      v_other_edit := true;$r$);

  v_src := replace(v_src, $r$      v_split_amount := (v_split->>'amount')::bigint;
$r$, $r$      v_split_amount := (v_split->>'amount')::bigint;
      v_contact := nullif(v_split->>'contact_id', '')::uuid;
      if v_contact is not null then
        if v_kind <> 'EXPENSE' then raise exception 'Solo un gasto puede tener una parte a cargo de un contacto'; end if;
        if not exists (select 1 from contacts where id = v_contact and owner_user_id = v_payer) then
          raise exception 'Ese contacto no existe';
        end if;
        v_cat_id := null;
        v_resp := v_payer;
      end if;
$r$);

  v_src := replace(v_src, $r$      insert into transaction_splits (transaction_id, household_id, amount, category_id, responsible_user_id, origin, note)
      values (v_id, v_hh, v_split_amount, v_cat_id, v_resp, v_origin,
              nullif(trim(coalesce(v_split->>'note', '')), ''))
      returning id into v_split_id;
$r$, $r$      insert into transaction_splits (transaction_id, household_id, amount, category_id, responsible_user_id, origin, note, contact_id)
      values (v_id, v_hh, v_split_amount, v_cat_id, v_resp, v_origin,
              nullif(trim(coalesce(v_split->>'note', '')), ''), v_contact)
      returning id into v_split_id;

      if v_contact is not null then
        insert into contact_ledger (contact_id, owner_user_id, amount, in_favor, kind, transaction_id, split_id, description, occurred_on, created_by)
        values (v_contact, v_payer, v_split_amount, true, 'SPLIT', v_id, v_split_id, coalesce(v_desc, v_merchant), v_date, v_payer);
      end if;
$r$);

  if position('v_contact uuid' in v_src) = 0 or position('Este movimiento tiene una parte de un contacto' in v_src) = 0
     or position('v_contact := nullif' in v_src) = 0 or position('insert into contact_ledger' in v_src) = 0 then
    raise exception 'save_transaction no tiene la forma esperada (¿falta la migración 0046?)';
  end if;
  execute v_src;
end $$;

-- set_split_category: la parte de un contacto no lleva categoría (no cuenta en presupuestos)
do $$
declare v_src text;
begin
  select pg_get_functiondef('public.set_split_category(uuid, uuid)'::regprocedure) into v_src;
  if position('contact_id is not null' in v_src) > 0 then return; end if;
  v_src := replace(v_src, $r$  update transaction_splits set category_id = p_category_id where id = p_split_id;$r$,
    $r$  if p_category_id is not null and v_split.contact_id is not null then
    raise exception 'Esta parte es de un contacto: no lleva categoría';
  end if;
  update transaction_splits set category_id = p_category_id where id = p_split_id;$r$);
  if position('contact_id is not null' in v_src) = 0 then
    raise exception 'set_split_category no tiene la forma esperada';
  end if;
  execute v_src;
end $$;

-- Tiempo real: la otra persona (de otro hogar) ve llegar los asientos
do $$
declare t text;
begin
  foreach t in array array['contacts', 'contact_ledger'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
