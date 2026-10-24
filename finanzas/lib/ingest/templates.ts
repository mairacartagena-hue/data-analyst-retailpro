// Textos que la persona copia en MacroDroid y en Google Apps Script.

export function notificationBody(): string {
  return `{"channel":"ANDROID_NOTIFICATION","app":"[app_name]","title":"[notification_title]","text":"[notification]"}`;
}

export function smsBody(): string {
  return `{"channel":"ANDROID_SMS","sender":"[sms_number]","text":"[sms_message]"}`;
}

/** Google Apps Script: lee la etiqueta de Gmail y envía cada correo nuevo una sola vez. */
export function appsScript(webhookUrl: string): string {
  return `// Finanzas en Pareja · Alertas bancarias de Gmail
// 1) Pega tu token en TOKEN. 2) Ejecuta "instalar" una vez y acepta los permisos.
const TOKEN = 'PEGA_AQUI_TU_TOKEN';
const WEBHOOK = '${webhookUrl}';
const ETIQUETA = 'Finanzas/Bancos';        // etiqueta que le pone tu filtro de Gmail
const PROCESADO = 'Finanzas/Procesado';    // se agrega a cada correo ya enviado

function instalar() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('procesar').timeBased().everyMinutes(5).create();
  GmailApp.getUserLabelByName(PROCESADO) || GmailApp.createLabel(PROCESADO);
  procesar();
}

function procesar() {
  const props = PropertiesService.getScriptProperties();
  const enviados = JSON.parse(props.getProperty('enviados') || '[]'); // ids ya enviados (últimos 500)
  const procesado = GmailApp.getUserLabelByName(PROCESADO) || GmailApp.createLabel(PROCESADO);
  const consulta = 'label:' + ETIQUETA.replace(/[\\s/]/g, '-') + ' newer_than:3d';
  const hilos = GmailApp.search(consulta, 0, 50);
  hilos.forEach(hilo => {
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
    if (todosOk) hilo.addLabel(procesado);
  });
  props.setProperty('enviados', JSON.stringify(enviados.slice(-500)));
}
`;
}
