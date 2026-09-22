/*
 * ADDED BY THE SVAR PRODUCTION PLANNER PROJECT (SVAR-M37).
 * NOT part of the upstream SVAR sources and not code of XB Software Sp. z o.o.
 *
 * Unit tests for the pure collapsed-group aggregation (`src/planner-router/
 * aggregate.js`). Run: `npm run test:planner` (plain `node --test`).
 *
 * WHAT THIS PROVES AND WHAT IT DOES NOT (project rule D-091 §1). Green here
 * proves the aggregation's pure functions group, key and clip geometry
 * exactly as documented. It proves NOTHING about the real `<Gantt>`
 * integration (badge rendering, hover, popover, the reveal gesture) — that
 * is the Planner product's own real-Chromium suite's job, not this file's.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  findVisibleRepresentative,
  buildAggregates,
  pickBadgeAnchor,
  collapsedAncestorsToOpen,
} from '../src/planner-router/aggregate.js';

/*
 * A small tree: 0 (root) -> A -> [B, C], D (sibling leaf), E -> F -> G,
 * H -> I (a SECOND collapsed group, sibling of A, for R1-1 Case C: two
 * different collapsed groups aggregating between their representatives).
 */
const TREE = {
  A: { id: 'A', parent: 0, open: false },
  B: { id: 'B', parent: 'A' },
  C: { id: 'C', parent: 'A' },
  D: { id: 'D', parent: 0, open: true },
  E: { id: 'E', parent: 0, open: true },
  F: { id: 'F', parent: 'E', open: false },
  G: { id: 'G', parent: 'F' },
  H: { id: 'H', parent: 0, open: false },
  I: { id: 'I', parent: 'H' },
};

function getTask(id) {
  return TREE[id];
}

test('findVisibleRepresentative: a visible task resolves to itself', () => {
  const visible = new Set(['A', 'B', 'D']);
  assert.equal(findVisibleRepresentative('B', getTask, visible), 'B');
});

test('findVisibleRepresentative: a hidden task resolves to its nearest visible ancestor', () => {
  const visible = new Set(['A', 'D']); // A's children (B, C) are collapsed
  assert.equal(findVisibleRepresentative('B', getTask, visible), 'A');
  assert.equal(findVisibleRepresentative('C', getTask, visible), 'A');
});

test('findVisibleRepresentative: a task with no tree entry at all resolves to null (E-2 firebreak)', () => {
  // A filter that removed a task from the tasks the store was ever handed
  // leaves no tree entry for it — the same seam a collapsed ancestor uses,
  // by construction, never a name this module has to know about.
  const visible = new Set(['A']);
  assert.equal(findVisibleRepresentative('ghost', getTask, visible), null);
});

test('findVisibleRepresentative: reaching the root with nothing visible resolves to null (defensive)', () => {
  const visible = new Set(['nothing-is-visible']);
  assert.equal(findVisibleRepresentative('F', getTask, visible), null);
});

test('buildAggregates: a fully visible link is excluded, never re-drawn as an aggregate', () => {
  const visible = new Set(['B', 'D']);
  const links = [{ id: 'l1', source: 'B', target: 'D', mode: 'soft' }];
  assert.deepEqual(buildAggregates(links, getTask, visible), []);
});

test('buildAggregates: a link with one hidden endpoint aggregates to its representative, count 1', () => {
  const visible = new Set(['A', 'D']);
  const links = [{ id: 'l1', source: 'B', target: 'D', mode: 'soft' }];
  const aggregates = buildAggregates(links, getTask, visible);
  assert.equal(aggregates.length, 1);
  assert.equal(aggregates[0].source, 'A');
  assert.equal(aggregates[0].target, 'D');
  assert.equal(aggregates[0].count, 1);
  assert.deepEqual(aggregates[0].memberLinkIds, ['l1']);
});

test('buildAggregates: two links collapsing to the same representative/direction/mode merge into one aggregate, count 2', () => {
  const visible = new Set(['A', 'D']);
  const links = [
    { id: 'l1', source: 'B', target: 'D', mode: 'soft' },
    { id: 'l2', source: 'C', target: 'D', mode: 'soft' },
  ];
  const aggregates = buildAggregates(links, getTask, visible);
  assert.equal(aggregates.length, 1);
  assert.equal(aggregates[0].count, 2);
  assert.deepEqual(new Set(aggregates[0].memberLinkIds), new Set(['l1', 'l2']));
});

