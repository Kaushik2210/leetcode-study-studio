# LeetCode Study Studio

Themes for LeetCode plus a learning layer: it changes how LeetCode looks, and it nudges you to practise in the ways
that make problems stick. Manifest V3, runs only on `leetcode.com`, nothing leaves your browser.

## Themes

| Theme | Look |
|---|---|
| **Midnight** | Calm, minimal dark |
| **Vintage Paper** | Cream sheets on a walnut desk, serif problem text, a cream header strip |
| **Arcade** | Retro pixel mood: hard shadows, monospace headings |
| **Studio** | Your own picture behind frosted panels, with a readability slider (35 to 95 %) |
| **Original** | LeetCode as shipped |

Dark themes force LeetCode's dark mode and recolour the code editor's syntax colours so code stays readable on
every theme, even when the page loaded in light mode. Switching theme applies to open LeetCode tabs immediately.

## Learning tools

- **Blind mode.** Difficulty and topic tags are blurred until you click them, so the label does not decide how hard
  you try. Click a blurred tag and it reveals; it does not follow the link.
- **Solution lock and hint ladder.** The Editorial and Solutions tabs stay closed until you have worked on the
  problem for N active minutes (5 to 40, default 15). Clicking them opens a three-rung ladder instead: say the
  problem back, commit to a pattern guess, peek at the topics. After the ladder you can unlock early with
  "I'm stuck", which is logged as a peek. Already-solved problems are never locked.
- **Spaced repetition.** When a submission is Accepted you rate how it went (Again / Hard / Good / Easy); each
  button shows the interval it will set. A small SM-2 variant schedules the review (1 to 180 days). The toolbar
  badge shows how many problems are due today, and the popup lists them with your key idea.
- **Mistake log.** After a failed submission, one tap records why (misread, edge case, wrong approach, off-by-one,
  too slow, syntax slip). The popup charts where your mistakes come from.
- **Notes and key idea.** A per-problem notebook and a one-line key idea, saved as you type.
- **Timer.** Counts only time you are actually working: the tab is visible and you have moved, typed or scrolled in
  the last two minutes. It feeds the solution lock.
- **Result moments.** A short themed banner on each verdict ("K.O.!" in Arcade, "Extra! Extra!" on Paper). Esc or a
  click dismisses it; it can be turned off, and it never animates if your system asks for reduced motion.
- **Progress.** Streak, solved today, total solved and time spent, plus an **Export my data** button (JSON).

## Install (unpacked)

1. Open `chrome://extensions` and turn on **Developer mode**.
2. **Load unpacked** and select this folder (`leetcode-study-studio`).
3. Open any problem on leetcode.com.

## How verdicts are detected

`hook.js` runs in the page's own JavaScript world and watches LeetCode's submission-result requests
(`/submissions/detail/<id>/check/`). It only listens: it never changes a request or response, and it copies out only
the verdict, runtime, memory and language. "Run code" results and unfinished (pending) results are ignored, and
each submission id counts once. If LeetCode changes that endpoint, the extension falls back to reading the verdict
from the page, but only within 90 seconds of pressing Submit, so opening an old submission is never counted.

## Permissions and privacy

- `storage`: your settings, per-problem history, notes and review schedule, kept in `chrome.storage.local`.
- `alarms`: refreshes the toolbar badge each hour.
- `https://leetcode.com/*`: where the content scripts run.
- No accounts, no analytics, no requests to any server of ours. Your background image is resized to at most 1920 px
  and stored locally; it is left out of the data export.

## Design

The popup and the in-page controls follow Apple's Human Interface Guidelines, translated for the web: system font
stack, semantic colours with light and dark support, 44 px minimum touch targets, visible focus rings, switches built
on real checkboxes, dialogs with labels and Esc to close, and `prefers-reduced-motion` and `forced-colors` support.

## Known limits

- Works on `leetcode.com` only (not `leetcode.cn`).
- LeetCode uses generated class names, so a redesign can break individual theme overrides. The data-driven parts
  (timer, reviews, mistake log) do not depend on them. `tests/leetcode_study_studio.py` checks the behaviour on a
  fixture page; see `tests/README.md`.
- Turning the extension off or choosing Original after a dark theme asks you to reload the page, because LeetCode's
  own colour mode was changed on the live page.
- Verdict detection and the Submissions tab were checked against LeetCode's markup and a simulated verdict; a real
  submission needs a signed-in account and was not run.

## Tests

```bash
node --test "tests/unit/*.test.js"      # scheduling logic, Node 20+, no packages
python tests/leetcode_study_studio.py   # needs Chrome and `pip install playwright`
```

The browser test loads a copy of the extension into a real Chrome, pointed at a local fixture page that copies the
parts of LeetCode's markup the extension relies on (29 checks). Pass `--extension DIR` to run it against a modified copy.
