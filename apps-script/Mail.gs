/**
 * Sends each active person in 'kisiler' the postings the agent added for them today.
 * The admin also gets the list of companies the agent could not read.
 */
function sendDailyMail() {
  var date = today_();
  var people = readPeople_();
  var admin = people.filter(function (p) { return p.admin; })[0];
  var postings = readTable_(CONFIG.SHEETS.POSTINGS).filter(function (r) { return r.tarih === date; });
  var unreadable = unreadableToday_(date);
  var sheetUrl = SpreadsheetApp.getActiveSpreadsheet().getUrl();

  Logger.log('Bugün: ' + date + ' | bugünkü satır: ' + postings.length + ' | kişi: ' + people.length);

  people.forEach(function (p) {
    var mine = postings.filter(function (r) { return r['kimin için'] === p.name; });
    var showUnreadable = p.admin && unreadable !== '';
    if (mine.length === 0 && !showUnreadable) return;

    var html = mine.length ? postingsTable_(p, mine, admin) : '<p>Bugün yeni ilan yok.</p>';
    if (p.admin) {
      if (showUnreadable) {
        html += '<p style="margin-top:16px"><b>Bakılamayan şirketler (manuel kontrol):</b><br>' +
          escapeHtml_(unreadable) + '</p>';
      }
      html += '<p><a href="' + sheetUrl + '">Tüm liste</a></p>';
    }

    MailApp.sendEmail({
      to: p.email,
      subject: (p.admin ? 'Yeni ilanlar - ' : 'Sana uygun yeni ilanlar - ') + date,
      htmlBody: html
    });
    Logger.log(p.name + ': ' + mine.length + ' ilan, mail gönderildi');
  });
}

function postingsTable_(person, rows, admin) {
  var cvs = {};
  rows.forEach(function (r) { cvs[r['hangi CV']] = true; });
  var showCv = person.admin || Object.keys(cvs).length > 1;

  var td = function (v) { return '<td style="padding:6px;border-bottom:1px solid #ddd">' + v + '</td>'; };
  var th = function (v) { return '<th align="left" style="padding:6px">' + v + '</th>'; };

  var head = '<tr style="background:#f2f2f2">' + th('Şirket') + th('Pozisyon') + th('Lokasyon') +
    (showCv ? th('CV') : '') + th('Neden uygun') + '</tr>';
  var body = rows.map(function (r) {
    return '<tr>' +
      td('<b>' + escapeHtml_(r['şirket']) + '</b>') +
      td('<a href="' + escapeHtml_(r.link) + '">' + escapeHtml_(r.pozisyon) + '</a>') +
      td(escapeHtml_(r.lokasyon)) +
      (showCv ? td(escapeHtml_(r['hangi CV'])) : '') +
      td(escapeHtml_(r['neden uygun'])) +
      '</tr>';
  }).join('');

  var intro = person.admin
    ? 'Bugün ' + rows.length + ' yeni ilan var.'
    : 'Selam ' + escapeHtml_(person.name) + ', bugün sana uygun ' + rows.length + ' yeni ilan buldum.' +
      (admin ? ' Sevgiler, ' + escapeHtml_(admin.name) : '');

  return '<p>' + intro + '</p>' +
    '<table style="border-collapse:collapse;font-family:Arial;font-size:13px">' + head + body + '</table>';
}

/** Last 'tarama' row for today, '' if none or '-'. */
function unreadableToday_(date) {
  var list = '';
  readTable_(CONFIG.SHEETS.SCAN_LOG).forEach(function (r) {
    var cols = Object.keys(r);
    if (r[cols[0]] === date) list = r[cols[1]];
  });
  return list === '-' ? '' : list;
}
