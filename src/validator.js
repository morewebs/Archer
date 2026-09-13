/**
 * Archer Specification Validator
 * Validates JSON schema rules, node/edge referential integrity, boundary consistency,
 * cycle warnings, isolated nodes, and geometric overlaps.
 */

import { detectCycles } from './graph.js';
import { computeLayout } from './layout.js';

export function validateSpec(spec) {
  const errors = [];
  const warnings = [];

  // 1. Root structure
  if (!spec || typeof spec !== 'object') {
    return {
      valid: false,
      errors: ['Specification must be a valid JSON object.'],
      warnings: [],
      stats: { nodeCount: 0, edgeCount: 0, boundaryCount: 0, cycleCount: 0 }
    };
  }

  // Meta checks
  if (!spec.meta || typeof spec.meta !== 'object') {
    errors.push('Missing required "meta" object.');
  } else {
    if (!spec.meta.title || typeof spec.meta.title !== 'string' || spec.meta.title.trim() === '') {
      errors.push('Field "meta.title" is required and must be a non-empty string.');
    }
    if (spec.meta.flow && !['lr', 'tb'].includes(spec.meta.flow)) {
      errors.push(`Invalid "meta.flow": "${spec.meta.flow}". Expected "lr" or "tb".`);
    }
  }

  // 2. Nodes validation
  if (!Array.isArray(spec.nodes)) {
    errors.push('Field "nodes" must be an array.');
  }

  const nodes = Array.isArray(spec.nodes) ? spec.nodes : [];
  const nodeIds = new Set();
  const validStatusSet = new Set(['ok', 'warn', 'err', 'unknown']);

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (!node || typeof node !== 'object') {
      errors.push(`Node at index ${i} is not a valid object.`);
      continue;
    }

    if (!node.id || typeof node.id !== 'string' || node.id.trim() === '') {
      errors.push(`Node at index ${i} is missing a valid "id".`);
      continue;
    }

    if (nodeIds.has(node.id)) {
      errors.push(`Duplicate node id "${node.id}". Node IDs must be unique.`);
    }
    nodeIds.add(node.id);

    if (!node.title || typeof node.title !== 'string' || node.title.trim() === '') {
      errors.push(`Node "${node.id}" is missing a valid "title".`);
    }

    if (node.status && !validStatusSet.has(node.status)) {
      errors.push(`Node "${node.id}" has invalid status "${node.status}". Expected "ok", "warn", "err", or "unknown".`);
    }

    if (node.stage !== undefined && (typeof node.stage !== 'number' || node.stage < 0)) {
      errors.push(`Node "${node.id}" has invalid stage "${node.stage}". Must be a non-negative integer.`);
    }

    if (node.lane !== undefined && (typeof node.lane !== 'number' || node.lane < 0)) {
      errors.push(`Node "${node.id}" has invalid lane "${node.lane}". Must be a non-negative integer.`);
    }

    if (node.column !== undefined || node.row !== undefined) {
      errors.push(`Node "${node.id}" uses forbidden direction-dependent alias "column" or "row". Archer strictly requires "stage" and "lane".`);
    }
  }

  // 3. Boundaries validation
  const boundaries = Array.isArray(spec.boundaries) ? spec.boundaries : [];
  const boundaryIds = new Set();

  for (let i = 0; i < boundaries.length; i++) {
    const b = boundaries[i];
    if (!b || typeof b !== 'object') {
      errors.push(`Boundary at index ${i} is not a valid object.`);
      continue;
    }
    if (!b.id || typeof b.id !== 'string' || b.id.trim() === '') {
      errors.push(`Boundary at index ${i} is missing a valid "id".`);
      continue;
    }
    if (boundaryIds.has(b.id)) {
      errors.push(`Duplicate boundary id "${b.id}". Boundary IDs must be unique.`);
    }
    boundaryIds.add(b.id);

    if (!b.title || typeof b.title !== 'string') {
      errors.push(`Boundary "${b.id}" is missing a valid "title".`);
    }
  }

  // Verify node.boundary references point to existing boundaries
  const boundaryUsage = new Map();
  for (const bId of boundaryIds) {
    boundaryUsage.set(bId, 0);
  }

  for (const node of nodes) {
    if (node.boundary) {
      if (!boundaryIds.has(node.boundary)) {
        errors.push(`Node "${node.id}" references non-existent boundary "${node.boundary}".`);
      } else {
        boundaryUsage.set(node.boundary, (boundaryUsage.get(node.boundary) || 0) + 1);
      }
    }
  }

  // Warn on empty boundaries
  for (const [bId, count] of boundaryUsage.entries()) {
    if (count === 0) {
      warnings.push(`Boundary "${bId}" has no member nodes assigned to it.`);
    }
  }

  // 4. Edges validation
  if (!Array.isArray(spec.edges)) {
    errors.push('Field "edges" must be an array.');
  }

  const edges = Array.isArray(spec.edges) ? spec.edges : [];
  const connectedNodes = new Set();

  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i];
    if (!edge || typeof edge !== 'object') {
      errors.push(`Edge at index ${i} is not a valid object.`);
      continue;
    }

    if (!edge.from || typeof edge.from !== 'string') {
      errors.push(`Edge at index ${i} is missing "from" node reference.`);
    } else if (!nodeIds.has(edge.from)) {
      errors.push(`Edge at index ${i} references non-existent "from" node "${edge.from}".`);
    } else {
      connectedNodes.add(edge.from);
    }

    if (!edge.to || typeof edge.to !== 'string') {
      errors.push(`Edge at index ${i} is missing "to" node reference.`);
    } else if (!nodeIds.has(edge.to)) {
      errors.push(`Edge at index ${i} references non-existent "to" node "${edge.to}".`);
    } else {
      connectedNodes.add(edge.to);
    }
  }

  // Warn on isolated nodes
  if (nodes.length > 1) {
    for (const node of nodes) {
      if (!connectedNodes.has(node.id)) {
        warnings.push(`Node "${node.id}" is isolated (no incoming or outgoing edges).`);
      }
    }
  }

  // 5. Cycle Detection (Warning)
  let cycleCount = 0;
  if (errors.length === 0 && nodes.length > 0) {
    const cycleInfo = detectCycles(nodes, edges);
    cycleCount = cycleInfo.cycles.length;
    if (cycleInfo.hasCycles) {
      for (const cycle of cycleInfo.cycles) {
        warnings.push(`Cycle detected: ${cycle.join(' -> ')}. Back-edges will be styled with arched dashed tracks.`);
      }
    }
  }

  // 6. Geometric Boundary Overlap Detection (Warning)
  if (errors.length === 0 && boundaries.length > 1) {
    try {
      const layout = computeLayout(spec);
      const activeBoundaries = layout.boundaries.filter(b => b.bounds !== null);

      for (let i = 0; i < activeBoundaries.length; i++) {
        for (let j = i + 1; j < activeBoundaries.length; j++) {
          const b1 = activeBoundaries[i].bounds;
          const b2 = activeBoundaries[j].bounds;

          const overlapX = b1.x < b2.x + b2.width && b1.x + b1.width > b2.x;
          const overlapY = b1.y < b2.y + b2.height && b1.y + b1.height > b2.y;

          if (overlapX && overlapY) {
            warnings.push(`Geometric overlap detected between boundary "${activeBoundaries[i].id}" and "${activeBoundaries[j].id}".`);
          }
        }
      }
    } catch {
      // Ignore layout errors during post-layout check
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    stats: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      boundaryCount: boundaries.length,
      cycleCount
    }
  };
}
