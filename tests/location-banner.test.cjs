// The "Location permission is off" banner must be dismissible and must recover
// when a person turns location on outside the page (iOS Settings) and comes
// back. The old banner had no close control and never re-checked, so the only
// way out was a full reload.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { read, appSource, has } = require("./support/client.cjs");

function sourceBetween(start, end) {
  const src = read("app-map-explore-today.js");
  const a = src.indexOf(`function ${start}(`);
  const b = src.indexOf(`\nfunction ${end}(`, a);
  if (a < 0 || b < 0) throw new Error(`markers not found: ${start} / ${end}`);
  return src.slice(a, b);
}

function fakeBanner() {
  const banner = {
    hidden: true,
    children: [],
    set textContent(v) {
      this._text = v;
      this.children = [];
    },
    get textContent() {
      return (this._text || "") + this.children.map((c) => c.textContent).join("");
    },
    append(child) {
      this.children.push(child);
    },
    setAttribute(key, value) {
      this.attrs = this.attrs || {};
      this.attrs[key] = value;
    },
  };
  const document = {
    getElementById: () => banner,
    createTextNode: (text) => ({ textContent: text }),
    createElement: () => ({
      textContent: "",
      className: "",
      setAttribute(key, value) {
        this.attrs = this.attrs || {};
        this.attrs[key] = value;
      },
    }),
  };
  return { banner, document };
}

test("the location banner can be dismissed without a reload", () => {
  const { banner, document } = fakeBanner();
  const mapNotice = new Function("document", `${sourceBetween("mapNotice", "locateUser")}\nreturn mapNotice;`)(document);

  mapNotice("Location permission is off. Enable it in your browser, or search by barangay.");
  assert.equal(banner.hidden, false);
  const close = banner.children.find((c) => c.className === "map-status-close");
  assert.ok(close, "banner must include a dismiss control");
  assert.match(banner.textContent, /Location permission is off/);

  close.onclick();
  assert.equal(banner.hidden, true, "dismissing must hide the banner");
});

test("returning to the tab retries the permission that was just enabled", () => {
  const js = appSource();
  assert.ok(has(js, 'document.addEventListener("visibilitychange"'), "must notice the user coming back");
  assert.ok(has(js, "locateAwaitingPermission = true"), "must remember a permission-denied attempt");
  assert.ok(has(js, "if (!locateAwaitingPermission) return;"), "must not retry unrelated location requests");
});
