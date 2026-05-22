export interface ObjectTypeRef {
  type: string;
  object_type: string;
}

export interface ConstraintLabel {
  each: ObjectTypeRef[];
  any: ObjectTypeRef[];
  all: ObjectTypeRef[];
}

export interface RawConstraint {
  from: string;
  to: string;
  arc_type: "EP" | "EF" | "AS" | "DF" | "DP";
  counts: [number, number | null];
  label: ConstraintLabel;
}

export type ActivityNodeData = {
  label: string;
  objectTypes: { name: string; multi: boolean }[];
  [key: string]: unknown;
};

export type EdgeRoutingMode = "SPLINES" | "POLYLINE";

export type QuantifierMode = "text" | "multi";

export type ConstraintEdgeData = {
  arcType: "EP" | "EF" | "AS" | "DF" | "DP";
  counts: [number, number | null];
  label: ConstraintLabel;
  bundleIndex: number;
  bundleTotal: number;
  constraintIndex: number;
  // ELK-computed route
  routedPath?: string;
  routedPoints?: { x: number; y: number }[];
  // Node positions at layout time (to detect drag and deform path)
  layoutSourcePos?: { x: number; y: number };
  layoutTargetPos?: { x: number; y: number };
  [key: string]: unknown;
};

// Curated color palette — cycles for any number of object types
const COLOR_PALETTE = [
  "#2563EB", // blue
  "#16A34A", // green
  "#9333EA", // purple
  "#EA580C", // orange
  "#DC2626", // red
  "#0891B2", // cyan
  "#D97706", // amber
  "#7C3AED", // violet
  "#059669", // emerald
  "#E11D48", // rose
  "#4F46E5", // indigo
  "#CA8A04", // yellow
];

// Hardcoded colors matching LaTeX dvipsnames for the paper's object types
const HARDCODED_COLORS: Record<string, string> = {
  customers: "#379908", // OliveGreen
  orders: "#1370bd",    // NavyBlue
  items: "#ff5f37",     // RedOrange
  employees: "#fb3699", // Magenta
};

/**
 * Generate a color map for all object types found in the given constraints.
 * Uses hardcoded colors for known types, falls back to palette for others.
 */
export function generateObjectTypeColors(
  constraints: RawConstraint[]
): Record<string, string> {
  const seen = new Set<string>();
  for (const c of constraints) {
    for (const refs of [c.label.each, c.label.any, c.label.all]) {
      for (const ref of refs) {
        seen.add(ref.object_type);
      }
    }
  }
  return generateObjectTypeColorsFromNames(Array.from(seen));
}

/**
 * Generate a color map from an explicit list of object type names.
 * Uses hardcoded colors for known types, falls back to palette for others.
 */
export function generateObjectTypeColorsFromNames(
  names: string[]
): Record<string, string> {
  const sorted = [...names].sort((a, b) => a.localeCompare(b));
  const colors: Record<string, string> = {};
  let paletteIdx = 0;
  for (const name of sorted) {
    if (HARDCODED_COLORS[name]) {
      colors[name] = HARDCODED_COLORS[name];
    } else {
      colors[name] = COLOR_PALETTE[paletteIdx % COLOR_PALETTE.length];
      paletteIdx++;
    }
  }
  return colors;
}
