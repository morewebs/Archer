/**
 * Archer Test Suite
 * Covers graph algorithms, layout geometry golden tests, schema validation,
 * negative edge cases, CLI exit codes, and byte-for-byte build determinism.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { detectCycles, computeStagesAndLanes, classifyEdges, tracePaths } from '../src/graph.js';
import { computeLayout, computeCardHeight, CARD_WIDTH, BASE_HEIGHT, ALERT_HEIGHT, ROW_HEIGHT } from '../src/layout.js';
import { validateSpec } from '../src/validator.js';
import { compileArcher } from '../src/compiler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '..');
const BIN_CLI = path.join(ROOT_DIR, 'bin', 'archer.mjs');
const RECIPES_DIR = path.join(ROOT_DIR, 'recipes');
const DIST_DIR = path.join(ROOT_DIR, 'dist');

console.log('[Archer Test Suite] Starting test execution...\n');

let passedTests = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(err);
    process.exit(1);
  }
}

// -------------------------------------------------------------
// 1. Graph Theory & Edge Classification Unit Tests
// -------------------------------------------------------------
console.log('--- 1. Graph Engine Unit Tests ---');

test('detectCycles finds cycles and reports back-edges', () => {
  const nodes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const edges = [
    { from: 'a', to: 'b' },
    { from: 'b', to: 'c' },
    { from: 'c', to: 'a' } // Cycle!
  ];
  const result = detectCycles(nodes, edges);
  assert.equal(result.hasCycles, true);
  assert.equal(result.cycleEdges.length, 1);
  assert.equal(result.cycleEdges[0].from, 'c');
  assert.equal(result.cycleEdges[0].to, 'a');
});

test('classifyEdges correctly distinguishes forward, lateral, and back edges', () => {
  const nodes = [
    { id: 'n1', stage: 0 },
    { id: 'n2', stage: 1 },
    { id: 'n3', stage: 1 },
    { id: 'n4', stage: 2 }
  ];
  const edges = [
    { from: 'n1', to: 'n2' }, // forward (0 -> 1)
    { from: 'n2', to: 'n3' }, // lateral (1 -> 1)
    { from: 'n4', to: 'n1' }  // back (2 -> 0)
  ];
  const stages = new Map([['n1', 0], ['n2', 1], ['n3', 1], ['n4', 2]]);
  const classification = classifyEdges(nodes, edges, stages);

  assert.equal(classification.get(edges[0]), 'forward');
  assert.equal(classification.get(edges[1]), 'lateral');
  assert.equal(classification.get(edges[2]), 'back');
});

test('computeStagesAndLanes clamps auto-nodes to explicit neighbor boundaries', () => {
  const nodes = [
    { id: 'root', stage: 0 },
    { id: 'middle' }, // Auto
    { id: 'sink', stage: 3 }
  ];
  const edges = [
    { from: 'root', to: 'middle' },
    { from: 'middle', to: 'sink' }
  ];
  const { stages, lanes } = computeStagesAndLanes(nodes, edges);
  assert.equal(stages.get('root'), 0);
  assert.equal(stages.get('middle'), 1);
  assert.equal(stages.get('sink'), 3);
  assert.equal(lanes.get('middle'), 0);
});

test('tracePaths performs correct upstream and downstream BFS isolation', () => {
  const nodes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'unrelated' }];
  const edges = [
    { from: 'a', to: 'b' },
    { from: 'b', to: 'c' }
  ];
  const trace = tracePaths('b', nodes, edges);
  assert.equal(trace.activeNodes.has('a'), true);
  assert.equal(trace.activeNodes.has('b'), true);
  assert.equal(trace.activeNodes.has('c'), true);
  assert.equal(trace.activeNodes.has('unrelated'), false);
  assert.equal(trace.upstreamNodes.has('a'), true);
  assert.equal(trace.downstreamNodes.has('c'), true);
});

// -------------------------------------------------------------
// 2. Deterministic Node Geometry Golden Tests
// -------------------------------------------------------------
console.log('\n--- 2. Deterministic Geometry Golden Tests ---');

test('computeCardHeight matches the deterministic formula', () => {
  const minimalNode = { id: 'm', title: 'Minimal' };
  assert.equal(computeCardHeight(minimalNode), BASE_HEIGHT);

  const nodeWithAlert = { id: 'a', title: 'Alert', alert: 'Critical issue' };
  assert.equal(computeCardHeight(nodeWithAlert), BASE_HEIGHT + ALERT_HEIGHT);

  const nodeWithDetails = {
    id: 'd',
    title: 'Details',
    details: [{ k: 'A', v: '1' }, { k: 'B', v: '2' }]
  };
  assert.equal(computeCardHeight(nodeWithDetails), BASE_HEIGHT + (2 * ROW_HEIGHT));

  const fullNode = {
    id: 'f',
    title: 'Full',
    alert: 'Warn',
    details: [{ k: 'K1', v: 'V1' }, { k: 'K2', v: 'V2' }, { k: 'K3', v: 'V3' }]
  };
  assert.equal(computeCardHeight(fullNode), BASE_HEIGHT + ALERT_HEIGHT + (3 * ROW_HEIGHT));
});

test('computeLayout produces exact golden coordinates and boundary boxes', () => {
  const spec = {
    meta: { title: 'Golden Test', flow: 'lr' },
    boundaries: [
      { id: 'b1', title: 'Boundary 1' }
    ],
    nodes: [
      { id: 'n1', title: 'Node 1', stage: 0, lane: 0, boundary: 'b1' },
      { id: 'n2', title: 'Node 2', stage: 1, lane: 0, boundary: 'b1' }
    ],
    edges: [
      { from: 'n1', to: 'n2' }
    ]
  };

  const layout = computeLayout(spec);
  const n1 = layout.nodes.find(n => n.id === 'n1');
  const n2 = layout.nodes.find(n => n.id === 'n2');

  assert.equal(n1.x, 80);
  assert.equal(n1.y, 120);
  assert.equal(n1.width, CARD_WIDTH);
  assert.equal(n1.height, BASE_HEIGHT);

  // Stage 1 X is 80 + 310 + 240 = 630
  assert.equal(n2.x, 630);
  assert.equal(n2.y, 120);

  // Boundary 1 enclosing box
  const b1 = layout.boundaries.find(b => b.id === 'b1');
  assert.notEqual(b1.bounds, null);
  assert.equal(b1.bounds.x, 80 - 40);
  assert.equal(b1.bounds.y, 120 - 52);
  assert.equal(b1.bounds.width, (630 + 310 - 80) + (2 * 40));
  assert.equal(b1.bounds.height, BASE_HEIGHT + 52 + 36);

  // Edge path coordinates
  const edge = layout.edges[0];
  assert.equal(edge.sx, 80 + CARD_WIDTH);
  assert.equal(edge.sy, 120 + 42);
  assert.equal(edge.tx, 630);
  assert.equal(edge.ty, 120 + 42);
});

// -------------------------------------------------------------
// 3. Validation & Negative Tests
// -------------------------------------------------------------
console.log('\n--- 3. Validation & Negative Tests ---');

test('validateSpec passes on a valid minimal specification', () => {
  const valid = {
    meta: { title: 'Minimal' },
    nodes: [{ id: 'a', title: 'A' }],
    edges: []
  };
  const res = validateSpec(valid);
  assert.equal(res.valid, true);
  assert.equal(res.errors.length, 0);
});

test('validateSpec fails on missing meta.title', () => {
  const invalid = { meta: {}, nodes: [], edges: [] };
  const res = validateSpec(invalid);
  assert.equal(res.valid, false);
  assert.match(res.errors.join(' '), /meta\.title/);
});

test('validateSpec catches duplicate node IDs', () => {
  const invalid = {
    meta: { title: 'Dup' },
    nodes: [{ id: 'dup', title: 'A' }, { id: 'dup', title: 'B' }],
    edges: []
  };
  const res = validateSpec(invalid);
  assert.equal(res.valid, false);
  assert.match(res.errors.join(' '), /Duplicate node id/);
});

test('validateSpec catches dangling edge references', () => {
  const invalid = {
    meta: { title: 'Dangling' },
    nodes: [{ id: 'a', title: 'A' }],
    edges: [{ from: 'a', to: 'ghost' }]
  };
  const res = validateSpec(invalid);
  assert.equal(res.valid, false);
  assert.match(res.errors.join(' '), /references non-existent "to" node "ghost"/);
});

test('validateSpec catches non-existent boundary references', () => {
  const invalid = {
    meta: { title: 'Bad Boundary' },
    boundaries: [{ id: 'valid-b', title: 'Valid' }],
    nodes: [{ id: 'a', title: 'A', boundary: 'ghost-b' }],
    edges: []
  };
  const res = validateSpec(invalid);
  assert.equal(res.valid, false);
  assert.match(res.errors.join(' '), /references non-existent boundary "ghost-b"/);
});

test('validateSpec issues warning on empty boundary and cycles', () => {
  const spec = {
    meta: { title: 'Warn Spec' },
    boundaries: [{ id: 'empty-b', title: 'Empty' }],
    nodes: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }],
    edges: [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'a' }
    ]
  };
  const res = validateSpec(spec);
  assert.equal(res.valid, true); // Valid syntax, but has warnings
  assert.equal(res.warnings.length >= 2, true);
  assert.match(res.warnings.join(' '), /has no member nodes/);
  assert.match(res.warnings.join(' '), /Cycle detected/);
});

test('validateSpec strictly rejects column and row aliases', () => {
  const invalid = {
    meta: { title: 'Alias Test' },
    nodes: [{ id: 'a', title: 'A', column: 0 }],
    edges: []
  };
  const res = validateSpec(invalid);
  assert.equal(res.valid, false);
  assert.match(res.errors.join(' '), /uses forbidden direction-dependent alias/);
});

// -------------------------------------------------------------
// 4. CLI Contract & Exit Codes Tests
// -------------------------------------------------------------
console.log('\n--- 4. CLI Contract & Exit Codes Tests ---');

test('CLI validate returns exit code 0 and correct JSON shape for valid spec', () => {
  const recipePath = path.join(RECIPES_DIR, 'network-proxy-audit.json');
  const output = execFileSync('node', [BIN_CLI, 'validate', recipePath, '--json'], { encoding: 'utf8' });
  const parsed = JSON.parse(output);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.errors.length, 0);
  assert.equal(typeof parsed.stats.nodeCount, 'number');
});

test('CLI validate returns exit code 1 for invalid spec', () => {
  const tmpInvalid = path.join(DIST_DIR, 'invalid-test.json');
  if (!fs.existsSync(DIST_DIR)) fs.mkdirSync(DIST_DIR, { recursive: true });
  fs.writeFileSync(tmpInvalid, JSON.stringify({ meta: {} }), 'utf8');

  let exitCode = 0;
  let stdout = '';
  try {
    stdout = execFileSync('node', [BIN_CLI, 'validate', tmpInvalid, '--json'], { encoding: 'utf8' });
  } catch (err) {
    exitCode = err.status;
    stdout = err.stdout;
  }
  assert.equal(exitCode, 1);
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.valid, false);
  assert.equal(parsed.errors.length > 0, true);
  fs.unlinkSync(tmpInvalid);
});

test('CLI recipe command exits 1 on unknown recipe', () => {
  let exitCode = 0;
  try {
    execFileSync('node', [BIN_CLI, 'recipe', 'non-existent-xyz'], { stdio: 'pipe' });
  } catch (err) {
    exitCode = err.status;
  }
  assert.equal(exitCode, 1);
});

// -------------------------------------------------------------
// 5. Deterministic Build Test
// -------------------------------------------------------------
console.log('\n--- 5. Deterministic Build Tests ---');

test('compileArcher produces byte-identical output across consecutive runs', () => {
  const recipe = JSON.parse(fs.readFileSync(path.join(RECIPES_DIR, 'cloud-infrastructure.json'), 'utf8'));
  const htmlRun1 = compileArcher(recipe);
  const htmlRun2 = compileArcher(recipe);
  assert.equal(htmlRun1, htmlRun2);
  assert.equal(Buffer.byteLength(htmlRun1), Buffer.byteLength(htmlRun2));
});

// -------------------------------------------------------------
// 6. Recipe Compilation Tests
// -------------------------------------------------------------
console.log('\n--- 6. Recipe Compilation Tests ---');

const recipes = [
  'network-proxy-audit',
  'cloud-infrastructure',
  'microservices-ingress',
  'incident-root-cause'
];

for (const r of recipes) {
  test(`Compiles recipe "${r}" into standalone HTML`, () => {
    const jsonPath = path.join(RECIPES_DIR, `${r}.json`);
    const outHtmlPath = path.join(DIST_DIR, `${r}.html`);
    const spec = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

    const html = compileArcher(spec, outHtmlPath);
    assert.equal(fs.existsSync(outHtmlPath), true);
    assert.equal(html.includes('<!DOCTYPE html>'), true);
    assert.equal(html.includes('window.ArcherGraph'), true);
    assert.equal(html.includes('node-card'), true);
    assert.equal(html.includes('generator" content="archer@1.0.0"'), true);
  });
}

console.log(`\n[Archer Test Suite] All ${passedTests} tests passed successfully! 🚀\n`);
