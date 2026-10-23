-- 0010 · Documentos de mascotas (PDF y fotos, hasta 10 MB) en un bucket privado
create table if not exists public.pet_documents (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  pet_id uuid not null references public.pets (id) on delete cascade,
  titulo text not null,
  fecha date not null,
  tipo text not null check (tipo in ('pdf', 'imagen')),
  ruta text not null unique,
  tamano integer not null check (tamano > 0 and tamano <= 10485760),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists pet_documents_pet_idx on public.pet_documents (pet_id, fecha desc);
alter table public.pet_documents enable row level security;
drop policy if exists "miembros gestionan documentos de mascotas" on public.pet_documents;
create policy "miembros gestionan documentos de mascotas" on public.pet_documents
  for all to authenticated using (public.is_member(household_id)) with check (public.is_member(household_id));
drop trigger if exists pet_documents_updated_at on public.pet_documents;
create trigger pet_documents_updated_at before update on public.pet_documents
  for each row execute function public.set_updated_at();

create or replace function public.miembro_de_ruta(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return public.is_member(split_part(p_name, '/', 1)::uuid);
exception when invalid_text_representation then
  return false;
end;
$$;
revoke all on function public.miembro_de_ruta(text) from public, anon;
grant execute on function public.miembro_de_ruta(text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('mascotas-docs', 'mascotas-docs', false, 10485760,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do update
  set public = false, file_size_limit = 10485760, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "miembros leen documentos de mascotas" on storage.objects;
drop policy if exists "miembros suben documentos de mascotas" on storage.objects;
drop policy if exists "miembros borran documentos de mascotas" on storage.objects;
create policy "miembros leen documentos de mascotas" on storage.objects
  for select to authenticated using (bucket_id = 'mascotas-docs' and public.miembro_de_ruta(name));
create policy "miembros suben documentos de mascotas" on storage.objects
  for insert to authenticated with check (bucket_id = 'mascotas-docs' and public.miembro_de_ruta(name));
create policy "miembros borran documentos de mascotas" on storage.objects
  for delete to authenticated using (bucket_id = 'mascotas-docs' and public.miembro_de_ruta(name));
