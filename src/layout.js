/**
 * Archer Deterministic Layout & Geometry Engine
 * Implements the authoritative node-side geometry contract, stage/lane coordinate mapping,
 * boundary container enclosure, port fan-out spreading, and cubic Bezier curve generation.
 */

import { computeStagesAndLanes, classifyEdges } from './graph.js';

export const CARD_WIDTH = 310;
export const BASE_HEIGHT = 88;
export const ALERT_HEIGHT = 38;
export const ROW_HEIGHT = 22;

export const GAP_X = 240;
export const GAP_Y = 60;
export const MARGIN_X = 80;
export const MARGIN_Y = 120;

export const BOUNDARY_PAD_X = 40;
export const BOUNDARY_PAD_TOP = 52;
export const BOUNDARY_PAD_BOTTOM = 36;

/**
 * Calculates deterministic card height based on content
 */
export function computeCardHeight(node) {
  const hasAlert = Boolean(node.alert && node.alert.trim().length > 0);
  const detailCount = Array.isArray(node.details) ? node.details.length : 0;
  return BASE_HEIGHT + (hasAlert ? ALERT_HEIGHT : 0) + (detailCount * ROW_HEIGHT);
}

/**
 * Computes full geometry: positions for nodes, boundaries, port coordinates, and edge SVG paths.
 */
