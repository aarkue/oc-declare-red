import {
	type Edge,
	EdgeLabelRenderer,
	type EdgeProps,
	useInternalNode,
} from "@xyflow/react";
import { useEffect, useRef, useState } from "react";
import { NODE_HEIGHT, NODE_WIDTH } from "../layout/elkLayout";
import type { ConstraintEdgeData } from "../types";
import { useVizContext } from "../VizContext";
import { type DotInfo, MultiDot } from "./MultiDots";

type ConstraintEdgeType = Edge<ConstraintEdgeData, "constraint">;

type Point = { x: number; y: number };

/**
 * Build an SVG path from a point sequence (same grouping as elkLayout).
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
 * Sample a cubic bezier at parameter t.
 */
function cubicBez(
	p0: Point,
	p1: Point,
	p2: Point,
	p3: Point,
	t: number,
): Point {
	const u = 1 - t;
	return {
		x:
			u * u * u * p0.x +
			3 * u * u * t * p1.x +
			3 * u * t * t * p2.x +
			t * t * t * p3.x,
		y:
			u * u * u * p0.y +
			3 * u * u * t * p1.y +
			3 * u * t * t * p2.y +
			t * t * t * p3.y,
	};
}

/**
 * Sample on-curve points from a bezier point sequence.
 */
function sampleCurve(points: Point[], n = 10): Point[] {
	if (points.length < 2) return [...points];
	const out: Point[] = [points[0]];
	let i = 1;
	while (i < points.length) {
		const rem = points.length - i;
		if (rem >= 3) {
			const p0 = out[out.length - 1];
			for (let s = 1; s <= n; s++)
				out.push(cubicBez(p0, points[i], points[i + 1], points[i + 2], s / n));
			i += 3;
		} else if (rem === 2) {
			out.push(points[i + 1]);
			i += 2;
		} else {
			out.push(points[i]);
			i += 1;
		}
	}
	return out;
}

/**
 * Compute placement (position and tangent angle) along a curve at parameter t (0..1),
 * with an optional pixel offset from that t-position.
 */
function getPlacementOnCurve(
	points: Point[],
	t: number,
	offsetPx = 0,
): { x: number; y: number; angle: number } {
	const sampled = sampleCurve(points, 20); // higher res for better tangents
	if (sampled.length < 2) return { x: sampled[0].x, y: sampled[0].y, angle: 0 };

	const segments: { dx: number; dy: number; len: number; acc: number }[] = [];
	let acc = 0;
	for (let i = 1; i < sampled.length; i++) {
		const dx = sampled[i].x - sampled[i - 1].x;
		const dy = sampled[i].y - sampled[i - 1].y;
		const len = Math.sqrt(dx * dx + dy * dy);
		acc += len;
		segments.push({ dx, dy, len, acc });
	}

	const totalLen = acc;
	if (totalLen === 0) return { x: sampled[0].x, y: sampled[0].y, angle: 0 };

	let targetDist = t * totalLen + offsetPx;
	if (targetDist < 0) targetDist = 0;
	if (targetDist > totalLen) targetDist = totalLen;

	let startAcc = 0;
	for (let i = 0; i < segments.length; i++) {
		const seg = segments[i];
		if (targetDist <= seg.acc || i === segments.length - 1) {
			const st = seg.len > 0 ? (targetDist - startAcc) / seg.len : 0;
			const x = sampled[i].x + st * seg.dx;
			const y = sampled[i].y + st * seg.dy;
			const angle = Math.atan2(seg.dy, seg.dx) * (180 / Math.PI);
			return { x, y, angle };
		}
		startAcc = seg.acc;
	}

	const last = sampled[sampled.length - 1];
	return { x: last.x, y: last.y, angle: 0 };
}

/** Compute the arc length of a point sequence by sampling the curve. */
function curveLength(points: Point[]): number {
	const sampled = sampleCurve(points, 10);
	let len = 0;
	for (let i = 1; i < sampled.length; i++) {
		const dx = sampled[i].x - sampled[i - 1].x;
		const dy = sampled[i].y - sampled[i - 1].y;
		len += Math.sqrt(dx * dx + dy * dy);
	}
	return len;
}

