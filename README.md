# Element Locator Recorder

Open a website in Chrome, use it normally, and get the **best locators** (Playwright + Selenium)
for every element you touched, plus a **step list for Jira**.

## Run it

```
pip install playwright
python run.py https://your-website.com
```

(If Chrome is not installed: `playwright install chromium`.)

Use the website as normal. A small box shows the best locator after each action.
When you are done, click the red **Stop recording** button (bottom-left of the page).

## What you get (in `recordings/<date_time>/`)

| File | What it is |
|---|---|
| `steps_for_jira.txt` | Numbered plain-text steps. Blocked/failed actions get a "Problem:" line |
| `locators.txt` | Best locator for each step: one Playwright line, one Selenium line |
| `test_playwright.py` | Runnable Playwright script of everything you did |

## Which file does what

```
element_recorder/
├── run.py                    START HERE. Reads the website address and starts everything
├── requirements.txt          Needs only: playwright
└── recorder_app/
    ├── session.py            Starts Chrome, waits for Stop, saves, closes Chrome
    ├── recorder.py           The "brain": receives actions, keeps the list of steps, notes failures
    ├── browser_script.js     JavaScript inside the website: watches actions, builds locators, Stop button
    ├── locator_code.py       Turns a locator into Playwright / Selenium code
    ├── step_text.py          Turns an action into a sentence ("Click the "Login" button")
    └── writers.py            Writes the 3 result files
```

## Flow in 5 lines

1. `run.py` -> `session.py` opens Chrome and injects `browser_script.js`.
2. You click/type. `browser_script.js` builds the locator options and sends the action to Python.
3. `recorder.py` stores it as a step (using `step_text.py` and `locator_code.py`).
4. `writers.py` rewrites the 3 files after every step.
5. You press Stop -> last typed text is saved -> Chrome closes.

## Want to change something?

| I want to... | Edit this file |
|---|---|
| Change how a step sentence reads | `step_text.py` |
| Change the order/kinds of locators | `browser_script.js` (section B, `REC.describe`) |
| Change what goes in locators.txt / Jira text | `writers.py` |
| Change the Playwright / Selenium code style | `locator_code.py` |
| Change the Stop button look | `browser_script.js` (`installStopButton`) |
