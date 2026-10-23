# A Medias: configuración y estado

Proyecto de Supabase: **A-medias** (`qrciymjmmpfremtjaiof`, región us-east-1)
Proyecto de Vercel: **a-medias** (dominio: `https://a-medias-eight.vercel.app`)
Rama de producción: `main` (la app se unió a `main` por PR #3 y #4)

## Estado

**Hecho**
- Base de datos completa: tablas, reglas de acceso (RLS), funciones, Realtime y los dos trabajos programados (pg_cron): el diario a las 00:05 y el de notificaciones cada 5 minutos.
- Edge Function `send-push` publicada (versión 3) con sus secretos VAPID y `PUSH_CRON_SECRET`.
- Login con magic link y redirecciones configuradas para el dominio de Vercel.
- App publicada en Vercel desde la rama de producción, con las variables de entorno.
- Seguridad: permisos de funciones internas quitados y `search_path` fijado (migración `0013`).
- Documentos de mascotas: quitados de la app. La migración `0011` borra lo que queda en la base.

**Pendiente (lo hace una persona)**
- [ ] Correr `supabase/migrations/0011_quitar_documentos_mascotas.sql` en el SQL Editor (borra la tabla y el espacio de archivos vacíos de documentos de mascotas).
- [ ] Activar **Authentication → Providers → Email → Leaked password protection** (aviso de seguridad de Supabase).
- [ ] Borrar el esquema viejo cuando ya no haga falta: `drop schema old_demo cascade;` (datos de prueba anteriores).
- [x] Rama de producción en Vercel: `main`.

## Pruebas

| Prueba | Estado |
|---|---|
| Hoy: marcar tareas y quién las hizo | OK |
| Tareas: crear, filtros, mascotas, cambiar responsable | OK |
| Compras: "Va:" con persona, "Los dos" y tarea con la fecha | OK |
| Compras: duración y paso a Despensa | OK |
| Semana: filtro por persona y sugerencias de mover | OK |
| Recordar: recordatorios | OK |
| Notificaciones | OK |
| Cambiar el color de una persona | OK |
| Tareas y medicamentos recién creados aparecen sin refrescar | OK |
| Regenerar el código de invitación | OK |
| Pendientes de antes: "No se hizo" y "Deshacer" | Por validar |
| Tomas de medicamento: terminar el tratamiento | Por validar |
| Resumen de las 21:00 | Por validar |
| Dos personas: lo que hace una aparece en el otro celular | Pendiente |
| Salir del hogar y volver a entrar | Pendiente |
| Unirse a un hogar con el código o el link | Pendiente |
| Magic link y código de 6 dígitos | Pendiente |
| Lentitud al cambiar de hoja | Mejorada: la primera vez tarda, luego va bien |

## Piezas del sistema

- **Migraciones** (`supabase/migrations/`): `0001` a `0013`, en orden. Las `0001` a `0007` están juntas en `supabase/sql_por_partes/` para pegarlas en el SQL Editor.
- **Datos de ejemplo:** `supabase/seed_sin_comentarios.sql`. Cambia el correo en la línea 3 antes de correrlo. Borra el hogar de esas dos cuentas.
- **Edge Function:** `supabase/functions/send-push/`. La llama pg_cron cada 5 minutos con el header `x-cron-secret`.
- **Claves VAPID:** no están en el repositorio. Están en el archivo `claves_vapid.txt` que se envió en el chat. Si se pierden, hay que generar otras, actualizarlas en Supabase y en Vercel, y las notificaciones activadas dejan de funcionar hasta reactivarlas en la app.

## Variables de entorno en Vercel

| Variable | Valor | Tipo |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://qrciymjmmpfremtjaiof.supabase.co` | Config |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | clave publicable de Supabase | Config |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | de `claves_vapid.txt` | Config |
| `VAPID_SUBJECT` | `mailto:` + correo de contacto | Config |
| `VAPID_PRIVATE_KEY` | de `claves_vapid.txt` | Sensitive |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API Keys → service_role | Sensitive |

Las variables `NEXT_PUBLIC_*` se incluyen en la app al compilarla. Si cambian, hay que volver a publicar.

## Cómo publicar un cambio

1. Subir el cambio a una rama y abrir un pull request hacia `main`. Al unirlo, Vercel publica solo.
2. Si el cambio incluye SQL, aplicarlo en Supabase antes de publicar el código que lo usa.
3. Si cambia la Edge Function, publicarla de nuevo en Supabase.
