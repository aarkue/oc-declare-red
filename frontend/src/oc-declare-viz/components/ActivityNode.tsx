import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import type { ActivityNodeData } from "../types";

type ActivityNodeType = Node<ActivityNodeData, "activity">;

export function ActivityNode({ data, selected }: NodeProps<ActivityNodeType>) {
	// const { objectTypeColors } = useVizContext();

	return (
		<div className="oc-declare-node" data-selected={selected || undefined}>
			<Handle
				type="source"
				position={Position.Top}
				id="s-top"
				className="oc-declare-handle"
			/>
			<Handle
				type="source"
				position={Position.Bottom}
				id="s-bottom"
				className="oc-declare-handle"
			/>
			<Handle
				type="source"
				position={Position.Left}
				id="s-left"
				className="oc-declare-handle"
			/>
			<Handle
				type="source"
				position={Position.Right}
				id="s-right"
				className="oc-declare-handle"
			/>
			<Handle
				type="target"
				position={Position.Top}
				id="t-top"
				className="oc-declare-handle"
				style={{ top: -1 }}
			/>
			<Handle
				type="target"
				position={Position.Right}
				id="t-right"
				className="oc-declare-handle"
				style={{ right: -1 }}
			/>
			<Handle
				type="target"
				position={Position.Bottom}
				id="t-bottom"
				className="oc-declare-handle"
				style={{ bottom: -1 }}
			/>
			<Handle
				type="target"
				position={Position.Left}
				id="t-left"
				className="oc-declare-handle"
				style={{ left: -1 }}
			/>
			<div className="oc-declare-node-label" title={data.label}>
				{data.label}
			</div>
			{/* <div className="oc-declare-node-dots">
        {data.objectTypes.map((ot) => (
          <span key={ot.name} style={{ display: "flex", alignItems: "center", gap: 2 }} title={`${ot.name} (${ot.multi ? "*" : "1"})`}>
            <MultiDot dot={{ objectType: ot.name, color: objectTypeColors[ot.name] ?? "#888", quantifier: ot.multi ? "all" : "each" }} />
          </span>
        ))}
      </div> */}
		</div>
	);
}
