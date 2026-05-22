import type { Node, Edge } from "@xyflow/react";
import type { RawConstraint, ActivityNodeData, ConstraintEdgeData } from "../types";

export function parseConstraints(
  raw: RawConstraint[],
  extraActivities?: string[]
): {
  nodes: Node<ActivityNodeData>[];
  edges: Edge<ConstraintEdgeData>[];
} {
  // 1. Collect unique activities
  const activitySet = new Set<string>();
  raw.forEach((c) => {
    activitySet.add(c.from);
    activitySet.add(c.to);
  });

  // Add extra activities (nodes without constraints)
  if (extraActivities) {
    for (const a of extraActivities) {
      activitySet.add(a);
    }
  }

  // 2. Infer object type involvement per activity
  const activityObjects = new Map<string, Map<string, { multi: boolean }>>();
  for (const activity of activitySet) {
    activityObjects.set(activity, new Map());
  }

  for (const c of raw) {
    const srcMap = activityObjects.get(c.from)!;
    const tgtMap = activityObjects.get(c.to)!;

    // EACH: both source and target involve one object of this type
    for (const ref of c.label.each) {
      if (!srcMap.has(ref.object_type)) srcMap.set(ref.object_type, { multi: false });
      if (!tgtMap.has(ref.object_type)) tgtMap.set(ref.object_type, { multi: false });
    }
    // ANY: source involves multiple, target just involved
    for (const ref of c.label.any) {
      srcMap.set(ref.object_type, { multi: true });
      if (!tgtMap.has(ref.object_type)) tgtMap.set(ref.object_type, { multi: false });
    }
    // ALL: both source and target involve multiple
    for (const ref of c.label.all) {
      srcMap.set(ref.object_type, { multi: true });
      tgtMap.set(ref.object_type, { multi: true });
    }
  }

  // 3. Create nodes (positions will be set by layout)
  const nodes: Node<ActivityNodeData>[] = [...activitySet].map((activity) => ({
    id: activity,
    type: "activity",
    position: { x: 0, y: 0 },
    data: {
      label: activity,
      objectTypes: [...activityObjects.get(activity)!.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([name, { multi }]) => ({ name, multi })),
    },
  }));

  // 4. Create edges with bundle offsets for overlapping pairs
  const pairCounts = new Map<string, number>();
  const edges = raw.map((c, i): Edge<ConstraintEdgeData> => {
    const key = [c.from, c.to].sort().join("||");
    const idx = pairCounts.get(key) ?? 0;
    pairCounts.set(key, idx + 1);
    return {
      id: `e-${i}`,
      source: c.from,
      target: c.to,
      type: "constraint",
      data: {
        arcType: c.arc_type,
        counts: c.counts,
        label: c.label,
        bundleIndex: idx,
        bundleTotal: 0, // filled in second pass
        constraintIndex: i,
      },
    };
  });

  // Second pass: fill bundleTotal
  for (const edge of edges) {
    const key = [edge.source, edge.target].sort().join("||");
    edge.data!.bundleTotal = pairCounts.get(key) ?? 1;
  }

  return { nodes, edges };
}
