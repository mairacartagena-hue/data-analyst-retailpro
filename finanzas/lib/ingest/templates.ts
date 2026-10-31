// Textos que la persona copia en MacroDroid y en Google Apps Script.

export function notificationBody(): string {
  return `{"channel":"ANDROID_NOTIFICATION","app":"[app_name]","title":"[notification_title]","text":"[notification]"}`;
}

export function smsBody(): string {
  return `{"channel":"ANDROID_SMS","sender":"[sms_number]","text":"[sms_message]"}`;
}

/** Valor del encabezado Authorization para MacroDroid. */
export function authHeader(token: string): string {
  return `Bearer ${token}`;
}

/**
 * Google Apps Script: lee la etiqueta de Gmail y envía cada correo una sola vez. Con `token` sale listo para pegar, sin reemplazar nada a mano.
 * Cada 5 minutos también pregunta a la app si la persona pidió el primer barrido (Ajustes → Periodos); si lo pidió,
 * envía todos los correos desde la fecha que dice la app y avisa cuando termina.
 */
export function appsScript(webhookUrl: string, token?: string): string {
  const barrido = webhookUrl.replace(/android-ingest$/, "backfill");
  return `// Finanzas en Pareja · Alertas bancarias de Gmail
// 1) Pega tu token en TOKEN (si ya viene puesto, sáltate este paso). 2) Ejecuta "instalar" una vez y acepta los permisos.
const TOKEN = '${token ?? "PEGA_AQUI_TU_TOKEN"}';
const WEBHOOK = '${webhookUrl}';
const BARRIDO = '${barrido}';              // la app avisa aquí si pediste el primer barrido
const ETIQUETA = 'Finanzas/Bancos';        // etiqueta que le pone tu filtro de Gmail
const PROCESADO = 'Finanzas/Procesado';    // se agrega a cada correo ya enviado

function instalar() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('procesar').timeBased().everyMinutes(5).create();
  GmailApp.getUserLabelByName(PROCESADO) || GmailApp.createLabel(PROCESADO);
  procesar();
}

// Se ejecuta solo cada 5 minutos. Si pediste el primer barrido en la app, envía todo desde el inicio del mes
// (si es largo, sigue en la próxima ejecución hasta terminar); si no, revisa los correos de los últimos 3 días.
function procesar() {
  const desde = barridoPedido();
  if (desde) {
    if (enviar('after:' + desde, true)) barridoTerminado();
    return;
  }
  enviar('newer_than:3d', false);
}

// Ejecútala a mano una vez para enviar los correos de los últimos 30 días (ej. al agregar un banco nuevo al filtro).
function reenviar30Dias() { enviar('newer_than:30d', true); }

// Fecha (AAAA/MM/DD) desde la que la app pidió el barrido, o '' si no hay ninguno pendiente.
function barridoPedido() {
  const res = UrlFetchApp.fetch(BARRIDO, { headers: { Authorization: 'Bearer ' + TOKEN }, muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return '';
  const desde = JSON.parse(res.getContentText()).desde;
  return desde ? String(desde).replace(/-/g, '/') : '';
}

function barridoTerminado() {
  UrlFetchApp.fetch(BARRIDO, { method: 'post', headers: { Authorization: 'Bearer ' + TOKEN }, muteHttpExceptions: true });
}

function nombreEnGmail(etiqueta) { return etiqueta.replace(/[\\s/]/g, '-'); }

// Devuelve true si revisó todo lo que había; false si se le acabó el tiempo y debe seguir en la próxima ejecución.
function enviar(filtroFecha, barrido) {
  const limite = Date.now() + 4.5 * 60 * 1000;
  const props = PropertiesService.getScriptProperties();
  const enviados = JSON.parse(props.getProperty('enviados') || '[]'); // ids ya enviados (últimos 400; el servidor también descarta repetidos)
  const procesado = GmailApp.getUserLabelByName(PROCESADO) || GmailApp.createLabel(PROCESADO);
  // En un barrido se saltan los hilos ya marcados como procesados, así uno largo retoma donde quedó
  const consulta = 'label:' + nombreEnGmail(ETIQUETA) + (barrido ? ' -label:' + nombreEnGmail(PROCESADO) : '') + ' ' + filtroFecha;
  let completo = true;
  while (true) {
    const hilos = GmailApp.search(consulta, 0, barrido ? 100 : 50);
    let etiquetados = 0;
    for (const hilo of hilos) {
      if (Date.now() > limite) { completo = false; break; }
      let todosOk = true;
      hilo.getMessages().forEach(m => {
        const id = m.getId();
        if (enviados.indexOf(id) >= 0) return;
        const res = UrlFetchApp.fetch(WEBHOOK, {
          method: 'post',
          contentType: 'application/json',
          headers: { Authorization: 'Bearer ' + TOKEN },
          muteHttpExceptions: true,
          payload: JSON.stringify({
            channel: 'GMAIL',
            from: m.getFrom(),
            subject: m.getSubject(),
            text: m.getPlainBody().slice(0, 4000),
            received_at: m.getDate().toISOString(),
            external_id: id,
          }),
        });
        if (res.getResponseCode() === 200) enviados.push(id);
        else todosOk = false;
      });
      if (todosOk) { hilo.addLabel(procesado); etiquetados++; }
    }
    if (!barrido || !completo) break;                 // revisión normal: una sola página
    if (hilos.length < 100) break;                    // no quedan más correos
    if (etiquetados === 0) { completo = false; break; } // solo fallas: se reintenta en la próxima ejecución
  }
  props.setProperty('enviados', JSON.stringify(enviados.slice(-400)));
  return completo;
}
`;
}
