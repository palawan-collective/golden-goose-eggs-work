// Tapping a barangay dot must name the barangay on the first tap, at any zoom.
// A hover tooltip is the wrong tool here: the far-zoom CSS hides every tooltip
// and the fly-to animation closes it, so most dots gave no name and a second
// tap after the map settled was needed.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { appSource, has } = require("./support/client.cjs");

const js = appSource();

test("each barangay dot has a persistent, tappable name popup", () => {
  assert.ok(has(js, 'marker.bindPopup(name, {'), "tap feedback must be a popup, not a hover tooltip");
  assert.ok(has(js, 'className: "barangay-point-popup"'), "popup needs its own styling hook");
  assert.ok(has(js, 'marker.openPopup()'), "click handler must open the popup");
  assert.ok(has(js, 'map.once("moveend", () => marker.openPopup())'), "popup must survive the fly-to");
});