/**
 * Deform ELK-routed points when nodes have been dragged.
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

/** Render a single quantifier indicator based on mode */
function QuantifierDot({ dot, mode }: { dot: DotInfo; mode: string }) {
	if (mode === "multi") return <MultiDot dot={dot} />;
	return null;
}

/** Render a single quantifier group inline: "∀items" or "ALL(items)" */
function QuantifierGroupSpan({
	quantifier,
	dots,
}: {
	quantifier: string;
	dots: DotInfo[];
}) {
	return (
		<>
			<span style={{ fontWeight: 700, color: "#4b5563" }}>
				{quantifier === "each" ? "∀" : `${quantifier.toUpperCase()}(`}
			</span>
			{dots.map((dot, i) => (
				<span key={i}>
					{i > 0 && <span style={{ color: "#9ca3af" }}>, </span>}
					<span style={{ color: dot.color }}>{dot.objectType}</span>
				</span>
			))}
			{quantifier !== "each" && (
				<span style={{ fontWeight: 700, color: "#4b5563" }}>)</span>
			)}
		</>
	);
}

/** Combined text label chip rendering all quantifier groups in one pill */
function CombinedTextLabel({
	groups,
}: {
	groups: { quantifier: string; dots: DotInfo[] }[];
}) {
	return (
		<span
			style={{
				fontFamily: "sans-serif",
				fontSize: 14,
				fontWeight: 600,
				display: "inline-flex",
				alignItems: "baseline",
				gap: 1,
				lineHeight: 1,
				borderRadius: 4,
				paddingLeft: 2,
				paddingRight: 2,
				paddingTop: 3,
				paddingBottom: 3,
				whiteSpace: "nowrap",
				backgroundColor: "rgba(255,255,255,0.75)",
				// border: "0.5px solid #9ca3af",
			}}
		>
			{groups.map((group, gi) => (
				<span key={group.quantifier}>
					{gi > 0 && <span style={{ color: "#9ca3af" }}>&ensp;</span>}
					<QuantifierGroupSpan quantifier={group.quantifier} dots={group.dots} />
				</span>
			))}
		</span>
	);
}

