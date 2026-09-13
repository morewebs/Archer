/**
 * Archer Graph Theory & Path Engine
 * Shared pure graph algorithms: DAG staging, cycle detection, edge classification, and BFS path tracing.
 * Testable in Node.js and inlined for browser runtime.
 */

/**
 * Builds adjacency maps for graph nodes and edges
 */
export function buildAdjacency(nodes, edges) {
  const outgoing = new Map();
  const incoming = new Map();
  const nodeMap = new Map();

  for (const node of nodes) {
    nodeMap.set(node.id, node);
    outgoing.set(node.id, []);
    incoming.set(node.id, []);
  }

  for (const edge of edges) {
    if (outgoing.has(edge.from)) {
      outgoing.get(edge.from).push(edge);
    }
    if (incoming.has(edge.to)) {
      incoming.get(edge.to).push(edge);
    }
  }

  return { outgoing, incoming, nodeMap };
}

/**
 * Detects cycles in the directed graph using DFS cycle coloring (0=unvisited, 1=visiting, 2=visited).
 * Returns detected cycle paths and back-edges.
 */
export function detectCycles(nodes, edges) {
  const { outgoing } = buildAdjacency(nodes, edges);
  const state = new Map(); // 0: unvisited, 1: visiting, 2: visited
  const cycleEdges = [];
  const cycles = [];
  const path = [];

  for (const node of nodes) {
    state.set(node.id, 0);
  }

  function dfs(nodeId) {
    state.set(nodeId, 1);
    path.push(nodeId);

    const edgesOut = outgoing.get(nodeId) || [];
    for (const edge of edgesOut) {
      const neighbor = edge.to;
      const neighborState = state.get(neighbor);

      if (neighborState === 1) {
        // Found cycle!
        cycleEdges.push(edge);
        const cycleStartIndex = path.indexOf(neighbor);
        if (cycleStartIndex !== -1) {
          cycles.push([...path.slice(cycleStartIndex), neighbor]);
        }
      } else if (neighborState === 0) {
        dfs(neighbor);
      }
    }

    path.pop();
    state.set(nodeId, 2);
  }

  for (const node of nodes) {
    if (state.get(node.id) === 0) {
      dfs(node.id);
    }
  }

  return {
    hasCycles: cycleEdges.length > 0,
    cycleEdges,
    cycles
  };
}

/**
 * Assigns stages and lanes to nodes deterministically.
 * Rules (Patches 1, 3, 4):
 * - Explicit stages are strictly respected.
 * - Auto stages use longest-path DAG staging clamped against explicit neighbor stages.
 * - Back and lateral edges are excluded from forward DAG stage assignment.
 * - Auto lanes are assigned deterministically (packing order by input array index).
 */
