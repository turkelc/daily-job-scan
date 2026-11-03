// Offline tests: loads the .gs files into a sandbox with mocked Google services.
// Fixtures mirror the documented response shapes of each public ATS API.
// Run: node tests/run.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const fx = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8'));

function makeSandbox({ tabs, routes }) {
  const sent = [];
  const logs = [];
  const fetched = [];
  const makeSheet = (name) => ({
    getDataRange: () => ({ getDisplayValues: () => tabs[name] }),
    clearContents: () => { tabs[name] = []; },
    getRange: (r, c, nr, nc) => {
      const range = {
        setValues: (vals) => { tabs[name] = vals.map((row) => row.map(String)); return range; },
        setValue: (v) => {
          while (tabs[name].length < r) tabs[name].push([]);
          const row = tabs[name][r - 1];
          while (row.length < c) row.push('');
          row[c - 1] = String(v);
          return range;
        },
        setFontWeight: () => range
      };
      return range;
    },
    setFrozenRows: () => {}
  });
  const ss = {
    getSheetByName: (n) => (tabs[n] ? makeSheet(n) : null),
    insertSheet: (n) => { tabs[n] = []; return makeSheet(n); },
    getUrl: () => 'https://docs.google.com/spreadsheets/d/TEST'
  };
  const sandbox = {
    Logger: { log: (m) => logs.push(m) },
    Utilities: { formatDate: () => '2026-11-03', sleep: () => {} },
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    MailApp: { sendEmail: (m) => sent.push(m) },
    UrlFetchApp: {
      fetchAll: (reqs) => reqs.map((q) => sandbox.UrlFetchApp.fetch(q.url, q)),
      fetch: (url, opts) => {
        fetched.push({ url, opts });
        const route = routes.find((r) => r.match.test(url));
        const body = route ? route.body(url, opts) : null;
        const code = body && body.__status ? body.__status : (body === null ? 404 : 200);
        return {
          getResponseCode: () => code,
          getContentText: () => (typeof body === 'string' ? body : JSON.stringify(body))
        };
      }
    },
    ScriptApp: {}
  };
  vm.createContext(sandbox);
  for (const f of ['Config.gs', 'Fetch.gs', 'Discover.gs', 'Mail.gs', 'Setup.gs']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script', f), 'utf8'), sandbox, { filename: f });
  }
  return { sandbox, tabs, sent, logs, fetched };
}

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('ok  ' + name); }
  catch (e) { console.log('FAIL ' + name + '\n     ' + e.message); process.exitCode = 1; }
}

// ---------- parseSources_ ----------
test('parseSources_: multiple typed sources in job_source', () => {
  const { sandbox } = makeSandbox({ tabs: {}, routes: [] });
  const s = sandbox.parseSources_('workable: https://apply.workable.com/atera/ | comeet: https://www.comeet.com/jobs/atera/63.00B', '');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(s)), [
    { type: 'workable', url: 'https://apply.workable.com/atera/' },
    { type: 'comeet', url: 'https://www.comeet.com/jobs/atera/63.00B' }
  ]);
});
test('parseSources_: trailing note after URL is ignored', () => {
  const { sandbox } = makeSandbox({ tabs: {}, routes: [] });
  const s = sandbox.parseSources_('greenhouse: https://boards-api.greenhouse.io/v1/boards/appsflyer/jobs (slug tahmini)', '');
  assert.strictEqual(s[0].url, 'https://boards-api.greenhouse.io/v1/boards/appsflyer/jobs');
});
test('parseSources_: falls back to an ATS URL in careers_page', () => {
  const { sandbox } = makeSandbox({ tabs: {}, routes: [] });
  const s = sandbox.parseSources_('', 'https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite?locationHierarchy1=abc');
  assert.strictEqual(s[0].type, 'workday');
});
test('parseSources_: plain careers page gives nothing to fetch', () => {
  const { sandbox } = makeSandbox({ tabs: {}, routes: [] });
  assert.strictEqual(sandbox.parseSources_('', 'https://www.wix.com/careers').length, 0);
});
test('parseSources_: label with spaces ("viola portfolio board") is kept but not fetchable', () => {
  const { sandbox } = makeSandbox({ tabs: {}, routes: [] });
  const s = sandbox.parseSources_('viola portfolio board: https://careers.viola-group.com/companies/glassesusa', '');
  assert.strictEqual(s[0].type, 'viola portfolio board');
  assert.strictEqual(sandbox.FETCHABLE_TYPES.indexOf(s[0].type), -1);
});

