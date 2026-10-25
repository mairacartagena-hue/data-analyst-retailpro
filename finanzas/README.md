# Finanzas en Pareja

PWA privada de finanzas personales y en pareja (Android y escritorio). Todo en pesos colombianos (COP).

**Stack:** Next.js 16 (App Router) + TypeScript 5.9 + Tailwind 4 + componentes estilo shadcn/ui (Radix) + Motion · Supabase (Postgres, Auth, RLS, Realtime) · Vercel Hobby. Todo gratuito.

## Estado (24 de octubre de 2026)

| Parte | Estado |
|---|---|
| Fase 1 — Núcleo financiero | Hecha |
| Fase 2 — Ingesta automática | Hecha; llegan correos de Bancolombia por Gmail |
| Cierre del mes (con importación del extracto en CSV), Informes, pestañas Inicio · Movimientos · + · Presupuesto · Informes · Más | Hecho |
| Comentarios en los movimientos (migración 0020) | Hecho |
| Etiquetas del hogar, nombre y reglas de reembolso en la memoria de comercios, importación de extractos en Excel (migración 0021) | Hecho |
| Fase 3 — Voz, OCR, Telegram, offline con cola | Pendiente |
| Organización hogar / personal, subcategorías, pago de deuda / reembolso / ajuste, presupuestos con nombre, vencimientos y metas de ahorro (migraciones 0017 y 0018) | Hecho (migraciones 0017 a 0019 aplicadas) |
| Fase 4 — Créditos con saldo (capital e intereses), Web Push, IA | Pendiente |

**Pendiente por probar o configurar:**
- [ ] Que la pareja se una al hogar y probar el cruce, la liquidación, Realtime en dos celulares y la privacidad (pasos 1, 5 y 6 de “Cómo probar la Fase 1”).
- [ ] Revisar la cola “Por revisar” y los avisos no reconocidos (Ajustes → Captura automática → Reintentar).
- [ ] Hacer el primer Cierre del mes.
- [x] MacroDroid con las 2 macros (notificaciones y SMS). Falta conectar el celular de la pareja cuando se una.
- [ ] Conseguir ejemplos reales de Nequi y Banco de Bogotá (Google Wallet ya está).
- [ ] Crear el resto de categorías y las categorías de ingresos.
- [x] ~~Leaked password protection~~: solo existe en planes de pago de Supabase; no aplica (se usa el plan gratuito).
- [x] Vercel confirmado: Root Directory = `finanzas` y `GEMINI_API_KEY` configurada.

## Fase 1 — Núcleo financiero

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

Pendiente para fases siguientes: voz/OCR/Telegram/offline con cola (Fase 3), Web Push, IA y créditos con saldo (Fase 4). Las metas de ahorro y los compromisos ya existen (0017 y 0018).

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

| Google Wallet (notificación de pago con el celular; la cuenta se reconoce por los 4 dígitos de la tarjeta) | `parsers/googleWallet.ts` |

