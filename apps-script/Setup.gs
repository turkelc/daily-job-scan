/**
 * Run `setup` once from the Apps Script editor. It replaces any old triggers
 * (including the earlier gunlukMail one) with:
 *   fetchAtsJobs   daily, FETCH_HOUR
 *   sendDailyMail  daily, MAIL_HOUR
 */
function setup() {
  var handlers = ['fetchAtsJobs', 'sendDailyMail', 'gunlukMail'];
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (handlers.indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('fetchAtsJobs').timeBased().everyDays(1)
    .atHour(CONFIG.FETCH_HOUR).inTimezone(CONFIG.TIMEZONE).create();
  ScriptApp.newTrigger('sendDailyMail').timeBased().everyDays(1)
    .atHour(CONFIG.MAIL_HOUR).inTimezone(CONFIG.TIMEZONE).create();
  Logger.log('Triggers: fetchAtsJobs @' + CONFIG.FETCH_HOUR + ', sendDailyMail @' + CONFIG.MAIL_HOUR);
}