// ---------- Israel filter ----------
test('Israel filter: cities and country codes', () => {
  const { sandbox } = makeSandbox({ tabs: {}, routes: [] });
  const yes = ['Tel Aviv', 'Tel-Aviv, Israel', 'Herzliya', 'Petah Tikva', 'Ramat Gan', 'Remote, IL', 'Tel Aviv, ISR', 'Herzelia', "Ra'anana", 'Yokneam'];
  const no = ['London', 'New York, NY', 'Remote', 'Kyiv, Ukraine', 'Illinois', 'Brazil'];
  yes.forEach((l) => assert.ok(sandbox.isIsraelJob_({ location: l }), l));
  no.forEach((l) => assert.ok(!sandbox.isIsraelJob_({ location: l }), l));
});

// ---------- fetchers ----------
const companyTab = [
  ['company', 'careers_page', 'note', 'job_source'],
  ['Melio', 'https://meliopayments.com/careers/', '', 'greenhouse: https://boards-api.greenhouse.io/v1/boards/melio/jobs'],
  ['Aidoc', '', '', 'greenhouse: https://boards-api.eu.greenhouse.io/v1/boards/aidocmedical/jobs'],
  ['Mobileye', '', '', 'lever: https://api.eu.lever.co/v0/postings/mobileye'],
  ['Moon Active', '', '', 'ashby: https://api.ashbyhq.com/posting-api/job-board/moonactive'],
  ['Atera', '', '', 'workable: https://apply.workable.com/atera/ | comeet: https://www.comeet.com/jobs/atera/63.00B'],
  ['Voltify', '', '', 'breezy: https://voltify.breezy.hr/ (postings are in the US)'],
  ['Unity', '', '', 'workday: https://unitytech.wd1.myworkdayjobs.com/Unity'],
  ['Amazon', '', '', 'amazon: https://www.amazon.jobs/en/search.json?loc_query=Israel'],
  ['Broken', '', '', 'greenhouse: https://boards-api.greenhouse.io/v1/boards/doesnotexist/jobs'],
  ['Empty', '', '', 'greenhouse: https://boards-api.greenhouse.io/v1/boards/emptyboard/jobs'],
  ['Wix', 'https://careers.wix.com/', '', ''],
  ['', '', '', '']
];
const routes = [
  { match: /boards-api\.greenhouse\.io\/v1\/boards\/melio\/jobs/, body: () => fx('greenhouse.json') },
  // EU boards are read through the main API host too
  { match: /^https:\/\/boards-api\.greenhouse\.io\/v1\/boards\/aidocmedical\/jobs/, body: () => fx('greenhouse.json') },
  { match: /boards-api\.greenhouse\.io\/v1\/boards\/emptyboard\/jobs/, body: () => ({ jobs: [] }) },
  { match: /api\.eu\.lever\.co\/v0\/postings\/mobileye\?mode=json/, body: () => fx('lever.json') },
  { match: /api\.ashbyhq\.com\/posting-api\/job-board\/moonactive$/, body: () => fx('ashby.json') },
  { match: /apply\.workable\.com\/api\/v1\/widget\/accounts\/atera$/, body: () => fx('workable.json') },
  { match: /voltify\.breezy\.hr\/json$/, body: () => fx('breezy.json') },
  { match: /unitytech\.wd1\.myworkdayjobs\.com\/wday\/cxs\/unitytech\/Unity\/jobs$/, body: (u, o) => {
      const off = JSON.parse(o.payload).offset;
      return off === 0 ? fx('workday_p1.json') : fx('workday_p2.json');
    } },
  { match: /amazon\.jobs\/en\/search\.json/, body: () => fx('amazon.json') }
];