export function computeStagesAndLanes(nodes, edges) {
  const { outgoing, incoming, nodeMap } = buildAdjacency(nodes, edges);
  const { cycleEdges } = detectCycles(nodes, edges);
  const cycleEdgeSet = new Set(cycleEdges);

  // Initialize stage assignments
  const stages = new Map();
  for (const node of nodes) {
    if (typeof node.stage === 'number' && node.stage >= 0) {
      stages.set(node.id, Math.floor(node.stage));
    }
  }

  // Iterative longest-path forward DAG staging for unassigned nodes
  let changed = true;
  let iterations = 0;
  const maxIterations = nodes.length * 2;

  while (changed && iterations < maxIterations) {
    changed = false;
    iterations++;

    for (const node of nodes) {
      if (typeof node.stage === 'number' && node.stage >= 0) continue;

      const incEdges = (incoming.get(node.id) || []).filter(e => !cycleEdgeSet.has(e));
      let candidateStage = 0;

      for (const edge of incEdges) {
        const srcStage = stages.get(edge.from);
        if (typeof srcStage === 'number') {
          candidateStage = Math.max(candidateStage, srcStage + 1);
        }
      }

      // Clamp against explicit successor stages if present
      const outEdges = (outgoing.get(node.id) || []).filter(e => !cycleEdgeSet.has(e));
      for (const edge of outEdges) {
        const dstNode = nodeMap.get(edge.to);
        if (dstNode && typeof dstNode.stage === 'number' && dstNode.stage >= 0) {
          candidateStage = Math.min(candidateStage, Math.max(0, dstNode.stage - 1));
        }
      }

      const prevStage = stages.get(node.id);
      if (prevStage !== candidateStage) {
        stages.set(node.id, candidateStage);
        changed = true;
      }
    }
  }

  // Ensure every node has a stage (fallback to 0)
  for (const node of nodes) {
    if (!stages.has(node.id)) {
      stages.set(node.id, 0);
    }
  }

  // Group nodes by stage to pack lanes deterministically
  const stageGroups = new Map();
  for (const node of nodes) {
    const s = stages.get(node.id);
    if (!stageGroups.has(s)) stageGroups.set(s, []);
    stageGroups.get(s).push(node);
  }

  const lanes = new Map();
  const sortedStageKeys = Array.from(stageGroups.keys()).sort((a, b) => a - b);

  for (const s of sortedStageKeys) {
    const group = stageGroups.get(s);
    const usedLanes = new Set();

    // First preserve explicit lanes
    for (const node of group) {
      if (typeof node.lane === 'number' && node.lane >= 0) {
        const explicitLane = Math.floor(node.lane);
        lanes.set(node.id, explicitLane);
        usedLanes.add(explicitLane);
      }
    }

    // Then pack unassigned nodes in deterministic array order
    let nextAvailableLane = 0;
    for (const node of group) {
      if (lanes.has(node.id)) continue;
      while (usedLanes.has(nextAvailableLane)) {
        nextAvailableLane++;
      }
      lanes.set(node.id, nextAvailableLane);
      usedLanes.add(nextAvailableLane);
      nextAvailableLane++;
    }
  }

  return { stages, lanes };
}

/**
 * Classifies edges into three distinct classes (Patch 3):
 * - forward: target.stage > source.stage
 * - lateral: target.stage === source.stage
 * - back: target.stage < source.stage
 */
export function classifyEdges(nodes, edges, stages) {
  const edgeClassifications = new Map();

  for (const edge of edges) {
    const srcStage = stages.get(edge.from) ?? 0;
    const dstStage = stages.get(edge.to) ?? 0;

    let edgeClass;
    if (dstStage > srcStage) {
      edgeClass = 'forward';
    } else if (dstStage === srcStage) {
      edgeClass = 'lateral';
    } else {
      edgeClass = 'back';
    }

    edgeClassifications.set(edge, edgeClass);
  }

  return edgeClassifications;
}

/**
 * Trace upstream and downstream paths from a selected starting node.
 * Used for interactive path tracing in the browser and graph testing.
 */
export function tracePaths(startNodeId, nodes, edges) {
  const { outgoing, incoming } = buildAdjacency(nodes, edges);

  const activeNodes = new Set([startNodeId]);
  const activeEdges = new Set();
  const upstreamNodes = new Set();
  const downstreamNodes = new Set();

  // Upstream BFS (ancestors)
  const upQueue = [startNodeId];
  while (upQueue.length > 0) {
    const curr = upQueue.shift();
    const inc = incoming.get(curr) || [];
    for (const edge of inc) {
      activeEdges.add(`${edge.from}->${edge.to}`);
      if (!activeNodes.has(edge.from)) {
        activeNodes.add(edge.from);
        upstreamNodes.add(edge.from);
        upQueue.push(edge.from);
      }
    }
  }

  // Downstream BFS (descendants)
  const downQueue = [startNodeId];
  while (downQueue.length > 0) {
    const curr = downQueue.shift();
    const out = outgoing.get(curr) || [];
    for (const edge of out) {
      activeEdges.add(`${edge.from}->${edge.to}`);
      if (!activeNodes.has(edge.to)) {
        activeNodes.add(edge.to);
        downstreamNodes.add(edge.to);
        downQueue.push(edge.to);
      }
    }
  }

  return {
    startNodeId,
    activeNodes,
    activeEdges,
    upstreamNodes,
    downstreamNodes
  };
}
