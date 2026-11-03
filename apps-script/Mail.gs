/**
 * Sends each active person in the people tab the postings the agent added for them today.
 * The admin also gets the list of companies the agent could not read.
 */
function sendDailyMail() {
  var date = today_();
  var people = readPeople_();
  var admin = people.filter(function (p) { return p.admin; })[0];
  var postings = readTable_(CONFIG.SHEETS.POSTINGS).filter(function (r) { return r.date === date; });
  var unreadable = unreadableToday_(date);
  var sheetUrl = SpreadsheetApp.getActiveSpreadsheet().getUrl();
  var T = CONFIG.MAIL_TEXT;

  Logger.log('Date: ' + date + ' | rows today: ' + postings.length + ' | people: ' + people.length);

  people.forEach(function (p) {
    var mine = postings.filter(function (r) { return r.person === p.name; });
    var showUnreadable = p.admin && unreadable !== '';
    if (mine.length === 0 && !showUnreadable) return;

    var html = mine.length ? postingsTable_(p, mine, admin) : '<p>' + escapeHtml_(T.NONE_TODAY) + '</p>';
    if (p.admin) {
      if (showUnreadable) {
        html += '<p style="margin-top:16px"><b>' + escapeHtml_(T.UNREADABLE_TITLE) + '</b><br>' +
          escapeHtml_(unreadable) + '</p>';
      }
      html += '<p><a href="' + sheetUrl + '">' + escapeHtml_(T.SHEET_LINK) + '</a></p>';
    }

    MailApp.sendEmail({
      to: p.email,
      subject: fill_(p.admin ? T.ADMIN_SUBJECT : T.PERSON_SUBJECT, { date: date }),
      htmlBody: html
    });
    Logger.log(p.name + ': ' + mine.length + ' postings, mail sent');
  });
}

function postingsTable_(person, rows, admin) {
  var T = CONFIG.MAIL_TEXT;
  var C = T.COLUMNS;
  var cvs = {};
  rows.forEach(function (r) { cvs[r.cv] = true; });
  var showCv = person.admin || Object.keys(cvs).length > 1;

  var td = function (v) { return '<td style="padding:6px;border-bottom:1px solid #ddd">' + v + '</td>'; };
  var th = function (v) { return '<th align="left" style="padding:6px">' + escapeHtml_(v) + '</th>'; };

  var head = '<tr style="background:#f2f2f2">' + th(C.company) + th(C.title) + th(C.location) +
    (showCv ? th(C.cv) : '') + th(C.reason) + '</tr>';
  var body = rows.map(function (r) {
    return '<tr>' +
      td('<b>' + escapeHtml_(r.company) + '</b>') +
      td('<a href="' + escapeHtml_(r.link) + '">' + escapeHtml_(r.title) + '</a>') +
      td(escapeHtml_(r.location)) +
      (showCv ? td(escapeHtml_(r.cv)) : '') +
      td(escapeHtml_(r.reason)) +
      '</tr>';
  }).join('');

  var intro = fill_(person.admin ? T.ADMIN_INTRO : T.PERSON_INTRO, {
    name: person.name,
    count: rows.length,
    sender: admin ? admin.name : ''
  });

  return '<p>' + escapeHtml_(intro.trim()) + '</p>' +
    '<table style="border-collapse:collapse;font-family:Arial;font-size:13px">' + head + body + '</table>';
}

/** Last scan_log row for today, '' if none or '-'. */
function unreadableToday_(date) {
  var list = '';
  readTable_(CONFIG.SHEETS.SCAN_LOG).forEach(function (r) {
    if (r.date === date) list = r.unreadable_companies;
  });
  return list === '-' ? '' : list;
}
