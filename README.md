# daily-job-scan

A daily job-posting scanner for a hand-picked list of companies in Israel. Every
afternoon it collects the companies' open roles, matches them against each
person's CV and target roles, and emails each person only the postings that are
new since the last run.

It runs on two pieces that each do what they are good at:

| Part | Runs on | Job | Deterministic? |
|---|---|---|---|
| `apps-script/Discover.gs` | Google Apps Script, weekly (Sunday) | Reads each careers page without a known source and records which ATS it uses (incl. the Comeet API token) in `detected_source` | Yes |
| `apps-script/Fetch.gs` | Google Apps Script, daily ~15:00 | Pulls open postings from public ATS APIs (Greenhouse, Lever, Ashby, Workable, Breezy, Workday, Amazon, Comeet) and keeps the Israel-based ones | Yes |
| `agent/daily-scan-prompt.md` | A scheduled Claude agent, daily 16:41 | Covers companies the APIs can't (Comeet boards, own careers pages, big-company job sites), verifies links, matches postings to each person, logs new matches | No: reads and judges |
| `apps-script/Mail.gs` | Google Apps Script, daily ~17:00 | Emails each person today's new matches; the admin also gets the list of companies that couldn't be read | Yes |

Everything meets in one Google Sheet, which is also the UI: add a company or a
person by adding a row.

```
                 ┌──────────────────────── Google Sheet ────────────────────────┐
 Fetch.gs ──────►│ raw_postings (Israel postings)   fetch_coverage (per source) │
 (ATS APIs)      │                                                              │
                 │ companies                        people                      │
 Claude agent ──►│ postings (matched, append-only)  scan_log (one row per run)  │
 (match + verify)│                                                              │
                 └──────────────────────────────┬───────────────────────────────┘
                                                ▼
                                   Mail.gs ──► one email per person
```

## Why split it this way

The first version had the agent browse every careers page itself. It worked,
but it was slow, used a lot of the plan's usage, and failed on days the usage
limit was hit. Most companies publish through an ATS with a public JSON API,
so fetching those is plain code: free, fast and repeatable. The agent now only
handles what needs judgement: reading pages that have no API, deciding whether
a posting fits a person, and checking that links are live.

## Setup

1. **Sheet.** Create the tabs described in [`docs/sheet-schema.md`](docs/sheet-schema.md).
   `raw_postings` and `fetch_coverage` are created by the script on its first run.
2. **Apps Script.** In the sheet: *Extensions → Apps Script*. Add the five
   `.gs` files from `apps-script/` and replace `appsscript.json` (enable
   "Show appsscript.json" in Project Settings), or push them with
   [clasp](#deploying-with-clasp). Then run `setup` once and approve the
   permissions. It creates the triggers (weekly discovery, daily fetch, daily
   mail) and removes old ones.
3. **Find sources and check the fetchers.** Run `testDiscover` once, then
   `testFetch`. The log lists every
   company + source with `ok` / `empty` / `error` and how many postings it
   found. Fix or remove sources that error or come back empty (usually a wrong
   board slug). Rate limits (HTTP 429) and server errors are retried.
4. **Agent.** Create a scheduled Claude task that runs daily after the fetch
   and before the mail, with the Google Sheets and Google Drive connectors.
   Use [`agent/daily-scan-prompt.md`](agent/daily-scan-prompt.md) as its
   prompt, replacing `{{SPREADSHEET_ID}}` and `{{TIMEZONE}}`.

## Adding things

- **A company:** add a row to `companies`. A name is enough; the agent finds
  the careers page. If you know the ATS, put it in `job_source` as `type: url`,
  e.g. `greenhouse: https://boards-api.greenhouse.io/v1/boards/acme/jobs`.
  Fetchable types: `greenhouse lever ashby workable breezy workday amazon`.
  Several sources: separate with ` | `.
- **A person:** add a row to `people` with `active = yes`. Profile, target
  roles, exclusions and any special rules are plain text the agent follows.
  `cv_source` can point at a Drive folder or file.

## Tests

The Apps Script code runs offline against mocked Google services and fixtures
shaped like each ATS API's documented response:

```
node tests/run.js
```

## Deploying with clasp

```
npm i -g @google/clasp
clasp login
cp .clasp.json.example .clasp.json   # put the script ID from Project Settings
clasp push
```

`.clasp.json` and `.clasprc.json` are git-ignored.

## Privacy

No personal data lives in this repo. Names, emails, CV locations and profiles
are rows in the sheet; the sheet ID goes only into the scheduled task.

## Limits

- Comeet's API needs a per-company token. Discover.gs reads it from the
  careers page; when it can't, the agent reads the careers page itself.
- Pages that only render in a browser and companies that post only on
  LinkedIn or Hebrew job boards can't be read; they show up in the admin's
  "couldn't read" list for a manual look.
- Matching quality depends on the agent and the profile text in `people`.
- Email text is in `CONFIG.MAIL_TEXT` in `Config.gs`; change it there to
  send mail in another language.