export function computeLayout(spec) {
  const flow = spec.meta?.flow === 'tb' ? 'tb' : 'lr';
  const rawNodes = spec.nodes || [];
  const rawEdges = spec.edges || [];
  const rawBoundaries = spec.boundaries || [];

  // 1. Stage and Lane assignment
  const { stages, lanes } = computeStagesAndLanes(rawNodes, rawEdges);
  const edgeClassifications = classifyEdges(rawNodes, rawEdges, stages);

  // 2. Precompute node heights and group by stage
  const nodeHeights = new Map();
  for (const node of rawNodes) {
    nodeHeights.set(node.id, computeCardHeight(node));
  }

  // Calculate layout coordinates
  const nodePositions = new Map();

  if (flow === 'lr') {
    // Stage is X axis, Lane is Y axis
    // Calculate cumulative Y for each lane within each stage
    const stageGroups = new Map();
    for (const node of rawNodes) {
      const s = stages.get(node.id);
      if (!stageGroups.has(s)) stageGroups.set(s, []);
      stageGroups.get(s).push(node);
    }

    for (const [stageIdx, group] of stageGroups.entries()) {
      group.sort((a, b) => (lanes.get(a.id) ?? 0) - (lanes.get(b.id) ?? 0));
      let currentY = MARGIN_Y;

      for (const node of group) {
        if (typeof node.x === 'number' && typeof node.y === 'number') {
          nodePositions.set(node.id, { x: node.x, y: node.y });
        } else {
          const x = MARGIN_X + stageIdx * (CARD_WIDTH + GAP_X);
          const y = currentY;
          nodePositions.set(node.id, { x, y });
          currentY += (nodeHeights.get(node.id) || BASE_HEIGHT) + GAP_Y;
        }
      }
    }
  } else {
    // Flow is 'tb' (Top-to-Bottom)
    // Stage is Y axis, Lane is X axis
    const stageGroups = new Map();
    for (const node of rawNodes) {
      const s = stages.get(node.id);
      if (!stageGroups.has(s)) stageGroups.set(s, []);
      stageGroups.get(s).push(node);
    }

    let currentY = MARGIN_Y;
    const sortedStages = Array.from(stageGroups.keys()).sort((a, b) => a - b);

    for (const s of sortedStages) {
      const group = stageGroups.get(s);
      group.sort((a, b) => (lanes.get(a.id) ?? 0) - (lanes.get(b.id) ?? 0));
      let maxHeightInStage = 0;

      for (const node of group) {
        const h = nodeHeights.get(node.id) || BASE_HEIGHT;
        maxHeightInStage = Math.max(maxHeightInStage, h);

        if (typeof node.x === 'number' && typeof node.y === 'number') {
          nodePositions.set(node.id, { x: node.x, y: node.y });
        } else {
          const laneIdx = lanes.get(node.id) ?? 0;
          const x = MARGIN_X + laneIdx * (CARD_WIDTH + GAP_X);
          const y = currentY;
          nodePositions.set(node.id, { x, y });
        }
      }
      currentY += maxHeightInStage + GAP_Y + 40;
    }
  }

  // Enrich nodes with computed geometry
  const enrichedNodes = rawNodes.map(node => {
    const pos = nodePositions.get(node.id) || { x: MARGIN_X, y: MARGIN_Y };
    const height = nodeHeights.get(node.id) || BASE_HEIGHT;
    const stage = stages.get(node.id) ?? 0;
    const lane = lanes.get(node.id) ?? 0;

    return {
      ...node,
      x: pos.x,
      y: pos.y,
      width: CARD_WIDTH,
      height,
      stage,
      lane,
      status: node.status || 'ok',
      hasInput: node.hasInput !== false,
      hasOutput: node.hasOutput !== false
    };
  });

  const enrichedNodeMap = new Map(enrichedNodes.map(n => [n.id, n]));

  // 3. Compute Boundaries (Enclosing frames from nodes[].boundary)
  const boundaryMembership = new Map();
  for (const b of rawBoundaries) {
    boundaryMembership.set(b.id, []);
  }

  for (const node of enrichedNodes) {
    if (node.boundary && boundaryMembership.has(node.boundary)) {
      boundaryMembership.get(node.boundary).push(node);
    }
  }

  const enrichedBoundaries = rawBoundaries.map(b => {
    const members = boundaryMembership.get(b.id) || [];
    if (members.length === 0) {
      return {
        ...b,
        memberCount: 0,
        bounds: null
      };
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const m of members) {
      if (m.x < minX) minX = m.x;
      if (m.y < minY) minY = m.y;
      if (m.x + m.width > maxX) maxX = m.x + m.width;
      if (m.y + m.height > maxY) maxY = m.y + m.height;
    }

    const bounds = {
      x: minX - BOUNDARY_PAD_X,
      y: minY - BOUNDARY_PAD_TOP,
      width: (maxX - minX) + (2 * BOUNDARY_PAD_X),
      height: (maxY - minY) + BOUNDARY_PAD_TOP + BOUNDARY_PAD_BOTTOM
    };

    return {
      ...b,
      memberCount: members.length,
      bounds
    };
  });

  // 4. Port Fan-Out Spreading & Edge Path Math
  // Count edges connected to each node side to distribute ports
  const nodeOutgoingEdges = new Map();
  const nodeIncomingEdges = new Map();

  for (const edge of rawEdges) {
    if (!nodeOutgoingEdges.has(edge.from)) nodeOutgoingEdges.set(edge.from, []);
    nodeOutgoingEdges.get(edge.from).push(edge);

    if (!nodeIncomingEdges.has(edge.to)) nodeIncomingEdges.set(edge.to, []);
    nodeIncomingEdges.get(edge.to).push(edge);
  }

  const enrichedEdges = rawEdges.map(edge => {
    const src = enrichedNodeMap.get(edge.from);
    const dst = enrichedNodeMap.get(edge.to);
    const edgeClass = edgeClassifications.get(edge) || 'forward';

    if (!src || !dst) {
      return { ...edge, valid: false, edgeClass };
    }

    // Determine port coordinates with fan-out distribution
    let sx, sy, tx, ty, pathData;

    if (flow === 'lr') {
      if (edgeClass === 'forward') {
        const outList = nodeOutgoingEdges.get(edge.from) || [];
        const outIdx = Math.max(0, outList.indexOf(edge));
        const inList = nodeIncomingEdges.get(edge.to) || [];
        const inIdx = Math.max(0, inList.indexOf(edge));

        const syOffset = outList.length > 1 ? 42 + ((outIdx - (outList.length - 1) / 2) * 14) : 42;
        const tyOffset = inList.length > 1 ? 42 + ((inIdx - (inList.length - 1) / 2) * 14) : 42;

        sx = src.x + CARD_WIDTH;
        sy = src.y + syOffset;
        tx = dst.x;
        ty = dst.y + tyOffset;

        const dx = Math.max(70, Math.abs(tx - sx) * 0.52);
        pathData = `M ${sx} ${sy} C ${sx + dx} ${sy}, ${tx - dx} ${ty}, ${tx} ${ty}`;
      } else if (edgeClass === 'lateral') {
        // Same stage lateral edge: loop out through the inter-column gap
        sx = src.x + CARD_WIDTH;
        sy = src.y + 42;
        tx = dst.x + CARD_WIDTH;
        ty = dst.y + 42;

        const loopOffset = 50;
        pathData = `M ${sx} ${sy} C ${sx + loopOffset} ${sy}, ${tx + loopOffset} ${ty}, ${tx} ${ty}`;
      } else {
        // Back edge: Arched track overhead
        sx = src.x + (CARD_WIDTH / 2);
        sy = src.y;
        tx = dst.x + (CARD_WIDTH / 2);
        ty = dst.y;

        const archHeight = Math.max(60, Math.abs(sx - tx) * 0.18);
        pathData = `M ${sx} ${sy} C ${sx} ${sy - archHeight}, ${tx} ${ty - archHeight}, ${tx} ${ty}`;
      }
    } else {
      // Flow is 'tb' (Top-to-Bottom)
      if (edgeClass === 'forward') {
        const outList = nodeOutgoingEdges.get(edge.from) || [];
        const outIdx = Math.max(0, outList.indexOf(edge));
        const outCount = outList.length;

        sx = src.x + (CARD_WIDTH / 2) + ((outIdx - (outCount - 1) / 2) * 16);
        sy = src.y + src.height;

        const inList = nodeIncomingEdges.get(edge.to) || [];
        const inIdx = Math.max(0, inList.indexOf(edge));
        const inCount = inList.length;

        tx = dst.x + (CARD_WIDTH / 2) + ((inIdx - (inCount - 1) / 2) * 16);
        ty = dst.y;

        const dy = Math.max(60, Math.abs(ty - sy) * 0.52);
        pathData = `M ${sx} ${sy} C ${sx} ${sy + dy}, ${tx} ${ty - dy}, ${tx} ${ty}`;
      } else if (edgeClass === 'lateral') {
        // Lateral in tb: arc out on right side
        sx = src.x + CARD_WIDTH;
        sy = src.y + (src.height / 2);
        tx = dst.x;
        ty = dst.y + (dst.height / 2);

        const dx = 60;
        pathData = `M ${sx} ${sy} C ${sx + dx} ${sy}, ${tx - dx} ${ty}, ${tx} ${ty}`;
      } else {
        // Back edge in tb: arc around left side
        sx = src.x;
        sy = src.y + (src.height / 2);
        tx = dst.x;
        ty = dst.y + (dst.height / 2);

        const archWidth = Math.max(60, Math.abs(sy - ty) * 0.2);
        pathData = `M ${sx} ${sy} C ${sx - archWidth} ${sy}, ${tx - archWidth} ${ty}, ${tx} ${ty}`;
      }
    }

    const midX = (sx + tx) / 2;
    const midY = (sy + ty) / 2;

    return {
      ...edge,
      valid: true,
      edgeClass,
      dashed: edge.dashed !== undefined ? edge.dashed : (edgeClass === 'back'),
      sx,
      sy,
      tx,
      ty,
      midX,
      midY,
      pathData
    };
  });

  // Calculate overall world bounding box
  let worldWidth = 3200;
  let worldHeight = 2400;

  for (const n of enrichedNodes) {
    if (n.x + n.width + 200 > worldWidth) worldWidth = n.x + n.width + 200;
    if (n.y + n.height + 200 > worldHeight) worldHeight = n.y + n.height + 200;
  }
  for (const b of enrichedBoundaries) {
    if (b.bounds) {
      if (b.bounds.x + b.bounds.width + 200 > worldWidth) worldWidth = b.bounds.x + b.bounds.width + 200;
      if (b.bounds.y + b.bounds.height + 200 > worldHeight) worldHeight = b.bounds.y + b.bounds.height + 200;
    }
  }

  return {
    meta: {
      ...spec.meta,
      flow,
      theme: spec.meta?.theme || 'dark',
      animated: spec.meta?.animated !== false
    },
    nodes: enrichedNodes,
    boundaries: enrichedBoundaries,
    edges: enrichedEdges,
    world: {
      width: Math.ceil(worldWidth),
      height: Math.ceil(worldHeight)
    }
  };
}
