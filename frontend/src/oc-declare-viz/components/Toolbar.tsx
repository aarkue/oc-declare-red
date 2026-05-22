import { Button, Flex, Text, Tooltip } from "@radix-ui/themes";
import type { EdgeRoutingMode, QuantifierMode, RawConstraint } from "../types";

interface Props {
	onAutoLayout: () => void;
	onExportSvg: () => void;
	onExportPng: () => void;
	layoutDirection: "RIGHT" | "DOWN";
	onDirectionChange: (dir: "RIGHT" | "DOWN") => void;
	edgeRouting: EdgeRoutingMode;
	onEdgeRoutingChange: (mode: EdgeRoutingMode) => void;
	filterObjectType: string | null;
	onFilterObjectType: (type: string | null) => void;
	onLoadData: (data: RawConstraint[]) => void;
	objectTypeColors: Record<string, string>;
	quantifierMode: QuantifierMode;
	onQuantifierModeChange: (mode: QuantifierMode) => void;
	animateEdges: boolean;
	onAnimateEdgesChange: (animate: boolean) => void;
	onAddActivity: () => void;
}

interface LegendProps {
	quantifierMode: QuantifierMode;
	objectTypeColors: Record<string, string>;
}

// const QUANTIFIER_MODES: { value: QuantifierMode; label: string }[] = [
// 	{ value: "multi", label: "Dots" },
// 	{ value: "text", label: "Text" },
// ];

export function Toolbar({
	onAutoLayout,
	onExportSvg,
	onExportPng,
	onLoadData,
	animateEdges,
	onAnimateEdgesChange,
	onAddActivity,
}: Props) {
	return (
		<Flex wrap="wrap" align="start" gap="1" maxWidth="15rem" py="2">
			{/* {QUANTIFIER_MODES.map((m) => (
				<Button
					key={m.value}
					variant={quantifierMode === m.value ? "solid" : "outline"}
					color={quantifierMode === m.value ? "pink" : "gray"}
					size="1"
					style={{ cursor: "pointer" }}
					onClick={() => onQuantifierModeChange(m.value)}
				>
					{m.label}
				</Button>
			))} */}
			{/* Animation */}
			<Button
				variant={animateEdges ? "solid" : "outline"}
				color={animateEdges ? "plum" : "gray"}
				size="1"
				style={{ cursor: "pointer" }}
				onClick={() => onAnimateEdgesChange(!animateEdges)}
			>
				Animate
			</Button>
			<Button
				variant="outline"
				color="gray"
				size="1"
				style={{ cursor: "pointer" }}
				onClick={onAddActivity}
			>
				+ Activity
			</Button>
			<Button
				variant="outline"
				color="gray"
				size="1"
				style={{ cursor: "pointer" }}
				onClick={onAutoLayout}
			>
				Re-layout
			</Button>

			{/* <Select.Root
					value={layoutDirection}
					onValueChange={(v) => onDirectionChange(v as "RIGHT" | "DOWN")}
				>
					<Select.Trigger variant="surface" style={{ cursor: "pointer" }} />
					<Select.Content>
						<Select.Item value="RIGHT">Left → Right</Select.Item>
						<Select.Item value="DOWN">Top → Bottom</Select.Item>
					</Select.Content>
				</Select.Root> */}
			{/* <Select.Root
					value={edgeRouting}
					onValueChange={(v) => onEdgeRoutingChange(v as EdgeRoutingMode)}
				>
					<Select.Trigger variant="surface" style={{ cursor: "pointer" }} />
					<Select.Content>
						<Select.Item value="SPLINES">Splines</Select.Item>
						<Select.Item value="POLYLINE">Polyline</Select.Item>
					</Select.Content>
				</Select.Root> */}
			<Button
				variant="outline"
				color="gray"
				size="1"
				asChild
				style={{ cursor: "pointer" }}
			>
				<label>
					Load JSON
					<input
						type="file"
						accept=".json"
						style={{ display: "none" }}
						onChange={(e) => {
							const file = e.target.files?.[0];
							if (!file) return;
							const reader = new FileReader();
							reader.onload = () => {
								const data = JSON.parse(reader.result as string);
								onLoadData(data);
							};
							reader.readAsText(file);
						}}
					/>
				</label>
			</Button>
			<Flex gap="1">
				{" "}
				<Button
					variant="solid"
					color="blue"
					size="1"
					style={{ cursor: "pointer" }}
					onClick={onExportSvg}
				>
					Export SVG
				</Button>
				<Button
					variant="solid"
					color="cyan"
					size="1"
					style={{ cursor: "pointer" }}
					onClick={onExportPng}
				>
					Export PNG
				</Button>
			</Flex>
		</Flex>
	);
}

