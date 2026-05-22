/**
 * Pure-SVG export for OC-DECLARE visualization.
 *
 * Renders everything as native SVG elements (rect, text, circle, path) —
 * no foreignObject, no CSS inlining — so the output works in any SVG viewer.
 */

import type { Edge, Node } from "@xyflow/react";
import { NODE_HEIGHT, NODE_WIDTH } from "../layout/elkLayout";
import type {
	ActivityNodeData,
	ConstraintEdgeData,
	QuantifierMode,
} from "../types";

// ── Public API ──────────────────────────────────────────────────────────────

export interface ExportOptions {
	nodes: Node<ActivityNodeData>[];
	edges: Edge<ConstraintEdgeData>[];
	objectTypeColors: Record<string, string>;
	quantifierMode: QuantifierMode;
}

export function exportSvg(opts: ExportOptions, filename = "oc-declare.svg") {
	const svgStr = buildExportSvg(opts);
	if (!svgStr) return;
	downloadBlob(
		new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" }),
		filename,
	);
}

export function exportPng(
	opts: ExportOptions,
	filename = "oc-declare.png",
	scale = 2,
) {
	const svgStr = buildExportSvg(opts);
	if (!svgStr) return;

	const img = new Image();
	const url = URL.createObjectURL(
		new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" }),
	);
	img.onload = () => {
		const canvas = document.createElement("canvas");
		canvas.width = img.naturalWidth * scale;
		canvas.height = img.naturalHeight * scale;
		const ctx = canvas.getContext("2d")!;
		ctx.scale(scale, scale);
		ctx.drawImage(img, 0, 0);
		canvas.toBlob((blob) => {
			if (blob) downloadBlob(blob, filename);
			URL.revokeObjectURL(url);
		}, "image/png");
	};
	img.src = url;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function downloadBlob(blob: Blob, filename: string) {
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	a.click();
	URL.revokeObjectURL(url);
}

function darken(hex: string, amount = 0.35): string {
	const c = hex.replace("#", "");
	const r = Math.round(parseInt(c.substring(0, 2), 16) * (1 - amount));
	const g = Math.round(parseInt(c.substring(2, 4), 16) * (1 - amount));
	const b = Math.round(parseInt(c.substring(4, 6), 16) * (1 - amount));
	return `rgb(${r},${g},${b})`;
}

type Pt = { x: number; y: number };

function cubicBez(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
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

function sampleCurve(points: Pt[], n = 10): Pt[] {
	if (points.length < 2) return [...points];
	const out: Pt[] = [points[0]];
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

function getPlacementOnCurve(
	points: Pt[],
	t: number,
	offsetPx = 0,
): { x: number; y: number; angle: number } {
	const sampled = sampleCurve(points, 20);
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
			return {
				x: sampled[i].x + st * seg.dx,
				y: sampled[i].y + st * seg.dy,
				angle: Math.atan2(seg.dy, seg.dx) * (180 / Math.PI),
			};
		}
		startAcc = seg.acc;
	}
	const last = sampled[sampled.length - 1];
	return { x: last.x, y: last.y, angle: 0 };
}

function pointsToSvgPath(points: Pt[]): string {
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

// ── SVG Builder ─────────────────────────────────────────────────────────────

const NS = "http://www.w3.org/2000/svg";

function el(
	tag: string,
	attrs: Record<string, string | number> = {},
): SVGElement {
	const e = document.createElementNS(NS, tag);
	for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
	return e;
}

function buildExportSvg(opts: ExportOptions): string | null {
	const { nodes, edges, objectTypeColors, quantifierMode } = opts;
	if (nodes.length === 0) return null;

	// Compute bounding box from nodes AND edge routed points
	let minX = Infinity,
		minY = Infinity,
		maxX = -Infinity,
		maxY = -Infinity;
	for (const n of nodes) {
		minX = Math.min(minX, n.position.x);
		minY = Math.min(minY, n.position.y);
		maxX = Math.max(maxX, n.position.x + NODE_WIDTH);
		maxY = Math.max(maxY, n.position.y + NODE_HEIGHT);
	}
	for (const edge of edges) {
		const pts = edge.data?.routedPoints;
		if (!pts) continue;
		// Sample curves to get actual on-curve points (control points can be outside)
		const sampled = sampleCurve(pts, 10);
		for (const p of sampled) {
			minX = Math.min(minX, p.x);
			minY = Math.min(minY, p.y);
			maxX = Math.max(maxX, p.x);
			maxY = Math.max(maxY, p.y);
		}
	}

	const padding = 40;
	const legendHeight = 130;
	const vbX = minX - padding;
	const vbY = minY - padding;
	const width = maxX - minX + 2 * padding;
	const height = maxY - minY + 2 * padding + legendHeight;

	const svg = el("svg", {
		xmlns: NS,
		viewBox: `${vbX} ${vbY} ${width} ${height}`,
		width,
		height,
	}) as SVGSVGElement;
	svg.setAttribute(
		"font-family",
		"Inter, system-ui, -apple-system, sans-serif",
	);

	// ── Defs (markers) ──
	const defs = el("defs");
	svg.appendChild(defs);
  
    // ── Nodes (below edges) ──
    const nodesG = el("g", { id: "nodes", });
    svg.appendChild(nodesG);

	// ── Edges ──
	const edgesG = el("g", { id: "edges" });
	svg.appendChild(edgesG);

	// ── Edge labels ──
	const labelsG = el("g", { id: "edge-labels" });
	svg.appendChild(labelsG);


	// Render edges + markers + labels
	for (const edge of edges) {
		const data = edge.data;
		if (!data) continue;

		const srcNode = nodes.find((n) => n.id === edge.source);
		const tgtNode = nodes.find((n) => n.id === edge.target);
		if (!srcNode || !tgtNode) continue;

		const isEF = data.arcType === "EF";
		const isEP = data.arcType === "EP";
		const sx = srcNode.position.x + NODE_WIDTH / 2;
		const sy = srcNode.position.y + NODE_HEIGHT / 2;
		const tx = tgtNode.position.x + NODE_WIDTH / 2;
		const ty = tgtNode.position.y + NODE_HEIGHT / 2;

		// Collect dots
		const dots: {
			objectType: string;
			color: string;
			quantifier: "each" | "any" | "all";
		}[] = [];
		for (const ref of data.label.each)
			dots.push({
				objectType: ref.object_type,
				color: objectTypeColors[ref.object_type] ?? "#888",
				quantifier: "each",
			});
		for (const ref of data.label.any)
			dots.push({
				objectType: ref.object_type,
				color: objectTypeColors[ref.object_type] ?? "#888",
				quantifier: "any",
			});
		for (const ref of data.label.all)
			dots.push({
				objectType: ref.object_type,
				color: objectTypeColors[ref.object_type] ?? "#888",
				quantifier: "all",
			});
		// Compute gradient colors in label order (each → any → all) for correct gradient direction
		const colorEntriesArr: { key: string; color: string; weight: number }[] = [];
		for (const dot of dots) {
			const weight = dot.quantifier === "any" ? 1 : 4;
			const existing = colorEntriesArr.find((e) => e.key === dot.objectType);
			if (existing) {
				existing.weight += weight;
			} else {
				colorEntriesArr.push({ key: dot.objectType, color: dot.color, weight });
			}
		}
		const sortedColors = colorEntriesArr.map((e) => e.color);
		const colorWeightsArr = colorEntriesArr.map((e) => e.weight);
		const totalWeight = colorWeightsArr.reduce((s, w) => s + w, 0);
		const useGradient = sortedColors.length > 1;
		const markerColor = "#4b5563";

		// Gradient
		if (useGradient) {
			const grad = el("linearGradient", {
				id: `grad-${edge.id}`,
				gradientUnits: "userSpaceOnUse",
				x1: sx,
				y1: sy,
				x2: tx,
				y2: ty,
			});
			for (let i = 0; i < sortedColors.length; i++) {
				const before = colorWeightsArr.slice(0, i).reduce((s, w) => s + w, 0);
				const mid = before + colorWeightsArr[i] / 2;
				grad.appendChild(
					el("stop", {
						offset: `${(mid / totalWeight) * 100}%`,
						"stop-color": sortedColors[i],
					}),
				);
			}
			defs.appendChild(grad);
		}

		const strokeColor =
			sortedColors.length > 0
				? useGradient
					? `url(#grad-${edge.id})`
					: sortedColors[0]
				: "#4b5563";

		// Markers — circle at source for all types
		const mc = el("marker", {
			id: `circle-${edge.id}`,
			markerWidth: 10,
			markerHeight: 10,
			viewBox: "-20 -20 40 40",
			orient: "auto",
			refX: 0,
			refY: 0,
		});
		mc.appendChild(el("circle", { cx: 0, cy: 0, r: 10, fill: markerColor }));
		defs.appendChild(mc);

		if (isEF) {
			// Arrow at target
			const ma = el("marker", {
				id: `arrow-${edge.id}`,
				markerWidth: 10,
				markerHeight: 10,
				viewBox: "-20 -20 40 40",
				orient: "auto",
				refX: 16.9,
				refY: 10,
			});
			ma.appendChild(
				el("path", {
					d: "M0,0 L20,9.5 L20,10 L20,10.5 L0,20 Z",
					fill: markerColor,
				}),
			);
			defs.appendChild(ma);
		} else if (isEP) {
			// EP: circle + arrow into source (combined marker)
			const m = el("marker", {
				id: `ep-${edge.id}`,
				markerWidth: 15,
				markerHeight: 10,
				viewBox: "-20 -20 60 40",
				orient: "auto",
				refX: 0,
				refY: 0,
			});
			m.appendChild(el("circle", { cx: 0, cy: 0, r: 10, fill: markerColor }));
			m.appendChild(
				el("path", {
					d: "M 30,-10 L 10,-0.5 L 10,0 L 10,0.5 L 30,10 Z",
					fill: markerColor,
				}),
			);
			defs.appendChild(m);
		}

		// Edge path
		let path: string;
		if (data.routedPoints && data.routedPoints.length >= 2) {
			path = pointsToSvgPath(data.routedPoints);
		} else {
			path = `M${sx},${sy} L${tx},${ty}`;
		}

		const opacity = (edge.style as Record<string, unknown>)?.opacity ?? 1;

		const pathEl = el("path", {
			d: path,
			fill: "none",
			stroke: strokeColor,
			"stroke-width": 3,
			opacity: opacity as number,
			...((isEP && false) ? { "stroke-dasharray": "6 3" } : {}),
			"marker-start": isEP ? `url(#ep-${edge.id})` : `url(#circle-${edge.id})`,
			...(isEF ? { "marker-end": `url(#arrow-${edge.id})` } : {}),
		});
		edgesG.appendChild(pathEl);

		// Dot/text labels along edge
		const T_TARGET = 0.5;
		const curvePoints =
			data.routedPoints && data.routedPoints.length >= 2
				? data.routedPoints
				: [
						{ x: sx, y: sy },
						{ x: tx, y: ty },
					];

		if (quantifierMode === "text") {
			// Group by quantifier for combined labels
			const textGroups = (["each", "any", "all"] as const)
				.map((q) => ({
					quantifier: q,
					groupDots: dots.filter((d) => d.quantifier === q),
				}))
				.filter((g) => g.groupDots.length > 0);

			// Build the full combined label string for sizing
			const fontSize = 14;
			const groupLabels = textGroups.map((gr) => {
				const names = gr.groupDots.map((d) => d.objectType);
				return gr.quantifier === "each"
					? `∀${names.join(", ")}`
					: `${gr.quantifier.toUpperCase()}(${names.join(", ")})`;
			});
			const textCharsW = groupLabels.join("").length * fontSize * 0.58;
			const gapW = Math.max(0, textGroups.length - 1) * fontSize * 0.5;
			const textW = textCharsW + gapW;
			const pillPadX = 2,
				pillPadY = 3;

			// Single centered placement
			const placement = getPlacementOnCurve(curvePoints, T_TARGET, 0);

			const g = el("g", {
				transform: `translate(${placement.x}, ${placement.y}) rotate(${placement.angle})`,
				opacity: opacity as number,
			});

			const isFlipped = placement.angle > 90 || placement.angle < -90;
			const textG = el("g", { transform: isFlipped ? "rotate(180)" : "" });

			// Background pill
			textG.appendChild(
				el("rect", {
					x: -textW / 2 - pillPadX,
					y: -fontSize / 2 - pillPadY,
					width: textW + pillPadX * 2,
					height: fontSize + pillPadY * 2,
					rx: 4,
					ry: 4,
					fill: "white",
					"fill-opacity": 0.75,
					stroke: "none",
				}),
			);

			// Render all groups as tspans in a single <text>
			const txt = el("text", {
				x: 0,
				y: 0.5,
				"font-size": fontSize,
				"font-weight": 600,
				"letter-spacing": "-0.3",
				"text-anchor": "middle",
				"dominant-baseline": "central",
			});
			for (let gi = 0; gi < textGroups.length; gi++) {
				const group = textGroups[gi];
				const names = group.groupDots.map((d) => d.objectType);

				const prefix = document.createElementNS(NS, "tspan");
				prefix.setAttribute("fill", "#4b5563");
				// Add dx gap before second+ groups for spacing
				if (gi > 0) {
					prefix.setAttribute("dx", `${fontSize * 0.6}`);
				}
				prefix.textContent =
					group.quantifier === "each"
						? "∀"
						: `${group.quantifier.toUpperCase()}(`;
				txt.appendChild(prefix);
				for (let ni = 0; ni < names.length; ni++) {
					if (ni > 0) {
						const comma = document.createElementNS(NS, "tspan");
						comma.setAttribute("fill", "#9ca3af");
						comma.textContent = ", ";
						txt.appendChild(comma);
					}
					const nameSpan = document.createElementNS(NS, "tspan");
					nameSpan.setAttribute("fill", group.groupDots[ni].color);
					nameSpan.textContent = names[ni];
					txt.appendChild(nameSpan);
				}
				if (group.quantifier !== "each") {
					const suffix = document.createElementNS(NS, "tspan");
					suffix.setAttribute("fill", "#4b5563");
					suffix.textContent = ")";
					txt.appendChild(suffix);
				}
			}
			textG.appendChild(txt);
			g.appendChild(textG);
			labelsG.appendChild(g);
		} else {
			// multi mode: individual dots
			const itemWidths = dots.map((dot) =>
				dot.quantifier === "each" ? 10 : 17,
			);
			const totalWidth = itemWidths.reduce((s, w) => s + w, 0);
			let currentOffset = -totalWidth / 2;

			for (let di = 0; di < dots.length; di++) {
				const dot = dots[di];
				const w = itemWidths[di];
				const placement = getPlacementOnCurve(
					curvePoints,
					T_TARGET,
					currentOffset + w / 2,
				);
				currentOffset += w;

				const g = el("g", {
					transform: `translate(${placement.x}, ${placement.y}) rotate(${placement.angle})`,
					opacity: opacity as number,
				});

				renderMultiDotSvg(g, dot);

				labelsG.appendChild(g);
			}
		}
	}

	// Render nodes
	for (const node of nodes) {
		const x = node.position.x;
		const y = node.position.y;
		const data = node.data;

		const g = el("g", { transform: `translate(${x}, ${y})` });

		// Background
		g.appendChild(
			el("rect", {
				x: 0,
				y: 0,
				width: NODE_WIDTH,
				height: NODE_HEIGHT,
				rx: 10,
				ry: 10,
				fill: "white",
				stroke: "#d1d5db",
				"stroke-width": 2,
			}),
		);

		// Activity label (truncate to fit node width with padding)
		const maxLabelChars = 16;
		const labelText =
			data.label.length > maxLabelChars
				? data.label.slice(0, maxLabelChars - 1).trimEnd() + "\u2026"
				: data.label;
		const label = el("text", {
			x: NODE_WIDTH / 2,
			y: 27.5, //22,
			"text-anchor": "middle",
			"dominant-baseline": "central",
			"font-size": 16,
			"font-weight": 500,
			fill: "#1f2937",
		});
		label.textContent = labelText;
		g.appendChild(label);

		// Object type dots row — match HTML flex layout with gap-1.5 (6px)
		// if (data.objectTypes.length > 0) {
		// 	const dotRow = el("g");
		// 	const gap = 6;
		// 	const dotY = 42;

		// 	// MultiDot sizes: each = single circle (diameter ~10.66), all/any = 3 overlapping (width ~18.86)
		// 	const r = 4.33,
		// 		step = 3.1,
		// 		sw = 1;
		// 	const eachW = (r + sw) * 2; // single dot width
		// 	const multiW = r * 2 + step * 2 + sw * 2; // 3-dot group width

		// 	const widths = data.objectTypes.map((ot) => (ot.multi ? multiW : eachW));
		// 	const totalWidth =
		// 		widths.reduce((s, w) => s + w, 0) + gap * (widths.length - 1);
		// 	let cx = (NODE_WIDTH - totalWidth) / 2;

		// 	for (let i = 0; i < data.objectTypes.length; i++) {
		// 		const ot = data.objectTypes[i];
		// 		const color = objectTypeColors[ot.name] ?? "#888";
		// 		const w = widths[i];
		// 		const dotG = el("g", {
		// 			transform: `translate(${cx + w / 2}, ${dotY})`,
		// 		});
		// 		renderMultiDotSvg(dotG, {
		// 			color,
		// 			quantifier: ot.multi ? "all" : "each",
		// 		});
		// 		dotRow.appendChild(dotG);
		// 		cx += w + gap;
		// 	}
		// 	g.appendChild(dotRow);
		// }

		nodesG.appendChild(g);
	}

	// Legend
	addLegend(svg, vbX + padding, maxY + padding * 0.5, objectTypeColors);

	return new XMLSerializer().serializeToString(svg);
}

// ── SVG dot renderers (mirror the React components) ─────────────────────────

function renderMultiDotSvg(
	parent: SVGElement,
	dot: { color: string; quantifier: "each" | "any" | "all" },
) {
	const r = 4.33;
	const step = 3.1;
	const sw = 1;
	const border = darken(dot.color);

	if (dot.quantifier === "all") {
		parent.appendChild(
			el("circle", {
				cx: step,
				cy: 0,
				r,
				fill: dot.color,
				stroke: border,
				"stroke-width": sw,
			}),
		);
		parent.appendChild(
			el("circle", {
				cx: 0,
				cy: 0,
				r,
				fill: dot.color,
				stroke: border,
				"stroke-width": sw,
			}),
		);
		parent.appendChild(
			el("circle", {
				cx: -step,
				cy: 0,
				r,
				fill: dot.color,
				stroke: border,
				"stroke-width": sw,
			}),
		);
	} else if (dot.quantifier === "any") {
		parent.appendChild(
			el("circle", {
				cx: step,
				cy: 0,
				r,
				fill: "white",
				stroke: border,
				"stroke-width": sw,
			}),
		);
		parent.appendChild(
			el("circle", {
				cx: 0,
				cy: 0,
				r,
				fill: "white",
				stroke: border,
				"stroke-width": sw,
			}),
		);
		parent.appendChild(
			el("circle", {
				cx: -step,
				cy: 0,
				r,
				fill: dot.color,
				stroke: border,
				"stroke-width": sw,
			}),
		);
	} else {
		parent.appendChild(
			el("circle", {
				cx: 0,
				cy: 0,
				r,
				fill: dot.color,
				stroke: border,
				"stroke-width": sw,
			}),
		);
	}
}

function addLegend(
	svg: SVGSVGElement,
	startX: number,
	y: number,
	objectTypeColors: Record<string, string>,
) {
	const legendG = el("g", { transform: `translate(${startX}, ${y})` });

	const fontSize = 16;
	const dotR = 7;
	const gap = 14;
	const rowGap = 30;

	// ── Row 1: Object Types ──
	let lx = 0;
	const row1Y = fontSize * 0.6;

	const title = el("text", {
		x: lx,
		y: row1Y,
		"font-size": fontSize,
		"font-weight": 700,
		fill: "#1f2937",
	});
	title.textContent = "Object Types:";
	legendG.appendChild(title);
	lx += 130;

	for (const [name, color] of Object.entries(objectTypeColors)) {
		legendG.appendChild(
			el("circle", {
				cx: lx + dotR,
				cy: fontSize * 0.35,
				r: dotR,
				fill: color,
			}),
		);
		const text = el("text", {
			x: lx + dotR * 2 + 6,
			y: row1Y,
			"font-size": fontSize,
			fill: "#374151",
		});
		text.textContent = name;
		legendG.appendChild(text);
		lx += name.length * fontSize * 0.6 + dotR * 2 + gap + 6;
	}

	// ── Row 2: Arc Types + Involvements ──
	const row2Y = row1Y + rowGap;
	lx = 0;
	const markerGray = "#6b7280";
	const arcLineY = row2Y - 3;
	const itemGap = 18;

	const arcTitle = el("text", {
		x: lx,
		y: row2Y,
		"font-size": fontSize,
		"font-weight": 700,
		fill: "#1f2937",
	});
	arcTitle.textContent = "Arc Types:";
	legendG.appendChild(arcTitle);
	lx += 106;

	// EF: ●——▸
	legendG.appendChild(
		el("circle", { cx: lx + 4, cy: arcLineY, r: 4, fill: markerGray }),
	);
	legendG.appendChild(
		el("line", {
			x1: lx + 8,
			y1: arcLineY,
			x2: lx + 30,
			y2: arcLineY,
			stroke: markerGray,
			"stroke-width": 2.5,
		}),
	);
	legendG.appendChild(
		el("polygon", {
			points: `${lx + 30},${arcLineY - 4} ${lx + 38},${arcLineY} ${lx + 30},${arcLineY + 4}`,
			fill: markerGray,
		}),
	);
	const efLabel = el("text", {
		x: lx + 42,
		y: row2Y,
		"font-size": fontSize - 2,
		fill: "#374151",
	});
	efLabel.textContent = "EF";
	legendG.appendChild(efLabel);
	lx += 60 + itemGap;

	// EP: ●◂---  (circle leftmost, arrow pointing left into it, then dashed line)
	legendG.appendChild(
		el("circle", { cx: lx + 4, cy: arcLineY, r: 4, fill: markerGray }),
	);
	legendG.appendChild(
		el("polygon", {
			points: `${lx + 14},${arcLineY - 4} ${lx + 7},${arcLineY} ${lx + 14},${arcLineY + 4}`,
			fill: markerGray,
		}),
	);
	legendG.appendChild(
		el("line", {
			x1: lx + 14,
			y1: arcLineY,
			x2: lx + 38,
			y2: arcLineY,
			stroke: markerGray,
			"stroke-width": 2.5,
			// "stroke-dasharray": "5 3",
		}),
	);
	const epLabel = el("text", {
		x: lx + 42,
		y: row2Y,
		"font-size": fontSize - 2,
		fill: "#374151",
	});
	epLabel.textContent = "EP";
	legendG.appendChild(epLabel);
	lx += 60 + itemGap;

	// AS: ●——
	legendG.appendChild(
		el("circle", { cx: lx + 4, cy: arcLineY, r: 4, fill: markerGray }),
	);
	legendG.appendChild(
		el("line", {
			x1: lx + 8,
			y1: arcLineY,
			x2: lx + 38,
			y2: arcLineY,
			stroke: markerGray,
			"stroke-width": 2.5,
		}),
	);
	const asLabel = el("text", {
		x: lx + 42,
		y: row2Y,
		"font-size": fontSize - 2,
		fill: "#374151",
	});
	asLabel.textContent = "AS";
	legendG.appendChild(asLabel);
	lx += 60 + itemGap;

	// // ── Involvements ──
	// lx += 10;
	// const qTitle = el("text", {
	// 	x: lx,
	// 	y: row2Y,
	// 	"font-size": fontSize,
	// 	"font-weight": 700,
	// 	fill: "#1f2937",
	// });
	// qTitle.textContent = "Involvements:";
	// legendG.appendChild(qTitle);
	// lx += 126;

	// const qItems: { quantifier: "each" | "all" | "any"; label: string }[] = [
	// 	{ quantifier: "each", label: "EACH" },
	// 	{ quantifier: "all", label: "ALL" },
	// 	{ quantifier: "any", label: "ANY" },
	// ];

	// for (const qi of qItems) {
	// 	const dotCx = qi.quantifier === "each" ? lx + 5 : lx + 10;
	// 	const dotG = el("g", { transform: `translate(${dotCx}, ${arcLineY})` });
	// 	renderMultiDotSvg(dotG, { color: markerGray, quantifier: qi.quantifier });
	// 	legendG.appendChild(dotG);
	// 	const dotW = qi.quantifier === "each" ? 14 : 22;
	// 	const qLabel = el("text", {
	// 		x: lx + dotW + 4,
	// 		y: row2Y,
	// 		"font-size": fontSize - 2,
	// 		fill: "#374151",
	// 	});
	// 	qLabel.textContent = qi.label;
	// 	legendG.appendChild(qLabel);
	// 	lx += dotW + qi.label.length * (fontSize - 2) * 0.6 + itemGap;
	// }

	svg.appendChild(legendG);
}
