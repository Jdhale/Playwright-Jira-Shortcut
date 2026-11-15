"""
step_text.py - turns one recorded action into a plain English sentence.

Example:  kind="fill", role="field", label="Email", value="a@b.com"
          ->  Type "a@b.com" in the "Email" field
"""


def short(text, limit=80):
    """Cut long text so logs stay readable."""
    text = " ".join(str(text).split())
    return text if len(text) <= limit else text[:limit] + "..."


def describe_step(kind, role, label, value, reason, action):
    """Return one human-readable sentence for the Jira step list."""
    target = 'the "%s" %s' % (label, role) if label else "an unnamed %s" % role
    value = short(value or "")

    if kind == "click":
        return "Click %s" % target
    if kind == "blocked":
        verb = "type in" if action == "type" else "click"
        return "Tried to %s %s - BLOCKED (%s)" % (verb, target, reason)
    if kind == "fill":
        return "Clear %s" % target if value == "" else 'Type "%s" in %s' % (value, target)
    if kind == "select":
        return 'Select "%s" from %s' % (value, target)
    if kind == "check":
        return "Select %s" % target if role == "radio button" else "Tick %s" % target
    if kind == "uncheck":
        return "Untick %s" % target
    if kind == "press_enter":
        return "Press Enter in %s" % target
    if kind == "file":
        return 'Upload the file "%s" using %s' % (value, target)
    return "%s on %s" % (kind, target)