test('NEGATIVE CONTROL (D-166 §K, kickoff §17): mixed mode never aggregates into one badge', () => {
  const visible = new Set(['A', 'D']);
  const links = [
    { id: 'l1', source: 'B', target: 'D', mode: 'soft' },
    { id: 'l2', source: 'C', target: 'D', mode: 'informational' },
  ];
  const aggregates = buildAggregates(links, getTask, visible);
  assert.equal(
    aggregates.length,
    2,
    'different mode must never merge into one aggregate, even with the same representative endpoints',
  );
  for (const aggregate of aggregates) assert.equal(aggregate.count, 1);
});

/* ======================================================================== *
 * SVAR Production Planner, Pavel manual acceptance, Phase 4.1G R1 second
 * follow-up — `presentationKeyOf` (D-166 §K widened).
 *
 * The negative control just above sets `mode: 'soft'`/`mode: 'informational'`
 * directly on its fixture links, so it already exercised the ORIGINAL
 * `mode ?? 'soft'` key correctly and would keep passing even if this whole
 * fix never existed. It does not reproduce the actual bug: the SVAR
 * Production Planner's own `ILink` objects (`linkProjection.ts`) never carry
 * `.mode` at all — D-116 keeps that word out of this renderer's vocabulary
 * on purpose — so every real link fell back to the literal string `'soft'`
 * and TWO REAL LINKS OF DIFFERENT MODE, ONCE THEIR OWN `.mode` FIELD IS
 * ABSENT LIKE THE REAL APP LEAVES IT, merged anyway. These fixtures leave
 * `.mode` unset (as production `ILink`s do) and separate purely through a
 * synthetic `presentationKeyOf`, standing in for the app's real
 * `linkPresentation` callback — the closed `{lineStyle, arrowhead}`
 * dictionary this module is allowed to be handed a digest of, never `mode`
 * itself.
 */
function presentationKeyOfById(map) {
  return (link) => map.get(link.id) ?? '';
}

test('RED-BEFORE-THIS-FIX (D-166 §K widened): two links with NO `.mode` field (the real app shape) but genuinely different presentation must not merge', () => {
  const visible = new Set(['A', 'D']);
  const links = [
    { id: 'l1', source: 'B', target: 'D' }, // no .mode — real ILink shape
    { id: 'l2', source: 'C', target: 'D' },
  ];
  const keyOf = presentationKeyOfById(
    new Map([
      ['l1', 'dashed\u0000true'], // stands for Soft
      ['l2', 'dotted\u0000true'], // stands for Informational
    ]),
  );
  const aggregates = buildAggregates(links, getTask, visible, keyOf);
  assert.equal(
    aggregates.length,
    2,
    'without presentationKeyOf these two would have merged into one count-2 aggregate — this is exactly what Pavel photographed',
  );
  for (const aggregate of aggregates) assert.equal(aggregate.count, 1);
  const byMember = new Map(aggregates.map((a) => [a.memberLinkIds[0], a]));
  assert.equal(byMember.get('l1').count, 1);
  assert.equal(byMember.get('l2').count, 1);
});

test('the same discriminating case, repeated for Hard+Informational and Hard+Soft (Pavel manual acceptance)', () => {
  const visible = new Set(['A', 'D']);
  const cases = [
    ['solid\u0000true', 'dotted\u0000true'], // Hard + Informational
    ['solid\u0000true', 'dashed\u0000true'], // Hard + Soft
  ];
  for (const [keyA, keyB] of cases) {
    const links = [
      { id: 'l1', source: 'B', target: 'D' },
      { id: 'l2', source: 'C', target: 'D' },
    ];
    const keyOf = presentationKeyOfById(
      new Map([
        ['l1', keyA],
        ['l2', keyB],
      ]),
    );
    const aggregates = buildAggregates(links, getTask, visible, keyOf);
    assert.equal(aggregates.length, 2, `${keyA} vs ${keyB} must not merge`);
    for (const aggregate of aggregates) assert.equal(aggregate.count, 1);
  }
});

test('two links with the SAME presentation (both real modes mapping to the same {lineStyle, arrowhead}) still merge into one badge — this is a widening, not a narrowing', () => {
  const visible = new Set(['A', 'D']);
  const links = [
    { id: 'l1', source: 'B', target: 'D' },
    { id: 'l2', source: 'C', target: 'D' },
  ];
  const keyOf = presentationKeyOfById(
    new Map([
      ['l1', 'dashed\u0000true'],
      ['l2', 'dashed\u0000true'],
    ]),
  );
  const aggregates = buildAggregates(links, getTask, visible, keyOf);
  assert.equal(aggregates.length, 1);
  assert.equal(aggregates[0].count, 2);
});

