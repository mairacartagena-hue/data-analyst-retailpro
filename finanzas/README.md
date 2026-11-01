# Finanzas en Pareja

PWA privada de finanzas personales y en pareja (Android y escritorio). Todo en pesos colombianos (COP).

**Stack:** Next.js 16 (App Router) + TypeScript 5.9 + Tailwind 4 + componentes estilo shadcn/ui (Radix) + Motion · Supabase (Postgres, Auth, RLS, Realtime) · Vercel Hobby. Todo gratuito.

## Estado (27 de octubre de 2026)

| Parte | Estado |
|---|---|
| Fase 1 — Núcleo financiero | Hecha |
| Fase 2 — Ingesta automática | Hecha; llegan correos de Bancolombia por Gmail |
| Cierre del mes (con importación del extracto en CSV), Informes, pestañas Inicio · Movimientos · + · Presupuesto · Informes · Más | Hecho |
| Comentarios en los movimientos (migración 0020) | Hecho |
| Etiquetas del hogar, nombre y reglas de reembolso en la memoria de comercios, importación de extractos en Excel (migración 0021) | Hecho |
| Fase 3 — Dictar, foto del recibo y registrar sin conexión (migración 0026) | Hecho (0026 aplicada) |
| Fase 3 — Telegram | Descartado (no se implementa) |
| Organización hogar / personal, subcategorías, pago de deuda / reembolso / ajuste, presupuestos con nombre, vencimientos y metas de ahorro (migraciones 0017 y 0018) | Hecho (migraciones 0017 a 0019 aplicadas) |
| Fase 4.1 — Créditos con saldo: cuenta Crédito, reparto de cada cuota, Saldo Seguro, Patrimonio y aviso mensual del saldo (migración 0031) | Hecho (0031 aplicada) |
| Fase 4.1 — Créditos: cuotas, valor inicial, valor de la cuota, cuota en Presupuestos y cruce automático del pago, importar el extracto con IA, ajustar una cuota con el pago real (migraciones 0034 a 0038) | Hecho (aplicadas) |
| Fase 4.2 — Notificaciones Web Push (migración 0033) | Hecho (0033 aplicada); claves configuradas y un celular activado; el primer aviso programado sale el 31 de octubre |
| Fase 4.3 — Asistente con IA: preguntas sobre las finanzas y resumen del mes | Hecho |
| Auditoría de seguridad del 27-oct-2026 (migración 0040) | Hecha (0040 aplicada); ver “Seguridad” |
| Etapa 1 de mejoras: bloqueo con huella, verificación en dos pasos y política de contenido (migración 0041) | Hecha |
| Etapa 2 de mejoras: más fácil de usar (Guardar fijo en las hojas, botón atrás del celular, secciones desplegables en tarjetas y créditos, un solo Guardar en Ajustes) | Hecha |
| Etapa 3 de mejoras: más simple (Inicio con presupuestos en alerta, un solo botón de presupuesto, informes por subcategoría, Captura plegada, Cierre de a una cuenta) | Hecha |
| Auditoría del 31-oct-2026: tarjeta nueva con saldo al corte, cuota de la tarjeta en Presupuestos y cruce de pagos de deudas (migración 0046) | Hecha |
| Etapa 4 de mejoras: informes (consumo vs. pagos, aviso de lo por revisar, tendencia por periodos, CSV con cuotas, presupuesto vs. real, gastos fijos y variables, resumen para la renta) | Hecha |

**Pendiente por probar o configurar:**
- [x] La pareja ya está en el hogar (2 miembros).
- [ ] Probar con los dos celulares el cruce, la liquidación, Realtime y la privacidad (pasos 5 y 6 de “Cómo probar la Fase 1”).
- [x] Cola “Por revisar” al día (0 pendientes al 27-oct).
- [x] Primer Cierre del mes (ya hay conciliaciones guardadas).
- [x] `CRON_SECRET` puesta en Vercel (27-oct): las rutas de los crons ya no quedan abiertas.
- [ ] Confirmar que llegue el primer aviso diario (31-oct) y, si no, revisar `VAPID_PRIVATE_KEY` y `PUSH_CRON_SECRET` en Vercel.
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
| Flujo del periodo con interruptor Real / Sin pagar (descuenta los pagos programados del periodo aún no registrados) | `app/(app)/page.tsx` |
| Inicio con vistas Mis finanzas / Hogar / Vista global: avisos, por revisar, Saldo Seguro, cruce, próximos vencimientos, **presupuestos en alerta** (los que pasan del 80 %; los demás en Presupuesto) y patrimonio y flujo | `app/(app)/page.tsx` |
| RLS en todas las tablas, Realtime en ambos celulares, PWA instalable, modo claro/oscuro | `supabase/migrations` |

Las metas de ahorro y los compromisos están en 0017 y 0018; Web Push y el asistente con IA, en la Fase 4 (abajo).

