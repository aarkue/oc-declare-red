import type { Edge, Node } from "@xyflow/react";
import ELK, {
	type ElkExtendedEdge,
	type ElkNode,
} from "elkjs/lib/elk.bundled.js";
import type { ConstraintEdgeData, EdgeRoutingMode } from "../types";

const elk = new ELK();

const NODE_WIDTH = 130;
const NODE_HEIGHT = 55;

type Point = { x: number; y: number };

interface ElkSection {
	startPoint: Point;
	bendPoints?: Point[];
	endPoint: Point;
}

/**
 * Extract ordered points from an ELK section.
 */
function sectionToPoints(section: ElkSection): Point[] {
	return [section.startPoint, ...(section.bendPoints ?? []), section.endPoint];
}

/**
 * Build an SVG path `d` attribute from a sequence of points.
 * Groups into cubic Bezier segments (triples of control points).
 */
function pointsToSvgPath(points: Point[]): string {
	let d = `M${points[0].x},${points[0].y}`;
	let i = 1;
	while (i < points.length) {
		const remaining = points.length - i;
		if (remaining >= 3) {
			d += ` C${points[i].x},${points[i].y} ${points[i + 1].x},${points[i + 1].y} ${points[i + 2].x},${points[i + 2].y}`;
			i += 3;
		} else if (remaining === 2) {
			d += ` Q${points[i].x},${points[i].y} ${points[i + 1].x},${points[i + 1].y}`;
			i += 2;
		} else {
			d += ` L${points[i].x},${points[i].y}`;
			i += 1;
		}
	}
	return d;
}

/**
 * Compute where a line from `center` towards `towards` exits a rectangle.
 */
function rectBorderPoint(
	center: Point,
	halfW: number,
	halfH: number,
	towards: Point,
): Point {
	const dx = towards.x - center.x;
	const dy = towards.y - center.y;
	if (dx === 0 && dy === 0) return { x: center.x + halfW, y: center.y };

	const absDx = Math.abs(dx);
	const absDy = Math.abs(dy);

	if (absDx * halfH > absDy * halfW) {
		const sx = Math.sign(dx);
		return { x: center.x + sx * halfW, y: center.y + (dy / absDx) * halfW };
	} else {
		const sy = Math.sign(dy);
		return { x: center.x + (dx / absDy) * halfH, y: center.y + sy * halfH };
	}
}

/**
 * Extend/clip the first and last points of an ELK path so they touch the
 * actual node border. ELK SPLINES often leave a gap due to edgeNode spacing.
 */
function snapEndpointsToNodeBorders(
	points: Point[],
	sourceCenter: Point,
	targetCenter: Point,
	halfW: number,
	halfH: number,
): Point[] {
	if (points.length < 2) return points;

	const result = [...points];

	// Snap start point: project from source center towards the second point
	const towardsStart = points[1];
	result[0] = rectBorderPoint(sourceCenter, halfW, halfH, towardsStart);

	// Snap end point: project from target center towards the second-to-last point
	const last = points.length - 1;
	const towardsEnd = points[last - 1];
	result[last] = rectBorderPoint(targetCenter, halfW, halfH, towardsEnd);

	return result;
}

/**
 * Deform points by applying a linear blend of source/target displacement.
 * Points near the source shift with the source delta, points near the target
 * shift with the target delta.
 */
function deformPoints(
	points: Point[],
	sourceDelta: Point,
	targetDelta: Point,
): Point[] {
	const n = points.length - 1;
	if (n <= 0) return points;
	return points.map((p, i) => {
		const t = i / n;
		return {
			x: p.x + (1 - t) * sourceDelta.x + t * targetDelta.x,
			y: p.y + (1 - t) * sourceDelta.y + t * targetDelta.y,
		};
	});
}

