/**
 * Pulls open postings straight from public ATS APIs (no API keys needed) and
 * writes the Israel-based ones to the raw_postings tab. The Claude agent reads
 * that tab instead of browsing every careers page, which keeps its usage low.
 *
 * Supported sources in the job_source column of the companies tab, written as "type: url",
 * several separated by " | ":
 *   greenhouse, lever, ashby, workable, breezy, workday, amazon
 * Anything else (comeet, own careers pages, ...) is left to the agent.
 */

var FETCHABLE_TYPES = ['greenhouse', 'lever', 'ashby', 'workable', 'breezy', 'workday', 'amazon'];

function fetchAtsJobs() {
  var date = today_();
  var companies = readTable_(CONFIG.SHEETS.COMPANIES);
  var raw = [];
  var coverage = [];

  companies.forEach(function (c) {
    var name = c.company;
    if (!name) return;
    var sources = parseSources_(c.job_source || '', c.careers_page || '');
    sources.forEach(function (s) {
      if (FETCHABLE_TYPES.indexOf(s.type) === -1) return;
      try {
        var jobs = FETCHERS[s.type](s.url);
        var israel = jobs.filter(isIsraelJob_);
        israel.forEach(function (j) {
          raw.push([date, name, j.title, j.location, j.url, s.type]);
        });
        // A board that returns nothing at all is more often a wrong or retired board than a
        // company with zero openings, so it is marked 'empty' and the agent checks it itself.
        coverage.push([date, name, s.type, s.url, jobs.length ? 'ok' : 'empty', jobs.length, israel.length, '']);
      } catch (e) {
        coverage.push([date, name, s.type, s.url, 'error', 0, 0, String(e.message || e).slice(0, 200)]);
      }
    });
  });

  writeTab_(CONFIG.SHEETS.RAW, ['date', 'company', 'title', 'location', 'link', 'source'], raw);
  writeTab_(CONFIG.SHEETS.COVERAGE,
    ['date', 'company', 'source', 'url', 'status', 'total_postings', 'israel_postings', 'error'], coverage);
  Logger.log('Israel postings: ' + raw.length + ' | sources: ' + coverage.length +
    ' | errors: ' + coverage.filter(function (c) { return c[4] === 'error'; }).length +
    ' | empty: ' + coverage.filter(function (c) { return c[4] === 'empty'; }).length);
}

/**
 * The job_source column ("greenhouse: https://... | comeet: https://...") plus, as a
 * fallback, an ATS URL in the careers_page column. Returns [{type, url}].
 */
function parseSources_(d, b) {
  var out = [];
  String(d).split('|').forEach(function (part) {
    var m = part.match(/^\s*([^:|]+?)\s*:\s*(https?:\/\/\S+)/i);
    if (m) out.push({ type: m[1].trim().toLowerCase(), url: m[2] });
  });
  var hasFetchable = out.some(function (s) { return FETCHABLE_TYPES.indexOf(s.type) !== -1; });
  if (!hasFetchable && b) {
    var t = detectType_(b);
    if (t) out.push({ type: t, url: b.trim() });
  }
  return out;
}

function detectType_(url) {
  if (/greenhouse\.io/i.test(url)) return 'greenhouse';
  if (/lever\.co/i.test(url)) return 'lever';
  if (/ashbyhq\.com/i.test(url)) return 'ashby';
  if (/workable\.com/i.test(url)) return 'workable';
  if (/\.breezy\.hr/i.test(url)) return 'breezy';
  if (/myworkdayjobs\.com/i.test(url)) return 'workday';
  return null;
}

function isIsraelJob_(j) {
  return j.assumeIsrael === true || CONFIG.ISRAEL_PATTERN.test(j.location || '');
}

function httpJson_(url, options) {
  var opts = options || {};
  opts.muteHttpExceptions = true;
  opts.headers = opts.headers || {};
  opts.headers['User-Agent'] = CONFIG.USER_AGENT;
  opts.headers['Accept'] = 'application/json';
  var res, code;
  for (var attempt = 1; attempt <= CONFIG.HTTP_ATTEMPTS; attempt++) {
    res = UrlFetchApp.fetch(url, opts);
    code = res.getResponseCode();
    if (code !== 429 && code < 500) break;          // retry only rate limits and server errors
    if (attempt < CONFIG.HTTP_ATTEMPTS) Utilities.sleep(2000 * attempt);
  }
  if (code !== 200) throw new Error('HTTP ' + code + ' ' + url);
  return JSON.parse(res.getContentText());
}

function joinLoc_(parts) {
  return parts.filter(function (p) { return p; }).join(', ');
}