**Créditos (Fase 4.1, migración 0031 y siguientes):** son un tipo de cuenta propio, **Crédito** (Cuentas → Créditos). Los pasivos manuales de Cuentas → “Otros activos y pasivos” siguen sirviendo para deudas sin cuotas:
- Datos del crédito: saldo de capital, tasa de interés (efectiva anual, en pesos; UVR queda fuera por ahora), plazo, día de pago, seguros y otros costos.
- Cada pago se registra una sola vez y se divide en capital (baja la deuda, no es gasto), intereses, seguros y otros costos (gastos). La app sugiere la división con la tasa y el saldo, y la persona la ajusta con el extracto del banco.
- Saldo Seguro: se reserva la cuota del periodo hasta que se pague, no el saldo total. Patrimonio: resta el saldo de capital real.
- **Cuotas (migración 0034):** en el crédito se indica el **número de cuotas** y **en qué cuota vas** (la próxima a pagar). Desde ese día, cada día de pago suma una cuota; la app muestra “Cuota 38 de 240” en Cuentas → Créditos y en el crédito, y calcula la cuota estimada con las cuotas que faltan. Sin ese dato cuenta los meses desde el saldo inicial.
- **Valor inicial (migración 0035):** lo que prestó el banco. Con él se ve cuánto del capital ya se pagó (barra en el crédito y “Pagado X %” en Cuentas → Créditos).
- **Valor de la cuota (migración 0036):** la cuota fija del extracto (capital + intereses, sin seguros). Con ella la app reserva esa cuota: los intereses salen de la tasa y el saldo, y la diferencia va a capital. Vacío: se calcula con la tasa y las cuotas que faltan.
- **Cuota en Presupuestos y cruce automático (migración 0038):** en el crédito, el interruptor **“Incluir la cuota en Presupuestos”** crea (o usa) una categoría con un presupuesto del **hogar** por la cuota: la estimada por la app (con seguros), que se puede cambiar. No es obligación del hogar, porque la cuota ya se aparta en “Tarjetas y créditos” del Saldo Seguro. El presupuesto cuenta lo transferido al crédito (la cuota real pagada); los intereses cargados al crédito no se cuentan otra vez. **Cruce automático** (`lib/finance/creditBudget.ts`, `components/CreditAutoPay.tsx`, función `apply_credit_payment`): cuando llega solo (correo, SMS o notificación) un pago que se parece a la cuota (±5 % de la estimada o del presupuesto, entre 15 días antes y 7 después del día de pago, y el texto menciona el crédito, el banco o sus últimos 4 dígitos), la app lo convierte sola en el pago del crédito: el aviso pasa a ser una transferencia al crédito con su monto real y los intereses y seguros estimados quedan como gasto cargado al crédito en su categoría. No cruza dos veces la misma cuota (si ya hay una transferencia al crédito a menos de 20 días) ni toca lo registrado a mano.
- **Importar el extracto del crédito** (Cuentas → Créditos → el crédito, o al crear uno): se sube el PDF o una foto y la IA (Gemini) llena saldo, tasa cobrada, número de cuotas, en qué cuota vas, valor de la cuota, seguros, día de pago y de corte, banco y últimos dígitos. Se revisa y se guarda. En un crédito que ya existe, si el saldo de la app a la fecha del extracto no coincide, ofrece ajustarlo (ajuste de saldo, no es gasto). El archivo no se guarda (`/api/credit-statement`, `lib/capture/creditStatement.ts`).
- **Ajustar una cuota con el pago real** (en el crédito y en Cierre del mes → Créditos, “Cuotas pagadas” → Ajustar): se escribe el capital que dice el pago del banco y la app deja el resto como intereses y seguros, sin cambiar lo que salió de la cuenta que pagó. Sirve para los dos registros de pago: el cruce automático (pago completo al crédito + intereses cargados al crédito) y la cuota registrada a mano (capital al crédito + intereses desde la cuenta) (`lib/finance/creditPayments.ts`, `components/CreditPaymentAdjust.tsx`).
- **Pestañas:** Cuentas se divide en **Cuentas · Créditos · Cruce** (créditos con cuotas y préstamos van en Créditos, con la deuda total y las cuotas del mes). En **Cierre del mes** también se separa **Cuentas / Créditos**: en un crédito se compara la deuda de capital con el extracto y la diferencia se corrige con un ajuste de saldo (no es gasto ni ingreso).
- La responsabilidad de la cuota se asigna igual que cualquier partida (ej. hipoteca 100 % de un miembro).
- Aviso mensual en el inicio (después del día de pago, hasta confirmarlo ese mes) para confirmar el saldo con el extracto: “¿El saldo de tu hipoteca es $X? Confirmar / Corregir”. Confirmar guarda la conciliación del mes; Corregir pide el saldo del extracto y registra la diferencia como ajuste de saldo (no es gasto ni ingreso) (`components/CreditCheck.tsx`).

## Notificaciones Web Push (migración 0033)

Ajustes → **Notificaciones** → “Activar en este celular” (cada persona en el suyo; en iPhone hay que instalar la app primero). “Enviar prueba” manda una al instante.

- **Un aviso al día a las 8 a. m.** (Vercel Cron → `/api/push/daily`); si hay varios recordatorios se juntan en uno. Al tocarlo se abre la pantalla del aviso.
- **Qué avisa:** pagos programados de los que eres responsable (el día antes y el mismo día), pago de la tarjeta (el día antes y el mismo día), cuota del crédito (el día antes, si no la has abonado), confirmar el saldo del crédito (el día después del pago), cierre del mes (el día 1, con las cuentas y créditos que faltan) y movimientos por revisar.
- **Cómo funciona:** la app calcula los recordatorios de los próximos 35 días cada vez que se abre y los guarda en `push_schedule` (`lib/finance/reminders.ts`, `components/PushScheduler.tsx`). La tarea diaria los pide con `push_due()` usando su propia clave (`PUSH_CRON_SECRET`), así el servidor no usa claves secretas de Supabase. Lo ya enviado no se repite; los celulares que ya no existen se borran solos.