test('backward compatibility: omitting presentationKeyOf entirely groups exactly as before (mode-only key)', () => {
  const visible = new Set(['A', 'D']);
  const links = [
    { id: 'l1', source: 'B', target: 'D', mode: 'soft' },
    { id: 'l2', source: 'C', target: 'D', mode: 'soft' },
  ];
  // No fourth argument at all — the pre-existing call shape.
  const aggregates = buildAggregates(links, getTask, visible);
  assert.equal(aggregates.length, 1);
  assert.equal(aggregates[0].count, 2);
});

test('aggregate id stays stable across two builds of the SAME grouping decision, even when the input array order differs (React key / openAggregateId identity)', () => {
  const visible = new Set(['A', 'D']);
  const keyOf = presentationKeyOfById(
    new Map([
      ['l1', 'dashed\u0000true'],
      ['l2', 'dotted\u0000true'],
    ]),
  );
  const forward = buildAggregates(
    [
      { id: 'l1', source: 'B', target: 'D' },
      { id: 'l2', source: 'C', target: 'D' },
    ],
    getTask,
    visible,
    keyOf,
  );
  const reversed = buildAggregates(
    [
      { id: 'l2', source: 'C', target: 'D' },
      { id: 'l1', source: 'B', target: 'D' },
    ],
    getTask,
    visible,
    keyOf,
  );
  const idsOf = (aggregates) => new Set(aggregates.map((a) => a.id));
  assert.deepEqual(idsOf(forward), idsOf(reversed));
});

test('expand/collapse round trip: rebuilding aggregates from the SAME links and visibility twice yields identical ids (nothing about presentation is lost)', () => {
  const visible = new Set(['A', 'D']);
  const links = [
    { id: 'l1', source: 'B', target: 'D' },
    { id: 'l2', source: 'C', target: 'D' },
  ];
  const keyOf = presentationKeyOfById(
    new Map([
      ['l1', 'dashed\u0000true'],
      ['l2', 'dotted\u0000true'],
    ]),
  );
  const before = buildAggregates(links, getTask, visible, keyOf);
  // Simulates collapse -> expand -> collapse: the same pure inputs handed
  // back to buildAggregates a second time, exactly as a re-render would.
  const after = buildAggregates(links, getTask, visible, keyOf);
  assert.deepEqual(
    before.map((a) => a.id).sort(),
    after.map((a) => a.id).sort(),
  );
  assert.deepEqual(
    before.map((a) => a.count).sort(),
    after.map((a) => a.count).sort(),
  );
});

test('buildAggregates: opposite direction between the same two representatives never merges (D-166: direction is part of the key)', () => {
  const visible = new Set(['A', 'D']);
  const links = [
    { id: 'l1', source: 'B', target: 'D', mode: 'soft' }, // A -> D
    { id: 'l2', source: 'D', target: 'C', mode: 'soft' }, // D -> A
  ];
  const aggregates = buildAggregates(links, getTask, visible);
  assert.equal(aggregates.length, 2);
  const bySource = new Map(aggregates.map((a) => [a.source, a]));
  assert.equal(bySource.get('A').target, 'D');
  assert.equal(bySource.get('D').target, 'A');
});

test('buildAggregates: a link with a filter-hidden endpoint (no tree entry) is skipped entirely, not aggregated (E-2 firebreak)', () => {
  const visible = new Set(['A', 'D']);
  const links = [{ id: 'l1', source: 'ghost', target: 'D', mode: 'soft' }];
  assert.deepEqual(buildAggregates(links, getTask, visible), []);
});

test('NEGATIVE CONTROL / R1-1 Case A: a link whose BOTH real endpoints are hidden inside the SAME collapsed representative is never drawn — no self-loop, no badge, no chip', () => {
  const visible = new Set(['A', 'D']);
  // B and C are both children of the one collapsed A: an internal
  // relationship of content the person chose to hide, in full.
  const links = [{ id: 'l1', source: 'B', target: 'C', mode: 'soft' }];
  assert.deepEqual(
    buildAggregates(links, getTask, visible),
    [],
    'both endpoints resolving to the same representative must produce no aggregate at all',
  );
});

test('R1-1 Case B: one hidden child -> one visible external task still aggregates normally', () => {
  const visible = new Set(['A', 'D']);
  const links = [{ id: 'l1', source: 'B', target: 'D', mode: 'soft' }];
  const aggregates = buildAggregates(links, getTask, visible);
  assert.equal(aggregates.length, 1);
  assert.equal(aggregates[0].source, 'A');
  assert.equal(aggregates[0].target, 'D');
});