export async function computeElkLayout<T extends Node>(
	nodes: T[],
	edges: Edge[],
	options?: {
		direction?: "RIGHT" | "DOWN";
		edgeRouting?: EdgeRoutingMode;
		preservePositions?: boolean;
	},
): Promise<{ nodes: T[]; edges: Edge[] }> {
	const direction = options?.direction ?? "RIGHT";
	const edgeRouting = options?.edgeRouting ?? "SPLINES";
	const preservePositions = options?.preservePositions ?? false;

	// Store input positions for drift correction when preserving positions
	const inputPositions = new Map<string, Point>();
	if (preservePositions) {
		for (const n of nodes) {
			inputPositions.set(n.id, { x: n.position.x, y: n.position.y });
		}
	}

	const layoutOptions: Record<string, string> = {
		"elk.algorithm": "layered",
		"elk.direction": direction,
		"elk.spacing.nodeNode": "20",
		"elk.layered.spacing.nodeNodeBetweenLayers": "10",
		"elk.spacing.edgeNode": "20",
		"elk.spacing.edgeEdge": "25",
		"elk.layered.spacing.edgeEdgeBetweenLayers": "10",
		"elk.layered.spacing.edgeNodeBetweenLayers": "20",
		"elk.edgeRouting": edgeRouting,
		"elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
		"elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
	};

	const elkGraph: ElkNode = {
		id: "root",
		layoutOptions,
		children: nodes.map((n) => ({
			id: n.id,
			width: NODE_WIDTH,
			height: NODE_HEIGHT,
			...(preservePositions ? { x: n.position.x, y: n.position.y } : {}),
		})),
		// For EP edges, reverse source/target so ELK follows temporal order.
		edges: edges.map((e) => {
			const data = e.data as ConstraintEdgeData;
			const isEP = data?.arcType === "EP";
			const shouldReverse = isEP && !preservePositions;

			// Build combined label text matching the chip format: "∀orders ALL(items)"
			const groups = (["each", "any", "all"] as const)
				.map((q) => ({
					quantifier: q,
					refs: [...(q === "each" ? data.label.each : q === "any" ? data.label.any : data.label.all)],
				}))
				.filter((g) => g.refs.length > 0);
			const labelText = groups
				.map((g) => {
					const names = g.refs.map((r) => r.object_type).join(", ");
					return g.quantifier === "each" ? `∀${names}` : `${g.quantifier.toUpperCase()}(${names})`;
				})
				.join("  ");
			const labelWidth = Math.max(20, labelText.length * 7);
			const labelHeight = 14;

			return {
				id: e.id,
				sources: [shouldReverse ? e.target : e.source],
				targets: [shouldReverse ? e.source : e.target],
				labels: labelText.trim()
					? [
							{
								id: `${e.id}-label`,
								text: labelText.trim(),
								width: labelWidth,
								height: labelHeight,
								layoutOptions: {
									"elk.edgeLabels.placement": "CENTER",
								},
							},
						]
					: [],
			};
		}) as ElkExtendedEdge[],
	};

	const layouted = await elk.layout(elkGraph);

	// Build a lookup for ELK's output positions
	const elkPositions = new Map<string, Point>();
	const elkCenters = new Map<string, Point>();
	for (const elkNode of layouted.children ?? []) {
		const pos = { x: elkNode.x ?? 0, y: elkNode.y ?? 0 };
		elkPositions.set(elkNode.id, pos);
		elkCenters.set(elkNode.id, {
			x: pos.x + (elkNode.width ?? NODE_WIDTH) / 2,
			y: pos.y + (elkNode.height ?? NODE_HEIGHT) / 2,
		});
	}

	// For preservePositions mode, we use the INPUT positions (not ELK's output)
	// as the canonical positions, since we don't want nodes to move.
	const canonicalPositions = preservePositions ? inputPositions : elkPositions;
	const canonicalCenters = new Map<string, Point>();
	for (const [id, pos] of canonicalPositions) {
		canonicalCenters.set(id, {
			x: pos.x + NODE_WIDTH / 2,
			y: pos.y + NODE_HEIGHT / 2,
		});
	}

	const layoutedNodes = nodes.map((node): T => {
		const pos = canonicalPositions.get(node.id);
		return {
			...node,
			position: {
				x: pos?.x ?? node.position.x,
				y: pos?.y ?? node.position.y,
			},
		};
	});

	const halfW = NODE_WIDTH / 2;
	const halfH = NODE_HEIGHT / 2;

	const layoutedEdges = edges.map((edge): Edge => {
		const elkEdge = layouted.edges?.find((e) => e.id === edge.id);
		const section = elkEdge?.sections?.[0];
		const isEP =
			(edge.data as ConstraintEdgeData | undefined)?.arcType === "EP";

		const canonSrcPos = canonicalPositions.get(edge.source) ?? { x: 0, y: 0 };
		const canonTgtPos = canonicalPositions.get(edge.target) ?? { x: 0, y: 0 };
		const canonSrcCenter = canonicalCenters.get(edge.source) ?? {
			x: halfW,
			y: halfH,
		};
		const canonTgtCenter = canonicalCenters.get(edge.target) ?? {
			x: halfW,
			y: halfH,
		};

		if (section) {
			let points = sectionToPoints(section);
			// Reverse for EP edges that had source/target swapped for ELK
			const wasReversed = isEP && !preservePositions;
			if (wasReversed) {
				points = [...points].reverse();
			}

			// Snap endpoints to actual node borders (fixes gaps)
			points = snapEndpointsToNodeBorders(
				points,
				canonSrcCenter,
				canonTgtCenter,
				halfW,
				halfH,
			);

			const routedPath = pointsToSvgPath(points);

			return {
				...edge,
				data: {
					...edge.data,
					routedPath,
					routedPoints: points,
					layoutSourcePos: canonSrcPos,
					layoutTargetPos: canonTgtPos,
				},
			};
		}

		return {
			...edge,
			data: {
				...edge.data,
				layoutSourcePos: canonSrcPos,
				layoutTargetPos: canonTgtPos,
			},
		};
	});

	return { nodes: layoutedNodes, edges: layoutedEdges };
}