Variables en Vercel: `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`mailto:...`) y `PUSH_CRON_SECRET`. En Supabase, la huella de esa clave: `insert into push_config (secret_hash) values (encode(extensions.digest('LA-CLAVE', 'sha256'), 'hex')) on conflict (id) do update set secret_hash = excluded.secret_hash;`

## Asistente con IA (Fase 4.3)

Más → **Asistente con IA** (también desde Informes → IA). Se le pregunta en lenguaje normal: “¿cuánto gastamos en mercado en los últimos 3 meses?”, “hazme un resumen del mes”, “¿qué podría recortar?”, “¿cuándo termino de pagar la hipoteca?”.

- La app arma en el celular un resumen de lo que la persona puede ver (`lib/ai/context.ts`): saldo seguro, patrimonio, cruce, presupuestos del periodo, cuentas y créditos (cuota, en qué cuota va, valor inicial), metas, pagos programados, ingresos y gastos de 12 meses, gasto por categoría de 6 meses y los movimientos recientes (hasta ~90 mil caracteres; los más viejos se recortan). Lo privado de la pareja nunca está en el celular, así que no se envía.
- `/api/ai/ask` exige sesión y llama a Gemini (`gemini-flash-latest`; si no está disponible usa Flash-Lite). Se puede cambiar con `GEMINI_ASSISTANT_MODEL`. Usa la misma `GEMINI_API_KEY` de la captura.
- La conversación se guarda solo en la pestaña abierta (se borra al cerrar la app) y responde en texto plano.

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
| Al generar el token, los botones de copiar (código del Apps Script y valor del encabezado Authorization) ya lo incluyen; aviso si el token aún no ha recibido nada. Cada persona configura su propio celular y Gmail una vez | `lib/ingest/templates.ts` |

| Google Wallet (notificación de pago con el celular; la cuenta se reconoce por los 4 dígitos de la tarjeta) | `parsers/googleWallet.ts` |

Pendiente de ejemplos reales: Nequi y Banco de Bogotá (mientras tanto los lee Gemini).

Variables de entorno de la Fase 2 (solo servidor, en Vercel):
```
GEMINI_API_KEY=...          # Google AI Studio, gratis
GEMINI_MODEL=...            # opcional; por defecto gemini-flash-lite-latest
```

## Fase 3 — Registro rápido y sin conexión

| Incluido | Dónde |
|---|---|
| **Dictar**: botón del micrófono siempre visible encima de la barra (a la derecha); abre el registro escuchando. También en + → Dictar. el navegador transcribe en español (es-CO) y la frase llena el formulario: tipo, monto, descripción, fecha, cuenta y categoría. Ej. “gasté 45 mil en el Éxito con Nequi”, “ayer pagué 18.500 de transporte”, “me pagaron el salario 3 millones en ahorros”, “pasé 200 mil de Nequi a ahorros”. Si el celular no deja dictar, se escribe la frase (o se usa el micrófono del teclado) | `components/QuickCapture.tsx` |
| La frase la lee Gemini (con la lista de cuentas y categorías, solo nombres); sin conexión la lee el celular con reglas: “45 mil”, “1,5 millones”, “1 millón 200 mil”, “20 lucas”, “ayer”, “antier” | `lib/capture/phrase.ts`, `app/api/capture` |
| **Foto del recibo** (+ → Foto del recibo): Gemini lee el total, el comercio, la fecha y sugiere la categoría. La foto se reduce en el celular, no se guarda en ningún lado y siempre se revisa el formulario antes de guardar | `lib/capture/gemini.ts` |
| **Sin conexión:** la app guarda en el celular una copia de los últimos datos y las pantallas principales; sin internet se abren con un aviso “Sin conexión · datos del …” | `lib/offline/store.ts`, `public/sw.js` |
| **Cola:** un movimiento nuevo guardado sin internet queda “por enviar” y se envía solo cuando vuelve la conexión (o con “Enviar ahora”). Cada uno lleva un identificador propio: si se reenvía no se duplica (`save_transaction_once()`, migración 0026). Editar, revisar avisos y leer fotos necesitan internet | `lib/data/FinanceProvider.tsx`, `components/OfflineBanner.tsx` |
| Al cerrar sesión se borra la copia local, la cola y las pantallas guardadas (avisa si hay movimientos sin enviar) | `app/(app)/ajustes` |

## Compras a cuotas con tarjeta de crédito (migración 0027)

- Al registrar (o revisar) un gasto pagado con una tarjeta de crédito aparece **Cuotas** (1 a 48). También se puede dictar: “compré un televisor de 2 millones con la Visa a 12 cuotas”. Se guarda en `transactions.installments`.
- **Presupuestos, informes y flujo del periodo:** cada mes cuenta su cuota de capital (valor ÷ cuotas, desde el mes de la compra; el sobrante de pesos va en la primera). En Movimientos la compra aparece una vez, con “· 12 cuotas”; en el detalle de un presupuesto sale “cuota 3 de 12”. Los totales que la pareja ve de un presupuesto personal compartido también se reparten (`shared_personal_spending()`).
- **Intereses estimados:** en Cuentas, cada tarjeta tiene su **tasa de interés (% efectiva anual)** (`accounts.interest_rate_ea`). Como cobran las tarjetas en Colombia: capital fijo por cuota e intereses sobre el saldo que queda, con la tasa mensual equivalente. A 1 cuota no hay intereses. Los intereses reales se registran con el extracto (Cierre del mes).
- **Saldo Seguro y vencimiento de la tarjeta:** se aparta solo lo que toca pagar en el periodo: deuda de la tarjeta − capital de las cuotas que vencen después + intereses estimados de las cuotas del periodo. La deuda completa sigue en Cuentas y en Patrimonio. **Con el día de corte y de pago de la tarjeta** (Cuentas → la tarjeta), se aparta solo el **extracto que vence en el periodo**: la deuda se compone de las compras más recientes (lo pagado cubre primero lo más viejo) y solo cuenta lo comprado hasta el corte de ese extracto; lo posterior al corte va en el extracto siguiente. Ej.: corte el 20 y pago el 5 → en octubre vence el extracto del 20-sep; en noviembre, el del 20-oct. Sin esos días se aparta la deuda menos las cuotas futuras, como antes. **Créditos (hipoteca):** se reserva la cuota del pago que cae en el periodo, y si ya abonaste capital al crédito después del corte de ese extracto y antes del siguiente (ej. el 23-oct para la cuota del 4-nov), esa cuota cuenta como pagada y no se reserva otra vez; un abono menor deja la parte proporcional que falta. Con el día de corte y de pago guardados en la cuenta. **Responsable de la tarjeta o del crédito** (Cuentas → la cuenta → “¿Quién paga…?”, migración 0032): el Saldo Seguro de quien paga aparta la cuota y la deuda; el del otro no. Para que pueda calcularlo, el responsable ve los movimientos pagados con esa cuenta y las compras del extracto de la tarjeta, y la cuenta no puede ser privada; solo el dueño puede editarla. La lista de Cuentas muestra “responsable: …” en cada tarjeta o crédito. **Proyección de la tarjeta** (Cuentas → la tarjeta): con día de corte, de pago y apertura, se proyecta por mes de pago; lo que compras después del extracto (una cuota o varias) entra en el primer extracto que lo factura (corte 20 y pago 5: una compra del 23-oct se paga el 5-dic y sus cuotas siguen mes a mes), y las cuotas que faltan de las compras del extracto empiezan en ese mismo pago. Las compras pendientes de revisar no se proyectan. En el formulario de un gasto con tarjeta, las cuotas se eligen en un menú de 1 a 48. Una compra del extracto que ya está registrada como movimiento (misma tarjeta, mismo valor con $1 de diferencia y 1 día de diferencia) se cuenta una sola vez: manda el extracto, que trae el saldo y las cuotas reales. Las **compras a cuotas del extracto** (Cuentas → la tarjeta) no se pagan en el extracto que vence: su saldo pendiente se factura una cuota por corte, así que solo cuenta la cuota (con intereses) que cae antes de la fecha de pago.

**Tarjeta nueva con su extracto (auditoría del 31-oct-2026):**
- Al crear la tarjeta se escribe el **saldo al corte** (el “Pago total” del extracto) y la **fecha de corte**; las compras a cuotas que siguen se agregan aparte y su saldo diferido se suma a la deuda (la app muestra la deuda total). También se puede **importar el PDF o la foto del extracto** y la IA llena saldo, fechas, cupo, tasa y compras a cuotas. La cuenta empieza el día siguiente al corte: las compras desde ese día se registran como movimientos y van en el próximo extracto.
- **Proyección:** el saldo al corte sale en el mes de su fecha de pago (menos lo que ya se abonó) y cada cuota de las compras anteriores en el pago que le toca.
- **Cuota del mes en Presupuestos** (interruptor en la tarjeta): presupuesto del hogar con lo que vence cada periodo de la deuda que ya traía la tarjeta; queda en 0 al acabarse. De cada pago a la tarjeta solo cuenta lo que cubre esa deuda anterior, porque las compras nuevas ya cuentan en su categoría (`lib/finance/cardBudget.ts`). “Recalcular” lo actualiza si se agregan compras del extracto.
- **Vencimientos:** el pago de la tarjeta queda tachado como “Pagado” cuando ya no queda nada del extracto.

**Pago de deudas: cruce automático (migración 0046):**
- Un pago registrado a mano (o desde Vencimientos → Pagar) en la **categoría del presupuesto de un crédito**, con ±25 % de la cuota, se convierte solo en el pago del crédito: baja la deuda, cuenta en su presupuesto y deja la cuota del crédito pagada; si venía de un vencimiento, el vencimiento sigue pagado.
- Un vencimiento manual se marca pagado también con una transferencia a un crédito o tarjeta cuyo presupuesto es de su categoría.
- Quien paga la tarjeta o el crédito de su pareja (“¿Quién paga…?”) ya puede transferirle desde sus cuentas.

**Cuota de la tarjeta en Vencimientos y cruce del pago (migración 0050):**
- La tarjeta con presupuesto aparece en Vencimientos para quien la paga y también para su dueña, con la cuota del presupuesto de ese día de pago. En Presupuestos, la barra de la tarjeta muestra su fecha de pago.
- Un pago registrado en la categoría de la tarjeta (a mano, o con Pagar en Presupuestos), entre la cuota y lo que vence del extracto (±25 %), o un aviso del banco que menciona la tarjeta con ese valor (±5 %), se convierte solo en la transferencia a la tarjeta: baja la deuda, queda pagado el vencimiento y cuenta en su presupuesto.

**Vencimientos de los presupuestos obligatorios del hogar para los dos (migración 0051):**
- La cuota de cada crédito o tarjeta cuyo presupuesto es del hogar y obligatorio sale en Vencimientos (Inicio y Presupuestos) a ambos, también si la cuenta es privada, con el monto del presupuesto y “a cargo de” quien la paga. Queda pagada con una transferencia a esa cuenta o un gasto en su categoría cerca del día de pago (`lib/finance/obligationDues.ts`).
- `household_obligation_debts()` solo entrega nombre, tipo, días de corte y pago y la categoría; no saldos ni movimientos.

## Préstamos (migración 0028)

Cuenta de tipo **Préstamo** (Cuentas → + → Préstamo): para plata que me prestan (por ejemplo mi hermana) o que le presto a alguien. Su saldo es negativo mientras se debe.

- **Me prestan 200:** transferencia de la cuenta del préstamo a mi cuenta. No es ingreso; la deuda sube a 200.
- **Compro algo con esa plata:** gasto normal de mi cuenta.
- **Le pago 120:** transferencia de mi cuenta a la cuenta del préstamo. No es gasto; la deuda baja a 80.
- La deuda cuenta como pasivo en Patrimonio y se aparta completa del Saldo Seguro. No suma al flujo ni a los presupuestos, y no sale como opción para liquidar con la pareja.

## Cierre del mes (conciliación)

Más → **Cierre del mes** (`app/(app)/cierre`), con recordatorio en el inicio los últimos 3 días del mes y los primeros 5 del siguiente.

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
- **Subcategorías** (`categories.parent_id`, un nivel): la barra de una principal suma sus subcategorías. Más → Categorías → “Agregar las que falten” carga la estructura sugerida sin duplicar nombres. Una subcategoría se crea con “Nueva” eligiendo “Dentro de”.
- **Barras por categoría**: las compartidas (progreso compartido o montos fijos) solo suman movimientos del hogar, así cuadran en los dos celulares y lo personal no se filtra. Lo ejecutado se calcula con los movimientos que cada quien puede ver.
- **Presupuestos con nombre** (`budget_plans`): del hogar o personales; categorías incluidas (con límite propio opcional), cada periodo o un rango de fechas, alerta (%) y estado (activo, en pausa, cerrado). Gastado = gastos y pagos de deuda menos reembolsos; Comprometido = vencimientos sin pagar; Disponible = límite − gastado; Proyección = gastado + comprometido + ritmo del gasto variable. Cada parte cuenta una sola vez.
- **Próximos vencimientos** (`scheduled_payments`, en Presupuesto y en el Inicio): pagos previstos (una vez o cada mes) y fechas de pago de tarjetas con deuda. “Pagar” registra el pago enlazado al vencimiento, que deja de contar como comprometido.
- **Metas de ahorro** (Más → Metas): del hogar o personales, con aportes y retiros. El aporte previsto por periodo se aparta del Saldo Seguro de quien creó la meta mientras falte.
- **Informes**: Hogar / Personal / Todo, también para el CSV (columna “Ámbito”).

Las pruebas de `tests/db` corren las migraciones reales en una base de datos en memoria (PGlite) y verifican los criterios de aceptación (privacidad, deuda, transferencias, captura automática, datos existentes).

## Organización de la app

Pestañas: **Inicio · Movimientos · + · Presupuesto · Informes · Más**. “Más” agrupa Cuentas y cruce, Categorías, Cierre del mes, Captura automática y Ajustes.

- **Hojas (formularios que suben desde abajo):** el botón Guardar queda fijo abajo aunque el formulario sea largo (`Sheet` con `footer`), y el botón **atrás** del celular cierra la hoja en vez de salir de la pantalla (si hay una hoja sobre otra, cierra solo la de encima). En la tarjeta, la **proyección de pagos** y las **compras del extracto** son secciones desplegables; en el crédito, las **cuotas pagadas** (`components/ui/collapsible.tsx`). Al registrar, “Más opciones” guarda dividir por montos y etiquetas, los comentarios van al final y los créditos y préstamos no salen en “Pagué con” (solo en transferencias). Al editar una cuenta su tipo ya no se puede cambiar.
- **Ajustes:** un solo **Guardar** para perfil y periodos, en una barra que aparece abajo cuando hay cambios.
- El micrófono para dictar está a la izquierda, encima de la barra, para no tapar los botones de las tarjetas.
- **Categorías** (Más → Categorías): un solo lugar para crear, editar y archivar las categorías de gastos e ingresos. Son las mismas que aparecen en Presupuesto y al registrar un pago; cada una muestra si es del hogar o personal, su límite (y quién lo asume) y cuántos movimientos la usan.

- **Presupuesto:** “+ Presupuesto” pregunta si es **de una categoría** o **de varias categorías** (con nombre); la sección de varias categorías solo aparece si hay alguno. Al tocar una barra (o “Ver sus pagos”) se ven los pagos que la forman y cómo llegó cada uno (correo, SMS, notificación o a mano).
- **Movimientos:** filtros por categoría (incluye subcategorías), espacio, tipo, cuenta, quién pagó y responsable (también por enlace: `?categoria=`, `?cuenta=`).
- **Marcas internas:** además de las etiquetas (abajo), la app guarda marcas técnicas que no se muestran (ej. `#gmf` para no sumar dos veces el 4x1000 y `#suscripcion` para reconocer cobros de suscripción); los cobros de suscripción sugieren la categoría “Suscripciones” en “Por revisar”.
- **Informes:** gastos **por subcategoría** (ej. “Energía · Servicios”; con “Categoría” las subcategorías suman en su principal), por persona (hogar/personal) y tendencia de 6 meses, con vista de tabla y descarga CSV para Excel (separador “;”).
- **Vencimientos del hogar en Presupuestos:** al guardar un vencimiento mensual del hogar con categoría, si ni ella ni su principal tienen presupuesto del hogar, el interruptor “Agregarlo a Presupuestos” (encendido por defecto) crea ese presupuesto como pago obligatorio por el monto del vencimiento, a cargo de quien le corresponde. Si ya existe, la hoja dice en cuál cuenta.
- **Vencimientos compartidos (migración 0043):** en un vencimiento del hogar, “¿Quién lo asume?” tiene la opción “Compartido”: cada uno pone un monto fijo (se propone mitad y mitad; deben sumar el total). Se guarda en `share_a` / `share_b`. Al pagarlo, el gasto se abre ya dividido por persona. Va amarrado al presupuesto de la categoría: queda “Compartido con montos fijos” en la misma proporción, y al revés.
- **Quién lo asume, amarrado:** en un vencimiento del hogar el campo se llama “¿Quién lo asume?”. Si su categoría tiene presupuesto del hogar, cambiarlo en el vencimiento cambia quién asume el presupuesto (100 % de esa persona) y guardar el presupuesto pone la misma persona en los vencimientos del hogar de esa categoría (compartido con montos fijos: sin una sola persona).
- **Cuotas de créditos en Vencimientos:** cada crédito con día de pago (a tu cargo) aparece en Vencimientos con la cuota estimada y su fecha; queda tachado como “Pagado” cuando ya hay abono después del corte anterior. “Pagar” abre el crédito con el formulario de la cuota listo (`/cuentas?vista=creditos&cuenta=…&cuota=1`).
- **Fecha de pago de las cuotas de créditos:** la tarjeta del presupuesto de un crédito muestra cuándo vence la cuota del periodo (día de pago del crédito): “Vence el 4 nov”, “Vence hoy”, “Vencida el …” o “Pagada · vencía el …”.
- **Presupuesto en grupos plegables:** Vencimientos, Hogar · obligatorios (se apartan del Saldo Seguro), Hogar · flexibles, Personales, Compartidos y De varias categorías; cada grupo muestra cuánto lleva de su límite y el celular recuerda cuáles dejaste abiertos. El interruptor de cada presupuesto del hogar se llama “Pago obligatorio del hogar”.
- **Informes plegables:** cada informe se abre y se cierra tocando su título; plegado muestra un resumen corto (ej. “Fijos 32 % · suscripciones $80.390 al mes”). De entrada solo está abierto “Gastos por subcategoría” y el celular recuerda cuáles dejaste abiertos.
- **Informes (etapa 4):**
  - **Consumo del periodo** (Informes) reparte las compras a cuotas: cuenta solo la cuota del periodo. En Movimientos el resumen dice **pagos** y suma cada compra por su valor completo.
  - Si hay movimientos **por revisar** dentro del periodo, Informes avisa cuánto suman (pueden cambiar de categoría).
  - **Tendencia de 6 periodos:** usa los periodos del hogar (mensual con su día de inicio o quincenal), no meses de calendario.
  - **CSV:** cada compra a cuotas sale con la cuota del periodo y la columna “Cuota” (ej. “2 de 12”), igual que los gráficos.
  - **Presupuesto frente a gasto real:** % usado de cada presupuesto de categoría en los últimos 3 periodos; avisa en cuáles te pasaste 2 o más veces.
  - **Cuotas de créditos completas:** en todos los informes (consumo, categorías, personas, tendencia, fijos y CSV) cada cuota pagada cuenta completa: a los intereses y seguros se suma el abono a capital como gasto de la misma categoría (`withCreditCapital()`), igual que en Presupuesto.
  - **Gastos fijos y variables:** vencimientos programados, suscripciones y cuotas de créditos (capital, intereses y seguros) frente al resto. Lista las suscripciones activas (compras marcadas, en una categoría de suscripciones o servicios conocidos, últimos 45 días). La marca `#suscripcion` solo queda en compras: una transferencia que se repite cada mes (a un familiar) no es suscripción (migración 0042).
  - **Resumen para la renta** (de quien mira, por año): ingresos por categoría, 4x1000 de sus cuentas (marca `#gmf`; la mitad es deducible) e **intereses** pagados de sus créditos, sin seguros (los seguros de cada cuota se toman de “Seguros y otros costos al mes” del crédito y se muestran aparte) (`taxSummary`, con `creditPayments`). Es una guía: los valores oficiales salen de los certificados de los bancos.