test('fetchAtsJobs: writes only Israel postings to raw_postings', () => {
  const tabs = { 'companies': companyTab };
  const { sandbox } = makeSandbox({ tabs, routes });
  sandbox.fetchAtsJobs();
  const raw = JSON.parse(JSON.stringify(tabs['raw_postings']));
  assert.deepStrictEqual(raw[0], ['date', 'company', 'title', 'location', 'link', 'source']);
  const by = (c) => raw.slice(1).filter((r) => r[1] === c).map((r) => r[2]);
  assert.deepStrictEqual(by('Melio'), ['Senior Data Analyst - Product', 'Customer Success Manager']);
  assert.deepStrictEqual(by('Aidoc'), ['Senior Data Analyst - Product', 'Customer Success Manager']);
  assert.deepStrictEqual(by('Mobileye'), ['Business Analyst']);
  assert.deepStrictEqual(by('Moon Active'), ['Business Strategy Manager', 'Market Researcher']);
  assert.deepStrictEqual(by('Atera'), ['Customer Success Operations']);
  assert.deepStrictEqual(by('Voltify'), []);
  assert.deepStrictEqual(by('Unity'), ['Business Analyst', 'Senior Strategic Partnership Manager', 'Senior Business Growth Manager']);
  assert.deepStrictEqual(by('Amazon'), ['Sales Operations Analyst, AWS Israel ENT & PS', 'Hardware Engineer']);
});

test('fetchAtsJobs: links are absolute and correct per ATS', () => {
  const tabs = { 'companies': companyTab };
  const { sandbox } = makeSandbox({ tabs, routes });
  sandbox.fetchAtsJobs();
  const link = (c, t) => tabs['raw_postings'].find((r) => r[1] === c && r[2] === t)[4];
  assert.strictEqual(link('Melio', 'Senior Data Analyst - Product'), 'https://job-boards.greenhouse.io/melio/jobs/7820287003');
  assert.strictEqual(link('Mobileye', 'Business Analyst'), 'https://jobs.eu.lever.co/mobileye/aaa-111');
  assert.strictEqual(link('Moon Active', 'Market Researcher'), 'https://jobs.ashbyhq.com/moonactive/537eb1da');
  assert.strictEqual(link('Atera', 'Customer Success Operations'), 'https://apply.workable.com/j/ABC123');
  assert.strictEqual(link('Unity', 'Business Analyst'), 'https://unitytech.wd1.myworkdayjobs.com/Unity/job/Tel-Aviv-Israel/Business-Analyst_JOBREQ-1');
  assert.strictEqual(link('Amazon', 'Sales Operations Analyst, AWS Israel ENT & PS'), 'https://www.amazon.jobs/en/jobs/10570232/sales-operations-analyst');
});

test('fetchAtsJobs: coverage tab records ok / error, skips comeet and plain pages', () => {
  const tabs = { 'companies': companyTab };
  const { sandbox, fetched } = makeSandbox({ tabs, routes });
  sandbox.fetchAtsJobs();
  const cov = tabs['fetch_coverage'].slice(1);
  const row = (c) => cov.filter((r) => r[1] === c);
  assert.strictEqual(row('Broken')[0][4], 'error');
  assert.ok(/HTTP 404/.test(row('Broken')[0][7]));
  assert.strictEqual(row('Melio')[0][4], 'ok');
  assert.strictEqual(row('Melio')[0][5], '3');   // total
  assert.strictEqual(row('Melio')[0][6], '2');   // israel
  assert.strictEqual(row('Atera').length, 1);    // workable only; comeet skipped
  assert.strictEqual(row('Wix').length, 0);
  assert.strictEqual(row('Empty')[0][4], 'empty');      // zero postings is suspicious, not covered
  assert.strictEqual(row('Voltify')[0][4], 'ok');      // has postings, none in Israel
  assert.ok(!fetched.some((f) => /boards-api\.eu\./.test(f.url)), 'no EU API host');
  assert.ok(!fetched.some((f) => /comeet/.test(f.url)));
  // Unity paged twice through Workday with an Israel search
  const wd = fetched.filter((f) => /wday\/cxs/.test(f.url));
  assert.strictEqual(wd.length, 2);
  assert.strictEqual(JSON.parse(wd[0].opts.payload).searchText, 'Israel');
  assert.strictEqual(wd[0].opts.method, 'post');
});