export function ConstraintEdge({
	id,
	source,
	target,
	data,
	selected,
}: EdgeProps<ConstraintEdgeType>) {
	const sourceNode = useInternalNode(source);
	const targetNode = useInternalNode(target);
	const { objectTypeColors, quantifierMode, animateEdges } = useVizContext();

	// Animation: constant-speed traversal, looping
	const ANIM_SPEED = 120; // pixels per second
	const [animT, setAnimT] = useState(0);
	const rafRef = useRef<number>(0);
	const edgeLengthRef = useRef(400); // updated below when points are available

	useEffect(() => {
		if (!animateEdges) {
			setAnimT(0);
			return;
		}
		let start: number | null = null;
		const tick = (ts: number) => {
			if (start === null) start = ts;
			const elapsed = ts - start;
			const travelMs = (edgeLengthRef.current / ANIM_SPEED) * 1000;
			const linear = (elapsed % travelMs) / travelMs;
			setAnimT(linear);
			rafRef.current = requestAnimationFrame(tick);
		};
		rafRef.current = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(rafRef.current);
	}, [animateEdges]);

	if (!data || !sourceNode || !targetNode) return null;

	const isEF = data.arcType === "EF" || data.arcType === "DF";
	const isEP = data.arcType === "EP" || data.arcType === "DP";
	const isDirect = data.arcType === "DF" || data.arcType === "DP";

	// Current node positions
	const sourcePos = sourceNode.internals.positionAbsolute;
	const targetPos = targetNode.internals.positionAbsolute;

	// Node centers for gradient orientation
	const sw = sourceNode.measured?.width ?? NODE_WIDTH;
	const sh = sourceNode.measured?.height ?? NODE_HEIGHT;
	const tw = targetNode.measured?.width ?? NODE_WIDTH;
	const th = targetNode.measured?.height ?? NODE_HEIGHT;
	const sx = sourcePos.x + sw / 2;
	const sy = sourcePos.y + sh / 2;
	const tx = targetPos.x + tw / 2;
	const ty = targetPos.y + th / 2;

	// Collect all object types in quantifier group order (each → any → all)
	const dots: DotInfo[] = [
		...data.label.each.map((ref) => ({
			objectType: ref.object_type,
			color: objectTypeColors[ref.object_type] ?? "#888",
			quantifier: "each" as const,
		})),
		...data.label.any.map((ref) => ({
			objectType: ref.object_type,
			color: objectTypeColors[ref.object_type] ?? "#888",
			quantifier: "any" as const,
		})),
		...data.label.all.map((ref) => ({
			objectType: ref.object_type,
			color: objectTypeColors[ref.object_type] ?? "#888",
			quantifier: "all" as const,
		})),
	];

	// Calculate unique colors with weights in label order (each → any → all) for gradient
	const colorEntries: { key: string; color: string; weight: number }[] = [];
	const seenTypes = new Set<string>();
	for (const dot of dots) {
		const weight = dot.quantifier === "any" ? 1 : 4;
		const existing = colorEntries.find((e) => e.key === dot.objectType);
		if (existing) {
			existing.weight += weight;
		} else {
			seenTypes.add(dot.objectType);
			colorEntries.push({ key: dot.objectType, color: dot.color, weight });
		}
	}
	const sortedColors = colorEntries.map((e) => e.color);
	const colorWeightsArr = colorEntries.map((e) => e.weight);
	const totalWeight = colorWeightsArr.reduce((s, w) => s + w, 0);

	const useGradient = sortedColors.length > 1;
	const strokeColor =
		sortedColors.length > 0
			? useGradient
				? `url(#grad-${id})`
				: sortedColors[0]
			: "#4b5563";
	const startMarkerColor = "#4b5563";
	const endMarkerColor = "#4b5563";

	// When animating, sweep t along edge direction
	// EF: source→target, EP: target→source, AS: wiggle around center
	const T_STATIC = 0.5;
	let T_TARGET = T_STATIC;
	if (animateEdges) {
		if (isEF) {
			T_TARGET = 0.1 + animT * 0.8;
		} else if (isEP) {
			T_TARGET = 0.9 - animT * 0.8;
		} else {
			// AS: ping-pong around center (0.3 ± 0.2)
			const pingPong = animT <= 0.5 ? animT * 2 : 2 - animT * 2;
			T_TARGET = 0.1 + pingPong * 0.4;
		}
	}

	// In text mode, group dots by quantifier for combined labels
	const textGroups =
		quantifierMode === "text"
			? (["each", "any", "all"] as const)
					.map((q) => ({
						quantifier: q,
						dots: dots.filter((d) => d.quantifier === q),
					}))
					.filter((g) => g.dots.length > 0)
			: [];

	// Items to place along edge: single centered chip for text, individual dots for multi
	const labelItems =
		quantifierMode === "text"
			? [{ width: 0 }] // single centered label, no offset needed
			: dots.map((dot) => ({
					width: dot.quantifier === "each" ? 10 : 17,
				}));

	const totalWidth = labelItems.reduce((sum, item) => sum + item.width, 0);
	const startOffset = -totalWidth / 2;

	let path: string;
	let displacements: { x: number; y: number; angle: number }[] = [];

	// Update edge length for constant-speed animation
	if (data.routedPoints) {
		edgeLengthRef.current = curveLength(data.routedPoints);
	} else {
		const dx = tx - sx,
			dy = ty - sy;
		edgeLengthRef.current = Math.sqrt(dx * dx + dy * dy);
	}

	if (data.routedPoints && data.layoutSourcePos && data.layoutTargetPos) {
		const sourceDelta = {
			x: sourcePos.x - data.layoutSourcePos.x,
			y: sourcePos.y - data.layoutSourcePos.y,
		};
		const targetDelta = {
			x: targetPos.x - data.layoutTargetPos.x,
			y: targetPos.y - data.layoutTargetPos.y,
		};

		const hasMoved =
			Math.abs(sourceDelta.x) > 0.5 ||
			Math.abs(sourceDelta.y) > 0.5 ||
			Math.abs(targetDelta.x) > 0.5 ||
			Math.abs(targetDelta.y) > 0.5;

		if (hasMoved) {
			const deformed = deformPoints(
				data.routedPoints,
				sourceDelta,
				targetDelta,
			);

			// Re-snap endpoints to the correct node border based on CURRENT positions.
			const halfW = NODE_WIDTH / 2;
			const halfH = NODE_HEIGHT / 2;
			const srcCenter = { x: sourcePos.x + halfW, y: sourcePos.y + halfH };
			const tgtCenter = { x: targetPos.x + halfW, y: targetPos.y + halfH };

			if (deformed.length >= 2) {
				const toward1 = deformed[1];
				const d1x = toward1.x - srcCenter.x;
				const d1y = toward1.y - srcCenter.y;
				if (d1x !== 0 || d1y !== 0) {
					const ax = Math.abs(d1x),
						ay = Math.abs(d1y);
					if (ax * halfH > ay * halfW) {
						const s = Math.sign(d1x);
						deformed[0] = {
							x: srcCenter.x + s * halfW,
							y: srcCenter.y + (d1y / ax) * halfW,
						};
					} else {
						const s = Math.sign(d1y);
						deformed[0] = {
							x: srcCenter.x + (d1x / ay) * halfH,
							y: srcCenter.y + s * halfH,
						};
					}
				}
				const li = deformed.length - 1;
				const towardN = deformed[li - 1];
				const dNx = towardN.x - tgtCenter.x;
				const dNy = towardN.y - tgtCenter.y;
				if (dNx !== 0 || dNy !== 0) {
					const ax = Math.abs(dNx),
						ay = Math.abs(dNy);
					if (ax * halfH > ay * halfW) {
						const s = Math.sign(dNx);
						deformed[li] = {
							x: tgtCenter.x + s * halfW,
							y: tgtCenter.y + (dNy / ax) * halfW,
						};
					} else {
						const s = Math.sign(dNy);
						deformed[li] = {
							x: tgtCenter.x + (dNx / ay) * halfH,
							y: tgtCenter.y + s * halfH,
						};
					}
				}
			}

			path = pointsToSvgPath(deformed);
			let currentOffset = startOffset;
			displacements = labelItems.map((item, i) => {
				const d = getPlacementOnCurve(
					deformed,
					T_TARGET,
					currentOffset + item.width / 2,
				);
				currentOffset += labelItems[i].width;
				return d;
			});
		} else {
			path = data.routedPath!;
			let currentOffset = startOffset;
			displacements = labelItems.map((item, i) => {
				const d = getPlacementOnCurve(
					data.routedPoints!,
					T_TARGET,
					currentOffset + item.width / 2,
				);
				currentOffset += labelItems[i].width;
				return d;
			});
		}
	} else {
		path = `M${sx},${sy} L${tx},${ty}`;

		const dx = tx - sx;
		const dy = ty - sy;
		const angle = Math.atan2(dy, dx) * (180 / Math.PI);
		const cx = sx + dx * T_TARGET;
		const cy = sy + dy * T_TARGET;
		const len = Math.sqrt(dx * dx + dy * dy);
		const ux = len > 0 ? dx / len : 0;
		const uy = len > 0 ? dy / len : 0;

		let currentOffset = startOffset;
		displacements = labelItems.map((item) => {
			const off = currentOffset + item.width / 2;
			currentOffset += item.width;
			return { x: cx + ux * off, y: cy + uy * off, angle };
		});
	}

	return (
		<>
			<defs>
				{useGradient && (
					<linearGradient
						id={`grad-${id}`}
						gradientUnits="userSpaceOnUse"
						x1={sx}
						y1={sy}
						x2={tx}
						y2={ty}
					>
						{sortedColors.map((c, i) => {
							const before = colorWeightsArr
								.slice(0, i)
								.reduce((s, w) => s + w, 0);
							const mid = before + colorWeightsArr[i] / 2;
							return (
								<stop
									key={i}
									offset={`${(mid / totalWeight) * 100}%`}
									stopColor={c}
								/>
							);
						})}
					</linearGradient>
				)}

				{/* EF start marker: circle at source */}
				<marker
					id={`circle-${id}`}
					markerWidth="10"
					markerHeight="10"
					viewBox="-20 -20 40 40"
					orient="auto"
					refX="0"
					refY="0"
				>
					<circle cx="0" cy="0" r="10" fill={startMarkerColor} />
				</marker>

				{/* EF end marker: filled arrowhead at target */}
				<marker
					id={`arrow-filled-${id}`}
					markerWidth="10"
					markerHeight="10"
					viewBox="-20 -20 40 40"
					orient="auto"
					refX="16.9"
					refY="10"
				>
					<path
						d="M0,0 L20,9.5 L20,10 L20,10.5 L0,20 Z"
						fill={endMarkerColor}
					/>
				</marker>

				{/* DF end marker: vertical bar + filled arrowhead at target */}
				<marker
					id={`arrow-direct-${id}`}
					markerWidth="10"
					markerHeight="10"
					viewBox="-20 -20 40 40"
					orient="auto"
					refX="16.9"
					refY="10"
				>
					<path d="M-6.5,0 L-6.5,20 L-3.5,20 L-3.5,0 Z" fill={endMarkerColor} />
					<path
						d="M0,0 L20,9.5 L20,10 L20,10.5 L0,20 Z"
						fill={endMarkerColor}
					/>
				</marker>

				{/* EP start marker: circle + filled arrow pointing INTO source */}
				<marker
					id={`ep-start-${id}`}
					markerWidth="15"
					markerHeight="10"
					viewBox="-20 -20 60 40"
					orient="auto"
					refX="0"
					refY="0"
				>
					<circle cx="0" cy="0" r="10" fill={startMarkerColor} />
					{/* Tip touches the circle at (10,0), base is at x=30 */}
					<path
						d="M 30,-10 L 10,-0.5 L 10,0 L 10,0.5 L 30,10 Z"
						fill={startMarkerColor}
					/>
				</marker>

				{/* DP start marker: circle + vertical bar + filled arrow pointing INTO source */}
				<marker
					id={`dp-start-${id}`}
					markerWidth="15"
					markerHeight="10"
					viewBox="-20 -20 60 40"
					orient="auto"
					refX="0"
					refY="0"
				>
					<circle cx="0" cy="0" r="10" fill={startMarkerColor} />
					<path
						d="M 23.5,-10 L 23.5,10 L 26.5,10 L 26.5,-10 Z"
						fill={startMarkerColor}
					/>
					<path
						d="M 30,-10 L 10,-0.5 L 10,0 L 10,0.5 L 30,10 Z"
						fill={startMarkerColor}
					/>
				</marker>
			</defs>

			{/* Fat invisible interaction path */}
			<path
				d={path}
				style={{ cursor: "pointer", pointerEvents: "stroke" }}
				fill="none"
				stroke="transparent"
				strokeWidth={20}
			/>

			{/* Visible edge path */}
			<path
				d={path}
				fill="none"
				stroke={strokeColor}
				strokeWidth={3}
				opacity={1}
				strokeDasharray={isEP ? "6 3" : undefined}
				markerStart={
					isEP
						? isDirect
							? `url(#dp-start-${id})`
							: `url(#ep-start-${id})`
						: `url(#circle-${id})`
				}
				markerEnd={
					isEF
						? isDirect
							? `url(#arrow-direct-${id})`
							: `url(#arrow-filled-${id})`
						: undefined
				}
			/>

			<EdgeLabelRenderer>
				{quantifierMode === "text"
					? (() => {
							const { x, y, angle } = displacements[0];
							const isFlipped = angle > 90 || angle < -90;
							const displayAngle = isFlipped ? angle + 180 : angle;
							return (
								<div
									style={{
										position: "absolute",
										transform: `translate(-50%, -50%) translate(${x}px, ${y}px) rotate(${displayAngle}deg)`,
										pointerEvents: "all",
										zIndex: 10,
									}}
								>
									<CombinedTextLabel groups={textGroups} />
								</div>
							);
						})()
					: dots.map((dot, i) => {
							const { x, y, angle } = displacements[i];
							return (
								<div
									key={i}
									style={{
										display: "flex",
										alignItems: "center",
										padding: 0,
										background: "transparent",
										border: "none",
										cursor: "pointer",
										zIndex: 10,
										gap: 4,
										fontSize: 0,
										opacity: selected ? 1 : 0.9,
										position: "absolute",
										transform: `translate(-50%, -50%) translate(${x}px, ${y}px) rotate(${angle}deg)`,
										pointerEvents: "all",
									}}
								>
									<QuantifierDot dot={dot} mode={quantifierMode} />
								</div>
							);
						})}
			</EdgeLabelRenderer>
		</>
	);
}
