# Finanzas en Pareja

PWA privada de finanzas personales y en pareja (Android y escritorio). Todo en pesos colombianos (COP).

**Stack:** Next.js 16 (App Router) + TypeScript 5.9 + Tailwind 4 + componentes estilo shadcn/ui (Radix) + Motion · Supabase (Postgres, Auth, RLS, Realtime) · Vercel Hobby. Todo gratuito.

## Estado: Fase 1 — Núcleo financiero

| Incluido | Dónde |
|---|---|
| Login (contraseña o enlace/código al correo), hogar de 2 miembros con código de invitación | `app/login`, `app/bienvenida`, `app/unirse` |
| Miembros configurables: nombre, color y avatar (sin “Él/Ella”; slots A/B) | `app/(app)/ajustes` |
| Cuentas: depósito, billetera, efectivo y tarjeta de crédito; visibilidad `PUBLIC` / `BALANCE_ONLY` / `PRIVATE`; mostrar nombre de una cuenta privada en gastos compartidos | `app/(app)/cuentas` |
| Categorías con responsabilidad `MEMBER_A_100` / `MEMBER_B_100` / `FIXED_AMOUNTS` / `PRIVATE`, obligación del hogar, progreso compartido y rollover | `app/(app)/presupuestos` |
| Periodos mensuales o quincenales con días de corte, rangos personalizados, deslizar entre periodos y calendario rápido | `components/PeriodSwitcher.tsx` |
| Movimientos manuales: gasto, ingreso (privado o compartido), transferencia (incluye pago de tarjeta) | `components/TransactionSheet.tsx` |
| Motor de cruce: caso 1 normal, caso 2 pago cruzado, caso 3 desglose por montos exactos; préstamos y encargos; liquidación | `lib/finance/crossLedger.ts`, `save_transaction()` |
| Partidas de montos fijos: si alguien se pasa de su parte, la app pregunta si se cobra el excedente | `fixedAmountsExcess()` |
| Saldo Seguro para Gastar con desglose | `lib/finance/safeToSpend.ts` |
| Patrimonio neto (cuentas + activos/pasivos manuales) y flujo de caja | `lib/finance/derive.ts` |
| Dashboard con vistas Mis finanzas / Hogar / Vista global | `app/(app)/page.tsx` |
| RLS en todas las tablas, Realtime en ambos celulares, PWA instalable, modo claro/oscuro | `supabase/migrations` |

Pendiente para fases siguientes: voz/OCR/Telegram/offline con cola (Fase 3), metas de ahorro, recurrentes, Web Push, búsqueda avanzada, IA y CSV (Fase 4). Mientras no existan metas de ahorro, “Ahorros programados pendientes” vale 0 en el Saldo Seguro.

**Créditos (decidido para la Fase 4):** por ahora se registran como pasivo manual en Cuentas → “Otros activos y pasivos” (tipo Crédito o Hipoteca) y la cuota como gasto en una categoría. En la Fase 4 serán un tipo de cuenta propio:
- Datos del crédito: saldo de capital, tasa de interés (efectiva anual, en pesos; UVR queda fuera por ahora), plazo, día de pago, seguros y otros costos.
- Cada pago se registra una sola vez y se divide en capital (baja la deuda, no es gasto), intereses, seguros y otros costos (gastos). La app sugiere la división con la tasa y el saldo, y la persona la ajusta con el extracto del banco.
- Saldo Seguro: se reserva la cuota del periodo hasta que se pague, no el saldo total. Patrimonio: resta el saldo de capital real.
- La responsabilidad de la cuota se asigna igual que cualquier partida (ej. hipoteca 100 % de un miembro).
- Aviso mensual para confirmar el saldo con el extracto: “¿El saldo de tu hipoteca es $X? Confirmar / Corregir”.

## Fase 2 — Ingesta automática

| Incluido | Dónde |
|---|---|
| Webhook único `POST /api/webhook/android-ingest` con token por persona (`Authorization: Bearer …`) | `app/api/webhook/android-ingest` |
| Parsers por banco, en un registro extensible | `lib/ingest/registry.ts`, `lib/ingest/parsers/` |
| Bancolombia (SMS y correo): compras con T.Deb/T.Cred, pagos PSE, transferencias enviadas y recibidas, pagos recibidos | `parsers/bancolombia.ts` |
| BBVA (notificación “Compra Exitosa”); avisos de ingreso a la app se ignoran | `parsers/bbva.ts` |
| Banco Caja Social (SMS de pagos aprobados; rechazados se ignoran) | `parsers/cajaSocial.ts` |
| Respaldo con Gemini (Flash-Lite, nivel gratuito) solo si las reglas no reconocen el texto; se envía enmascarado | `lib/ingest/gemini.ts` |
| Deduplicación sin IA: mismo monto, ±5 min, comercio parecido (`pg_trgm`) y cuenta compatible → se fusiona | `ingest_event()` |
| Transferencias entre cuentas propias: la salida y la entrada se unen en una transferencia | `ingest_event()` |
| Retiros: transferencia a la cuenta de efectivo | `ingest_event()` |
| Cola “Por revisar” en el inicio con sugerencia de un toque y “Aplicar siempre sin preguntar” | `components/PendingReview.tsx` |
| Memoria de comercios de cada persona (comercio, NIT, cuenta o celular) | `merchant_memory`, `remember_merchant()` |
| Registro de eventos (`ingest_logs`), texto crudo borrado a los 30 días | Ajustes → Captura automática |
| Guía MacroDroid (notificaciones y SMS) y Google Apps Script para Gmail | Ajustes → Captura automática |

