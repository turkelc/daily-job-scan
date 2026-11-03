/**
 * Shared settings and helpers. All other files read from CONFIG.
 * The script is bound to the Google Sheet, so no spreadsheet ID is needed here.
 */
var CONFIG = {
  TIMEZONE: 'Asia/Jerusalem',

  SHEETS: {
    COMPANIES: 'good_companies_with_careers.csv', // company list (A: name, B: careers page, C: note, D: job source)
    PEOPLE: 'kisiler',        // one row per person who gets matches
    POSTINGS: 'ilanlar',      // matched postings, written by the Claude agent
    SCAN_LOG: 'tarama',       // one row per agent run: companies it could not read
    RAW: 'ham_ilanlar',       // all Israel postings fetched from ATS APIs today (rewritten each run)
    COVERAGE: 'ats_kapsam'    // per company + source: ok / error, counts
  },

  FETCH_HOUR: 15, // fetchAtsJobs runs between 15:00 and 16:00, before the agent (16:41)
  MAIL_HOUR: 17,  // sendDailyMail runs between 17:00 and 18:00, after the agent

  // A posting counts as Israel-based if its location text matches this.
  ISRAEL_PATTERN: /israel|tel[\s-]?aviv|herzl?iya|herzelia|ramat[\s-]?gan|petah?[\s-]?tikv?a|haifa|jerusalem|netanya|ra'?anana|rehovot|yokneam|hod[\s-]?hasharon|kfar[\s-]?saba|bnei[\s-]?brak|givatayim|ness[\s-]?ziona|rosh[\s-]?ha'?ayin|airport[\s-]?city|be'?er[\s-]?sheva|caesarea|or[\s-]?yehuda|\bIL\b|\bISR\b/i,

  USER_AGENT: 'Mozilla/5.0 (compatible; job-scan Apps Script)',
  WORKDAY_MAX: 200, // max postings to page through per Workday site
  AMAZON_MAX: 300
};

function today_() {
  return Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd');
}

function sheet_(name) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
}

/** Reads a tab into objects keyed by its header row. */
function readTable_(name) {
  var sh = sheet_(name);
  if (!sh) return [];
  var rows = sh.getDataRange().getDisplayValues();
  if (rows.length < 2) return [];
  var header = rows[0].map(function (h) { return String(h).trim(); });
  return rows.slice(1).map(function (r) {
    var o = {};
    header.forEach(function (h, i) { o[h] = String(r[i] === undefined ? '' : r[i]).trim(); });
    return o;
  });
}

/** Active people from the 'kisiler' tab: [{name, email, admin}] */
function readPeople_() {
  return readTable_(CONFIG.SHEETS.PEOPLE)
    .filter(function (p) { return p.isim && p.email && isYes_(p.aktif); })
    .map(function (p) { return { name: p.isim, email: p.email, admin: isYes_(p.admin) }; });
}

function isYes_(v) {
  return /^(evet|yes|true|1|x)$/i.test(String(v).trim());
}

/** Clears a tab (creating it if missing) and writes header + rows. */
function writeTab_(name, header, rows) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  sh.clearContents();
  var all = [header].concat(rows);
  sh.getRange(1, 1, all.length, header.length).setValues(all);
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, header.length).setFontWeight('bold');
}

function escapeHtml_(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
