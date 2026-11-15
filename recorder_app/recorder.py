"""
recorder.py - the "brain". Receives what the browser reports and keeps the list of steps.

How it works (in order):
  1. browser_script.js sees you click/type and calls  Recorder.on_event(...)
  2. on_event adds a step to self.steps (text + best locator + iframe info)
  3. Playwright events (page changed, request failed, popup...) add notes or steps too
  4. After every step, writers.save_all() rewrites the 3 result files

A step is a plain dict, for example:
  {"kind": "click", "text": 'Click the "Login" button', "best": <locator>, "frames": [...],
   "shadow_hosts": [...], "failures": [], "ready": True}
"""

import asyncio
import pathlib
import time
from datetime import datetime
from urllib.parse import urlparse

from . import writers
from .locator_code import cand_shown, indent_block, playwright_locator, selenium_display
from .step_text import describe_step, short

# Step kinds that are real user actions (problem notes can be attached to these).
ACTION_KINDS = ("click", "fill", "select", "check", "uncheck", "press_enter", "file", "blocked")


def short_url(url):
    """Only the path of a URL (e.g. /api/login) so messages stay short."""
    return short(urlparse(url).path or "/", 60)


async def get_frame_chain(frame):
    """Return the iframes (outermost first) that contain `frame`, each with a CSS selector."""
    chain = []
    current = frame
    while current is not None and current.parent_frame is not None:
        css = None
        try:
            handle = await current.frame_element()
            css = await handle.evaluate("el => (window.__rec ? window.__rec.cssFor(el) : null)")
        except Exception:
            css = None
        if not css:
            css = 'iframe[name="%s"]' % current.name if current.name else "iframe"
        chain.insert(0, {"css": css, "name": current.name, "url": current.url})
        current = current.parent_frame
    return chain