Pendiente de ejemplos reales: Nequi y Banco de Bogotá (mientras tanto los lee Gemini).

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
- **Importar el extracto (Excel o CSV)** (`components/StatementImport.tsx`, `lib/finance/statement.ts`, `lib/finance/xlsx.ts`): en cada cuenta, “Importar extracto (Excel o CSV) y conciliar”. El archivo se lee en el celular y no se sube. Lee `.xlsx` con un lector propio (acepta el estilo de Excel y el de los archivos que generan los bancos) y CSV. Probado con un extracto real de ahorros de Bancolombia: fechas sin año (`1/07`, el año sale del periodo DESDE/HASTA), encabezados repetidos en cada página y los totales cuadran con los del banco. Reconoce separador `;` `,` o tabulación, encabezados con o sin título, columna de valor con signo o débitos/créditos separados, y fechas día/mes/año o año-mes-día. Si no reconoce las columnas se pueden elegir a mano.
  - **Intereses y 4x1000** vienen en muchas líneas pequeñas (un abono casi todos los días): se suman por mes y se comparan contra lo registrado en la app (tolerancia de $2 en intereses y de 1 % o $50 en el 4x1000).
  - **Compras internacionales:** el aviso trae un valor y el banco cobra comisión de cambio; se unen si el comercio coincide, la fecha es cercana y la diferencia es de hasta 5 %, y se marcan como aproximadas. Un peso de diferencia por centavos también concilia.
  - **Faltan en la app:** línea del extracto sin movimiento con el mismo valor (hasta 3 días de diferencia). Los del banco (4x1000, intereses, cuotas) se registran todos con un botón; los demás abren el formulario ya llenado.
  - **Posibles duplicados:** más movimientos en la app que líneas en el extracto con ese valor y fecha; se puede borrar el que sobra.
  - **En la app y no en el extracto:** solo aviso.
  - **4x1000:** compara lo que cobró el banco con el estimado (0,4 % sobre las salidas por encima del tope exento). **Intereses** a favor y cobrados, y **cuotas/comisiones/seguros/IVA** se detectan por la descripción.
  - Si el extracto trae saldo, ofrece usar el saldo final como saldo del banco.
- Cada cuenta guarda la **fecha de su saldo inicial** (`opening_at`): lo que ocurrió antes ya estaba incluido en ese saldo y no se vuelve a restar.

## Hogar y personal (migraciones 0017, 0018 y 0019)

Cada movimiento tiene campos independientes: **tipo**, **ámbito** (hogar o personal), **categoría/subcategoría**, **responsable** de cada parte, **quién pagó** y **cuenta**.

- **Ámbito** (`transactions.scope`): la pareja ve un movimiento si es del hogar o si participa en él (pagó, lo registró o tiene una parte a su cargo). Ya no lo deciden la categoría ni la visibilidad de la cuenta. Una cuenta personal puede pagar gastos del hogar y sigue siendo de su dueño (si es privada, la pareja ve “Cuenta privada”).
- Al elegir una categoría se **sugiere** el ámbito (hogar si la categoría tiene progreso compartido o montos fijos); la persona lo cambia. Una categoría personal solo se usa en movimientos personales. Lo que llega por captura automática queda **personal** hasta revisarlo; “Aplicar siempre” recuerda el ámbito elegido.
- **Tipos**: gasto, ingreso, transferencia propia, liquidación, **pago de deuda** (cuenta en el presupuesto de su categoría), **reembolso** (resta del gasto de su categoría, no es ingreso) y **ajuste** (corrige el saldo; no es ingreso ni gasto). Transferencias, liquidaciones y ajustes no cuentan en gastos ni ingresos.
- **Deuda opcional**: si la parte de un movimiento le corresponde a quien no pagó, la app pregunta si se anota en el cruce (`creates_debt`). Un gasto del hogar 100 % de una persona no genera deuda.
- **Ajustes de la pareja**: un movimiento del hogar ya confirmado lo pueden ajustar los dos; quien pagó y su cuenta no cambian (`updated_by` guarda quién ajustó). Solo quien lo registró lo borra. Lo personal solo lo edita su dueño.
- **Las categorías no deciden nada (0019):** solo dicen en qué se gastó o de dónde vino la plata; todas las ven y usan los dos (también las de ingresos). Si algo es del hogar o personal, y quién lo asume, se define en el **presupuesto de la categoría** (`category_limits`, Presupuesto → “+ Categoría”) y en cada movimiento. Un presupuesto de categoría es del hogar (con responsable: 100 % de una persona o montos fijos; lo ven los dos y suma movimientos del hogar) o personal (solo su dueño lo ve; suma sus movimientos personales). Una categoría puede tener uno del hogar y uno personal por persona. Un presupuesto personal (de categoría o con nombre) se puede **compartir con la pareja**: ella ve el límite y cuánto lleva su dueño (totales de `shared_personal_spending()`), no los movimientos, y no lo puede editar. Al pagar desde un presupuesto se proponen su espacio y su responsable; al registrar eligiendo la categoría, el responsable es quien pagó y el espacio es el último usado.
- **Subcategorías** (`categories.parent_id`, un nivel): la barra de una principal suma sus subcategorías. Más → Categorías → “Agregar las que falten” carga la estructura sugerida sin duplicar nombres.
- **Barras por categoría**: las compartidas (progreso compartido o montos fijos) solo suman movimientos del hogar, así cuadran en los dos celulares y lo personal no se filtra. Lo ejecutado se calcula con los movimientos que cada quien puede ver.
- **Presupuestos con nombre** (`budget_plans`): del hogar o personales; categorías incluidas (con límite propio opcional), cada periodo o un rango de fechas, alerta (%) y estado (activo, en pausa, cerrado). Gastado = gastos y pagos de deuda menos reembolsos; Comprometido = vencimientos sin pagar; Disponible = límite − gastado; Proyección = gastado + comprometido + ritmo del gasto variable. Cada parte cuenta una sola vez.
- **Próximos vencimientos** (`scheduled_payments`, en Presupuesto y en el Inicio): pagos previstos (una vez o cada mes) y fechas de pago de tarjetas con deuda. “Pagar” registra el pago enlazado al vencimiento, que deja de contar como comprometido.
- **Metas de ahorro** (Más → Metas): del hogar o personales, con aportes y retiros. El aporte previsto por periodo se aparta del Saldo Seguro de quien creó la meta mientras falte.
- **Informes**: Hogar / Personal / Todo, también para el CSV (columna “Ámbito”).

