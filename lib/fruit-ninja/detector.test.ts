import { test } from "node:test";
import assert from "node:assert/strict";
import { detectSlices, type ComboConfig } from "./detector";
import { createHandTracker, updateHandTracker, type HandSlot, type TrailPoint } from "./handTracker";
import type { Entity } from "./physics";

// Values mirror games/fruit-ninja/config.ts so this suite's expectations
// stay pinned to the co-op game's actual tuning, even though the engine
// itself is config-agnostic.
const R = 0.06; // fruit radius
const BOMB_RADIUS = 0.055;
const COMBO: ComboConfig = { enabled: true, bonus: 5 };

function slot(points: [number, number, number][], over: Partial<HandSlot> = {}): HandSlot {
  const trail: TrailPoint[] = points.map(([x, y, t]) => ({ x, y, t, bridged: false }));
  return { active: true, trail, lastSeen: trail[trail.length - 1]?.t ?? 0, sawGap: false, ...over };
}

let nextId = 1;
function fruit(x: number, y: number): Entity {
  return { id: nextId++, kind: "fruit", x, y, vx: 0, vy: 0, radius: R, color: "#f87171" };
}
function bomb(x: number, y: number): Entity {
  return { id: nextId++, kind: "bomb", x, y, vx: 0, vy: 0, radius: BOMB_RADIUS, color: "#000" };
}

test("segment through an entity's center slices; just outside the radius does not", () => {
  const s = [slot([[0.2, 0.5, 100], [0.8, 0.5, 116]])];
  const hit = detectSlices(s, [fruit(0.5, 0.5)], 116, 100, 1, COMBO);
  assert.equal(hit.slicedFruit.length, 1);

  // Perpendicular distance from a y=0.5 segment is exactly the y offset.
  const inside = detectSlices(s, [fruit(0.5, 0.5 + R - 0.001)], 116, 100, 1, COMBO);
  assert.equal(inside.slicedFruit.length, 1);
  const outside = detectSlices(s, [fruit(0.5, 0.5 + R + 0.001)], 116, 100, 1, COMBO);
  assert.equal(outside.slicedFruit.length, 0);
});

test("an entity crossed by both hands in one call is sliced exactly once", () => {
  const s = [
    slot([[0.2, 0.5, 100], [0.8, 0.5, 116]]), // horizontal through center
    slot([[0.5, 0.2, 100], [0.5, 0.8, 116]]), // vertical through center
  ];
  const f = fruit(0.5, 0.5);
  const r = detectSlices(s, [f], 116, 100, 1, COMBO);
  assert.equal(r.slicedFruit.length, 1);
  assert.equal(r.slicedFruit[0].id, f.id);
  // Only the slot that actually won the contested cut produces a hit.
  assert.equal(r.hits.length, 1);
  assert.equal(r.hits[0].fruitCount, 1);
  assert.equal(r.hits[0].comboBonus, 0); // one fruit per stroke, no combo
});

test("aspect correction scales x (not y) so the hit-circle stays a true circle", () => {
  const aspect = 16 / 9;

  // Vertical blade, fruit offset 0.04 in x: on-screen distance is
  // 0.04 * 16/9 = 0.0711 > radius, so a correct implementation misses...
  const vertical = [slot([[0.5, 0.2, 100], [0.5, 0.8, 116]])];
  const offX = fruit(0.5 + 0.04, 0.5);
  assert.ok(0.04 * aspect > R && 0.04 < R);
  assert.equal(detectSlices(vertical, [offX], 116, 100, aspect, COMBO).slicedFruit.length, 0);
  // ...while at aspect 1 the same geometry hits (guards against omitting the scale).
  assert.equal(detectSlices(vertical, [offX], 116, 100, 1, COMBO).slicedFruit.length, 1);

  // Horizontal blade, fruit offset 0.05 in y: y distances are already in
  // height units and must NOT be scaled — 0.05 < radius hits, but a mutant
  // applying aspect to y would compute 0.0889 and miss.
  const horizontal = [slot([[0.2, 0.5, 100], [0.8, 0.5, 116]])];
  const offY = fruit(0.5, 0.5 + 0.05);
  assert.ok(0.05 < R && 0.05 * aspect > R);
  assert.equal(detectSlices(horizontal, [offY], 116, 100, aspect, COMBO).slicedFruit.length, 1);
});