- **Captura automática:** si el token ya recibió avisos, la guía de configuración queda plegada detrás de “Configuración”.
- **Cierre del mes:** se abre una cuenta a la vez (la primera sin conciliar); al conciliarla se abre la siguiente.
- **Enviarle plata a la pareja** (+ → Transferir → “A {nombre}”): sale de tu cuenta, llega a su cuenta si la dejó visible (opcional) y queda anotado en el cruce (él te la debe). Sirve para cuando le mandas dinero para que haga una compra: cuando la registra a tu cargo, el cruce se compensa solo. El motivo se escribe libre en la descripción. El interruptor **“Anotar como deuda de {nombre}”** (activado por defecto) se apaga cuando la plata no es un préstamo (un regalo, plata que ya era de él): entonces solo se mueve entre cuentas y el cruce no cambia (migración 0022). También convierte un aviso pendiente (ej. “Cuenta ···4993”) en un envío a la pareja, sin dejar duplicados. Requiere que la pareja ya esté en el hogar; si no, el formulario muestra su enlace de invitación. Por debajo es una liquidación (`SETTLEMENT`).
- **Deudas a tu favor** (Más → Cuentas y cruce): cada deuda que tu pareja tiene contigo se lista con lo que queda y un interruptor **“cobrar / condonar”**. *Cobrar*: entra la plata a la cuenta que elijas (como ajuste de saldo: no cuenta como ingreso del hogar) y baja la deuda. *Condonar*: solo se quita del cruce, sin mover plata; se puede deshacer desde el historial. Se puede resolver solo una parte. Un pago se deshace borrando su movimiento. Solo quien tiene la deuda a favor puede resolverla, y nunca por más de lo que le deben (migración 0023, `resolve_debt()`).
- **Etiquetas** (Movimientos → Etiquetas): se crean, renombran, cambian de color y borran desde ahí o al registrar un movimiento. Un movimiento puede tener varias. Sirven para filtrar en Movimientos (también por enlace `?etiqueta=`), para el informe “Gastos por etiqueta” y salen en el CSV. Las del hogar las ven y editan los dos; quien ve un movimiento ve sus etiquetas (lo personal no se filtra a la pareja). Son distintas de las marcas internas (`#gmf`, `#banco`…), que la app sigue usando sin mostrarlas.
- **Memoria de comercios** (Más → Captura automática): al tocar un nombre se edita dónde se guardó (nombre, categoría, responsable, hogar o personal, deuda con la pareja, aplicar siempre). El **nombre** se usa en los avisos nuevos de esa llave, cuenta o comercio. Al guardar, **lo que cambies también se aplica a los movimientos anteriores** de ese origen (solo los tuyos ya confirmados, y solo en lo que editaste: nombre, categoría, responsable, espacio o deuda). Los pendientes se resuelven al revisarlos, la descripción que escribiste tú se respeta y los movimientos divididos no cambian de categoría ni responsable. **Correos sin fecha no se duplican** (migración 0025): los correos de AvalPay (PSE) no traen la fecha del pago; ahora el aviso guarda la fecha del correo (`ingest_logs.event_at`), “Reintentar” la usa, y un correo sin fecha se une al mismo monto y comercio del día anterior, el mismo día o el siguiente. Gemini ya no puede agregar letras de otros alfabetos al nombre del comercio. Cada cuenta, llave o celular aparece **una sola vez** en la lista: por debajo se guardan dos filas (la llave completa y “cuenta 1234” con los 4 últimos dígitos, porque algunos avisos solo traen esos), y se editan, apagan y olvidan juntas. **Lo que la app ya reconoce se confirma solo** (migración 0024): si el comercio, llave o cuenta está en la memoria con categoría, el aviso entra confirmado con esa categoría; “Aplicar siempre” nace prendido y se apaga comercio por comercio. Solo queda “Por revisar” lo que no logra identificar. Una **regla de reembolso** hace que los ingresos de un origen (ej. lo que envía Yolima cada mes) entren como reembolso de una categoría y resten del gasto.
- **Primer barrido (migración 0044):** en Ajustes → Periodos, debajo del día en que empieza el mes, el botón “Traer movimientos desde el inicio del mes” pide traer los correos bancarios de Gmail desde esa fecha hasta hoy (hasta 92 días atrás). La app no lee Gmail: el botón deja un pedido en `ingest_backfills` (uno por persona) con `request_ingest_backfill(fecha)`, y el Apps Script de la persona lo consulta cada 5 minutos en `GET /api/webhook/backfill` (con su token), envía todo desde esa fecha (si es largo, sigue en la próxima ejecución) y lo cierra con `POST /api/webhook/backfill`. Lo que llega pasa por la misma ingesta de siempre (no se duplica, queda “Por revisar” lo que no se reconoce). Si ya tenían el script instalado, deben reemplazarlo por el nuevo de Captura automática. Las notificaciones y SMS de MacroDroid no se pueden traer hacia atrás: solo se capturan desde que el celular las recibe. **El barrido dice qué encontró (migración 0045):** al terminar, el script informa cuántos correos envió y si existe la etiqueta (`ingest_backfills.sent` / `label_found`), y Ajustes avisa si no encontró la etiqueta o si no había correos, en vez de darlo por bueno. La etiqueta de Gmail puede llamarse como quieran (`Bancos`, `Finanzas/Bancos`…), pero `ETIQUETA` en el script debe ser idéntica; y el filtro debe crearse con “Aplicar también el filtro a las conversaciones coincidentes”, porque Gmail solo etiqueta lo nuevo.
- **Avisos sin reconocer:** el Cierre del mes y Captura automática cuentan lo mismo; Captura los lista todos (no solo los últimos) y un solo botón reintenta todos.
- **Categorías de ingresos** (`categories.kind = INCOME`): personales y sin presupuesto; se crean desde el formulario con “+ Nueva”.

