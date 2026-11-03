/**
 * Finds which ATS a company uses by reading its careers page HTML, and writes the
 * result to the detected_source column of the companies tab. Fetch.gs reads that
 * column next to job_source, so newly found companies move from the agent to code.
 *
 * Only companies without a fetchable job_source are checked. The hand-edited
 * columns (company, careers_page, note, job_source) are never changed.
 * Runs weekly (see Setup.gs) and can be run by hand: testDiscover.
 */

var DETECTED_HEADER = 'detected_source';

function discoverSources() {
  var sh = sheet_(CONFIG.SHEETS.COMPANIES);
  var values = sh.getDataRange().getDisplayValues();
  var header = values[0].map(function (h) { return String(h).trim(); });
  var col = ensureColumn_(sh, header, DETECTED_HEADER);
  var idx = {
    company: header.indexOf('company'),
    page: header.indexOf('careers_page'),
    source: header.indexOf('job_source')
  };
  var date = today_();

  // Which rows to check, and which pages to read for each.
  var targets = [];
  values.slice(1).forEach(function (r, i) {
    var name = String(r[idx.company] || '').trim();
    if (!name) return;
    var given = parseSources_(String(r[idx.source] || ''), '');
    if (given.some(function (s) { return FETCHABLE_TYPES.indexOf(s.type) !== -1; })) return;
    var pages = [];
    var page = String(r[idx.page] || '').trim();
    if (/^https?:\/\//.test(page)) pages.push(page);
    given.forEach(function (s) { if (s.type === 'comeet') pages.push(s.url); }); // Comeet board pages carry the API token
    if (pages.length) targets.push({ row: i + 2, name: name, pages: pages });
  });

  // Fetch all pages in parallel batches.
  var requests = [];
  targets.forEach(function (t) {
    t.pages.forEach(function (p) {
      requests.push({ target: t, url: p });
    });
  });
  var html = {};
  for (var b = 0; b < requests.length; b += CONFIG.DISCOVER_BATCH) {
    var batch = requests.slice(b, b + CONFIG.DISCOVER_BATCH);
    var responses = UrlFetchApp.fetchAll(batch.map(function (q) {
      return { url: q.url, muteHttpExceptions: true, followRedirects: true,
               headers: { 'User-Agent': CONFIG.USER_AGENT } };
    }));
    responses.forEach(function (res, k) {
      var q = batch[k];
      var text = res.getResponseCode() === 200 ? res.getContentText() : '';
      html[q.target.row] = (html[q.target.row] || '') + '\n' + text;
    });
  }

  var found = 0;
  targets.forEach(function (t) {
    var sources = detectAts_(html[t.row] || '');
    var cell = sources.length
      ? sources.map(function (s) { return s.type + ': ' + s.url; }).join(' | ')
      : 'none (checked ' + date + ')';
    if (sources.length) found++;
    sh.getRange(t.row, col).setValue(cell);
  });
  Logger.log('Checked: ' + targets.length + ' | ATS found: ' + found);
}

/** Adds a header cell if it is missing; returns the 1-based column number. */
function ensureColumn_(sh, header, name) {
  var i = header.indexOf(name);
  if (i !== -1) return i + 1;
  var col = header.length + 1;
  sh.getRange(1, col).setValue(name).setFontWeight('bold');
  return col;
}

/**
 * Looks for ATS links and embeds in a page's HTML. Returns [{type, url}] with
 * URLs in the form Fetch.gs expects. At most one source per ATS type.
 */
function detectAts_(html) {
  var out = [];
  var seen = {};
  var add = function (type, url) {
    if (seen[type]) return;
    seen[type] = true;
    out.push({ type: type, url: url });
  };
  var m;

  // Greenhouse: boards / job-boards links, embed scripts (?for=slug), API links.
  m = html.match(/greenhouse\.io\/(?:embed\/job_board(?:\/js)?\?for=|v1\/boards\/)([a-z0-9_-]+)/i) ||
      html.match(/(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/(?!embed\b)([a-z0-9_-]+)/i);
  if (m) add('greenhouse', 'https://boards-api.greenhouse.io/v1/boards/' + m[1].toLowerCase() + '/jobs');

  m = html.match(/(?:jobs|api)(\.eu)?\.lever\.co\/(?:v0\/postings\/)?([a-z0-9_.-]+)/i);
  if (m && m[2].toLowerCase() !== 'v0') {
    add('lever', 'https://api' + (m[1] || '') + '.lever.co/v0/postings/' + m[2]);
  }

  m = html.match(/(?:jobs\.ashbyhq\.com|api\.ashbyhq\.com\/posting-api\/job-board)\/([a-z0-9_.%-]+)/i);
  if (m && !/^(api|embed)$/i.test(m[1])) add('ashby', 'https://api.ashbyhq.com/posting-api/job-board/' + m[1]);

  m = html.match(/apply\.workable\.com\/(?!api\b|j\b)([a-z0-9_-]+)/i);
  if (m) add('workable', 'https://apply.workable.com/' + m[1] + '/');

  m = html.match(/https?:\/\/([a-z0-9-]+)\.breezy\.hr/i);
  if (m && !/^(app|www|marketing|help)$/i.test(m[1])) add('breezy', 'https://' + m[1] + '.breezy.hr/');

  m = html.match(/https?:\/\/[a-z0-9-]+\.wd\d+\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?[A-Za-z0-9_-]+/);
  if (m) add('workday', m[0]);

  m = html.match(/(?:careers|jobs)\.smartrecruiters\.com\/([A-Za-z0-9_-]+)/);
  if (m) add('smartrecruiters', 'https://careers.smartrecruiters.com/' + m[1]);

  var comeet = detectComeet_(html);
  if (comeet) add('comeet-api', comeet);

  return out;
}

/** Comeet's careers API needs the company UID and its public token, both embedded in the page. */
function detectComeet_(html) {
  var api = html.match(/careers-api\/2\.0\/company\/([0-9A-F]{2}\.[0-9A-F]{3})\/positions\?token=([0-9A-Z]+)/i);
  if (api) return comeetApiUrl_(api[1], api[2]);
  // Only look for the token close to a Comeet mention, so an unrelated token on the
  // page (e.g. a CSRF token) is not picked up.
  var re = /comeet/gi, hit;
  while ((hit = re.exec(html)) !== null) {
    var win = html.slice(Math.max(0, hit.index - 1500), hit.index + 1500);
    var uid = win.match(/company[-_]?uid["'\s]*[:=]\s*["']([0-9A-F]{2}\.[0-9A-F]{3})["']/i) ||
              win.match(/comeet\.com\/jobs\/[a-z0-9_-]+\/([0-9A-F]{2}\.[0-9A-F]{3})/i);
    var token = win.match(/["']?token["']?\s*[:=]\s*["']([0-9A-F]{16,})["']/i);
    if (uid && token) return comeetApiUrl_(uid[1], token[1]);
  }
  return null;
}

function comeetApiUrl_(uid, token) {
  return 'https://www.comeet.co/careers-api/2.0/company/' + uid.toUpperCase() +
    '/positions?token=' + token.toUpperCase() + '&details=false';
}

/** Run once by hand: detects sources and logs what it found per company. */
function testDiscover() {
  discoverSources();
  readTable_(CONFIG.SHEETS.COMPANIES).forEach(function (c) {
    if (c[DETECTED_HEADER]) Logger.log(c.company + ' | ' + c[DETECTED_HEADER]);
  });
}