test('httpJson_: retries on HTTP 429 and then succeeds', () => {
  let calls = 0;
  const { sandbox } = makeSandbox({ tabs: {}, routes: [
    { match: /apply\.workable\.com\/api\/v1\/widget\/accounts\/atera$/, body: () => (++calls < 3 ? { __status: 429 } : fx('workable.json')) }
  ] });
  const jobs = sandbox.FETCHERS.workable('https://apply.workable.com/atera/');
  assert.strictEqual(calls, 3);
  assert.strictEqual(jobs.length, 2);
});

test('httpJson_: gives up after HTTP_ATTEMPTS and reports the status', () => {
  let calls = 0;
  const { sandbox } = makeSandbox({ tabs: {}, routes: [
    { match: /apply\.workable\.com/, body: () => { calls++; return { __status: 429 }; } }
  ] });
  assert.throws(() => sandbox.FETCHERS.workable('https://apply.workable.com/atera/'), /HTTP 429/);
  assert.strictEqual(calls, 3);
});

test('httpJson_: does not retry a 404', () => {
  let calls = 0;
  const { sandbox } = makeSandbox({ tabs: {}, routes: [
    { match: /boards-api\.greenhouse\.io/, body: () => { calls++; return null; } }
  ] });
  assert.throws(() => sandbox.FETCHERS.greenhouse('https://boards-api.greenhouse.io/v1/boards/x/jobs'), /HTTP 404/);
  assert.strictEqual(calls, 1);
});

test('amazon: asks for Israel-only results', () => {
  const { sandbox, fetched } = makeSandbox({ tabs: {}, routes: [{ match: /amazon\.jobs/, body: () => fx('amazon.json') }] });
  sandbox.FETCHERS.amazon();
  assert.ok(/normalized_country_code%5B%5D=ISR/.test(fetched[0].url));
});

// ---------- discovery ----------
const COMEET_EMBED = `<div id="careers"></div>
<script type="text/javascript">
window.comeetInit = function() {
  COMEET.init({ "token": "6C6B32BF0C9F9DF04B49D85C9A6C3E3B", "company-uid": "85.003", "color": "278fe6" });
};
(function(d, s, id) { var js = d.createElement(s); js.id = id; js.src = "//www.comeet.co/careers-api/api.js"; })(document, "script", "comeet-jsapi");
</script>`;

test('detectAts_: finds each ATS and builds fetchable URLs', () => {
  const { sandbox } = makeSandbox({ tabs: {}, routes: [] });
  const one = (html) => JSON.parse(JSON.stringify(sandbox.detectAts_(html)));
  assert.deepStrictEqual(one('<script src="https://boards.greenhouse.io/embed/job_board/js?for=Acme"></script>'),
    [{ type: 'greenhouse', url: 'https://boards-api.greenhouse.io/v1/boards/acme/jobs' }]);
  assert.deepStrictEqual(one('<a href="https://job-boards.eu.greenhouse.io/acmeil/jobs/123">x</a>'),
    [{ type: 'greenhouse', url: 'https://boards-api.greenhouse.io/v1/boards/acmeil/jobs' }]);
  assert.deepStrictEqual(one('<a href="https://jobs.eu.lever.co/acme/abc-1">x</a>'),
    [{ type: 'lever', url: 'https://api.eu.lever.co/v0/postings/acme' }]);
  assert.deepStrictEqual(one('<iframe src="https://jobs.ashbyhq.com/acme?embed=js"></iframe>'),
    [{ type: 'ashby', url: 'https://api.ashbyhq.com/posting-api/job-board/acme' }]);
  assert.deepStrictEqual(one('<a href="https://apply.workable.com/j/ABC">x</a><a href="https://apply.workable.com/acme/">all</a>'),
    [{ type: 'workable', url: 'https://apply.workable.com/acme/' }]);
  assert.deepStrictEqual(one('<a href="https://acme.breezy.hr/p/1">x</a>'),
    [{ type: 'breezy', url: 'https://acme.breezy.hr/' }]);
  assert.deepStrictEqual(one('<a href="https://acme.wd3.myworkdayjobs.com/en-US/AcmeCareers/job/x">x</a>'),
    [{ type: 'workday', url: 'https://acme.wd3.myworkdayjobs.com/en-US/AcmeCareers' }]);
  assert.deepStrictEqual(one(COMEET_EMBED),
    [{ type: 'comeet-api', url: 'https://www.comeet.co/careers-api/2.0/company/85.003/positions?token=6C6B32BF0C9F9DF04B49D85C9A6C3E3B&details=false' }]);
  assert.deepStrictEqual(one('<p>We are hiring! Send your CV.</p>'), []);
});

