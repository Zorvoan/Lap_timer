# Lap Timer design contract

The approved direction for the simplified app. Mockups: [docs/design/mockup-v2.png](docs/design/mockup-v2.png)
(approved layout) and [docs/design/mockup-v3.png](docs/design/mockup-v3.png) (the same layout refined
with the `anti-ui-slop` skill in `.claude/skills/`, plus the states every screen must handle). The
HTML next to each PNG is the source of the mockup.

## Purpose

An operational tool for drivers who are not technical: pick a track, drive it, see the time and where
it ranks. Every screen has one obvious next action. Nothing needs configuring before the first lap.

## Structure

- Bottom bar with three destinations: **Roads**, **Drive** (a red button in the bar, not a floating
  circle) and **Me**. The active tab is marked with a red bar at the top of the item.
- **Sign in first**: everyone signs in (or creates an account with nickname and car) before the
  app opens; an account without a nickname and car is asked for them. A run already being timed is
  never interrupted by this.
- **Roads** (the tracks list): one plain list (dividers, no card per track). Each row: name, length, your best time and
  rank, or the track record when you have no time. A List / Map switch shows the same tracks on a
  map. Near a start line, that track is offered at the top with its Drive button.
- **Track**: one page per track (replaces the circuit card, circuit detail and leaderboard pages):
  map, a large Drive button, then Leaderboard / My laps. Tapping a driver compares their lap with yours.
- **Before driving**: no choices. The track comes from where you are (with a Change link), the lap to
  beat is your best one, and a single GPS status line gates Start until accuracy is good enough.
- **Driving**: the gap to your best lap ("vs best") is the largest element, then the lap time, three
  sections and speed. Stop at the bottom. Nothing else.
- **Finish**: shown automatically at the finish line. Result, improvement, leaderboard rank, sections,
  then Drive again and "Where did I gain/lose time?".
- **Me**: account, past drives, Settings, Install on home screen, How it works. The simulator and
  technical options live under Settings, Advanced.

## Visual language

- Existing tokens (`apps/web/src/index.css`): dark background, panels, hairline borders, red accent.
- Red is for the primary action and the active tab only. Green = faster (minus sign), red = slower
  (plus sign), purple = best section. Meaning never relies on colour alone.
- Times and gaps in the monospace face with tabular numerals.
- Line icons (map, stopwatch, person, chevrons, play/stop) in one stroke style. No emoji.
- Spacing and dividers group things before borders or boxes do. No gradients, no nested panels.
- English UI, plain words: "vs best", "Best possible time", "Part 1-3", "Finding GPS".

## Motion

Follows `.claude/skills/ui-animation`; tokens and classes live at the end of `index.css`.
- Only `transform` and `opacity` move; colours fade (`.tint`). No `transition: all`.
- Feedback: buttons and tabs press to 0.97 instantly (`.press`); switches slide their highlight.
- Orientation: pages rise 6 px and fade in 220 ms; sheets slide up from the bottom and slide back.
- Numbers that arrive on their own (parts, rank) land with a short blur-in; the running clock and
  gap never animate.
- Delight is spent on rare moments only: the sign-in screen and the time card (card rises, digits
  land, stamp slams on).
- Reduced motion: nothing travels or scales, things only fade.

## States each screen must handle

First visit and signed out (the sign-in screen), finding GPS
(Start locked, says why and how long it usually takes), slower than best, GPS lost while driving
(timing continues, the driver is told to carry on), no laps on a track yet, finish without a
connection (saved on the phone, uploads later), plus loading and error for every network list.

## Done when

Each screen and state above is built with real data, works at 390 px wide and on desktop, and has
been rendered and compared with the mockups.
