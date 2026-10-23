-- 0011 · Se quita la sección de documentos de mascotas (la tabla y el bucket estaban vacíos)
drop policy if exists "miembros leen documentos de mascotas" on storage.objects;
drop policy if exists "miembros suben documentos de mascotas" on storage.objects;
drop policy if exists "miembros borran documentos de mascotas" on storage.objects;
delete from storage.buckets where id = 'mascotas-docs';
drop table if exists public.pet_documents;
drop function if exists public.miembro_de_ruta(text);
