import { Theme } from "@radix-ui/themes";
import "@radix-ui/themes/styles.css";
import {
  Background,
  type Connection,
  ConnectionLineType,
  ConnectionMode,
  Controls,
  type Edge,
  type Node,
  type OnNodeDrag,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ActivityNode } from "./components/ActivityNode";
import { AddNodeDialog } from "./components/AddNodeDialog";
import { ConstraintDialog } from "./components/ConstraintDialog";
import { ConstraintEdge } from "./components/ConstraintEdge";
import { Toolbar, ToolbarLegend } from "./components/Toolbar";
import { parseConstraints } from "./data/parseConstraints";
import { exportPng, exportSvg } from "./export/exportSvg";
import { computeElkLayout, resnapEdges } from "./layout/elkLayout";
import "./oc-declare-viz.css";
import type {
  ActivityNodeData,
  ConstraintEdgeData,
  EdgeRoutingMode,
  QuantifierMode,
  RawConstraint,
} from "./types";
import {
  generateObjectTypeColors,
  generateObjectTypeColorsFromNames,
} from "./types";
import { VizProvider } from "./VizContext";

export interface OcDeclareVizProps {
	constraints: RawConstraint[];
	onModelChange?: (constraints: RawConstraint[]) => void;
	/** Fixed set of object type names for stable coloring (e.g. from OCEL). If omitted, derived from constraints. */
	objectTypeNames?: string[];
	className?: string;
	style?: React.CSSProperties;
}

const nodeTypes = { activity: ActivityNode };
const edgeTypes = { constraint: ConstraintEdge };

