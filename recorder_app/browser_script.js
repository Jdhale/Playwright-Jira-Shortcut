/*
 * browser_script.js
 * =================
 * This JavaScript is injected into EVERY page and EVERY iframe by session.py.
 * It runs inside the website and does 4 things:
 *
 *   1. WATCH      - listens for your clicks, typing, dropdowns, checkboxes, uploads, Enter key.
 *   2. FIND       - builds the best locators for the element you used (builds the list of candidates).
 *   3. REPORT     - sends one "event" per action to Python through window.pyEvent().
 *   4. STOP BUTTON - a small "Stop recording" button (bottom-left) that tells Python to finish.
 *
 * The file is organised in sections, top to bottom:
 *   A. Small helper functions
 *   B. Locator building (the "FIND" part)
 *   C. Sending events to Python
 *   D. On-page visuals (hover outline, info box, Stop button)
 *   E. Event listeners (the "WATCH" part)
 */
(() => {
  // Make sure we only install once per page/frame.
  if (window.__recInstalled) return;
  window.__recInstalled = true;

  const REC = {};
  window.__rec = REC;   // Python calls REC.cssFor() and REC.flushActive() later

  // ======================================================================
  // A. SMALL HELPER FUNCTIONS
  // ======================================================================

  // Attributes that developers add just for automated testing (best locators).
  const TESTID_ATTRS = ['data-testid', 'data-test-id', 'data-test', 'data-qa', 'data-cy'];
  // Elements a person would normally "click on".
  const INTERACTIVE = 'button, a, input, select, textarea, label, summary, option, ' +
    '[role="button"], [role="link"], [role="tab"], [role="menuitem"], ' +
    '[role="checkbox"], [role="radio"], [role="option"], [onclick]';
  // Input types that behave like buttons (they are clicked, not typed into).
  const BUTTON_TYPES = ['button', 'submit', 'reset', 'image'];
  // Input types that are NOT plain text boxes.
  const NON_TEXT_TYPES = ['checkbox', 'radio', 'file', 'button', 'submit', 'reset', 'image', 'range', 'color'];
  // Id of our own Stop button, so we never record clicks on it.
  const UI_ID = '__rec_ui';

  // Returns true if a value looks auto-generated (random ids, long numbers), which breaks often.
  function looksDynamic(s) {
    return !s || /\d{4,}/.test(s) || /[0-9a-f]{10,}/i.test(s) || /:/.test(s) ||
      /^(ember|react|ng-|mui-|rc_|radix)/i.test(s);
  }

  // Wraps a value in single quotes for use inside a CSS attribute selector.
  function attrVal(v) {
    return "'" + String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
  }

  // Quotes text for XPath (returns null if the text has both quote types).
  function xpathStr(s) {
    if (s.indexOf("'") === -1) return "'" + s + "'";
    if (s.indexOf('"') === -1) return '"' + s + '"';
    return null;
  }

  // The "root" an element lives in: the document or a shadow root.
  function rootOf(el) { return el.getRootNode(); }

  // True when the root is a shadow root.
  function isShadow(root) { return typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot; }

  // How many elements a CSS selector matches inside a root (-1 on error).
  function cssCount(root, css) {
    try { return root.querySelectorAll(css).length; } catch (e) { return -1; }
  }

  // How many elements an XPath matches in this document (-1 on error).
  function xpathCount(xp) {
    try {
      return document.evaluate(xp, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null).snapshotLength;
    } catch (e) { return -1; }
  }

  // Visible text of an element with extra spaces removed.
  function ownText(el) {
    return (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  // Shortens long text so logs stay readable.
  function clip(s, n) {
    s = s || '';
    return s.length > n ? s.slice(0, n) + '...' : s;
  }

  // Walks up from an element (also out of shadow roots) to find the nearest match.
  function closestComposed(el, selector) {
    while (el) {
      if (el.matches && el.matches(selector)) return el;
      const parent = el.parentElement;
      if (parent) { el = parent; continue; }
      const root = el.getRootNode();
      el = isShadow(root) ? root.host : null;
    }
    return null;
  }

  // True if the element is part of our own Stop button (we must ignore those).
  function isOwnUi(el) { return !!closestComposed(el, '#' + UI_ID); }

  // The real element that was acted on, even when it is inside an (open) shadow DOM.
  function realTarget(e) {
    const path = e.composedPath ? e.composedPath() : [];
    return (path[0] && path[0].nodeType === 1) ? path[0] : e.target;
  }

  // Turns e.g. a <span> inside a <button> into the <button> itself.
  function interactiveOf(el) { return closestComposed(el, INTERACTIVE) || el; }

  // Finds the element under the mouse pointer, looking inside shadow roots too.
  function deepFromPoint(x, y) {
    let el = document.elementFromPoint(x, y);
    while (el && el.shadowRoot) {
      const inner = el.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === el) break;
      el = inner;
    }
    return el;
  }

  // The element that currently has keyboard focus (looking inside shadow roots).
  function deepActive() {
    let a = document.activeElement;
    while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
    return a;
  }

  // Plain-English word for what kind of element this is (button, field, ...).
  function roleWord(el) {
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    const role = (el.getAttribute('role') || '').toLowerCase();
    if (tag === 'button' || role === 'button' || (tag === 'input' && BUTTON_TYPES.indexOf(type) !== -1)) return 'button';
    if (tag === 'a' || role === 'link') return 'link';
    if (tag === 'select') return 'dropdown';
    if (tag === 'input' && type === 'checkbox') return 'checkbox';
    if (tag === 'input' && type === 'radio') return 'radio button';
    if (tag === 'input' && type === 'file') return 'file field';
    if (tag === 'input' || tag === 'textarea') return 'field';
    if (tag === 'summary') return 'section header';
    if (role === 'tab') return 'tab';
    if (role === 'menuitem') return 'menu item';
    return 'element';
  }

  // Best human-friendly name for an element (label, button text, placeholder, ...).
  function labelFor(el) {
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    let t = el.getAttribute('aria-label');
    if (!t) {
      const lb = el.getAttribute('aria-labelledby');
      const root = rootOf(el);
      const n = lb && root.getElementById ? root.getElementById(lb.split(' ')[0]) : null;
      if (n) t = ownText(n);
    }
    if (!t && el.labels && el.labels.length) t = ownText(el.labels[0]);
    if (!t && tag === 'input' && BUTTON_TYPES.indexOf(type) !== -1) t = el.value || el.getAttribute('alt');
    if (!t && ['button', 'a', 'summary', 'option', 'label', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].indexOf(tag) !== -1) t = ownText(el);
    if (!t && el.getAttribute('role')) t = ownText(el);
    if (!t) t = el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('alt');
    if (!t) {
      const img = el.querySelector ? el.querySelector('img[alt]') : null;
      if (img) t = img.getAttribute('alt');
    }
    if (!t) t = el.getAttribute('name') || (looksDynamic(el.id) ? '' : el.id);
    return clip((t || '').replace(/\s+/g, ' ').trim(), 50);
  }

  // Short visible text usable as a locator (only for buttons, links, labels, headings...).
  function textForLocator(el) {
    const tag = el.tagName.toLowerCase();
    const role = (el.getAttribute('role') || '').toLowerCase();
    const ok = ['button', 'a', 'label', 'summary', 'option', 'th', 'legend', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].indexOf(tag) !== -1 ||
      ['button', 'link', 'tab', 'menuitem'].indexOf(role) !== -1;
    if (!ok) return '';
    const t = ownText(el);
    return (t && t.length <= 40) ? t : '';
  }

  // ======================================================================
  // B. LOCATOR BUILDING  ("FIND")
  // ======================================================================

  // Classes that are safe to use in a selector (not random, not state-like such as "active").
  function stableClasses(el) {
    return Array.prototype.slice.call(el.classList).filter(function (c) {
      return !looksDynamic(c) && !/^(active|open|show|hover|focus|selected|disabled|is-|has-)/i.test(c);
    }).slice(0, 2);
  }

  // Builds the shortest CSS path (tag.class:nth-of-type chain) that matches only this element.
  function cssPath(el) {
    const root = rootOf(el);
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && cur !== document.documentElement) {
      let seg = cur.tagName.toLowerCase();
      if (cur.id && !looksDynamic(cur.id)) {
        seg = '#' + CSS.escape(cur.id);
      } else {
        const cls = stableClasses(cur);
        if (cls.length) seg += '.' + cls.map(function (c) { return CSS.escape(c); }).join('.');
        const parent = cur.parentElement;
        if (parent) {
          const same = Array.prototype.filter.call(parent.children, function (c) { return c.tagName === cur.tagName; });
          if (same.length > 1) seg += ':nth-of-type(' + (same.indexOf(cur) + 1) + ')';
        }
      }
      parts.unshift(seg);
      const css = parts.join(' > ');
      if (cssCount(root, css) === 1) return css;
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  }

  // Builds an XPath for the element (starts from the nearest stable id when there is one).
  function xpathPath(el) {
    const segs = [];
    let cur = el;
    while (cur && cur.nodeType === 1) {
      if (cur.id && !looksDynamic(cur.id) && xpathStr(cur.id)) {
        return '//*[@id=' + xpathStr(cur.id) + ']' + (segs.length ? '/' + segs.join('/') : '');
      }
      let seg = cur.tagName.toLowerCase();
      const parent = cur.parentElement;
      if (parent) {
        const same = Array.prototype.filter.call(parent.children, function (c) { return c.tagName === cur.tagName; });
        if (same.length > 1) seg += '[' + (same.indexOf(cur) + 1) + ']';
      }
      segs.unshift(seg);
      cur = parent;
    }
    return '/' + segs.join('/');
  }

  // Best single CSS selector for an element (Python also uses this for iframes and shadow hosts).
  function bestCss(el) {
    const root = rootOf(el);
    for (let i = 0; i < TESTID_ATTRS.length; i++) {
      const v = el.getAttribute(TESTID_ATTRS[i]);
      if (v) {
        const c = '[' + TESTID_ATTRS[i] + '=' + attrVal(v) + ']';
        if (cssCount(root, c) === 1) return c;
      }
    }
    if (el.id && !looksDynamic(el.id)) {
      const c = '#' + CSS.escape(el.id);
      if (cssCount(root, c) === 1) return c;
    }
    return cssPath(el);
  }
  REC.cssFor = bestCss;

  // Builds every locator candidate for an element, ranked best first, plus shadow DOM info.
  REC.describe = function (el) {
    const root = rootOf(el);
    const shadow = isShadow(root);
    const tag = el.tagName.toLowerCase();
    const cands = [];

    // Adds one candidate: rank (lower = better), plain-English name/reason, and its selectors.
    function add(rank, name, why, css, xpath, pw) {
      let count = -1;
      if (css) count = cssCount(root, css);
      else if (xpath && !shadow) count = xpathCount(xpath);
      cands.push({ rank: rank, name: name, why: why, css: css || null, xpath: xpath || null, pw: pw || null, count: count });
    }

    for (let i = 0; i < TESTID_ATTRS.length; i++) {
      const v = el.getAttribute(TESTID_ATTRS[i]);
      if (v) add(1, 'Test ID', 'Added by developers just for testing, so it rarely changes. Best choice.',
        '[' + TESTID_ATTRS[i] + '=' + attrVal(v) + ']');
    }
    if (el.id && !looksDynamic(el.id)) {
      add(2, 'ID', 'A unique id on the element. Stable as long as the id is not auto-generated.', '#' + CSS.escape(el.id));
    }
    const nm = el.getAttribute('name');
    if (nm && !looksDynamic(nm)) {
      add(3, 'Name attribute', 'The "name" of a form field. Usually stable.', tag + '[name=' + attrVal(nm) + ']');
    }
    const al = el.getAttribute('aria-label');
    if (al) add(4, 'Aria label', 'Accessibility label. Readable and usually stable.', tag + '[aria-label=' + attrVal(al) + ']');

    if (!shadow) {
      const txt = textForLocator(el);
      const q = txt ? xpathStr(txt) : null;
      if (q) {
        const role = tag === 'button' || el.getAttribute('role') === 'button' ? 'button' : (tag === 'a' ? 'link' : null);
        const pw = role
          ? 'get_by_role(' + JSON.stringify(role) + ', name=' + JSON.stringify(txt) + ', exact=True)'
          : 'get_by_text(' + JSON.stringify(txt) + ', exact=True)';
        add(5, 'Visible text', 'Matches the text you can see. Easy to read, but breaks if the wording changes.',
          null, '//' + tag + '[normalize-space()=' + q + ']', pw);
      }
    }

    const ph = el.getAttribute('placeholder');
    if (ph) add(6, 'Placeholder', 'The grey hint text inside the field. Breaks if the hint text changes.',
      tag + '[placeholder=' + attrVal(ph) + ']');

    add(7, 'CSS path (backup)', 'Built from the page structure. Works, but can break if the layout changes.', cssPath(el));
    if (!shadow) {
      add(8, 'XPath (last resort)', 'Same idea as the CSS path, written as XPath. Use only if nothing else works.', null, xpathPath(el));
    }

    // Unique locators first, then by rank.
    cands.sort(function (a, b) {
      return ((a.count === 1 ? 0 : 1) - (b.count === 1 ? 0 : 1)) || (a.rank - b.rank);
    });

    // Remove duplicates (same selector found twice).
    const seen = {};
    const unique = cands.filter(function (c) {
      const key = (c.css || '') + '|' + (c.xpath || '');
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });

    // Shadow DOM: selectors of the host elements, outermost first.
    const hosts = [];
    let r = root;
    while (isShadow(r)) {
      hosts.unshift(bestCss(r.host));
      r = r.host.getRootNode();
    }

    return {
      tag: tag, role: roleWord(el), label: labelFor(el),
      candidates: unique.slice(0, 5), shadowHosts: hosts
    };
  };

  // Why a click on this element cannot work (null when it can).
  function blockedReason(el) {
    if (el.matches && el.matches(':disabled')) return { code: 'disabled', text: 'the element is disabled' };
    if (closestComposed(el, '[aria-disabled="true"]')) return { code: 'disabled', text: 'the element is marked as disabled' };
    return null;
  }

  // ======================================================================
  // C. SENDING EVENTS TO PYTHON  ("REPORT")
  // ======================================================================

  // Packs everything Python needs about one action into a plain object.
  function build(kind, el, extra) {
    const d = REC.describe(el);
    return Object.assign({
      kind: kind, tag: d.tag, role: d.role, label: d.label,
      candidates: d.candidates, shadowHosts: d.shadowHosts, pageUrl: location.href
    }, extra || {});
  }

  // Sends an event to Python and returns its reply (or null if the bridge is missing).
  async function send(payload) {
    try { return await window.pyEvent(payload); } catch (e) { return null; }
  }

  // Describes the action, sends it to Python and shows the small info box on the page.
  async function act(kind, el, extra) {
    const res = await send(build(kind, el, extra));
    if (res && res.toast) showToast(res.toast);
  }

  // Logs a typed value if it changed since the last time we logged it.
  function flushFill(t) {
    if (!t || !t.tagName) return;
    const tag = t.tagName.toLowerCase();
    const type = (t.getAttribute('type') || '').toLowerCase();
    const textLike = tag === 'textarea' || (tag === 'input' && NON_TEXT_TYPES.indexOf(type) === -1);
    if (!textLike || t.__recLast === undefined || t.value === t.__recLast) return;
    t.__recLast = t.value;
    act('fill', t, { value: t.value });
  }
  // Python calls this when you press Stop, so text you typed last is not lost.
  REC.flushActive = function () { flushFill(deepActive()); };

  // True for inputs where you type text (so Enter means "submit").
  function isTextInput(t) {
    const type = (t.getAttribute('type') || '').toLowerCase();
    return t.tagName.toLowerCase() === 'input' && NON_TEXT_TYPES.indexOf(type) === -1;
  }

  // ======================================================================
  // D. ON-PAGE VISUALS  (hover outline, info box, Stop button)
  // ======================================================================

  // Small box in the corner of the page showing the locator that was just recorded.
  let toastBox = null, toastTimer = null;
  function showToast(text) {
    if (!toastBox || !toastBox.isConnected) {
      toastBox = document.createElement('div');
      toastBox.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:2147483647;max-width:420px;' +
        'background:#1f2937;color:#fff;font:12px/1.4 monospace;padding:8px 10px;border-radius:6px;' +
        'white-space:pre-wrap;pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,.3);';
      (document.body || document.documentElement).appendChild(toastBox);
    }
    toastBox.textContent = text;
    toastBox.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastBox.style.display = 'none'; }, 5000);
  }

  // Red outline that follows the element under your mouse.
  let overlay = null;
  function moveOverlay(el) {
    if (!overlay || !overlay.isConnected) {
      overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;box-sizing:border-box;' +
        'border:2px solid #ff4d4f;background:rgba(255,77,79,0.12);left:0;top:0;width:0;height:0;';
      document.documentElement.appendChild(overlay);
    }
    const r = el.getBoundingClientRect();
    overlay.style.left = r.left + 'px';
    overlay.style.top = r.top + 'px';
    overlay.style.width = r.width + 'px';
    overlay.style.height = r.height + 'px';
  }

  // Tells Python to stop. Python saves the files and closes the browser.
  async function onStopClick(e, button) {
    e.stopPropagation();
    flushFill(deepActive());               // save the text you typed last
    button.textContent = 'Saving...';
    try { await window.pyStop(); } catch (err) { /* browser is closing */ }
  }

  // Adds the red "Stop recording" button (top page only, never inside iframes).
  // It lives in its own shadow root so the website's CSS cannot change how it looks.
  function installStopButton() {
    if (window !== window.top) return;
    if (!document.documentElement || document.getElementById(UI_ID)) return;
    const host = document.createElement('div');
    host.id = UI_ID;
    host.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:2147483647;';
    const shadow = host.attachShadow({ mode: 'open' });
    const button = document.createElement('button');
    button.textContent = '\u25A0 Stop recording';
    button.style.cssText = 'all:initial;cursor:pointer;background:#dc2626;color:#fff;' +
      'font:600 13px/1 Arial,sans-serif;padding:10px 14px;border-radius:6px;' +
      'box-shadow:0 2px 8px rgba(0,0,0,.35);opacity:.92;';
    button.addEventListener('click', function (e) { onStopClick(e, button); });
    shadow.appendChild(button);
    document.documentElement.appendChild(host);
  }
  document.addEventListener('DOMContentLoaded', installStopButton);
  setInterval(installStopButton, 1000);   // puts it back if the page removes it

  // ======================================================================
  // E. EVENT LISTENERS  ("WATCH")
  // ======================================================================

  let lastBlocked = { el: null, t: 0 };

  // Hover: outline the element you are pointing at.
  document.addEventListener('mouseover', function (e) {
    const t = realTarget(e);
    if (t && t.getBoundingClientRect && !isOwnUi(t)) moveOverlay(interactiveOf(t));
  }, true);

  // Remember the starting value when you enter a field, so we only log real changes.
  document.addEventListener('focusin', function (e) {
    const t = realTarget(e);
    if (t && t.tagName && t.__recLast === undefined && 'value' in t) t.__recLast = t.value;
  }, true);

  // Mouse press: first save any text you typed, then detect clicks on disabled elements.
  document.addEventListener('pointerdown', function (e) {
    if (e.button !== 0 || !e.isTrusted || isOwnUi(realTarget(e))) return;
    flushFill(deepActive());
    const hit = deepFromPoint(e.clientX, e.clientY) || realTarget(e);
    const target = interactiveOf(hit);
    const why = blockedReason(target);
    if (why) {
      lastBlocked = { el: target, t: Date.now() };
      act('blocked', target, { action: 'click', reason: why.text, reasonCode: why.code });
    }
  }, true);

  // Click: log it, except for fields/checkboxes (those are logged when their value changes).
  document.addEventListener('click', function (e) {
    if (e.button !== 0 || !e.isTrusted || isOwnUi(realTarget(e))) return;
    const t = interactiveOf(realTarget(e));
    if (lastBlocked.el === t && Date.now() - lastBlocked.t < 500) return;
    const tag = t.tagName.toLowerCase();
    const type = (t.getAttribute('type') || '').toLowerCase();
    if (tag === 'select' || tag === 'textarea' || tag === 'option') return;
    if (tag === 'input' && BUTTON_TYPES.indexOf(type) === -1) return;
    if (tag === 'label' && t.control) return;
    act('click', t);
  }, true);

  // Value changes: typing, dropdowns, checkboxes, radio buttons and file uploads.
  document.addEventListener('change', function (e) {
    if (!e.isTrusted) return;
    const t = realTarget(e);
    if (!t || !t.tagName) return;
    const tag = t.tagName.toLowerCase();
    const type = (t.getAttribute('type') || '').toLowerCase();
    if (tag === 'select') {
      act('select', t, { value: Array.prototype.map.call(t.selectedOptions, function (o) { return o.text.trim(); }).join(', ') });
    } else if (tag === 'input' && (type === 'checkbox' || type === 'radio')) {
      act(t.checked ? 'check' : 'uncheck', t);
    } else if (tag === 'input' && type === 'file') {
      act('file', t, { value: Array.prototype.map.call(t.files, function (f) { return f.name; }).join(', ') });
    } else if (tag === 'input' || tag === 'textarea') {
      if (t.__recLast === t.value) return;
      t.__recLast = t.value;
      act('fill', t, { value: t.value });
    }
  }, true);

  // Keyboard: Enter inside a text field, and typing into read-only fields (blocked).
  document.addEventListener('keydown', function (e) {
    if (!e.isTrusted) return;
    const t = realTarget(e);
    if (!t || !t.tagName) return;
    const tag = t.tagName.toLowerCase();
    if (e.key === 'Enter' && isTextInput(t)) {
      flushFill(t);
      act('press_enter', t);
      return;
    }
    if (e.key && e.key.length === 1 && !e.ctrlKey && !e.metaKey && (tag === 'input' || tag === 'textarea') &&
        (t.readOnly || t.disabled) && !t.__recWarned) {
      t.__recWarned = true;
      act('blocked', t, { action: 'type', reason: 'the field is read-only', reasonCode: 'readonly' });
    }
  }, true);
})();