test('detectAts_: ignores a token that is far from any Comeet mention', () => {
  const { sandbox } = makeSandbox({ tabs: {}, routes: [] });
  const html = '<script>var cfg = { "token": "AAAAAAAAAAAAAAAAAAAA", "company-uid": "11.111" };</script>' +
    ' '.repeat(5000) + '<footer>Powered by Comeet</footer>';
  assert.strictEqual(sandbox.detectAts_(html).length, 0);
});

test('discoverSources: writes detected_source only for companies without a fetchable source', () => {
  const tabs = { companies: [
    ['company', 'careers_page', 'note', 'job_source'],
    ['Known', 'https://known.example/careers', '', 'greenhouse: https://boards-api.greenhouse.io/v1/boards/known/jobs'],
    ['Acme', 'https://acme.example/careers', '', ''],
    ['Artlist', 'https://artlist.example/careers', '', 'comeet: https://www.comeet.com/jobs/artlist/85.003'],
    ['Plain', 'https://plain.example/careers', '', ''],
    ['NoPage', '', '', '']
  ] };
  const routes = [
    { match: /acme\.example/, body: () => '<script src="https://boards.greenhouse.io/embed/job_board/js?for=acme"></script>' },
    { match: /artlist\.example/, body: () => '<h1>Careers</h1>' },
    { match: /comeet\.com\/jobs\/artlist/, body: () => COMEET_EMBED },
    { match: /plain\.example/, body: () => '<p>Send your CV to jobs@plain.example</p>' }
  ];
  const { sandbox, fetched } = makeSandbox({ tabs, routes });
  sandbox.discoverSources();
  const t = tabs.companies;
  assert.strictEqual(t[0][4], 'detected_source');
  assert.strictEqual(t[1][4] || '', '', 'company with a fetchable job_source is not checked');
  assert.ok(!fetched.some((f) => /known\.example/.test(f.url)));
  assert.strictEqual(t[2][4], 'greenhouse: https://boards-api.greenhouse.io/v1/boards/acme/jobs');
  assert.ok(/^comeet-api: https:\/\/www\.comeet\.co\/careers-api\/2\.0\/company\/85\.003\/positions\?token=/.test(t[3][4]), 'token read from the Comeet board page');
  assert.strictEqual(t[4][4], 'none (checked 2026-11-03)');
  assert.strictEqual(t[5][4] || '', '', 'no careers page, nothing to check');
  // the hand-edited columns are untouched
  assert.strictEqual(t[3][3], 'comeet: https://www.comeet.com/jobs/artlist/85.003');
});

test('fetchAtsJobs: uses detected_source, including the Comeet API', () => {
  const tabs = { companies: [
    ['company', 'careers_page', 'note', 'job_source', 'detected_source'],
    ['Artlist', '', '', 'comeet: https://www.comeet.com/jobs/artlist/85.003',
      'comeet-api: https://www.comeet.co/careers-api/2.0/company/85.003/positions?token=6C6B32BF0C9F9DF04B49D85C9A6C3E3B&details=false'],
    ['Plain', '', '', '', 'none (checked 2026-11-03)']
  ] };
  const routes = [{ match: /comeet\.co\/careers-api\/2\.0\/company\/85\.003\/positions/, body: () => fx('comeet.json') }];
  const { sandbox } = makeSandbox({ tabs, routes });
  sandbox.fetchAtsJobs();
  const raw = JSON.parse(JSON.stringify(tabs.raw_postings));
  assert.deepStrictEqual(raw.slice(1).map((r) => [r[1], r[2], r[4], r[5]]), [
    ['Artlist', 'Growth Product Analytics Team Lead', 'https://artlist.io/careers/13.E40', 'comeet-api']
  ]);
  const cov = tabs.fetch_coverage.slice(1);
  assert.strictEqual(cov.length, 1, 'comeet board link itself is not fetched, "none" is ignored');
  assert.strictEqual(cov[0][2], 'comeet-api');
  assert.strictEqual(cov[0][4], 'ok');
});

