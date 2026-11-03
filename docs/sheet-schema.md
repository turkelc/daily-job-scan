# Sheet schema

Tab names are set in `apps-script/Config.gs` (`CONFIG.SHEETS`) and in the agent
prompt. Columns are matched by header text, so keep the headers as below.

## `companies` (edited by hand)

| Header | Notes |
|---|---|
| company | Required |
| careers_page | Optional. An ATS URL here is used if job_source has no fetchable source |
| note | Free text. A note saying "duplicate" makes the agent skip the row |
| job_source | Optional. `type: url`, several separated by ` | `. Text after the URL is ignored |

Fetchable `type`s and the URL they expect:

| type | Example |
|---|---|
| greenhouse | `https://boards-api.greenhouse.io/v1/boards/<slug>/jobs` (EU boards: `boards-api.eu.greenhouse.io`; the other host is tried automatically) |
| lever | `https://api.lever.co/v0/postings/<slug>` or `api.eu.lever.co` |
| ashby | `https://api.ashbyhq.com/posting-api/job-board/<slug>` |
| workable | `https://apply.workable.com/<slug>/` |
| breezy | `https://<slug>.breezy.hr/` |
| workday | `https://<tenant>.wd<N>.myworkdayjobs.com/<site>` (searched for "Israel") |
| amazon | `https://www.amazon.jobs/en/search.json?loc_query=Israel` |

Any other label (e.g. `comeet: …`) is left to the agent.

## `people` (edited by hand)

| Header | Used by | Notes |
|---|---|---|
| name | all | Must match `person` in `postings` |
| email | Mail.gs | Where that person's mail goes |
| active | all | `yes` / `no` |
| admin | Mail.gs | `yes` for the owner: gets the unreadable-company list and the sheet link |
| cv_source | agent | `drive folder: <id>`, `drive file: <id>`, a Drive link, or `-` |
| profile | agent | Background in plain text |
| target_roles | agent | Roles and level that fit |
| exclusions | agent | Roles to leave out |
| special_rules | agent | Any extra rule, e.g. how to fill `cv` or a tag to add to `reason` |
| notes | — | Free text |

## `postings` (append-only, written by the agent)

`date | company | title | link | person | location | cv | reason | link_status`

`date` is `YYYY-MM-DD` text. Mail.gs sends the rows whose `date` is today.
`link_status` is `open` when written; older rows may say `closed (…)` or `unverified (…)` after a manual link check.

## `scan_log` (append-only, written by the agent)

`date | unreadable_companies` — one row per run; `-` when every company was read.

## `raw_postings` (rewritten daily by Fetch.gs)

`date | company | title | location | link | source`

## `fetch_coverage` (rewritten daily by Fetch.gs)

`date | company | source | url | status | total_postings | israel_postings | error`

`status` is `ok` or `error`.
