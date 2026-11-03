# Sheet schema

Tab names are set in `apps-script/Config.gs` (`CONFIG.SHEETS`) and in the agent
prompt. Column names below are matched by header text, so keep them as is.

## `good_companies_with_careers.csv`: company list (edited by hand)

| Col | Header | Notes |
|---|---|---|
| A | company name | Required |
| B | career page | Optional. An ATS URL here is used if D has no fetchable source |
| C | not | Free-text note. "duplicate of …" makes the agent skip the row |
| D | ilan kaynağı (ATS) | Optional. `type: url`, several separated by ` | `. Text after the URL is ignored |

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

## `kisiler`: people (edited by hand)

| Header | Used by | Notes |
|---|---|---|
| isim | all | Must match `kimin için` in `ilanlar` |
| email | Mail.gs | Where that person's mail goes |
| aktif | all | `evet` / `hayır` |
| admin | Mail.gs | `evet` for the owner: gets the unreadable-company list and the sheet link |
| cv_kaynagi | agent | `drive klasör: <id>`, `drive dosya: <id>`, a Drive link, or `-` |
| profil | agent | Background in plain text |
| hedef_roller | agent | Roles and level that fit |
| haric_tutulanlar | agent | Roles to exclude |
| ozel_kurallar | agent | Any extra rule, e.g. how to fill `hangi CV` or a tag to add |
| not | — | Free text |

## `ilanlar`: matched postings (append-only, written by the agent)

`tarih | şirket | pozisyon | link | kimin için | lokasyon | hangi CV | neden uygun | link durumu`

`tarih` is `YYYY-MM-DD` text. Mail.gs sends the rows whose `tarih` is today.

## `tarama`: run log (append-only, written by the agent)

`tarih | okunamayan şirketler` — one row per run; `-` when every company was read.

## `ham_ilanlar`: raw postings (rewritten daily by Fetch.gs)

`tarih | şirket | pozisyon | lokasyon | link | kaynak`

## `ats_kapsam`: fetch coverage (rewritten daily by Fetch.gs)

`tarih | şirket | kaynak | url | durum (ok/hata) | toplam ilan | israil ilanı | hata`