// ---------- mail ----------
function mailTabs(bobEmail) {
  return {
    people: [
      ['name', 'email', 'active', 'admin', 'cv_source', 'profile'],
      ['Alice', 'alice@example.com', 'yes', 'yes', '', ''],
      ['Bob', bobEmail, 'yes', 'no', '', ''],
      ['Old', 'old@example.com', 'no', 'no', '', '']
    ],
    postings: [
      ['date', 'company', 'title', 'link', 'person', 'location', 'cv', 'reason', 'link_status'],
      ['2026-11-03', 'Melio', 'Data Analyst', 'https://x/1', 'Alice', 'Tel Aviv', 'Product Analytics', 'SQL & <BI>', 'open'],
      ['2026-11-03', 'Global-e', 'CSM', 'https://x/2', 'Bob', 'Petah Tikva', 'Customer Success', '[SaaS: none] fit', 'open'],
      ['2026-11-02', 'Old Co', 'Old Job', 'https://x/3', 'Alice', 'Tel Aviv', 'Sales Ops', 'old', 'open']
    ],
    scan_log: [['date', 'unreadable_companies'], ['2026-11-03', 'Wix, Nvidia']]
  };
}

test('sendDailyMail: one mail per active person, only today\'s rows', () => {
  const { sandbox, sent } = makeSandbox({ tabs: mailTabs('bob@example.com'), routes: [] });
  sandbox.sendDailyMail();
  assert.strictEqual(sent.length, 2);
  const adminMail = sent.find((m) => m.to === 'alice@example.com');
  const bobMail = sent.find((m) => m.to === 'bob@example.com');
  assert.strictEqual(adminMail.subject, 'New job postings - 2026-11-03');
  assert.ok(adminMail.htmlBody.includes('Melio') && !adminMail.htmlBody.includes('Old Co'));
  assert.ok(adminMail.htmlBody.includes('Companies that could not be read') && adminMail.htmlBody.includes('Wix, Nvidia'));
  assert.ok(adminMail.htmlBody.includes('SQL &amp; &lt;BI&gt;'), 'html escaped');
  assert.strictEqual(bobMail.subject, 'New job postings for you - 2026-11-03');
  assert.ok(bobMail.htmlBody.includes('Hi Bob') && bobMail.htmlBody.includes('fit you today. Alice'));
  assert.ok(!bobMail.htmlBody.includes('could not be read'), 'unreadable list only for admin');
  assert.ok(!bobMail.htmlBody.includes('>CV<'), 'single-CV person has no CV column');
  assert.ok(!sent.some((m) => m.to === 'old@example.com'), 'inactive person skipped');
});

test('sendDailyMail: admin still mailed with no postings when there is an unreadable list', () => {
  const tabs = mailTabs('bob@example.com');
  tabs.postings = tabs.postings.slice(0, 1);
  const { sandbox, sent } = makeSandbox({ tabs, routes: [] });
  sandbox.sendDailyMail();
  assert.strictEqual(sent.length, 1);
  assert.ok(sent[0].htmlBody.includes('No new postings today.'));
});

test('sendDailyMail: test mode (Bob row pointing at Alice) sends two mails to Alice', () => {
  const { sandbox, sent } = makeSandbox({ tabs: mailTabs('alice@example.com'), routes: [] });
  sandbox.sendDailyMail();
  assert.strictEqual(sent.filter((m) => m.to === 'alice@example.com').length, 2);
});

console.log(`\n${passed} passed`);