test('R1-1 Case C: a hidden child of one collapsed group -> a hidden child of a DIFFERENT collapsed group aggregates between the two representatives', () => {
  const visible = new Set(['A', 'H']);
  const links = [{ id: 'l1', source: 'B', target: 'I', mode: 'soft' }];
  const aggregates = buildAggregates(links, getTask, visible);
  assert.equal(aggregates.length, 1);
  assert.equal(aggregates[0].source, 'A');
  assert.equal(aggregates[0].target, 'H');
  assert.equal(aggregates[0].count, 1);
});

test('R1-11: an aggregate id is never shaped like a canonical UUID — the consuming app relies on this to refuse it as a TaskLinkId', () => {
  // Phase 4.1C manual acceptance remediation, R1-11 audit: "no mutation API
  // accepts an aggregate id as if it were a TaskLink id". The consuming
  // app's own `parseTaskLinkId` (src/core/domain/ids.ts) enforces that at
  // its own boundary by requiring a UUID — this proves the OTHER half of
  // that guarantee, that this module never hands out anything a UUID
  // pattern (`^[0-9a-f]{8}-...`) could match, so the two halves cannot
  // silently stop agreeing.
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const visible = new Set(['A', 'D']);
  const links = [{ id: 'l1', source: 'B', target: 'D', mode: 'soft' }];
  const [aggregate] = buildAggregates(links, getTask, visible);
  assert.ok(aggregate.id.startsWith('aggregate:'));
  assert.equal(uuidPattern.test(aggregate.id), false);
});

test('R1-1 Case D / E-2 firebreak: an endpoint hidden only by an active filter (no tree entry at all) is not folded into collapsed-group aggregation, even when the other side is a genuine collapsed group', () => {
  const visible = new Set(['A', 'H']);
  // 'ghost2' has no entry in TREE at all — a filtered-out task, never
  // merely a collapsed one, per the E-2 firebreak this module leans on.
  const links = [{ id: 'l1', source: 'B', target: 'ghost2', mode: 'soft' }];
  assert.deepEqual(
    buildAggregates(links, getTask, visible),
    [],
    'a filter-hidden representative (no tree entry) must never enter aggregation',
  );
});

test('collapsedAncestorsToOpen: one collapsed ancestor -> just that one, in top-down order', () => {
  assert.deepEqual(collapsedAncestorsToOpen('B', getTask), ['A']);
});

test('collapsedAncestorsToOpen: two collapsed ancestors -> the FARTHER one first (top-down cascade)', () => {
  assert.deepEqual(collapsedAncestorsToOpen('G', getTask), ['F']);
});

test('collapsedAncestorsToOpen: an already-visible root task needs nothing opened', () => {
  // D sits at the root and is already open: nothing hides it.
  assert.deepEqual(collapsedAncestorsToOpen('D', getTask), []);
});

test('collapsedAncestorsToOpen: an already-open ancestor is SKIPPED, never re-opened — "minimal" is the closed ones only', () => {
  // G's chain is G -> F (closed) -> E (open) -> root. Only F is returned.
  assert.deepEqual(collapsedAncestorsToOpen('G', getTask), ['F']);
});

/* ======================================================================== *
 * SVAR-M44 (R3-6, Pavel manual acceptance remediation —
 * "не открываетгруппу.jpg")
 *
 * The product's own demo hierarchy, reduced to the shape that broke: a
 * collapsed group with BOTH a direct leaf child and an OPEN subgroup whose
 * own leaves are therefore hidden by the grandparent rather than by their
 * own parent. Pavel's popover listed one link into the direct child and two
 * into the open subgroup's leaves; row 1 revealed and rows 2 and 3 did
 * nothing at all.
 * ======================================================================== */

const NESTED_TREE = {
  engineering: { id: 'engineering', parent: 0, open: false },
  infra: { id: 'infra', parent: 'engineering' },
  tools: { id: 'tools', parent: 'engineering', open: true },
  levelEditor: { id: 'levelEditor', parent: 'tools' },
  buildPipeline: { id: 'buildPipeline', parent: 'tools' },
  gameplay: { id: 'gameplay', parent: 'engineering', open: true },
  combat: { id: 'combat', parent: 'gameplay' },
};

function getNested(id) {
  return NESTED_TREE[id];
}

