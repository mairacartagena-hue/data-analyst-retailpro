-- 0015 · Administrar etiquetas: renombrar (si el nombre nuevo ya existe, se unifican) y quitar una etiqueta
-- de todos los movimientos propios. También se actualiza la memoria de comercios.

create or replace function public.rename_tag(p_old text, p_new text)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_old text := lower(trim(p_old));
  v_new text := lower(trim(p_new));
  v_n int;
begin
  if v_new !~ '^#' then v_new := '#' || v_new; end if;
  v_new := regexp_replace(v_new, '\s+', '_', 'g');
  if v_new !~ '^#[a-z0-9_ñáéíóú]{2,30}$' then raise exception 'Usa solo letras, números o _ (2 a 30 caracteres)'; end if;
  update transactions
     set tags = array(select distinct case when t = v_old then v_new else t end from unnest(tags) t)
   where household_id = my_household_id() and v_old = any (tags)
     and (created_by = auth.uid() or payer_user_id = auth.uid());
  get diagnostics v_n = row_count;
  update merchant_memory set tag = v_new where user_id = auth.uid() and tag = v_old;
  return v_n;
end;
$$;

create or replace function public.remove_tag(p_tag text)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_tag text := lower(trim(p_tag));
  v_n int;
begin
  update transactions set tags = array_remove(tags, v_tag)
   where household_id = my_household_id() and v_tag = any (tags)
     and (created_by = auth.uid() or payer_user_id = auth.uid());
  get diagnostics v_n = row_count;
  update merchant_memory set tag = null where user_id = auth.uid() and tag = v_tag;
  return v_n;
end;
$$;

revoke all on function public.rename_tag(text, text) from public, anon;
revoke all on function public.remove_tag(text) from public, anon;
grant execute on function public.rename_tag(text, text) to authenticated;
grant execute on function public.remove_tag(text) to authenticated;
