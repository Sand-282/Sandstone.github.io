// Deploy as a Google Apps Script web app: execute as you, access by anyone.
// Set WEBHOOK_TOKEN in Script Properties to the same long random value held
// in the Cloudflare Worker's GMAIL_BRIDGE_TOKEN secret.
function doPost(e) {
  try {
    var request = JSON.parse(e.postData.contents);
    var expected = PropertiesService.getScriptProperties().getProperty('WEBHOOK_TOKEN');
    if (!expected || expected.length < 32 || request.token !== expected) return result_({ error: 'Unauthorized' });
    if (!/^[0-9a-f-]{36}$/i.test(request.id || '') ||
        typeof request.to !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(request.to) ||
        typeof request.subject !== 'string' || request.subject.length > 200 ||
        typeof request.text !== 'string' || request.text.length > 100000) return result_({ error: 'Invalid message' });

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(3000)) return result_({ error: 'Busy; retry later' });
    try {
      var properties = PropertiesService.getScriptProperties();
      var key = 'sent:' + request.id;
      if (properties.getProperty(key)) return result_({ id: request.id });
      var options = { to: request.to, subject: request.subject, body: request.text };
      if (typeof request.replyTo === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(request.replyTo)) options.replyTo = request.replyTo;
      MailApp.sendEmail(options);
      properties.setProperty(key, '1');
      return result_({ id: request.id });
    } finally { lock.releaseLock(); }
  } catch (_) { return result_({ error: 'Delivery failed' }); }
}

function result_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

