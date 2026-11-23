// Place pages must show that photos exist. The gallery was reachable only by
// clicking the hero, with no visible sign that three more photos were attached,
// so every listing looked like it had a single plain image.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { appSource, has } = require("./support/client.cjs");

const weather = appSource();
const html = fs.readFileSync("public/site/index.html", "utf8");

test("place detail shows a tappable photo strip for every attached image", () => {
  assert.ok(has(html, 'id="dePhotoStrip"'), "detail sheet needs a photo strip container");
  assert.ok(has(weather, 'openCarousel(stripImages, i)'), "each thumbnail opens the gallery at its own photo");
  assert.ok(has(weather, '"dest-photo-thumb"'), "thumbnails need a styling/tap hook");
  assert.ok(has(html, ".dest-photo-strip{"), "strip needs responsive grid styling");
});

test("short place descriptions are shown in full, not clipped mid-sentence", () => {
  assert.ok(
    has(weather, 'desc.classList.toggle("collapsed"'),
    "only genuinely long descriptions should be clamped",
  );
});