var FETCHERS = {

  greenhouse: function (url) {
    var m = url.match(/boards\/([^\/?#\s]+)/) || url.match(/greenhouse\.io\/([^\/?#\s]+)/);
    if (!m) throw new Error('no greenhouse slug in url');
    // One public API host serves every board, including job-boards.eu.greenhouse.io ones.
    var data = httpJson_('https://boards-api.greenhouse.io/v1/boards/' + m[1] + '/jobs');
    return (data.jobs || []).map(function (j) {
      var offices = (j.offices || []).map(function (o) { return o.name; });
      return {
        title: j.title,
        location: joinLoc_([j.location && j.location.name].concat(offices)),
        url: j.absolute_url
      };
    });
  },

  lever: function (url) {
    var m = url.match(/postings\/([^\/?#\s]+)/) || url.match(/lever\.co\/([^\/?#\s]+)/);
    if (!m) throw new Error('no lever slug in url');
    var host = /\.eu\.lever\.co/i.test(url) ? 'api.eu.lever.co' : 'api.lever.co';
    var data = httpJson_('https://' + host + '/v0/postings/' + m[1] + '?mode=json');
    return (data || []).map(function (j) {
      var c = j.categories || {};
      return {
        title: j.text,
        location: joinLoc_([c.location].concat(c.allLocations || []).concat([j.country])),
        url: j.hostedUrl
      };
    });
  },

  ashby: function (url) {
    var m = url.match(/job-board\/([^\/?#\s]+)/) || url.match(/ashbyhq\.com\/([^\/?#\s]+)/);
    if (!m) throw new Error('no ashby slug in url');
    var data = httpJson_('https://api.ashbyhq.com/posting-api/job-board/' + m[1]);
    return (data.jobs || []).map(function (j) {
      var secondary = (j.secondaryLocations || []).map(function (s) { return s.location; });
      var country = j.address && j.address.postalAddress && j.address.postalAddress.addressCountry;
      return {
        title: j.title,
        location: joinLoc_([j.location].concat(secondary).concat([country])),
        url: j.jobUrl
      };
    });
  },

  workable: function (url) {
    var m = url.match(/accounts\/([^\/?#\s]+)/) || url.match(/workable\.com\/([^\/?#\s]+)/);
    if (!m) throw new Error('no workable slug in url');
    var data = httpJson_('https://apply.workable.com/api/v1/widget/accounts/' + m[1]);
    return (data.jobs || []).map(function (j) {
      var locs = (j.locations || []).map(function (l) { return joinLoc_([l.city, l.country]); });
      return {
        title: j.title,
        location: joinLoc_([j.city, j.state, j.country].concat(locs)),
        url: j.url || j.shortlink || j.application_url
      };
    });
  },

  breezy: function (url) {
    var m = url.match(/https?:\/\/([^.\/]+)\.breezy\.hr/i);
    if (!m) throw new Error('no breezy slug in url');
    var data = httpJson_('https://' + m[1] + '.breezy.hr/json');
    return (data || []).map(function (j) {
      var l = j.location || {};
      return {
        title: j.name,
        location: joinLoc_([l.name, l.city, l.country && l.country.name]),
        url: j.url
      };
    });
  },

  workday: function (url) {
    // https://{tenant}.wd{n}.myworkdayjobs.com/[en-US/]{site}
    var m = url.match(/https?:\/\/(([^.\/]+)\.wd\d+\.myworkdayjobs\.com)\/(?:[a-z]{2}-[A-Z]{2}\/)?([^\/?#\s]+)/);
    if (!m) throw new Error('cannot parse workday url');
    var host = m[1], tenant = m[2], site = m[3];
    var api = 'https://' + host + '/wday/cxs/' + tenant + '/' + site + '/jobs';
    var jobs = [];
    for (var offset = 0; offset < CONFIG.WORKDAY_MAX; offset += 20) {
      var data = httpJson_(api, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({ appliedFacets: {}, limit: 20, offset: offset, searchText: 'Israel' })
      });
      var page = data.jobPostings || [];
      page.forEach(function (j) {
        jobs.push({
          title: j.title,
          location: j.locationsText || '',
          url: 'https://' + host + '/' + site + j.externalPath,
          // Results come from an "Israel" search; multi-location postings show
          // only "2 Locations", so keep them and let the agent confirm.
          assumeIsrael: !CONFIG.ISRAEL_PATTERN.test(j.locationsText || '') && /locations/i.test(j.locationsText || '')
        });
      });
      if (page.length < 20 || (data.total && offset + 20 >= data.total)) break;
    }
    return jobs;
  },

  amazon: function () {
    var jobs = [];
    for (var offset = 0; offset < CONFIG.AMAZON_MAX; offset += 100) {
      var data = httpJson_('https://www.amazon.jobs/en/search.json?normalized_country_code%5B%5D=ISR' +
        '&loc_query=Israel&result_limit=100&sort=recent&offset=' + offset);
      var page = data.jobs || [];
      page.forEach(function (j) {
        jobs.push({
          title: j.title,
          location: joinLoc_([j.normalized_location || j.location, j.country_code]),
          url: 'https://www.amazon.jobs' + j.job_path
        });
      });
      if (page.length < 100) break;
    }
    return jobs;
  }
};

/** Run once by hand after setup: fetches and logs which sources worked. */
function testFetch() {
  fetchAtsJobs();
  readTable_(CONFIG.SHEETS.COVERAGE).forEach(function (c) {
    Logger.log([c.company, c.source, c.status, c.total_postings, c.israel_postings, c.error].join(' | '));
  });
}
