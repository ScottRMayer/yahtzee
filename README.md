# Yahtzee Scorecard

A scorecard for writing down Yahtzee scores that adds everything up for you —
subtotals, the 63-point upper bonus, extra-Yahtzee bonuses and the grand total.

No install, no build step, no accounts. It's a single web page.

## Using it

Open `index.html` in any browser — double-click the file, or drag it into a
browser window. That's it.

To use it on your phone at the table, publish it with GitHub Pages: in this
repo go to **Settings → Pages**, set the source to **Deploy from a branch**,
pick the branch and the `/ (root)` folder, and it will be served at
`https://scottrmayer.github.io/yahtzee/`. Add that to your home screen and it
behaves like an app.

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
| `test/scoring.test.js` | Tests for the scoring rules |

## Tests

```sh
npm test
```

Runs the scoring suite on Node's built-in test runner — no dependencies to
install. It covers the legal values for every box, the 63-point bonus boundary,
Yahtzee bonuses, and winner/tie detection.
