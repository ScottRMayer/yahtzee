# Yahtzee Scorecard

A scorecard for writing down Yahtzee scores that adds everything up for you —
subtotals, the 63-point upper bonus, extra-Yahtzee bonuses and the grand total.

No install, no build step, no accounts. It's a single web page.

## Using it

**On this computer:** open `index.html` in any browser — double-click it, or
drag it into a browser window. No server needed.

**Anywhere, as one file:** `dist/yahtzee.html` is the whole app — markup,
styles and scripts inlined into a single self-contained page. Save it to a
phone, a USB stick or an email to yourself and open it. It works offline and
has no other files to keep track of.

**On your phone, as a website:** GitHub Pages serves this repo as-is — there
is no build step to configure. Pushing code does *not* publish a site on its
own; Pages has to be switched on once:

1. Go to **Settings → Pages** in this repository.
2. Under *Build and deployment* → *Source*, choose **Deploy from a branch**.
3. Pick the branch holding this code and the **`/ (root)`** folder. Save.
4. Give it a minute, then open `https://scottrmayer.github.io/yahtzee/`.

Add that page to your home screen and it behaves like an app.

> Opening a `raw.githubusercontent.com` link instead will show the source code
> rather than the app — GitHub serves raw files as plain text.

## How it works

- **Tap any box** to score it. You only get the values that box can legally
  hold, so a 7 can never end up in Fours and a Full House is always 25 or 0.
  - Upper section boxes are picked by how many dice show that face —
    three 5s is one tap on "15 · 3 dice".
  - Full House, the straights and Yahtzee offer their score or a scratch.
  - Three/Four of a Kind and Chance offer every possible dice total, 5–30.
- **Scratching a box** is scoring it 0 — tap the "0 · Scratch" option. The box
  then counts as played, which is what drives the "boxes filled" count and the
  end-of-game winner.
- **Totals update as you go.** The Bonus row counts down how many upper-section
  points you still need for the 35-point bonus ("14 to go"), then turns green
  when you've earned it.
- **Extra Yahtzees** use the +/− stepper on the Yahtzee bonus row, 100 points
  each.
- **Changed your mind?** Tap a filled box again to pick a different value, or
  use *Clear box* to empty it.
- **Players**: up to 8. Tap a name to rename it, `×` to remove someone,
  *+ Player* to add. *New game* clears the scores but keeps the names.

The game is saved in the browser's local storage on that device, so closing the
tab or reloading mid-game doesn't lose anything. It isn't synced anywhere — a
game started on your phone stays on your phone.

## Scoring rules used

Standard Yahtzee scoring:

| Box | Scores |
| --- | --- |
| Aces – Sixes | Sum of dice showing that face |
| Upper bonus | 35, if the upper section reaches 63 |
| Three / Four of a Kind | Sum of all five dice |
| Full House | 25 |
| Small Straight (4 in a row) | 30 |
| Large Straight (5 in a row) | 40 |
| Yahtzee | 50 |
| Chance | Sum of all five dice |
| Each extra Yahtzee | 100 |

The app records scores; it doesn't police whether your dice actually made the
hand. Joker rules for extra Yahtzees are up to your table — score the upper or
lower box you use as normal, and add the 100-point bonus with the stepper.

## Layout

| File | What's in it |
| --- | --- |
| `index.html` | Page structure |
| `styles.css` | Styling, light and dark |
| `scoring.js` | The rules: legal values per box, all totals. No DOM. |
| `app.js` | Rendering, score entry, saving |
| `build.js` | Bundles the above into `dist/` |
| `test/scoring.test.js` | Tests for the scoring rules |

Edit the four source files; `dist/` is generated, never hand-edited.

## Tests

```sh
npm test
```

Runs the scoring suite on Node's built-in test runner — no dependencies to
install. It covers the legal values for every box, the 63-point bonus boundary,
Yahtzee bonuses, and winner/tie detection.

## Build

```sh
npm run build
```

Regenerates `dist/` from the sources, so the bundles can't drift from the app:

| Output | For |
| --- | --- |
| `dist/yahtzee.html` | One standalone file — open it anywhere, offline |
| `dist/artifact-page.html` | A fragment for a host that supplies the document shell and stamps `data-theme` on the root element |

The fragment's stylesheet is rewritten so the dark palette answers both the
viewer's system setting and an explicit `data-theme`. That rewrite is the
delicate part, and the build refuses to emit a bundle that would get it wrong:
each dark block is re-scoped **in place** and wrapped in `:where()` so neither
source order nor specificity shifts — hoisting those rules or raising their
specificity silently changes which declaration wins, which is how the quiet
buttons once ended up invisible on a dark background. The build also fails if a
colour would exist only in dark mode, if `body` loses its token background, or
if a `prefers-color-scheme` query is written in a form the rewrite can't
translate.