export { NODE_WIDTH, NODE_HEIGHT };

/**
 * Re-snap edges connected to a moved node without running ELK.
 * Deforms the stored ELK path using the node displacement, then recalculates
 * endpoints to snap to the correct node borders.
 */
export function resnapEdges(edges: Edge[], nodes: Node[]): Edge[] {
	const halfW = NODE_WIDTH / 2;
	const halfH = NODE_HEIGHT / 2;

	// Build a position lookup
	const nodePos = new Map<string, Point>();
	const nodeCenter = new Map<string, Point>();
	for (const n of nodes) {
		nodePos.set(n.id, { x: n.position.x, y: n.position.y });
		nodeCenter.set(n.id, {
			x: n.position.x + halfW,
			y: n.position.y + halfH,
		});
	}

	return edges.map((edge): Edge => {
		const edgeData = edge.data as ConstraintEdgeData | undefined;
		if (
			!edgeData?.routedPoints ||
			!edgeData.layoutSourcePos ||
			!edgeData.layoutTargetPos
		) {
			return edge;
		}

		const curSrcPos = nodePos.get(edge.source);
		const curTgtPos = nodePos.get(edge.target);
		const curSrcCenter = nodeCenter.get(edge.source);
		const curTgtCenter = nodeCenter.get(edge.target);
		if (!curSrcPos || !curTgtPos || !curSrcCenter || !curTgtCenter) return edge;

		// Compute displacement from layout positions
		const srcDelta = {
			x: curSrcPos.x - edgeData.layoutSourcePos.x,
			y: curSrcPos.y - edgeData.layoutSourcePos.y,
		};
		const tgtDelta = {
			x: curTgtPos.x - edgeData.layoutTargetPos.x,
			y: curTgtPos.y - edgeData.layoutTargetPos.y,
		};

		// Deform points with the displacement
		let points = deformPoints(edgeData.routedPoints, srcDelta, tgtDelta);

		// Re-snap endpoints to node borders based on current positions
		points = snapEndpointsToNodeBorders(
			points,
			curSrcCenter,
			curTgtCenter,
			halfW,
			halfH,
		);

		const routedPath = pointsToSvgPath(points);

		return {
			...edge,
			data: {
				...edgeData,
				routedPath,
				routedPoints: points,
				layoutSourcePos: curSrcPos,
				layoutTargetPos: curTgtPos,
			},
		};
	});
}
