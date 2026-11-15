"""
session.py - starts Chrome, connects it to the Recorder, and waits until you press Stop.

Flow:
  open_session()   -> launch Chrome, inject browser_script.js, wire up the Recorder
  (you use the website; browser_script.js reports every action)
  stop             -> you click the red "Stop recording" button (or close Chrome / press Ctrl+C)
  finish_session() -> flush the last typed text, save the files, close Chrome
"""

import asyncio
import pathlib
from dataclasses import dataclass
from datetime import datetime

from playwright.async_api import async_playwright

from .recorder import Recorder

# The JavaScript file that is injected into every page.
SCRIPT_PATH = pathlib.Path(__file__).with_name("browser_script.js")


@dataclass
class Session:
    """Everything that belongs to one recording."""
    browser: object
    context: object
    page: object
    recorder: Recorder
    stop_event: asyncio.Event   # set when you click Stop or close the browser


async def launch_chrome(playwright, headless=False):
    """Start Google Chrome; fall back to Playwright's own Chromium if Chrome is not installed."""
    try:
        return await playwright.chromium.launch(channel="chrome", headless=headless)
    except Exception:
        print("Google Chrome not found - using Playwright's Chromium instead.")
        return await playwright.chromium.launch(headless=headless)


async def open_session(playwright, url, out_root, headless=False):
    """Launch the browser and connect it to a new Recorder."""
    out_dir = pathlib.Path(out_root) / datetime.now().strftime("%Y%m%d_%H%M%S")
    recorder = Recorder(url, out_dir)
    stop_event = asyncio.Event()

    browser = await launch_chrome(playwright, headless)
    browser.on("disconnected", lambda _: stop_event.set())   # you closed the Chrome window
    context = await browser.new_context(no_viewport=not headless)

    async def request_stop():
        """Called by the red Stop button inside the page."""
        stop_event.set()

    await context.expose_function("pyStop", request_stop)               # Stop button -> Python
    await context.expose_binding("pyEvent", recorder.on_event)          # every action -> Python
    await context.add_init_script(SCRIPT_PATH.read_text(encoding="utf-8"))  # inject the JavaScript
    context.on("page", recorder.attach_page)                            # watch every tab
    page = await context.new_page()
    return Session(browser, context, page, recorder, stop_event)


async def finish_session(session):
    """Save the last typed text and the files, then close Chrome."""
    try:
        for page in session.context.pages:
            for frame in page.frames:
                try:
                    await frame.evaluate("window.__rec && window.__rec.flushActive()")
                except Exception:
                    pass
        await asyncio.sleep(0.5)   # give the last events time to arrive
    except Exception:
        pass
    session.recorder.save_all()
    try:
        await session.browser.close()
    except Exception:
        pass


async def run(url, out_root):
    """Open the website, wait for Stop, save everything."""
    async with async_playwright() as playwright:
        session = await open_session(playwright, url, out_root)
        print("Recording started. Use the website normally.")
        print("When you are done, click the red 'Stop recording' button (bottom-left of the page).")
        try:
            await session.page.goto(url)
        except Exception as exc:
            print("Could not open %s: %s" % (url, exc))
        await session.stop_event.wait()
        await finish_session(session)
    print("\nRecording stopped. Files saved in: %s" % session.recorder.out_dir.resolve())
    print("  steps_for_jira.txt | locators.txt | test_playwright.py")