export function ToolbarLegend({ objectTypeColors }: LegendProps) {
	return (
		<Flex wrap="wrap" align="center" gap="1">
			<Flex direction="column" gap="1">
				<Flex direction="column" gap="1">
					<Text
						size="1"
						weight="bold"
						style={{
							color: "var(--gray-a8)",
							textTransform: "uppercase",
							letterSpacing: "0.08em",
							marginRight: 4,
						}}
					>
						Legend
					</Text>
					<Flex wrap="wrap" align="start" justify="start" gap="1" width="20rem">
						{Object.entries(objectTypeColors).map(([name, color]) => (
							<Tooltip key={name} content={`Object Type: ${name}`}>
								<Button
									variant={"outline"}
                  color="gray"
									size="1"
								>
									<span
										style={{
											width: 10,
											height: 10,
											borderRadius: "50%",
											backgroundColor: color,
											display: "inline-block",
											flexShrink: 0,
										}}
									/>
									{name}
								</Button>
							</Tooltip>
						))}
					</Flex>
				</Flex>

				{/* Arc Types Legend */}
				<Flex align="center" gap="2">
					<Text
						size="1"
						weight="bold"
						style={{
							color: "var(--gray-a8)",
							textTransform: "uppercase",
							letterSpacing: "0.08em",
						}}
					>
						Arcs
					</Text>
					<Flex align="center" gap="1">
						<svg width="36" height="12" style={{ display: "block" }}>
							<circle cx="4" cy="6" r="3" fill="#6b7280" />
							<line
								x1="7"
								y1="6"
								x2="28"
								y2="6"
								stroke="#6b7280"
								strokeWidth="2"
							/>
							<polygon points="28,3 35,6 28,9" fill="#6b7280" />
						</svg>
						<Text size="1" color="gray">
							EF
						</Text>
					</Flex>
					<Flex align="center" gap="1">
						<svg width="36" height="12" style={{ display: "block" }}>
							<circle cx="4" cy="6" r="3" fill="#6b7280" />
							<polygon points="14,3 7,6 14,9" fill="#6b7280" />
							<line
								x1="14"
								y1="6"
								x2="35"
								y2="6"
								stroke="#6b7280"
								strokeWidth="2"
								strokeDasharray="4 2"
							/>
						</svg>
						<Text size="1" color="gray">
							EP
						</Text>
					</Flex>
					<Flex align="center" gap="1">
						<svg width="30" height="12" style={{ display: "block" }}>
							<circle cx="4" cy="6" r="3" fill="#6b7280" />
							<line
								x1="7"
								y1="6"
								x2="29"
								y2="6"
								stroke="#6b7280"
								strokeWidth="2"
							/>
						</svg>
						<Text size="1" color="gray">
							AS
						</Text>
					</Flex>
				</Flex>

				{/* Object Involvements Legend + Mode Selector */}
				{/* <Flex align="center" gap="2">
					<Text
						size="1"
						weight="bold"
						style={{
							color: "var(--gray-a8)",
							textTransform: "uppercase",
							letterSpacing: "0.08em",
						}}
					>
						Involvements
					</Text>
					<Flex align="center" gap="1">
						<MultiDot
							dot={{ objectType: "", color: "#6b7280", quantifier: "each" }}
						/>
						<Text size="1" color="gray">
							EACH
						</Text>
					</Flex>
					<Flex align="center" gap="1">
						<MultiDot
							dot={{ objectType: "", color: "#6b7280", quantifier: "all" }}
						/>
						<Text size="1" color="gray">
							ALL
						</Text>
					</Flex>
					<Flex align="center" gap="1">
						<MultiDot
							dot={{ objectType: "", color: "#6b7280", quantifier: "any" }}
						/>
						<Text size="1" color="gray">
							ANY
						</Text>
					</Flex>
				</Flex> */}
			</Flex>
		</Flex>
	);
}