Pendiente de ejemplos reales: Nequi, Banco de Bogotá y Google Wallet (mientras tanto los lee Gemini).

Variables de entorno de la Fase 2 (solo servidor, en Vercel):
```
GEMINI_API_KEY=...          # Google AI Studio, gratis
GEMINI_MODEL=...            # opcional; por defecto gemini-flash-lite-latest
```

## Cierre del mes (conciliación)

Ajustes → **Cierre del mes** (`app/(app)/cierre`), con recordatorio en el inicio los últimos 3 días del mes y los primeros 5 del siguiente.

- Por cada cuenta propia: saldo inicial, entradas, salidas y saldo según la app; se escribe el saldo del banco (o la deuda del extracto en tarjetas) y se ve la diferencia. Se guarda el historial en `account_reconciliations` (solo su dueño).
- Gastos bancarios en un toque: 4x1000, cuota de manejo, intereses, comisión y seguro → categoría personal “Gastos bancarios”.
- Diferencia sin explicar → gasto en la categoría “No identificado” (o ingreso no identificado si sobra plata).
- **4x1000 estimado:** 0,4 % de las salidas por encima del tope exento: cuenta exenta 350 UVT/mes, depósito de bajo monto 65 UVT/mes (Concepto DIAN 362 de 2024). UVT 2026 = $52.374 (Resolución DIAN 000238 de 2025), editable en Ajustes → Periodos.
- **¿Qué hace falta?:** obligaciones del hogar sin pagar, movimientos por revisar, avisos no reconocidos y cuentas sin conciliar.
- Cada cuenta guarda la **fecha de su saldo inicial** (`opening_at`): lo que ocurrió antes ya estaba incluido en ese saldo y no se vuelve a restar.

## Decisiones de la Fase 1

1. **Tarjeta de crédito:** la compra consume el presupuesto al comprar; pagar la tarjeta es una transferencia y no vuelve a consumir presupuesto.
2. **Montos fijos:** lo ejecutado cuenta para el responsable de cada parte. Si quien paga se pasa de su parte fija, la app pregunta cuánto cobrarle a la pareja (propone el excedente hasta lo que a la pareja le falte); si se cobra, esa parte queda a cargo de la pareja y genera un asiento de cruce.
3. **Cuenta privada en categoría compartida:** la pareja ve monto, fecha y concepto; la cuenta aparece como “Cuenta privada”, salvo que su dueño active “Mostrar el nombre en gastos compartidos”.
4. **Ingresos:** privados por defecto; se pueden compartir (la pareja los ve y cuentan en el flujo del hogar).
5. **Rollover:** opcional por categoría; pasan sobrantes y sobregiros.
6. **Moneda:** solo pesos colombianos.
7. **Patrimonio:** cuentas y tarjetas + activos y pasivos manuales.
8. **Privacidad cuando chocan dos reglas:** un gasto en una categoría `PRIVATE` no se muestra aunque salga de una cuenta `PUBLIC` (la privacidad gana). Las barras compartidas sí suman todos los montos de su categoría para que cuadren en los dos celulares.
9. **Quién registra:** cada movimiento lo registra quien pagó, y solo esa persona lo edita o borra. La liquidación la registra quien paga.

## Configuración

### 1. Base de datos (Supabase, proyecto `finanzas-pareja`)
Las migraciones están en `supabase/migrations/` (0001 → 0012). Para aplicarlas a mano, pega cada archivo completo en **SQL Editor → Run**, en orden. Se pueden correr más de una vez.

### 2. Autenticación
En Supabase → **Authentication → URL Configuration**:
- **Site URL:** `https://TU-APP.vercel.app`
- **Redirect URLs:** `http://localhost:3000/**` y `https://TU-APP.vercel.app/**`

### 3. Variables de entorno
Copia `.env.example` a `.env.local` (y en Vercel → Settings → Environment Variables):
```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...   (clave pública / publishable)
```
Ninguna clave secreta va en el cliente.

### 4. Vercel
Importa el repositorio, con **Root Directory = `finanzas`**. `vercel.json` programa una llamada diaria a `/api/keepalive` para que Supabase no pause el proyecto por inactividad (7 días sin uso).

## Desarrollo

```bash
cd finanzas
npm install
npm run dev        # http://localhost:3000
npm test           # pruebas unitarias (Vitest)
npm run typecheck
npm run build
```

## Cómo probar la Fase 1

1. Crea tu cuenta, crea el hogar y comparte el código desde **Ajustes**. Tu pareja crea su cuenta y se une.
2. Cada uno agrega sus cuentas en **Cuentas** (prueben una `PRIVATE`, una `BALANCE_ONLY` y una tarjeta con deuda).
3. En **Presupuestos** creen, por ejemplo:
   - Mercado: 100 % A, $1.000.000, obligación del hogar, progreso compartido.
   - Arriendo: montos fijos A $500.000 / B $300.000, obligación.
   - Ropa: personal (privada).
4. Registren gastos con el botón **+**:
   - A paga $400.000 de Mercado → el Saldo Seguro de A reserva $600.000.
   - A paga el internet de B → “Pagado por ti, corresponde a B” y B queda debiendo en el cruce.
   - A paga $200.000 en el supermercado y divide: $165.000 Mercado de A + $35.000 a cargo de B.
   - A paga $600.000 de Arriendo → la app pregunta si le cobra a B el excedente de $100.000.
5. Revisen en el otro celular que las barras compartidas y el cruce se actualizan solos, y que no se ven las cuentas ni categorías privadas.
6. Quien debe toca **Liquidar** y el cruce vuelve a cero.
