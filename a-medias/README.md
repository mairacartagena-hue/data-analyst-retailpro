# A Medias

App web (PWA instalable en Android) para que una pareja reparta las tareas de la casa, las compras, los recordatorios y el cuidado de sus mascotas.

**Stack:** Next.js 15 (App Router) + TypeScript + Tailwind 4 + Supabase (Postgres, Auth, Realtime, Edge Functions, pg_cron).

```
a-medias/
├── app/                      Pantallas (Hoy, Tareas, Compras, Semana, Recordar, Ajustes, mascotas, login, unirse)
├── components/               UI, paneles y proveedor de datos con Realtime
├── lib/                      Supabase, fechas (America/Bogota), lógica de balance/sugerencias/despensa
├── public/                   manifest.webmanifest, sw.js, íconos, offline.html
├── scripts/generate-icons.mjs
└── supabase/
    ├── migrations/           0001…0007 (tablas, RLS, funciones, Realtime, pg_cron)
    ├── functions/send-push/  Edge Function que envía las notificaciones
    └── seed.sql              Datos de ejemplo
```

---

## 1. Crear el proyecto en Supabase

1. Entra a [supabase.com](https://supabase.com) → **New project**. Región sugerida: `South America (São Paulo)`.
2. Guarda la contraseña de la base de datos.
3. En **Project Settings → API** copia:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` → `SUPABASE_SERVICE_ROLE_KEY` (secreta: solo servidor y Edge Function)

## 2. Activar pg_cron y pg_net

**Database → Extensions** → busca y activa `pg_cron` y `pg_net`.

## 3. Correr las migraciones

Opción A, desde el navegador: abre **SQL Editor** y pega y ejecuta, en orden, cada archivo de `supabase/migrations/`:

| Archivo | Qué hace |
|---|---|
| `0001_schema.sql` | Tablas, `updated_at` automático |
| `0002_rls.sql` | `is_member()` y RLS en todas las tablas |
| `0003_hogar.sql` | `create_household`, `join_household`, `regenerate_invite_code`, `set_member_color`, `leave_household` |
| `0004_ocurrencias.sql` | `generate_occurrences`, rotación, cambio de turno, mover tareas, fin de tratamientos |
| `0005_despensa_y_avisos.sql` | Despensa automática, `due_notifications`, mantenimiento diario |
| `0006_realtime.sql` | Agrega las tablas a Realtime |
| `0007_cron.sql` | Programa pg_cron (ver paso 6 antes) |

Opción B, con la CLI: `npx supabase link --project-ref TU-REF` y `npx supabase db push`.

## 4. Configurar el login (magic link)

**Authentication → URL Configuration**

- **Site URL:** `https://TU-APP.vercel.app` (tu dominio de Vercel)
- **Redirect URLs** (agrega las dos):
  - `http://localhost:3000/**`
  - `https://TU-APP.vercel.app/**`

**Authentication → Emails → Magic Link** (recomendado). Cambia el enlace de la plantilla para que funcione aunque el correo se abra en otro navegador, y agrega el código de 6 dígitos (la app tiene un campo para escribirlo, útil con la app instalada):

```html
<h2>Entra a A Medias</h2>
<p><a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email">Entrar</a></p>
<p>O escribe este código en la app: <strong>{{ .Token }}</strong></p>
```

La sesión queda guardada: no hay que volver a entrar cada vez.

## 5. Claves VAPID (notificaciones push)

```bash
cd a-medias
npm install
npm run vapid
```

Te muestra una **Public Key** y una **Private Key**.

## 6. Edge Function y tareas programadas

1. Inventa un secreto largo para el cron (por ejemplo, con `openssl rand -hex 32`).
2. Guarda la URL y ese secreto en Vault (**SQL Editor**):
   ```sql
   select vault.create_secret('https://TU-PROYECTO.supabase.co', 'project_url');
   select vault.create_secret('EL-SECRETO-DEL-CRON', 'push_cron_secret');
   ```
3. Publica la función y sus secretos (`SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` ya vienen incluidos):
   ```bash
   npx supabase login
   npx supabase link --project-ref TU-REF
   npx supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:tu@correo.com PUSH_CRON_SECRET=EL-SECRETO-DEL-CRON
   npx supabase functions deploy send-push --no-verify-jwt
   ```
4. Corre `0007_cron.sql` si no lo hiciste. Quedan dos trabajos (míralos en **Integrations → Cron**):
   - `a-medias-diario` (00:05 hora Colombia): termina tratamientos vencidos, genera 4 semanas de turnos y revisa la despensa.
   - `a-medias-push` (cada 5 minutos): llama a `send-push`, que envía tareas a su hora, cada toma de medicamento, recordatorios y vacunas con su aviso previo, y borra las suscripciones que responden 410.

No se usan crons de Vercel.

## 7. Variables de entorno

Copia `.env.example` a `.env.local` para desarrollo:

| Variable | Dónde | Pública |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Vercel y `.env.local` | Sí |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel y `.env.local` | Sí |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Vercel y `.env.local` | Sí |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel (solo servidor) y Edge Function | **No** |
| `VAPID_PRIVATE_KEY` | Vercel (solo servidor) y Edge Function | **No** |
| `VAPID_SUBJECT` | Vercel y Edge Function | No |

En Next.js, la service role solo se usa en `/api/push/test` (botón "Enviar una de prueba").

```bash
npm run dev     # http://localhost:3000
npm run build
```

## 8. Datos de ejemplo

`members` depende de `auth.users`, así que primero se crean los dos usuarios:

1. **Authentication → Users → Add user → Create new user**. Crea dos (por ejemplo `nicki@…` y `ari@…`) con **Auto Confirm User** marcado. También sirve que cada persona entre una vez a la app con su correo.
2. Abre `supabase/seed.sql`, escribe esos dos correos en `v_email1` y `v_email2` (o pega sus IDs en `v_user1` y `v_user2`; los ves en la lista de usuarios).
3. Ejecútalo en el **SQL Editor**.

Crea el hogar "Casa de Nicki y Ari" (código `MICHI234`) con la gata Michi, tareas fijas, rotativas y "juntos", Amoxicilina 5 ml por 7 días con 3 tomas (8:00, 14:00, 20:00) que empezó hace 2 días, despensa (Café y Detergente ya en "Se termina pronto"), compras, recordatorios, una vacuna y notas. Se puede correr otra vez para reiniciar el ejemplo.

## 9. Publicar en Vercel (reemplazando la app anterior)

La app anterior era un solo `Index.html`. Para reemplazarla **sin cambiar el link**:

1. En Vercel abre el proyecto de la app vieja → **Settings → Git** y conéctalo a este repositorio (si no lo estaba).
2. **Settings → Build and Deployment → Root Directory:** `a-medias`. Framework: **Next.js** (se detecta solo).
3. **Settings → Environment Variables:** agrega las variables del paso 7.
4. Si el repositorio de la app vieja tiene el `Index.html`, bórralo de ese repositorio (este repositorio no lo tiene).
5. **Deployments → Redeploy.** Al terminar, el mismo dominio sirve la app nueva.
6. Verifica que el dominio esté en Site URL y Redirect URLs de Supabase (paso 4).

## 10. Cambiar el acceso directo viejo del celular por el nuevo

En Android, el ícono viejo apunta a la app anterior y no se actualiza solo:

1. Mantén presionado el ícono viejo → **Desinstalar** (o **Quitar** / arrastrarlo a "Desinstalar").
2. En Chrome: **⋮ → Configuración → Configuración de sitios → Todos los sitios →** busca tu dominio → **Borrar y restablecer**. Así se va el caché de la app vieja.
3. Abre el link de la app en Chrome, entra con tu correo y toca **Ajustes → Instalar app** (o **⋮ → Instalar app**).
4. Abre la app desde el ícono nuevo y toca **Activar notificaciones**.

---

## Cómo funciona

- **Tiempo real:** `HouseholdProvider` carga los datos del hogar y escucha cambios de Postgres por Realtime. Al tildar algo, la otra persona lo ve al instante. Al volver a la app o al reconectar, recarga.
- **Seguridad:** RLS en todas las tablas con `is_member(household_id)` (SECURITY DEFINER). Las tablas hijas guardan `household_id` (lo llena un trigger desde el padre). Unirse a un hogar va por `join_household(codigo)`, porque el invitado aún no puede leer el hogar. Máximo 2 personas; el color libre se asigna solo.
- **Turnos:** `generate_occurrences` es idempotente y crea las ocurrencias de las próximas 4 semanas. Corre por trigger al crear o editar una tarea, cuando alguien entra o sale del hogar y cada día con pg_cron; el cliente nunca la llama. Cambiar un turno de una tarea que rota mueve el "ancla" de la rotación, y solo se reacomodan las ocurrencias futuras sin completar.
- **Medicamentos:** una ocurrencia por toma por día, entre `fecha_inicio` y `fecha_fin` (`fecha_inicio + duracion_dias - 1`). Al completar la última toma, o cuando pasa la fecha de fin, `activa = false` y queda en el historial como "Terminado". Si alguien destilda la última toma antes de que pase la fecha, se reactiva.
- **Balance:** cuenta lo asignado a cada uno en la semana (lunes a domingo). Cada toma cuenta; "Juntos" no.
- **Sugerencias:** si un día alguien tiene 2 tareas más que su promedio diario y otro día de esa semana tiene 0, se propone mover una tarea pendiente (nunca medicamentos). "Dejar así" guarda el descarte en `suggestion_dismissals`.
- **Despensa:** días restantes = `duracion_dias - (hoy - fecha_ultima_compra)`. Con 20% o menos, se agrega a Mercado como AUTO sin duplicar. Al marcarlo comprado se actualiza `fecha_ultima_compra`.

## Pruebas manuales

1. **Login:** entra con tu correo, abre el link (o escribe el código) y cierra y abre la app: la sesión sigue.
2. **Unirse con el link:** en Ajustes copia el link de invitación, ábrelo en el celular de tu pareja, que entre con su correo y toque "Unirme al hogar". Su color se asigna solo y el balance muestra los dos nombres.
3. **Tiempo real:** con la app abierta en los dos celulares, tilda una tarea en uno. En el otro se marca al instante, sin recargar.
4. **Medicamento:** en Recordar → Michi, tilda las 3 tomas del día. El progreso avanza ("Día 3 de 7 · Toma 3 de 3", la barra sube) y el otro celular lo ve. Con el ejemplo, al tildar las del último día el tratamiento pasa a "Terminado" en el historial.
5. **Notificación:** en Ajustes toca "Activar notificaciones" y luego "Enviar una de prueba". Después crea una tarea con recordatorio para dentro de 5 a 10 minutos y espera el aviso, que envía la Edge Function.
