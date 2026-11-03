/**
 * Run `setup` once from the Apps Script editor. It replaces any old triggers
 * (including the legacy one from the first version) with:
 *   discoverSources weekly, Sunday at DISCOVER_HOUR
 *   fetchAtsJobs    daily, FETCH_HOUR
 *   sendDailyMail   daily, MAIL_HOUR
 */
function setup() {
  var handlers = ['discoverSources', 'fetchAtsJobs', 'sendDailyMail', 'gunlukMail']; // gunlukMail: legacy trigger from the first version
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (handlers.indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('discoverSources').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY)
    .atHour(CONFIG.DISCOVER_HOUR).inTimezone(CONFIG.TIMEZONE).create();
  ScriptApp.newTrigger('fetchAtsJobs').timeBased().everyDays(1)
    .atHour(CONFIG.FETCH_HOUR).inTimezone(CONFIG.TIMEZONE).create();
  ScriptApp.newTrigger('sendDailyMail').timeBased().everyDays(1)
    .atHour(CONFIG.MAIL_HOUR).inTimezone(CONFIG.TIMEZONE).create();
  Logger.log('Triggers: discoverSources Sundays @' + CONFIG.DISCOVER_HOUR +
    ', fetchAtsJobs @' + CONFIG.FETCH_HOUR + ', sendDailyMail @' + CONFIG.MAIL_HOUR);
}
