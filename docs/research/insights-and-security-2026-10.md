# Insights and Security pages (October 2026)

What we looked at, what changed in 0.11.272, and the ideas still open.

## What others do

- **Safari Privacy Report.** It opens with one summary: trackers prevented, the share of sites that contacted trackers, and the most contacted tracker. Below that are two lists, **Websites** and **Trackers**, each sorted by count. A website opens to the trackers seen on it, and a tracker opens to the websites it was on. There are no charts. ([TechRepublic](https://techrepublic.com/article/how-to-view-website-trackers-in-mobile-safari), [MacSales](https://eshop.macsales.com/blog/67139-apple-safari-14-privacy-report/), [Plausible](https://ingest.plausible.io/blog/safari-privacy-report))
- **iOS App Privacy Report.** Its sections have short lists that end in "Show All". Each item opens to the domains it contacted, sorted by most recent or most frequent.
- **Chrome Safety Check.** It shows "Safety at a glance" rows with a green tick or a red mark, and a button to fix each problem. "Safety recommendations" follow below. It covers Safe Browsing, passwords, updates, extensions and permissions. ([PCWorld](https://www.pcworld.com/article/2786983/use-this-tucked-away-chrome-feature-to-surf-the-web-more-safely.html), [Chromium](https://chromium.googlesource.com/chromium/src/+/master/components/safety_check/), [Google Security Blog](https://security.googleblog.com/2024/06/staying-safe-with-chrome-extensions.html))
- **Security indicators research.** Badly placed indicators go unseen, and intrusive ones annoy people. So we show status calmly and use colour only when something needs a look.

## What changed in 0.11.272

| Problem | Change |
|---|---|
| An open company row was a wall of text, and its sites had no order | Each row shows the name, "On N of your M sites", the reach bar and the number blocked. When opened, it shows a one or two sentence description (with names put back where the database left them out), then the sites ordered by blocks. Each site opens on Sites. |
| The search box and "Show all" sat outside the card | Both are now inside the card. |
| "What they wanted" was hard to read | It's now "Why they tracked you". Each purpose gets its own bar and a plain sentence, and anything past the top four is folded into Other. |
| The heat map didn't help | It's replaced by seven day bars. The busiest day is picked first and says "1,704 blocked, most between 6 PM and 10 PM", plus the top sites that day, each of which opens on Sites. |
| Sites listed every address separately | Sites are grouped (docs.google.com and mail.google.com come under google.com). Each row shows ads, trackers and pop-ups in one line. An open site shows three number tiles, its tracker companies (each opens on Trackers), each address with its own switch, and Report. |
| Security was only a list | There's a new **Safety check**: Moat on, danger lists, list updates, leaked password warnings, paused sites, Never block, and a recent restore from a file. Each problem has a one-click fix. Pages stopped: dangerous ones first, each with what it was ("Phishing: fake sign-in pages"). A tip about changing your password is added when phishing or scams appear. Ad pages and your own blocks are folded away. |

## How people could misuse Moat, and what covers it

| Misuse | Cover |
|---|---|
| A "fix your blocker" settings file that turns protection off | The import preview names each weakening change (0.11.271). Restores can be undone for 14 days from Backup and from Safety check, and a risky one is marked as needing a look. |
| Someone with the computer, or a site's "disable your ad blocker" prompt, turns things off | Safety check lists Moat off, danger lists off, paused sites and Never block, each with a fix. |
| Getting a dangerous site unblocked | The danger lists outrank Never block and pausing. Opening a dangerous page needs Details, then Open anyway. "Not dangerous?" reports only reach a person. |
| Flooding the report inbox | The report worker has per-IP, per-site and overall rate limits, plus a daily cap and a 16 KB body limit. |
| Tampering with a backup file | A backup can't run code. Every field is checked twice, with unknown fields dropped and sizes capped, and nothing applies before you see the preview. |

## Ideas not built yet

1. **"Opened anyway" history.** Record when someone clicks through a danger page, and show it on Security with a "Report a scam" link.
2. **Password typed on a phishing page.** The leaked-password check could warn on a field that's on a phishing list. This needs care so Moat never reads passwords it doesn't need to.
3. **Weekly safety note.** A quiet badge on the toolbar icon when Safety check has something to look at, cleared once you open Security.
4. **Lock with the browser profile.** Optionally require a confirmation before turning Moat off or a danger list off, for shared family computers.
5. **Per-company actions.** A "Block everywhere" button on a company row that adds its domains to Always block.