class Recorder:
    """Collects the recorded steps and saves the result files."""

    def __init__(self, start_url, out_dir):
        """Remember the start URL and create the folder for the result files."""
        self.start_url = start_url
        self.out_dir = pathlib.Path(out_dir)
        self.out_dir.mkdir(parents=True, exist_ok=True)
        self.steps = []
        self.started = datetime.now()

    # ------------------------------------------------------------------
    # Small helpers
    # ------------------------------------------------------------------
    def save_all(self):
        """Rewrite steps_for_jira.txt, locators.txt and test_playwright.py."""
        writers.save_all(self.out_dir, self.steps, self.start_url, self.started)

    def number_of(self, step):
        """1-based number of a step among the finished steps."""
        return writers.finished(self.steps).index(step) + 1

    def last_action_step(self):
        """The most recent real user action (problem notes are attached to it)."""
        for step in reversed(self.steps):
            if step["kind"] in ACTION_KINDS:
                return step
        return None

    def note_failure(self, text):
        """Attach 'something failed' to the action done in the last 5 seconds."""
        step = self.last_action_step()
        if step and time.time() - step["ts"] < 5 and text not in step["failures"]:
            step["failures"].append(text)
            self.save_all()
            print("    !! Problem after that step: %s" % text)

    # ------------------------------------------------------------------
    # 1. Events from the browser (your clicks, typing, ...)
    # ------------------------------------------------------------------
    async def on_event(self, source, payload):
        """Called by browser_script.js for every action. The step's place in the list is
        reserved immediately, so the order always matches what you did."""
        step = {"kind": payload["kind"], "ts": time.time(), "ready": False, "failures": []}
        self.steps.append(step)
        try:
            frames = await get_frame_chain(source["frame"])
            candidates = payload.get("candidates") or []
            step.update({
                "role": payload["role"], "label": payload["label"], "value": payload.get("value"),
                "frames": frames, "shadow_hosts": payload.get("shadowHosts") or [],
                "best": candidates[0] if candidates else None, "candidates": candidates,
                "reason": payload.get("reason"), "reason_code": payload.get("reasonCode"),
            })
            step["text"] = describe_step(step["kind"], step["role"], step["label"], step["value"],
                                         step["reason"], payload.get("action"))
            step["ready"] = True
            self.save_all()
            self.print_step(step)
            toast = "Step %d: %s" % (self.number_of(step), step["text"])
            if step["best"]:
                toast += "\nBest locator (%s): %s" % (step["best"]["name"], cand_shown(step["best"]))
            return {"toast": toast}  # shown in the small box on the page
        except Exception as exc:  # a recording problem must never break the website
            print("   (could not record this action: %s)" % exc)
            return None

    # ------------------------------------------------------------------
    # 2. Events from Playwright (page changes, failures, popups)
    # ------------------------------------------------------------------
    def attach_page(self, page):
        """Start watching one browser tab."""
        page.on("framenavigated", self.on_navigated)
        page.on("requestfailed", self.on_request_failed)
        page.on("response", self.on_response)
        page.on("pageerror", lambda exc: self.note_failure("page error: %s" % short(exc, 120)))
        page.on("dialog", lambda dialog: asyncio.ensure_future(self.on_dialog(dialog)))

    def add_simple_step(self, kind, text, **extra):
        """Add a step that has no element (open website, page changed, popup)."""
        step = {"kind": kind, "text": text, "ts": time.time(), "ready": True,
                "failures": [], "frames": [], "shadow_hosts": [], "best": None}
        step.update(extra)
        self.steps.append(step)
        self.save_all()
        print("\n[%d] %s" % (len(writers.finished(self.steps)), text))

    def on_navigated(self, frame):
        """The page address changed: add 'Open the website' (first time) or 'The page changed to'."""
        if frame.parent_frame is not None or frame.url in ("", "about:blank"):
            return
        last = self.steps[-1] if self.steps else None
        if last and last["kind"] in ("open", "navigate") and last.get("url") == frame.url:
            return
        if self.steps:
            self.add_simple_step("navigate", "The page changed to: " + frame.url, url=frame.url)
        else:
            self.add_simple_step("open", "Open the website: " + frame.url, url=frame.url)

    def on_request_failed(self, request):
        """A network request failed (images, fonts and cancelled requests are ignored)."""
        failure = request.failure or ""
        if request.resource_type in ("document", "xhr", "fetch") and "ERR_ABORTED" not in failure:
            self.note_failure("request %s %s failed (%s)" % (request.method, short_url(request.url), failure))

    def on_response(self, response):
        """The server answered with an error code (400 or higher)."""
        request = response.request
        if response.status >= 400 and request.resource_type in ("document", "xhr", "fetch"):
            self.note_failure("%s %s returned %d" % (request.method, short_url(request.url), response.status))

    async def on_dialog(self, dialog):
        """Playwright would silently dismiss alert/confirm popups, so accept them and log it."""
        self.add_simple_step("dialog", 'A popup appeared: "%s" (accepted automatically)' % short(dialog.message, 100))
        await dialog.accept()

    # ------------------------------------------------------------------
    # 3. Terminal output
    # ------------------------------------------------------------------
    def print_step(self, step):
        """Show one step in the terminal with its best locator."""
        print("\n[%d] %s" % (self.number_of(step), step["text"]))
        best = step["best"]
        if not best:
            return
        print("    Best locator : %s  ->  %s" % (best["name"], cand_shown(best)))
        print("    Why          : %s" % best["why"])
        if best["count"] != 1:
            print("    Warning      : this matches %s elements, not exactly one" % best["count"])
        print("    Playwright   : %s" % playwright_locator(step["frames"], best))
        selenium = selenium_display(step).split("\n")
        if len(selenium) == 1:
            print("    Selenium     : %s" % selenium[0])
        else:
            print("    Selenium     :")
            print(indent_block("\n".join(selenium), 18))
        backups = ["%s -> %s" % (c["name"], cand_shown(c)) for c in step["candidates"][1:3]]
        if backups:
            print("    Backups      : " + " | ".join(backups))
