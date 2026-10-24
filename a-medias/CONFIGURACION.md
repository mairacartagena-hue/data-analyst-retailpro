# A Medias: configuración y estado

Proyecto de Supabase: **A-medias** (`qrciymjmmpfremtjaiof`, región us-east-1)
Proyecto de Vercel: **a-medias** (dominio: `https://a-medias-eight.vercel.app`)
Rama de producción: `main`

## Estado de la configuración

**Hecho**
- Base de datos: tablas, reglas de acceso (RLS), funciones, Realtime y dos trabajos programados (pg_cron): el diario (00:05) y el de notificaciones (cada 5 minutos, incluido el resumen de las 21:00).
- Migraciones `0001` a `0019` aplicadas. La `0011` ya quitó la tabla de documentos de mascotas.
- Esquema viejo `old_demo` eliminado.
- Bucket `mascotas-docs` eliminado.
- Edge Function `send-push` publicada, con sus secretos VAPID y `PUSH_CRON_SECRET`.
- Seguridad: permisos de funciones internas quitados y `search_path` fijado (migración `0013`).
- Login con correo y contraseña. La opción de link al correo queda como alternativa.
- Confirmación de correo desactivada en Supabase, para que las cuentas nuevas entren sin confirmar.
- Correo de Supabase: Resend desactivado (o pendiente de confirmar por la persona que lo revisa).
- App en Vercel desde `main`, con variables de entorno.

**Avisos de seguridad que quedan (aceptados)**
- `push_log` tiene RLS sin políticas: es intencional, solo lo usa el servidor.
- `pg_net` está en el esquema `public`: riesgo bajo; moverlo podría romper los avisos automáticos.
- Funciones `SECURITY DEFINER` llamables por usuarios: son las que usa la app (crear hogar, unirse, cambiar turno, etc.). `is_member` la necesitan las reglas de acceso.
- Protección de contraseñas filtradas: solo está disponible en el plan Pro.

**Pendiente**
- [x] Correo de Supabase (interno): el link llega a otras direcciones (probado).

## Pruebas

| Prueba | Estado |
|---|---|
| Hoy: marcar tareas y quién las hizo | OK |
| Tareas: crear, filtros, mascotas, cambiar responsable | OK |
| Tareas y medicamentos recién creados aparecen sin refrescar | OK |
| Compras: "Va:" con persona, "Juntos" y tarea con la fecha | OK |
| Compras: duración y paso a Despensa | OK |
| Compras: comida natural (lista Mascotas) con mascota | Por validar |
| Semana: filtro por persona y sugerencias de mover | OK |
| Recordar: recordatorios | OK |
| Notificaciones | OK |
| Cambiar el color de una persona | OK |
| Regenerar el código de invitación | OK |
| Pendientes de antes: "No se hizo" y "Deshacer" | OK |
| Tomas de medicamento: marcar tomas | OK |
| Tomas de medicamento: terminar el tratamiento (fin: 26/10/2026) | Pendiente: se prueba al marcar las últimas tomas o al pasar la fecha de fin |
| Resumen de las 21:00 | Parcial: el servidor lo envió el 22/10 a las 21:15; confirmar que llegó al celular |
| Importar tareas (CSV, vista previa y actualización) | OK |
| Importar compras (despensa y lista de compras) | OK |
| Importar recordar (recordatorios, mascotas y vacunas, notas) | OK |
| Plantilla CSV abierta en Google Sheets (sin caracteres raros) | OK |
| Exportar todo (ZIP) y abrirlo en Google Sheets | OK |
| Login con correo y contraseña: crear cuenta y entrar | OK |
| Definir contraseña desde Ajustes para una cuenta sin contraseña | OK |
| Link al correo para una cuenta nueva | OK |
| Dos personas: lo que hace una aparece en el otro celular | OK |
| Salir del hogar y volver a entrar | OK |
| Unirse a un hogar con el código o el link | Pendiente |
| Lentitud al cambiar de hoja | Mejorada: la primera vez tarda, luego va bien |
| "Juntos" igual en todas las hojas (dos iniciales; filtro en Tareas; conteo en el balance) | OK (local) |
| Mascotas: fecha de nacimiento exacta o aproximada y edad | OK (local) |

## Piezas del sistema

- **Migraciones** (`supabase/migrations/`): `0001` a `0019`, en orden. Las `0001` a `0007` están juntas en `supabase/sql_por_partes/` para pegarlas en el SQL Editor.
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
