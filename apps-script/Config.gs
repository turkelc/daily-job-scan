/**
 * Shared settings and helpers. All other files read from CONFIG.
 * The script is bound to the Google Sheet, so no spreadsheet ID is needed here.
 */
var CONFIG = {
  TIMEZONE: 'Asia/Jerusalem',

  SHEETS: {
    COMPANIES: 'companies',          // company, careers_page, note, job_source (edited by hand)
    PEOPLE: 'people',                // one row per person who gets matches (edited by hand)
    POSTINGS: 'postings',            // matched postings, appended by the Claude agent
    SCAN_LOG: 'scan_log',            // one row per agent run: companies it could not read
    RAW: 'raw_postings',             // Israel postings fetched from ATS APIs today (rewritten daily)
    COVERAGE: 'fetch_coverage'       // per company + source: ok / error, counts (rewritten daily)
  },

  FETCH_HOUR: 15, // fetchAtsJobs runs between 15:00 and 16:00, before the agent (16:41)
  MAIL_HOUR: 17,  // sendDailyMail runs between 17:00 and 18:00, after the agent

  // A posting counts as Israel-based if its location text matches this.
  ISRAEL_PATTERN: /israel|tel[\s-]?aviv|herzl?iya|herzelia|ramat[\s-]?gan|petah?[\s-]?tikv?a|haifa|jerusalem|netanya|ra'?anana|rehovot|yokneam|hod[\s-]?hasharon|kfar[\s-]?saba|bnei[\s-]?brak|givatayim|ness[\s-]?ziona|rosh[\s-]?ha'?ayin|airport[\s-]?city|be'?er[\s-]?sheva|caesarea|or[\s-]?yehuda|\bIL\b|\bISR\b/i,

  USER_AGENT: 'Mozilla/5.0 (compatible; daily-job-scan Apps Script)',
  WORKDAY_MAX: 200, // max postings to page through per Workday site
  AMAZON_MAX: 300,

  // Email copy. {name}, {count} and {sender} are filled in.
  MAIL_TEXT: {
    ADMIN_SUBJECT: 'New job postings - {date}',
    PERSON_SUBJECT: 'New job postings for you - {date}',
    ADMIN_INTRO: '{count} new postings today.',
    PERSON_INTRO: 'Hi {name}, here are {count} new postings that fit you today. {sender}',
    NONE_TODAY: 'No new postings today.',
    UNREADABLE_TITLE: 'Companies that could not be read (check manually):',
    SHEET_LINK: 'Full list',
    COLUMNS: { company: 'Company', title: 'Title', location: 'Location', cv: 'CV', reason: 'Why it fits' }
  }
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

/** Active people from the people tab: [{name, email, admin}] */
function readPeople_() {
  return readTable_(CONFIG.SHEETS.PEOPLE)
    .filter(function (p) { return p.name && p.email && isYes_(p.active); })
    .map(function (p) { return { name: p.name, email: p.email, admin: isYes_(p.admin) }; });
}

function isYes_(v) {
  return /^(yes|y|true|1|x)$/i.test(String(v).trim());
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

/** Replaces {key} placeholders in a template. */
function fill_(template, values) {
  return String(template).replace(/\{(\w+)\}/g, function (m, k) {
    return values[k] === undefined ? m : values[k];
  });
}

function escapeHtml_(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