function OcDeclareVizInner({
	constraints: propConstraints,
	onModelChange,
	objectTypeNames,
	className,
	style,
}: OcDeclareVizProps) {
	const [nodes, setNodes, onNodesChange] = useNodesState<
		Node<ActivityNodeData>
	>([]);
	const [edges, setEdges, onEdgesChange] = useEdgesState<
		Edge<ConstraintEdgeData>
	>([]);
	const [layoutDirection, setLayoutDirection] = useState<"RIGHT" | "DOWN">(
		"RIGHT",
	);
	const [edgeRouting, setEdgeRouting] = useState<EdgeRoutingMode>("SPLINES");
	const [filterObjectType, setFilterObjectType] = useState<string | null>(null);
	const [quantifierMode, setQuantifierMode] = useState<QuantifierMode>("text");
	const [animateEdges, setAnimateEdges] = useState(false);
	const [rawConstraints, setRawConstraints] =
		useState<RawConstraint[]>(propConstraints);
	const [extraActivities, setExtraActivities] = useState<string[]>([]);
	const { getNodes, getEdges } = useReactFlow();
	const draggedNodeRef = useRef<string | null>(null);

	// Dialogs
	const [addNodeOpen, setAddNodeOpen] = useState(false);
	const [constraintDialogOpen, setConstraintDialogOpen] = useState(false);
	const [constraintDialogSource, setConstraintDialogSource] = useState("");
	const [constraintDialogTarget, setConstraintDialogTarget] = useState("");
	const [editingConstraint, setEditingConstraint] = useState<
		{ constraint: RawConstraint; index: number } | undefined
	>();

	// Sync from prop
	useEffect(() => {
		setRawConstraints(propConstraints);
		setExtraActivities([]);
	}, [propConstraints]);

	const updateConstraints = useCallback(
		(newConstraints: RawConstraint[], newExtra?: string[]) => {
			setRawConstraints(newConstraints);
			if (newExtra !== undefined) setExtraActivities(newExtra);
			onModelChange?.(newConstraints);
		},
		[onModelChange],
	);

	// Object type colors — prefer fixed names from OCEL, fall back to deriving from constraints
	const objectTypeColors = useMemo(
		() =>
			objectTypeNames
				? generateObjectTypeColorsFromNames(objectTypeNames)
				: generateObjectTypeColors(rawConstraints),
		[objectTypeNames, rawConstraints],
	);

	// All known object types (for constraint dialog)
	const allObjectTypes = useMemo(
		() => Object.keys(objectTypeColors).sort(),
		[objectTypeColors],
	);

	// All activity names (for add node duplicate check)
	const allActivityNames = useMemo(() => {
		const names = new Set<string>();
		for (const c of rawConstraints) {
			names.add(c.from);
			names.add(c.to);
		}
		for (const a of extraActivities) names.add(a);
		return names;
	}, [rawConstraints, extraActivities]);

	// Parse and layout when data, direction, or edge routing changes
	useEffect(() => {
		if (rawConstraints.length === 0 && extraActivities.length === 0) {
			setNodes([]);
			setEdges([]);
			return;
		}
		const { nodes: parsedNodes, edges: parsedEdges } = parseConstraints(
			rawConstraints,
			extraActivities,
		);

		computeElkLayout(parsedNodes, parsedEdges, {
			direction: layoutDirection,
			edgeRouting,
		}).then(({ nodes: layoutedNodes, edges: layoutedEdges }) => {
			setNodes(layoutedNodes);
			setEdges(layoutedEdges as Edge<ConstraintEdgeData>[]);
		});
	}, [
		rawConstraints,
		extraActivities,
		layoutDirection,
		edgeRouting,
		setNodes,
		setEdges,
	]);

	const handleAutoLayout = useCallback(() => {
		const currentNodes = getNodes() as Node<ActivityNodeData>[];
		const currentEdges = getEdges() as Edge<ConstraintEdgeData>[];
		computeElkLayout(currentNodes, currentEdges, {
			direction: layoutDirection,
			edgeRouting,
		}).then(({ nodes: layoutedNodes, edges: layoutedEdges }) => {
			setNodes(layoutedNodes);
			setEdges(layoutedEdges as Edge<ConstraintEdgeData>[]);
		});
	}, [getNodes, getEdges, layoutDirection, edgeRouting, setNodes, setEdges]);

	// Track which node is being dragged
	const onNodeDragStart: OnNodeDrag = useCallback((_event, node) => {
		draggedNodeRef.current = node.id;
	}, []);

	// On drag stop, locally re-snap edges connected to the dragged node
	const onNodeDragStop: OnNodeDrag = useCallback(() => {
		const draggedId = draggedNodeRef.current;
		draggedNodeRef.current = null;
		if (!draggedId) return;

		const currentNodes = getNodes() as Node<ActivityNodeData>[];
		const currentEdges = getEdges() as Edge<ConstraintEdgeData>[];

		// Only re-snap edges connected to the dragged node
		const affectedIds = new Set(
			currentEdges
				.filter((e) => e.source === draggedId || e.target === draggedId)
				.map((e) => e.id),
		);

		const resnapped = resnapEdges(
			currentEdges.filter((e) => affectedIds.has(e.id)),
			currentNodes,
		) as Edge<ConstraintEdgeData>[];
		const resnappedMap = new Map(resnapped.map((e) => [e.id, e]));

		setEdges((prev) =>
			prev.map((e) => (resnappedMap.has(e.id) ? resnappedMap.get(e.id)! : e)),
		);
	}, [getNodes, getEdges, setEdges]);

	const getExportOpts = useCallback(
		() => ({
			nodes: getNodes() as Node<ActivityNodeData>[],
			edges: getEdges() as Edge<ConstraintEdgeData>[],
			objectTypeColors,
			quantifierMode,
		}),
		[getNodes, getEdges, objectTypeColors, quantifierMode],
	);

	const handleExportSvg = useCallback(() => {
		exportSvg(getExportOpts());
	}, [getExportOpts]);

	const handleExportPng = useCallback(() => {
		exportPng(getExportOpts());
	}, [getExportOpts]);

	// Apply object type filter to edge opacity
	const filteredEdges = edges.map((edge) => {
		if (!filterObjectType || !edge.data) return edge;
		const d = edge.data;
		const involved = [...d.label.each, ...d.label.any, ...d.label.all].some(
			(ref) => ref.object_type === filterObjectType,
		);
		return {
			...edge,
			style: { ...edge.style, opacity: involved ? 1.0 : 0.08 },
		};
	});

	// Delete nodes: remove connected constraints
	const handleNodesDelete = useCallback(
		(deletedNodes: Node[]) => {
			const deletedIds = new Set(deletedNodes.map((n) => n.id));
			const newConstraints = rawConstraints.filter(
				(c) => !deletedIds.has(c.from) && !deletedIds.has(c.to),
			);
			const newExtra = extraActivities.filter((a) => !deletedIds.has(a));
			updateConstraints(newConstraints, newExtra);
		},
		[rawConstraints, extraActivities, updateConstraints],
	);

	// Delete edges: remove constraints by index
	const handleEdgesDelete = useCallback(
		(deletedEdges: Edge[]) => {
			const deletedIndices = new Set(
				deletedEdges
					.map(
						(e) => (e.data as ConstraintEdgeData | undefined)?.constraintIndex,
					)
					.filter((i): i is number => i !== undefined),
			);
			const newConstraints = rawConstraints.filter(
				(_, i) => !deletedIndices.has(i),
			);
			updateConstraints(newConstraints);
		},
		[rawConstraints, updateConstraints],
	);

	// Connect: open constraint dialog
	const handleConnect = useCallback((connection: Connection) => {
		if (!connection.source || !connection.target) return;
		setConstraintDialogSource(connection.source);
		setConstraintDialogTarget(connection.target);
		setEditingConstraint(undefined);
		setConstraintDialogOpen(true);
	}, []);

	// Edge click: open edit dialog
	const handleEdgeDoubleClick = useCallback(
		(_event: React.MouseEvent, edge: Edge) => {
			const data = edge.data as ConstraintEdgeData | undefined;
			if (!data) return;
			setConstraintDialogSource(edge.source);
			setConstraintDialogTarget(edge.target);
			setEditingConstraint({
				constraint: rawConstraints[data.constraintIndex],
				index: data.constraintIndex,
			});
			setConstraintDialogOpen(true);
		},
		[rawConstraints],
	);

	// Add activity
	const handleAddActivity = useCallback((name: string) => {
		setExtraActivities((prev) => [...prev, name]);
	}, []);

	// Add/edit constraint
	const handleConstraintConfirm = useCallback(
		(constraint: RawConstraint) => {
			if (editingConstraint !== undefined) {
				// Edit
				const newConstraints = [...rawConstraints];
				newConstraints[editingConstraint.index] = constraint;
				updateConstraints(newConstraints);
			} else {
				// Add
				updateConstraints([...rawConstraints, constraint]);
			}
		},
		[rawConstraints, editingConstraint, updateConstraints],
	);

	// Load new data from JSON file
	const handleLoadData = useCallback(
		(data: RawConstraint[]) => {
			setExtraActivities([]);
			updateConstraints(data);
		},
		[updateConstraints],
	);

	return (
		<VizProvider value={{ objectTypeColors, quantifierMode, animateEdges }}>
			<div
				className={`oc-declare-viz${className ? ` ${className}` : ""}`}
				style={style}
			>
				<div className="oc-declare-flow">
					<ReactFlow
						nodes={nodes}
						edges={filteredEdges}
						onNodesChange={onNodesChange}
						onEdgesChange={onEdgesChange}
						onNodeDragStart={onNodeDragStart}
						onNodeDragStop={onNodeDragStop}
						onNodesDelete={handleNodesDelete}
						onEdgesDelete={handleEdgesDelete}
						onConnect={handleConnect}
						onEdgeDoubleClick={handleEdgeDoubleClick}
						nodeTypes={nodeTypes}
						edgeTypes={edgeTypes}
						connectionMode={ConnectionMode.Loose}
						connectionLineType={ConnectionLineType.Straight}
						connectionLineStyle={{ stroke: "#a3a3a3", strokeWidth: 3 }}
						deleteKeyCode="Delete"
						fitView
						minZoom={0.2}
						maxZoom={3}
						proOptions={{ hideAttribution: true }}
					>
						<Background color="#f1f5f9" gap={20} />
						<Controls />
						<Panel position="top-left">
							<Toolbar
								onAutoLayout={handleAutoLayout}
								onExportSvg={handleExportSvg}
								onExportPng={handleExportPng}
								layoutDirection={layoutDirection}
								onDirectionChange={setLayoutDirection}
								edgeRouting={edgeRouting}
								onEdgeRoutingChange={setEdgeRouting}
								filterObjectType={filterObjectType}
								onFilterObjectType={setFilterObjectType}
								onLoadData={handleLoadData}
								objectTypeColors={objectTypeColors}
								quantifierMode={quantifierMode}
								onQuantifierModeChange={setQuantifierMode}
								animateEdges={animateEdges}
								onAnimateEdgesChange={setAnimateEdges}
								onAddActivity={() => setAddNodeOpen(true)}
							/>
							<ToolbarLegend
								objectTypeColors={objectTypeColors}
								quantifierMode={quantifierMode}
							/>

						</Panel>
					</ReactFlow>
				</div>

				<AddNodeDialog
					open={addNodeOpen}
					onOpenChange={setAddNodeOpen}
					onAdd={handleAddActivity}
					existingNames={allActivityNames}
				/>

				<ConstraintDialog
					open={constraintDialogOpen}
					onOpenChange={setConstraintDialogOpen}
					onConfirm={handleConstraintConfirm}
					source={constraintDialogSource}
					target={constraintDialogTarget}
					objectTypes={allObjectTypes}
					existing={editingConstraint?.constraint}
				/>
			</div>
		</VizProvider>
	);
}

export function OcDeclareViz({ style, ...props }: OcDeclareVizProps) {
	return (
		<Theme
			appearance="light"
			accentColor="indigo"
			radius="medium"
			scaling="95%"
			hasBackground={false}
			style={{ width: "100%", height: "100%" }}
		>
			<ReactFlowProvider>
				<OcDeclareVizInner
					{...props}
					style={{ width: "100%", height: "100%" }}
				/>
			</ReactFlowProvider>
		</Theme>
	);
}