test("combo: multiple fruit in one stroke bonus, none across calls, bombs excluded", () => {
  const s = [slot([[0.1, 0.5, 100], [0.9, 0.5, 116]])];

  const three = detectSlices(s, [fruit(0.3, 0.5), fruit(0.5, 0.5), fruit(0.7, 0.5)], 116, 100, 1, COMBO);
  assert.equal(three.slicedFruit.length, 3);
  assert.equal(three.hits.length, 1);
  assert.equal(three.hits[0].fruitCount, 3);
  assert.equal(three.hits[0].comboBonus, 2 * COMBO.bonus);

  // Same two fruit split across two frames: one per call, no combo either time.
  const s1 = [slot([[0.1, 0.5, 100], [0.4, 0.5, 116]])];
  const c1 = detectSlices(s1, [fruit(0.3, 0.5), fruit(0.7, 0.5)], 116, 100, 1, COMBO);
  assert.equal(c1.slicedFruit.length, 1);
  assert.equal(c1.hits[0].comboBonus, 0);
  const s2 = [slot([[0.1, 0.5, 100], [0.4, 0.5, 116], [0.9, 0.5, 132]])];
  const c2 = detectSlices(s2, [fruit(0.7, 0.5)], 132, 116, 1, COMBO);
  assert.equal(c2.slicedFruit.length, 1);
  assert.equal(c2.hits[0].comboBonus, 0);

  // A bomb mid-stroke is sliced but doesn't inflate the fruit combo.
  const withBomb = detectSlices(s, [fruit(0.3, 0.5), bomb(0.5, 0.5), fruit(0.7, 0.5)], 116, 100, 1, COMBO);
  assert.equal(withBomb.slicedFruit.length, 2);
  assert.equal(withBomb.slicedBombs.length, 1);
  assert.equal(withBomb.hits.length, 1);
  assert.equal(withBomb.hits[0].fruitCount, 2);
  assert.equal(withBomb.hits[0].bombCount, 1);
  assert.equal(withBomb.hits[0].comboBonus, 1 * COMBO.bonus);
});

test("stale trail segments older than sinceT never re-trigger a slice", () => {
  // Old segment (t 100->116) passes through the fruit; the only new segment
  // (t 116->132) misses it. sinceT=116 must exclude the old one.
  const s = [slot([[0.2, 0.5, 100], [0.8, 0.5, 116], [0.8, 0.1, 132]])];
  const f = fruit(0.5, 0.5);
  assert.equal(detectSlices(s, [f], 132, 116, 1, COMBO).slicedFruit.length, 0);
  // Sanity: widening the window to include the old segment does slice it.
  assert.equal(detectSlices(s, [f], 132, 99, 1, COMBO).slicedFruit.length, 1);
});

test("dead-reckoned bridge segment slices a fruit sitting in the dropout path", () => {
  // Fast swipe (0.005 units/ms) tracked for 3 frames, then the camera drops
  // it for 96ms. The tested window (sinceT=112, now=128) lies entirely inside
  // the gap, 80-96ms past the last real point — deep past where the old
  // displacement-clamp bug saturated (0.005 * 40ms = MAX drift), which would
  // have collapsed the bridge to the single point x=0.46 and missed this
  // fruit by 0.083. The speed-capped bridge sweeps x 0.3667 -> 0.388.
  let s = createHandTracker();
  for (let i = 0; i < 3; i++) {
    s = updateHandTracker(s, [{ x: 0.1 + 0.08 * i, y: 0.5 }], i * 16);
  }
  for (const t of [48, 64, 80, 96, 112, 128]) s = updateHandTracker(s, [], t);
  assert.equal(s[0].active, true);
  assert.equal(s[0].sawGap, true);

  const maxSpeed = 0.2 / 150; // DEFAULT_TRACKER_TUNING.deadReckonMaxDrift / maxGapMs
  const bridgeStartX = 0.26 + maxSpeed * 80;
  const bridgeEndX = 0.26 + maxSpeed * 96;
  const f = fruit(0.377, 0.5);
  assert.ok(bridgeStartX < f.x && f.x < bridgeEndX); // fruit sits inside the swept span
  assert.ok(Math.abs(0.26 + 0.2 - f.x) > R); // old clamped point misses

  const r = detectSlices(s, [f], 128, 112, 1, COMBO);
  assert.equal(r.slicedFruit.length, 1);
  assert.equal(r.slicedFruit[0].id, f.id);
});

test("a stroke's hit carries the slot's player", () => {
  const s = [slot([[0.2, 0.5, 100], [0.8, 0.5, 116]], { player: 1 })];
  const r = detectSlices(s, [fruit(0.5, 0.5)], 116, 100, 1, COMBO);
  assert.equal(r.hits.length, 1);
  assert.equal(r.hits[0].player, 1);
});

test("a slot with no player assignment produces a hit with player undefined", () => {
  const s = [slot([[0.2, 0.5, 100], [0.8, 0.5, 116]])]; // player left unset, as co-op always leaves it
  const r = detectSlices(s, [fruit(0.5, 0.5)], 116, 100, 1, COMBO);
  assert.equal(r.hits.length, 1);
  assert.equal(r.hits[0].player, undefined);
});
