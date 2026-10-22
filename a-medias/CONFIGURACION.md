# Configuración de A Medias (estado y pasos pendientes)

Proyecto de Supabase: **A-medias** (`qrciymjmmpfremtjaiof`)
Proyecto de Vercel: **a-medias**

## Ya hecho

- Las tablas viejas de prueba (hogar "Apto 402 · Nicki y Ari") se movieron al esquema `old_demo`. No se borró nada; la app no las ve.
- Migraciones `0001_schema` y `0002_rls` aplicadas.
- Edge Function `send-push` publicada (sin verificación JWT; se protege con `x-cron-secret`).

## 1. Supabase: terminar la base de datos

1. **SQL Editor → New query**, pega todo `supabase/pegar_en_sql_editor.sql` y toca **Run**.
   Instala 0003–0007, activa `pg_cron` y `pg_net`, guarda en Vault la URL y un secreto del cron generado al azar, y programa los dos crons.
2. La última consulta muestra `push_cron_secret`. Cópialo para el paso 2.

## 2. Supabase: secretos de la Edge Function

**Edge Functions → Secrets → Add new secret** (los valores VAPID están en el archivo `claves_vapid.txt` que te envió Claude):

| Nombre | Valor |
|---|---|
| `VAPID_PUBLIC_KEY` | de `claves_vapid.txt` |
| `VAPID_PRIVATE_KEY` | de `claves_vapid.txt` |
| `VAPID_SUBJECT` | `mailto:` + tu correo |
| `PUSH_CRON_SECRET` | el valor que copiaste en el paso 1 |

## 3. Supabase: login

**Authentication → URL Configuration**

- Site URL: el dominio de Vercel (por ejemplo `https://a-medias.vercel.app`)
- Redirect URLs: `http://localhost:3000/**` y `https://TU-DOMINIO.vercel.app/**`

**Authentication → Emails → Magic Link**: usa la plantilla del README (paso 4).

## 4. Vercel

1. **Settings → Git**: conecta el repositorio `mairacartagena-hue/data-analyst-retailpro`.
2. **Settings → Build and Deployment → Root Directory**: `a-medias` (Framework: Next.js).
3. **Settings → Environments → Production → Branch**: la app está en la rama `claude/medias-supabase-vercel-pawhb1`. Combínala con `main` o elige esa rama como rama de producción.
4. **Settings → Environment Variables**:

| Variable | Valor |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://qrciymjmmpfremtjaiof.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `sb_publishable_tYxfeVEHFPvofR9PEjatFw_Yn_faWJE` |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | de `claves_vapid.txt` |
| `VAPID_PRIVATE_KEY` | de `claves_vapid.txt` (márcala como Sensitive) |
| `VAPID_SUBJECT` | `mailto:` + tu correo |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API Keys → `service_role` (Sensitive) |

5. **Deployments → Redeploy**.

## 5. Probar

Sigue "Pruebas manuales" del README. Para cargar el ejemplo, ver README paso 8.

Cuando todo funcione, puedes borrar el esquema viejo en el SQL Editor con `drop schema old_demo cascade;`.