test('R3-6: every leaf under a collapsed group resolves the SAME collapsed ancestor, whether its own parent is open or not', () => {
  for (const id of ['infra', 'levelEditor', 'buildPipeline', 'combat']) {
    assert.deepEqual(
      collapsedAncestorsToOpen(id, getNested),
      ['engineering'],
      `${id} must name the closed grandparent that actually hides it`,
    );
  }
});

test('R3-6: the chain stays MINIMAL — an open subgroup on the way up is not re-opened, and no unrelated group is named', () => {
  const chain = collapsedAncestorsToOpen('levelEditor', getNested);
  assert.ok(!chain.includes('tools'), 'the open subgroup is left alone');
  assert.ok(!chain.includes('gameplay'), 'and no sibling group is touched');
  assert.equal(chain.length, 1);
});

test('R3-6: the three popover rows of the screenshot resolve to three DIFFERENT hidden tasks, all reachable', () => {
  const visible = new Set(['engineering', 'conceptArt']);
  const rows = [
    { source: 'conceptArt', target: 'infra' },
    { source: 'conceptArt', target: 'levelEditor' },
    { source: 'conceptArt', target: 'buildPipeline' },
  ];
  const revealed = rows.map((row) => {
    const chain = collapsedAncestorsToOpen(row.target, getNested);
    assert.ok(
      chain.length > 0,
      `row for ${row.target} must have something to open — an empty chain is what made rows 2 and 3 dead`,
    );
    return row.target;
  });
  assert.equal(
    new Set(revealed).size,
    3,
    'each row reveals its own distinct task',
  );
  assert.equal(
    findVisibleRepresentative('infra', getNested, visible),
    'engineering',
    'and all three really do aggregate behind the one representative',
  );
});

test('NEGATIVE CONTROL / R3-6: the retired "stop at the first open ancestor" walk returns nothing for exactly the rows that were dead', () => {
  const retired = (taskId) => {
    const toOpen = [];
    let current = getNested(taskId);
    while (current) {
      const parentId = current.parent;
      if (!parentId) break;
      const parent = getNested(parentId);
      if (!parent) break;
      if (parent.open === true) break; // the retired line
      toOpen.push(parent.id);
      current = parent;
    }
    return toOpen.reverse();
  };
  assert.deepEqual(
    retired('infra'),
    ['engineering'],
    'the row that worked really did work under the retired walk',
  );
  for (const id of ['levelEditor', 'buildPipeline']) {
    assert.deepEqual(
      retired(id),
      [],
      `${id} returned an empty chain, so the caller opened nothing and then scrolled to a task that was still not rendered — silently doing nothing (SVAR-M44 red-before)`,
    );
  }
});

test('pickBadgeAnchor: both ends visible -> the midpoint of the (fully clipped) route', () => {
  const points = [
    [0, 0],
    [100, 0],
  ];
  const anchor = pickBadgeAnchor(points, { from: -10, to: 110 });
  assert.deepEqual(anchor, [50, 0]);
});

test('pickBadgeAnchor: only the target end on screen -> the anchor sits in the visible run near it', () => {
  const points = [
    [0, 0],
    [1000, 0],
  ];
  const anchor = pickBadgeAnchor(points, { from: 900, to: 1100 });
  assert.ok(anchor[0] >= 900 && anchor[0] <= 1000);
});

test('pickBadgeAnchor: both ends off screen but the route crosses the viewport -> anchor inside the crossing segment', () => {
  const points = [
    [0, 0],
    [1000, 0],
  ];
  const anchor = pickBadgeAnchor(points, { from: 400, to: 600 });
  assert.ok(anchor[0] >= 400 && anchor[0] <= 600);
});

test('NEGATIVE CONTROL (D-166 Blocker: no floating badge without a visible route segment): route never enters the viewport -> null', () => {
  const points = [
    [0, 0],
    [100, 0],
  ];
  const anchor = pickBadgeAnchor(points, { from: 500, to: 600 });
  assert.equal(
    anchor,
    null,
    'a route that never touches the viewport must not produce a badge anchor',
  );
});

test('pickBadgeAnchor: a bent route picks its anchor from the longest visible run, not the first one', () => {
  const points = [
    [0, 0],
    [50, 0],
    [50, 500],
    [1000, 500],
  ];
  // A short visible sliver near x=50 and a long one from x=200 to x=1000 at
  // y=500 — the anchor must land in the long run, not the short one.
  const anchor = pickBadgeAnchor(points, { from: 45, to: 1000 });
  assert.equal(anchor[1], 500);
});
