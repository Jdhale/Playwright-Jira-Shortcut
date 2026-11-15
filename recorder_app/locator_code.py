"""
locator_code.py - turns a chosen locator into ready-to-paste code.

A "candidate" is one locator option made by browser_script.js, a dict like:
    {"name": "ID", "css": "#email", "xpath": None, "pw": None, "count": 1, "why": "..."}
"frames" = list of iframes the element is inside (outermost first).
"shadow_hosts" = list of shadow DOM host selectors (outermost first).
"""

import json


def q(text):
    """Return `text` as a double-quoted literal that is valid Python code."""
    return json.dumps(text, ensure_ascii=False)


def indent_block(text, spaces):
    """Indent every line of `text` by `spaces` spaces."""
    pad = " " * spaces
    return "\n".join(pad + line if line else line for line in text.split("\n"))


def cand_shown(cand):
    """The selector text of a candidate (CSS if it has one, otherwise XPath)."""
    return cand["css"] or cand["xpath"]


def playwright_locator(frames, cand):
    """Playwright locator, e.g. page.frame_locator("#f").locator("#email").
    (Playwright CSS already sees inside open shadow DOM, so nothing extra is needed.)"""
    base = "page"
    for frame in frames:
        base += ".frame_locator(%s)" % q(frame["css"])
    if cand["pw"]:
        tail = cand["pw"]
    elif cand["css"]:
        tail = "locator(%s)" % q(cand["css"])
    else:
        tail = "locator(%s)" % q("xpath=" + cand["xpath"])
    return base + "." + tail


def selenium_code(frames, shadow_hosts, cand, assign=True):
    """Selenium (Python) lines: switch into iframes, open shadow roots, find the element.
    assign=False gives just the find_element(...) call when there is nothing else to show."""
    lines = []
    for frame in frames:
        lines.append("driver.switch_to.frame(driver.find_element(By.CSS_SELECTOR, %s))" % q(frame["css"]))

    if shadow_hosts and cand["css"]:
        lines.append("shadow = driver.find_element(By.CSS_SELECTOR, %s).shadow_root" % q(shadow_hosts[0]))
        for host in shadow_hosts[1:]:
            lines.append("shadow = shadow.find_element(By.CSS_SELECTOR, %s).shadow_root" % q(host))
        find = "shadow.find_element(By.CSS_SELECTOR, %s)" % q(cand["css"])
    elif cand["css"]:
        find = "driver.find_element(By.CSS_SELECTOR, %s)" % q(cand["css"])
    else:
        find = "driver.find_element(By.XPATH, %s)" % q(cand["xpath"])

    lines.append("element = " + find if (assign or lines) else find)
    if frames:
        lines.append("# when finished with the iframe: driver.switch_to.default_content()")
    return "\n".join(lines)


def selenium_display(step):
    """Selenium code for a step, short (one line) when no iframe/shadow DOM is involved."""
    complex_case = bool(step["frames"] or step["shadow_hosts"])
    return selenium_code(step["frames"], step["shadow_hosts"], step["best"], assign=complex_case)


def playwright_action(step):
    """The Playwright code line(s) that repeat one recorded step."""
    kind = step["kind"]
    loc = playwright_locator(step["frames"], step["best"]) if step.get("best") else None
    value = step.get("value") or ""

    if kind == "open":
        return "page.goto(%s)" % q(step["url"])
    if kind in ("navigate", "dialog") or loc is None:
        return "# (this happened by itself, nothing to do)"
    if kind == "click":
        return "%s.click()" % loc
    if kind == "fill":
        return "%s.fill(%s)" % (loc, q(value))
    if kind == "select":
        parts = value.split(", ")
        arg = q(parts[0]) if len(parts) == 1 else "[%s]" % ", ".join(q(p) for p in parts)
        return "%s.select_option(label=%s)" % (loc, arg)
    if kind == "check":
        return "%s.check()" % loc
    if kind == "uncheck":
        return "%s.uncheck()" % loc
    if kind == "press_enter":
        return '%s.press("Enter")' % loc
    if kind == "file":
        return "# TODO: put the real file path below\n%s.set_input_files(%s)" % (loc, q(value))
    if kind == "blocked":
        if step.get("reason_code") == "readonly":
            return "expect(%s).not_to_be_editable()" % loc
        return "expect(%s).to_be_disabled()" % loc
    return "# unsupported step"