Las pruebas de `tests/db` corren las migraciones reales en una base de datos en memoria (PGlite) y verifican los criterios de aceptación (privacidad, deuda, transferencias, captura automática, datos existentes).

## Organización de la app

Pestañas: **Inicio · Movimientos · + · Presupuesto · Informes · Más**. “Más” agrupa Cuentas y cruce, Categorías, Cierre del mes, Captura automática y Ajustes.

- **Categorías** (Más → Categorías): un solo lugar para crear, editar y archivar las categorías de gastos e ingresos. Son las mismas que aparecen en Presupuesto y al registrar un pago; cada una muestra si es del hogar o personal, su límite (y quién lo asume) y cuántos movimientos la usan.

- **Presupuesto:** al tocar una barra se ven los pagos que la forman y cómo llegó cada uno (correo, SMS, notificación o a mano).
- **Movimientos:** filtros por categoría (incluye subcategorías), espacio, tipo, cuenta, quién pagó y responsable (también por enlace: `?categoria=`, `?cuenta=`).
- **Sin etiquetas visibles:** la app trabaja solo con categorías. Por dentro se conservan marcas técnicas (ej. `#gmf` para no sumar dos veces el 4x1000 y `#suscripcion` para reconocer cobros de suscripción); los cobros de suscripción sugieren la categoría “Suscripciones” en “Por revisar”.
- **Informes:** gastos por categoría, por persona (hogar/personal) y tendencia de 6 meses, con vista de tabla y descarga CSV para Excel (separador “;”).
- **Enviarle plata a la pareja** (+ → Transferir → “A {nombre}”): sale de tu cuenta, llega a su cuenta si la dejó visible (opcional) y queda anotado en el cruce (él te la debe). Sirve para cuando le mandas dinero para que haga una compra: cuando la registra a tu cargo, el cruce se compensa solo. Motivo rápido: “Para una compra” o “Préstamo”. También convierte un aviso pendiente (ej. “Cuenta ···4993”) en un envío a la pareja, sin dejar duplicados. Requiere que la pareja ya esté en el hogar; si no, el formulario muestra su enlace de invitación. Por debajo es una liquidación (`SETTLEMENT`).
- **Etiquetas** (Movimientos → Etiquetas): se crean, renombran, cambian de color y borran desde ahí o al registrar un movimiento. Un movimiento puede tener varias. Sirven para filtrar en Movimientos (también por enlace `?etiqueta=`), para el informe “Gastos por etiqueta” y salen en el CSV. Las del hogar las ven y editan los dos; quien ve un movimiento ve sus etiquetas (lo personal no se filtra a la pareja). Son distintas de las marcas internas (`#gmf`, `#banco`…), que la app sigue usando sin mostrarlas.
- **Memoria de comercios** (Más → Captura automática): al tocar un nombre se edita dónde se guardó (nombre, categoría, responsable, hogar o personal, deuda con la pareja, aplicar siempre). El **nombre** se usa en los avisos nuevos de esa llave, cuenta o comercio. Al guardar, **lo que cambies también se aplica a los movimientos anteriores** de ese origen (solo los tuyos ya confirmados, y solo en lo que editaste: nombre, categoría, responsable, espacio o deuda). Los pendientes se resuelven al revisarlos, la descripción que escribiste tú se respeta y los movimientos divididos no cambian de categoría ni responsable. Una **regla de reembolso** hace que los ingresos de un origen (ej. lo que envía Yolima cada mes) entren como reembolso de una categoría y resten del gasto.
- **Avisos sin reconocer:** el Cierre del mes y Captura automática cuentan lo mismo; Captura los lista todos (no solo los últimos) y un solo botón reintenta todos.
- **Categorías de ingresos** (`categories.kind = INCOME`): personales y sin presupuesto; se crean desde el formulario con “+ Nueva”.

