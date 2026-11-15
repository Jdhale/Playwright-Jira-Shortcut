"""
writers.py - writes the 3 result files from the list of recorded steps.

    steps_for_jira.txt   numbered plain-text steps (paste into Jira)
    locators.txt         the best locator for every step (short and simple)
    test_playwright.py   runnable Playwright script
"""

import pathlib

from .locator_code import indent_block, playwright_action, playwright_locator, selenium_display


def finished(steps):
    """Only steps that are completely filled in."""
    return [s for s in steps if s.get("ready")]


def render_jira(steps, url, started):
    """Plain numbered steps. A failed/blocked action gets a 'Problem:' line under it."""
    lines = ["Steps performed", "Website: %s" % url,
             "Recorded on: %s" % started.strftime("%Y-%m-%d %H:%M"), ""]
    for number, step in enumerate(finished(steps), 1):
        lines.append("%d. %s" % (number, step["text"]))
        for problem in step["failures"]:
            lines.append("   Problem: %s" % problem)
    return "\n".join(lines) + "\n"


def render_locators(steps):
    """Only what you need: the step, the Playwright locator and the Selenium locator."""
    out = ["BEST LOCATOR FOR EACH STEP", ""]
    for number, step in enumerate(finished(steps), 1):
        best = step.get("best")
        if not best:
            continue  # steps like "open website" have no element
        out.append("%d. %s" % (number, step["text"]))
        out.append("   Playwright : %s" % playwright_locator(step["frames"], best))
        selenium = selenium_display(step).split("\n")
        if len(selenium) == 1:
            out.append("   Selenium   : %s" % selenium[0])
        else:
            out.append("   Selenium   :")
            out.append(indent_block("\n".join(selenium), 15))
        if best["count"] != 1:
            out.append("   Warning    : matches %s elements, not exactly one" % best["count"])
        out.append("")
    return "\n".join(out)


def render_playwright(steps):
    """A runnable Playwright (Python) script that repeats all recorded steps."""
    lines = ["from playwright.sync_api import sync_playwright, expect", "", "",
             "def run():", "    with sync_playwright() as p:",
             '        browser = p.chromium.launch(channel="chrome", headless=False)',
             "        page = browser.new_page()",
             '        page.on("dialog", lambda dialog: dialog.accept())', ""]
    for number, step in enumerate(finished(steps), 1):
        lines.append("        # Step %d: %s" % (number, step["text"]))
        lines.append(indent_block(playwright_action(step), 8))
        for problem in step["failures"]:
            lines.append("        # NOTE: %s" % problem)
    lines += ["", "        page.wait_for_timeout(2000)", "        browser.close()", "", "",
              'if __name__ == "__main__":', "    run()", ""]
    return "\n".join(lines)


def save_all(out_dir, steps, url, started):
    """Write the three files (called after every step so nothing is lost)."""
    out_dir = pathlib.Path(out_dir)
    (out_dir / "steps_for_jira.txt").write_text(render_jira(steps, url, started), encoding="utf-8")
    (out_dir / "locators.txt").write_text(render_locators(steps), encoding="utf-8")
    (out_dir / "test_playwright.py").write_text(render_playwright(steps), encoding="utf-8")
