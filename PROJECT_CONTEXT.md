# PROJECT CONTEXT (handoff for other AI models)

Last updated: 2026-11-15
Status: VERSION 2 BUILT AND TESTED (headless). Waiting for the user to try real websites.

## 1. Goal (as stated by the user)
A tool that works like visiting a website and clicking elements. For each action it gives the
BEST LOCATORS (Selenium and Playwright) and logs the steps (what was clicked, which fields were filled).

## 2. Decisions made by the user
| Topic | Decision |
|---|---|
| Form factor | Lightest option: Python + Playwright, JavaScript injected into the page |
| Browsers | Chrome only for now (falls back to Playwright Chromium) |
| Output | NO raw HTML. Only best locators, explained in easy language |
| Step log | Simple human-readable numbered text for Jira + runnable Playwright script |
| Click behavior | Clicks go through; blocked/failed actions are noted in the log |
| Sensitive data | Password masking not required for now |
| Iframes / shadow DOM | Supported |
| Comments | Every function has a comment/docstring |

## 3. Changes in version 2 (user feedback)
1. Code was hard to follow in one file -> split into a project folder with a README map (see section 4).
2. locators.txt had too much info -> now only: step text, Playwright line, Selenium line
   (plus a warning only if the locator matches more than one element). Steps without an element are skipped.
3. Added a red "Stop recording" button (bottom-left, top page only, inside its own shadow root,
   never recorded). It flushes the last typed text, saves the files and closes Chrome.
   Closing Chrome or pressing Ctrl+C also works; files are saved after every step anyway.

## 4. Project layout (element_recorder/)
- run.py                      entry point: `python run.py <url>`
- requirements.txt            playwright
- README.md                   run instructions + "which file does what" table
- recorder_app/session.py     launches Chrome, injects JS, waits for stop, saves, closes
- recorder_app/recorder.py    Recorder class: on_event (from JS), Playwright page events, failure notes, terminal output
- recorder_app/browser_script.js  injected JS: watch actions, build locator candidates, shadow/iframe info, Stop button
- recorder_app/locator_code.py    candidate -> Playwright / Selenium code
- recorder_app/step_text.py       action -> sentence
- recorder_app/writers.py         writes steps_for_jira.txt, locators.txt, test_playwright.py
Output goes to recordings/<timestamp>/.

## 5. Locator ranking (best first, unique ones preferred)
Test ID > ID (if not auto-generated) > name > aria-label > visible text > placeholder > CSS path > XPath.
Playwright CSS pierces open shadow DOM; Selenium output uses .shadow_root chains and switch_to.frame.

## 6. Testing done
- py_compile + node --check OK.
- Headless Chromium on a local page (input, checkbox, select, test-id button, disabled button,
  iframe button, shadow DOM button): steps, blocked click, iframe/shadow locators, Stop button,
  last-typed-text flush all work; Stop button click is not recorded.
- NOT tested: real websites, headed Chrome on the user's machine, Windows console, cross-origin iframes,
  closed shadow DOM.

## 7. Known limitations
- Closed shadow DOM unreadable; iframes inside shadow DOM may need manual Selenium edits.
- Clicks blocked by an overlay are not detected (only disabled/aria-disabled/read-only).
- Contenteditable, drag and drop, hover menus, scrolling not recorded.
- The Stop button appears only in the top page, not inside iframes.

## 8. Next ideas
- Firefox / WebKit flag, Selenium script export, Jira wiki markup, overlay-blocked detection.