## Pagos que se hacen por otra persona

Ej. un pago mensual que se hace por un familiar que luego envía la plata: se usa una categoría propia (ej. “Alvaro”) y reembolsos.
- El pago es un gasto en esa categoría; la plata que llega es un **reembolso** de la misma categoría, así que en el mes queda en $0 y no cuenta como ingreso.
- Para que llegue sola como reembolso: regla de reembolso en la memoria de comercios (`merchant_memory.movement_kind = 'REFUND'`) para quien envía la plata.
- La migración 0037 (`third_parties`) probó un interruptor “Plata de un tercero”; la 0039 la quitó.

## Seguridad

- RLS en todas las tablas; las funciones `SECURITY DEFINER` tienen `search_path` fijo y validan `auth.uid()`.
- Sin sesión solo se puede llamar a `ingest_event()`, a propósito: el webhook la usa con la clave pública y la función valida el token personal.
- `ingest_find_duplicate()` es interna (nadie la llama desde la API).
- Desde la migración 0016, las funciones nuevas no quedan abiertas sin sesión por defecto: cada migración debe dar `grant execute … to authenticated` (o `anon`, si de verdad hace falta).
- Al pegar migraciones por partes en el SQL Editor, revisar después **Advisors → Security** en Supabase: los `revoke`/`grant` de 0009, 0014a y 0015 no habían quedado aplicados (los corrige 0016).
- Tokens de captura y clave del cron guardados solo como huella SHA-256; el texto crudo de los avisos se borra a los 30 días; a Gemini se le envía enmascarado.
- **Auditoría del 27-oct-2026 (migración 0040 y código):**
  - El webhook valida el token (`ingest_token_valid()`) **antes** de leer el aviso con Gemini: sin token válido no se gasta el cupo de la IA.
  - `slot_user()`, `category_responsible()` y la función del trigger `accounts_check_responsible()` ya no se pueden llamar desde la API (devolvían ids de usuario de cualquier hogar). Las siguen usando por dentro las funciones de la base.
  - Al cerrar sesión, el celular deja de recibir las notificaciones de esa persona.
  - El service worker tenía los manejadores de notificaciones duplicados (al tocar un aviso podía abrir dos ventanas); quedó uno, que solo abre rutas de la app.
  - Cabeceras de seguridad en todas las páginas (`next.config.ts`): no se puede meter la app en un iframe, `nosniff`, `Referrer-Policy` y micrófono/cámara solo para la app.
