# Holiday map

A small browser applet for a non-technical Windows user. They open it from their desktop, pick a
day or a range on a calendar, and see the bank, school and major religious holidays on those
days in every country (or in the countries they've picked on a world map). It must run with
nothing installed: on Windows, only what ships with it (Edge). It must also run on Linux. The
data comes from free web services. The user will steer the details.

## Environment

- This directory is a git repository; commit your work as you go, with short clear messages.
- You can install packages into the project (for Python, a uv-managed `.venv`; for JS, local
  `node_modules`); network access is available. You can't install system packages or write
  outside this directory and /tmp: if you need a system package, ask the user.
- Tools you can use for development: Node 26, Python 3.14 with uv, and Chromium
  (`chromium --headless --no-sandbox`, at `/usr/bin/chromium`; for scripting, use
  `playwright-core` or `puppeteer-core` pointed at it, without downloading browsers). You can
  look at PNG screenshots with the read tool.
- What the user receives must need nothing installed: no Node, Python or server on their side.

## Working style

- Keep documentation light: a short README with setup and usage. No design docs, plans or
  changelogs unless the user asks for them.
- Write tests for the core logic, at a sensible level.
- Make reasonable decisions yourself; ask the user when a choice is really theirs.
- Do what the user asked, then report back. For a big request, it's fine to deliver a first
  working slice and check in rather than doing everything in one go.