## Seguridad

- RLS en todas las tablas; las funciones `SECURITY DEFINER` tienen `search_path` fijo y validan `auth.uid()`.
- Sin sesión solo se puede llamar a `ingest_event()`, a propósito: el webhook la usa con la clave pública y la función valida el token personal.
- `ingest_find_duplicate()` es interna (nadie la llama desde la API).
- Desde la migración 0016, las funciones nuevas no quedan abiertas sin sesión por defecto: cada migración debe dar `grant execute … to authenticated` (o `anon`, si de verdad hace falta).
- Al pegar migraciones por partes en el SQL Editor, revisar después **Advisors → Security** en Supabase: los `revoke`/`grant` de 0009, 0014a y 0015 no habían quedado aplicados (los corrige 0016).

## Decisiones de la Fase 1

1. **Tarjeta de crédito:** la compra consume el presupuesto al comprar; pagar la tarjeta es una transferencia y no vuelve a consumir presupuesto.
2. **Montos fijos:** lo ejecutado cuenta para el responsable de cada parte. Si quien paga se pasa de su parte fija, la app pregunta cuánto cobrarle a la pareja (propone el excedente hasta lo que a la pareja le falte); si se cobra, esa parte queda a cargo de la pareja y genera un asiento de cruce.
3. **Cuenta privada en categoría compartida:** la pareja ve monto, fecha y concepto; la cuenta aparece como “Cuenta privada”, salvo que su dueño active “Mostrar el nombre en gastos compartidos”.
4. **Ingresos:** privados por defecto; se pueden compartir (la pareja los ve y cuentan en el flujo del hogar).
5. **Rollover:** opcional por categoría; pasan sobrantes y sobregiros.
6. **Moneda:** solo pesos colombianos.
7. **Patrimonio:** cuentas y tarjetas + activos y pasivos manuales.
8. **Privacidad (desde 0017):** la decide el ámbito del movimiento, no la categoría ni la cuenta. Las barras compartidas suman solo movimientos del hogar.
9. **Quién registra:** cada movimiento lo registra quien pagó. Los del hogar los puede ajustar la pareja; solo quien lo registró lo borra. La liquidación la registra quien paga.

## Configuración

### 1. Base de datos (Supabase, proyecto `finanzas-pareja`)
Las migraciones están en `supabase/migrations/` (0001 → 0019). Para aplicarlas a mano, pega cada archivo completo en **SQL Editor → Run**, en orden. Se pueden correr más de una vez.

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