- **`CRON_SECRET` en Vercel (configurada el 27-oct):** Vercel la envía sola a sus crons. Sin ella, `/api/keepalive` y `/api/push/daily` quedan abiertas (la segunda sigue necesitando `PUSH_CRON_SECRET`, pero alguien podría adelantar el envío del día).
- **Bloqueo con huella** (Ajustes → Seguridad, cada celular): la app pide la huella o el bloqueo de pantalla del celular al abrirse y al volver después de 2 minutos en segundo plano (WebAuthn, `lib/appLock.ts`, `components/AppLock.tsx`). Es un candado de la pantalla en ese celular; la cookie `app-lock` solo indica que la página llegue tapada.
- **Verificación en dos pasos** (Ajustes → Seguridad, gratis en Supabase): código de 6 dígitos de una app autenticadora. Quien la activa, al iniciar sesión pasa por `/verificar`. La base lo exige (migración 0041): sin el código (sesión `aal1`) ninguna tabla ni función devuelve datos (`mfa_ok()`, regla restrictiva en todas las tablas, `my_household_id()`, `is_member()`, saldos y notificaciones). Si se pierde el celular con la app autenticadora, se borra el factor en Supabase → Authentication → Users.
- **Política de contenido (CSP)** en `next.config.ts`: solo se cargan scripts, estilos e imágenes de la app y solo se conecta con ella y con Supabase.
- Avisos de Supabase que se aceptan: “Leaked password protection” (solo en planes de pago), funciones `SECURITY DEFINER` llamables con sesión (así funciona la app: cada una valida `auth.uid()`), `ingest_event`/`ingest_token_valid`/`push_due`/`push_gone` sin sesión (validan token o clave) y tablas sin políticas a propósito (`push_config`, `client_submissions`: solo las usan funciones internas).

