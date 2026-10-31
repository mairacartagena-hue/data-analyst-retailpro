// Textos que la persona copia en MacroDroid y en Google Apps Script.

export function notificationBody(): string {
  return `{"channel":"ANDROID_NOTIFICATION","app":"{not_app_name}","title":"{not_title}","text":"[notification]"}`;
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
 * envía todos los correos desde la fecha que dice la app y, al terminar, le dice cuántos envió y si encontró la etiqueta.
 */
export function appsScript(webhookUrl: string, token?: string): string {
  const barrido = webhookUrl.replace(/android-ingest$/, "backfill");
  return `// Finanzas en Pareja · Alertas bancarias de Gmail
// 1) Pega tu token en TOKEN (si ya viene puesto, sáltate este paso). 2) Ejecuta "instalar" una vez y acepta los permisos.
const TOKEN = '${token ?? "PEGA_AQUI_TU_TOKEN"}';
const WEBHOOK = '${webhookUrl}';
const BARRIDO = '${barrido}';              // la app avisa aquí si pediste el primer barrido
const ETIQUETA = 'Finanzas/Bancos';        // IDÉNTICA al nombre de tu etiqueta en Gmail (puede ser solo 'Bancos')
const PROCESADO = 'Finanzas/Procesado';    // se agrega a cada correo ya enviado

function instalar() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('procesar').timeBased().everyMinutes(5).create();
  GmailApp.getUserLabelByName(PROCESADO) || GmailApp.createLabel(PROCESADO);
  procesar();
}

// Se ejecuta solo cada 5 minutos. Si pediste el primer barrido en la app, envía todo desde el inicio del mes
// (si es largo, sigue en la próxima ejecución); si no, revisa los correos de los últimos 3 días.
function procesar() {
  const desde = barridoPedido();
  if (desde) {
    const props = PropertiesService.getScriptProperties();
    const r = enviar('after:' + desde, true);
    const total = Number(props.getProperty('barridoCorreos') || 0) + r.correos;
    if (r.completo) {
      barridoTerminado(total, r.etiquetaOk);
      props.deleteProperty('barridoCorreos');
    } else {
      props.setProperty('barridoCorreos', String(total));
    }
    return;
  }
  enviar('newer_than:3d', false);
}

// Ejecútala a mano una vez para enviar los correos de los últimos 30 días (ej. al agregar un banco nuevo al filtro).
function reenviar30Dias() { enviar('newer_than:30d', true); }

// Fecha (AAAA/MM/DD) desde la que la app pidió el barrido, o '' si no hay ninguno pendiente (o la app no respondió).
function barridoPedido() {
  try {
    const res = UrlFetchApp.fetch(BARRIDO, { headers: { Authorization: 'Bearer ' + TOKEN }, muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return '';
    const desde = JSON.parse(res.getContentText()).desde;
    return desde ? String(desde).replace(/-/g, '/') : '';
  } catch (e) {
    return ''; // un fallo aquí no debe frenar el envío normal de correos
  }
}

// Le dice a la app que terminó, cuántos correos envió y si encontró la etiqueta.
function barridoTerminado(correos, etiquetaOk) {
  UrlFetchApp.fetch(BARRIDO, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + TOKEN },
    muteHttpExceptions: true,
    payload: JSON.stringify({ correos: correos, etiqueta_ok: etiquetaOk }),
  });
}

function nombreEnGmail(etiqueta) { return etiqueta.replace(/[\\s/]/g, '-'); }

// Devuelve { completo, correos, etiquetaOk }: completo = false si se le acabó el tiempo y sigue en la próxima ejecución;
// correos = cuántos envió ahora; etiquetaOk = false si en tu Gmail no existe la etiqueta ETIQUETA.
function enviar(filtroFecha, barrido) {
  const resultado = { completo: true, correos: 0, etiquetaOk: true };
  if (!GmailApp.getUserLabelByName(ETIQUETA)) {
    Logger.log('No existe la etiqueta "' + ETIQUETA + '" en Gmail. Cambia ETIQUETA por el nombre exacto de tu etiqueta.');
    resultado.etiquetaOk = false;
    return resultado;
  }
  const limite = Date.now() + 4.5 * 60 * 1000;
  const props = PropertiesService.getScriptProperties();
  const enviados = JSON.parse(props.getProperty('enviados') || '[]'); // ids ya enviados (últimos 400; el servidor también descarta repetidos)
  const procesado = GmailApp.getUserLabelByName(PROCESADO) || GmailApp.createLabel(PROCESADO);
  // En un barrido se saltan los hilos ya marcados como procesados, así uno largo retoma donde quedó
  const consulta = 'label:' + nombreEnGmail(ETIQUETA) + (barrido ? ' -label:' + nombreEnGmail(PROCESADO) : '') + ' ' + filtroFecha;
  while (true) {
    const hilos = GmailApp.search(consulta, 0, barrido ? 100 : 50);
    let etiquetados = 0;
    for (const hilo of hilos) {
      if (Date.now() > limite) { resultado.completo = false; break; }
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
        if (res.getResponseCode() === 200) { enviados.push(id); resultado.correos++; }
        else todosOk = false;
      });
      if (todosOk) { hilo.addLabel(procesado); etiquetados++; }
    }
    if (!barrido || !resultado.completo) break;                 // revisión normal: una sola página
    if (hilos.length < 100) break;                              // no quedan más correos
    if (etiquetados === 0) { resultado.completo = false; break; } // solo fallas: se reintenta en la próxima ejecución
  }
  props.setProperty('enviados', JSON.stringify(enviados.slice(-400)));
  return resultado;
}
`;
}