## Decisiones de la Fase 1

1. **Tarjeta de crédito:** la compra consume el presupuesto al comprar (si es a cuotas, una cuota por mes); pagar la tarjeta es una transferencia y no vuelve a consumir presupuesto.
2. **Montos fijos:** lo ejecutado cuenta para el responsable de cada parte. Si quien paga se pasa de su parte fija, la app pregunta cuánto cobrarle a la pareja (propone el excedente hasta lo que a la pareja le falte); si se cobra, esa parte queda a cargo de la pareja y genera un asiento de cruce.
3. **Cuenta privada en categoría compartida:** la pareja ve monto, fecha y concepto; la cuenta aparece como “Cuenta privada”, salvo que su dueño active “Mostrar el nombre en gastos compartidos”.
4. **Ingresos:** privados por defecto; se pueden compartir (la pareja los ve y cuentan en el flujo del hogar).
5. **Rollover:** el cálculo existe (pasan sobrantes y sobregiros), pero ya no se ofrece el interruptor al editar un presupuesto.
6. **Moneda:** solo pesos colombianos.
7. **Patrimonio:** cuentas y tarjetas + activos y pasivos manuales.
8. **Privacidad (desde 0017):** la decide el ámbito del movimiento, no la categoría ni la cuenta. Las barras compartidas suman solo movimientos del hogar.
9. **Quién registra:** cada movimiento lo registra quien pagó. Los del hogar los puede ajustar la pareja; solo quien lo registró lo borra. La liquidación la registra quien paga.

## Configuración

### 1. Base de datos (Supabase, proyecto `finanzas-pareja`)
Las migraciones están en `supabase/migrations/` (0001 → 0042). Para aplicarlas a mano, pega cada archivo completo en **SQL Editor → Run**, en orden. Se pueden correr más de una vez.

### 2. Autenticación
En Supabase → **Authentication → URL Configuration**:
- **Site URL:** `https://TU-APP.vercel.app`
- **Redirect URLs:** `http://localhost:3000/**` y `https://TU-APP.vercel.app/**`

### 3. Variables de entorno
Copia `.env.example` a `.env.local` (y en Vercel → Settings → Environment Variables):
```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...   (clave pública / publishable)
CRON_SECRET=...                     (recomendada: protege las rutas de los crons)
```
Las de Gemini y Web Push están en sus secciones.
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
