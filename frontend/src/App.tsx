import { useCallback, useEffect, useMemo, useState } from "react";
import type { RawConstraint } from "./oc-declare-viz";
import { OcDeclareViz } from "./oc-declare-viz";
import {
	type DiscoveryOptions,
	discover,
	initWasm,
	isWasmReady,
	modelStats,
	ocelInfo,
	projectSmart,
	reduce,
} from "./wasm/oc-declare-wasm";
import "./App.css";

// Pre-computed models available in public/models/
const PRE_COMPUTED_MODELS: { name: string; file: string, danger?: boolean }[] = [
	{
		name: "Running Example",
		file: "running-example-model.json",
	},
	{
		name: "O2C",
		file: "O2C-None-GENSome(20)-FILTERSome(20)-discovered.json",
	},
	{
		name: "O2C (Reduced)",
		file: "O2C-None-GENSome(20)-FILTERSome(20)-reduced-lossless.json",
	},
	{
		name: "O2C (Reduced->Refined)",
		file: "O2C-None-GENSome(20)-FILTERSome(20)-refined.json",
	},
	{
		name: "Logistics",
		file: "Logistics-None-GENSome(20)-FILTERSome(20)-discovered.json",
	},
	{
		name: "Logistics (Reduced)",
		file: "Logistics-None-GENSome(20)-FILTERSome(20)-reduced-lossless.json",
	},
	{
		name: "Logistics (Reduced->Refined)",
		file: "Logistics-None-GENSome(20)-FILTERSome(20)-refined.json",
	},
	{
		name: "P2P",
		file: "P2P-None-GENSome(20)-FILTERSome(20)-discovered.json",
	},
	{
		name: "P2P (Reduced)",
		file: "P2P-None-GENSome(20)-FILTERSome(20)-reduced-lossless.json",
	},
	{
		name: "P2P (Reduced->Refined)",
		file: "P2P-None-GENSome(20)-FILTERSome(20)-refined.json",
	},
	{
		name: "BPIC2017",
		file: "BPIC2017-None-GENSome(20)-FILTERSome(20)-discovered.json",
	},
	{
		name: "BPIC2017 (Reduced)",
		file: "BPIC2017-None-GENSome(20)-FILTERSome(20)-reduced-lossless.json",
	},
	{
		name: "BPIC2017 (Reduced->Refined)",
		file: "BPIC2017-None-GENSome(20)-FILTERSome(20)-refined.json",
	},
	{
		name: "BPIC2019",
		file: "BPIC2019-None-GENSome(20)-FILTERSome(20)-discovered.json",
    danger: true
	},
	{
		name: "BPIC2019 (Reduced)",
		file: "BPIC2019-None-GENSome(20)-FILTERSome(20)-reduced-lossless.json",
	},
	{
		name: "BPIC2019 (Reduced->Refined)",
		file: "BPIC2019-None-GENSome(20)-FILTERSome(20)-refined.json",
	},
	{
		name: "BPIC2014",
		file: "BPIC2014-None-GENSome(20)-FILTERSome(20)-discovered.json",
    danger: true
	},
	{
		name: "BPIC2014 (Reduced)",
		file: "BPIC2014-None-GENSome(20)-FILTERSome(20)-reduced-lossless.json",
    danger: true
	},
	{
		name: "BPIC2014 (Reduced->Refined)",
		file: "BPIC2014-None-GENSome(20)-FILTERSome(20)-refined.json",
    danger: true
	},
];

interface OcelStatsInfo {
	num_events: number;
	num_objects: number;
	num_event_types: number;
	num_object_types: number;
	event_types: Record<string, number>;
	object_types: Record<string, number>;
	max_objects_per_type_per_event: Record<string, number>;
}

interface ModelStatsInfo {
	num_constraints: number;
	size: number;
	num_nodes: number;
	density: number;
	separability: number;
	constraint_variability: number;
	typed_connections: number;
	arc_type_counts: Record<string, number>;
}

export default function App() {
	// The "source of truth" model — never modified by projection
	const [constraints, setConstraints] = useState<RawConstraint[]>([]);
	const [wasmReady, setWasmReady] = useState(false);
	const [loading, setLoading] = useState(false);
	const [statusMsg, setStatusMsg] = useState("");
	const [ocelData, setOcelData] = useState<string | null>(null);
	const [ocelStats, setOcelStats] = useState<OcelStatsInfo | null>(null);
	const [mStats, setMStats] = useState<ModelStatsInfo | null>(null);
	const [sidebarOpen, setSidebarOpen] = useState(true);

	// Discovery options
	const [noiseThreshold, setNoiseThreshold] = useState(0.2);
	const [reductionMode, setReductionMode] = useState<"None" | "Lossless">(
		"None",
	);
	const [refinement, setRefinement] = useState(true);
	const [arrowTypes, setArrowTypes] = useState({
		AS: true,
		EF: true,
		EP: true,
	});

	// Activity selection for discovery
	const [selectedActivities, setSelectedActivities] = useState<Set<string>>(
		new Set(),
	);

	// Projection state (temporary filter, upper-right panel)
	const [projMode, setProjMode] = useState<"naive" | "lossless">("lossless");
	const [projActivities, setProjActivities] = useState<Set<string>>(new Set());
	const [projPanelOpen, setProjPanelOpen] = useState(true);

	// Init WASM on mount and auto-load running example
	useEffect(() => {
		initWasm()
			.then(() => setWasmReady(true))
			.catch((e) => setStatusMsg(`WASM init failed: ${e}`));
		fetch("/models/running-example-model.json")
			.then((r) => r.json())
			.then((data: RawConstraint[]) => {
				setConstraints(data);
				setStatusMsg(`Loaded ${data.length} constraints`);
			})
			.catch((e) => setStatusMsg(`Failed to load example: ${e}`));
	}, []);

	// When OCEL changes, select all activities by default
	useEffect(() => {
		if (ocelStats) {
			setSelectedActivities(new Set(Object.keys(ocelStats.event_types)));
		}
	}, [ocelStats]);

	// Activities in the current model
	const modelActivities = useMemo(() => {
		const acts = new Set<string>();
		for (const c of constraints) {
			acts.add(c.from);
			acts.add(c.to);
		}
		return Array.from(acts).sort();
	}, [constraints]);

	// Reset projection when model changes
	useEffect(() => {
		setProjActivities(new Set(modelActivities));
	}, [modelActivities]);

	// Derive displayed constraints from projection
	const displayedConstraints = useMemo(() => {
		// If all activities selected, show full model
		if (projActivities.size === modelActivities.length) {
			return constraints;
		}
		if (projActivities.size === 0) return [];

		if (projMode === "naive") {
			return constraints.filter(
				(c) => projActivities.has(c.from) && projActivities.has(c.to),
			);
		}

		// Lossless projection via WASM
		if (!isWasmReady()) return constraints;
		try {
			const result = projectSmart(
				JSON.stringify(constraints),
				JSON.stringify(Array.from(projActivities)),
			);
			return JSON.parse(result) as RawConstraint[];
		} catch {
			return constraints;
		}
	}, [constraints, projActivities, projMode, modelActivities.length]);

	// Compute model stats on displayed constraints
	useEffect(() => {
		if (displayedConstraints.length === 0) {
			setMStats(null);
			return;
		}
		if (!isWasmReady()) return;
		try {
			const json = modelStats(JSON.stringify(displayedConstraints));
			setMStats(JSON.parse(json));
		} catch {
			setMStats(null);
		}
	}, [displayedConstraints]);

	// Sorted activities with counts and percentages (for discovery)
	const sortedActivities = useMemo(() => {
		if (!ocelStats) return [];
		const total = ocelStats.num_events;
		return Object.entries(ocelStats.event_types)
			.sort(([, a], [, b]) => b - a)
			.map(([name, count]) => ({
				name,
				count,
				pct: total > 0 ? ((count / total) * 100).toFixed(1) : "0.0",
			}));
	}, [ocelStats]);

	// Load a pre-computed model
	const loadPreComputed = useCallback(async (file: string) => {
		setLoading(true);
		setStatusMsg(`Loading ${file}...`);
		try {
			const r = await fetch(`/models/${file}`);
			const data: RawConstraint[] = await r.json();
			setConstraints(data);
			setOcelData(null);
			setOcelStats(null);
			setStatusMsg(`Loaded ${data.length} constraints`);
		} catch (e) {
			setStatusMsg(`Failed: ${e}`);
		}
		setLoading(false);
	}, []);

	// Handle OCEL file upload
	const handleOcelUpload = useCallback(
		async (e: React.ChangeEvent<HTMLInputElement>) => {
			const file = e.target.files?.[0];
			if (!file) return;
			setLoading(true);
			setStatusMsg(`Reading ${file.name}...`);
			const text = await file.text();
			setOcelData(text);
			if (isWasmReady()) {
				try {
					const info = JSON.parse(ocelInfo(text));
					setOcelStats(info);
					setStatusMsg(
						`Loaded OCEL: ${info.num_events} events, ${info.num_objects} objects`,
					);
				} catch (err) {
					setStatusMsg(`Failed to parse OCEL: ${err}`);
				}
			}
			setLoading(false);
		},
		[],
	);

	// Run discovery on loaded OCEL
	const runDiscovery = useCallback(() => {
		if (!ocelData || !isWasmReady()) return;
		setLoading(true);
		setStatusMsg("Discovering constraints...");

		setTimeout(() => {
			try {
				const selectedTypes = Object.entries(arrowTypes)
					.filter(([, v]) => v)
					.map(([k]) => k);

				const allSelected =
					ocelStats != null &&
					selectedActivities.size === Object.keys(ocelStats.event_types).length;
				const actsToUse = allSelected ? null : Array.from(selectedActivities);

				const options: DiscoveryOptions = {
					noise_threshold: noiseThreshold,
					reduction: reductionMode,
					o2o_mode: "None",
					refinement,
					considered_arrow_types: selectedTypes,
					counts_for_generation: [1, 20],
					counts_for_filter: [1, 20],
					acts_to_use: actsToUse,
				};
				const result = discover(ocelData, options);
				const arcs: RawConstraint[] = JSON.parse(result);
				setConstraints(arcs);
				setStatusMsg(`Discovered ${arcs.length} constraints`);
			} catch (err) {
				setStatusMsg(`Discovery failed: ${err}`);
			}
			setLoading(false);
		}, 50);
	}, [
		ocelData,
		noiseThreshold,
		reductionMode,
		refinement,
		arrowTypes,
		selectedActivities,
		ocelStats,
	]);

	// Apply lossless reduction to current model
	const applyReduction = useCallback(() => {
		if (constraints.length === 0 || !isWasmReady()) return;
		setLoading(true);
		setTimeout(() => {
			try {
				const result = reduce(JSON.stringify(constraints), true);
				const arcs: RawConstraint[] = JSON.parse(result);
				setConstraints(arcs);
				setStatusMsg(`Reduced to ${arcs.length} constraints (lossless)`);
			} catch (err) {
				setStatusMsg(`Reduction failed: ${err}`);
			}
			setLoading(false);
		}, 50);
	}, [constraints]);

	// Drag & drop
	const handleDragOver = useCallback((e: React.DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
	}, []);

	const handleDrop = useCallback(async (e: React.DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
		const file = e.dataTransfer.files[0];
		if (!file) return;

		setLoading(true);
		const text = await file.text();

		try {
			const parsed = JSON.parse(text);
			if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].arc_type) {
				setConstraints(parsed);
				setStatusMsg(`Loaded ${parsed.length} constraints`);
				setLoading(false);
				return;
			}
		} catch {
			/* not a model JSON */
		}

		setOcelData(text);
		if (isWasmReady()) {
			try {
				const info = JSON.parse(ocelInfo(text));
				setOcelStats(info);
				setStatusMsg(
					`Loaded OCEL: ${info.num_events} events, ${info.num_objects} objects — click Discover to run`,
				);
			} catch (err) {
				setStatusMsg(`Failed to parse: ${err}`);
			}
		}
		setLoading(false);
	}, []);

	const hasOcel = ocelData !== null;

	const selectedArrowCount = useMemo(
		() => Object.values(arrowTypes).filter(Boolean).length,
		[arrowTypes],
	);

	const isProjectionActive = projActivities.size < modelActivities.length;

	// Stable object type names — from OCEL if available, otherwise from the full model
	const stableObjectTypeNames = useMemo(() => {
		if (ocelStats) {
			return Object.keys(ocelStats.object_types);
		}
		// Derive from the full (unfiltered) constraints
		const types = new Set<string>();
		for (const c of constraints) {
			for (const refs of [c.label.each, c.label.any, c.label.all]) {
				for (const ref of refs) {
					types.add(ref.object_type);
				}
			}
		}
		return Array.from(types);
	}, [ocelStats, constraints]);

	return (
		<div
			role="application"
			className="app-root"
			onDragOver={handleDragOver}
			onDrop={handleDrop}
		>
			{/* Sidebar */}
			{sidebarOpen && (
				<div className="sidebar">
					<div className="sidebar-header">
						OC-DECLARE Reduction
            <p className="hint">
              This tool implements the OC-DECLARE simplification approach of the corresponding paper submitted to OBJECTS @ BPM 2026.
            </p>
					</div>

					{statusMsg && (
						<div className={`status-bar ${loading ? "loading" : "ready"}`}>
							{loading && "⏳ "}
							{statusMsg}
						</div>
					)}

					<Section title="Load Pre-computed Models">
						<div className="hint" style={{ marginTop: 6 }}>
							Discovered with τ=0.2, pre-pruning (max. 20)
						</div>
						<div className="model-list">
							{PRE_COMPUTED_MODELS.map((m) => (
								<button
									type="button"
									key={m.file}
									className="model-btn"
									onClick={() => loadPreComputed(m.file)}
									disabled={loading}
								>
									{m.name} {m.danger === true ? " | ⚠️ Very Large" : ""}
								</button>
							))}
						</div>
					</Section>

					<Section title="Discover From OCEL">
						<div className="file-upload">
							<input
								type="file"
								accept=".json,.xml,.jsonocel,.xmlocel"
								onChange={handleOcelUpload}
								disabled={loading}
							/>
							<div className="hint">
								Or drag &amp; drop an OCEL JSON file anywhere
							</div>
						</div>
					</Section>

					{ocelStats && (
						<Section title="OCEL Info">
							<table className="stats-table">
								<tbody>
									<tr>
										<td className="label">Events</td>
										<td className="value">
											{ocelStats.num_events.toLocaleString()}
										</td>
									</tr>
									<tr>
										<td className="label">Objects</td>
										<td className="value">
											{ocelStats.num_objects.toLocaleString()}
										</td>
									</tr>
									<tr className="group-header">
										<td colSpan={2}>Object Types</td>
									</tr>
									{Object.entries(ocelStats.object_types)
										.sort(([, a], [, b]) => b - a)
										.map(([name, count]) => {
											const maxPerEv =
												ocelStats.max_objects_per_type_per_event[name] ?? 0;
											return (
												<tr key={name}>
													<td className="sub-label">
														{name}
														{maxPerEv > 1 && (
															<span className="multi-badge">
																{" "}
																(1:{maxPerEv})
															</span>
														)}
													</td>
													<td className="sub-value">
														{count.toLocaleString()}
													</td>
												</tr>
											);
										})}
								</tbody>
							</table>
						</Section>
					)}

					{hasOcel && wasmReady && (
						<Section title="Discovery">
							<div className="discovery-controls">
								<label>
									Noise threshold: <strong>{noiseThreshold.toFixed(2)}</strong>
									<input
										type="range"
										min="0"
										max="1"
										step="0.01"
										value={noiseThreshold}
										onChange={(e) =>
											setNoiseThreshold(parseFloat(e.target.value))
										}
									/>
								</label>

								<label>
									Reduction:
									<select
										value={reductionMode}
										onChange={(e) =>
											setReductionMode(e.target.value as "None" | "Lossless")
										}
									>
										<option value="None">None</option>
										<option value="Lossless">Lossless</option>
									</select>
								</label>

								<label className="checkbox-inline">
									<input
										type="checkbox"
										checked={refinement}
										onChange={(e) => setRefinement(e.target.checked)}
									/>{" "}
									Refinement
								</label>

								<div>
									Arrow types:
									<div className="checkbox-group">
										{(["AS", "EF", "EP"] as const).map((t) => (
											<label key={t}>
												<input
													type="checkbox"
													checked={arrowTypes[t]}
													onChange={(e) =>
														setArrowTypes((prev) => ({
															...prev,
															[t]: e.target.checked,
														}))
													}
												/>{" "}
												{t}
											</label>
										))}
									</div>
								</div>

								{/* Activity Selection for Discovery */}
								<div>
									<div className="activity-header">
										Activities ({selectedActivities.size}/
										{sortedActivities.length}):
										<span className="activity-actions">
											<button
												type="button"
												className="link-btn"
												onClick={() =>
													setSelectedActivities(
														new Set(sortedActivities.map((a) => a.name)),
													)
												}
											>
												all
											</button>
											<button
												type="button"
												className="link-btn"
												onClick={() => setSelectedActivities(new Set())}
											>
												none
											</button>
										</span>
									</div>
									<div className="activity-list">
										{sortedActivities.map((a) => (
											<label key={a.name} className="activity-item">
												<input
													type="checkbox"
													checked={selectedActivities.has(a.name)}
													onChange={(e) => {
														setSelectedActivities((prev) => {
															const next = new Set(prev);
															if (e.target.checked) next.add(a.name);
															else next.delete(a.name);
															return next;
														});
													}}
												/>
												<span className="activity-name" title={a.name}>
													{a.name}
												</span>
												<span className="activity-count">
													{a.count.toLocaleString()} ({a.pct}%)
												</span>
											</label>
										))}
									</div>
								</div>

								<button
									type="button"
									className="btn-primary"
									onClick={runDiscovery}
									disabled={
										loading ||
										selectedArrowCount === 0 ||
										selectedActivities.size === 0
									}
								>
									Discover
								</button>
							</div>
						</Section>
					)}

					{constraints.length > 0 && wasmReady && (
						<Section title="Reduction">
							<button
								type="button"
								className="btn-primary"
								onClick={applyReduction}
								disabled={loading}
								style={{ width: "100%" }}
							>
								Apply Lossless Reduction
							</button>
						</Section>
					)}

					{mStats && (
						<Section
							title={
								isProjectionActive ? "Model Stats (projected)" : "Model Stats"
							}
						>
							<table className="stats-table">
								<tbody>
									<StatRow label="Constraints" value={mStats.num_constraints} />
									<StatRow label="Nodes" value={mStats.num_nodes} />
									<StatRow label="Size (S)" value={mStats.size} />
									<StatRow
										label="Density (D)"
										value={mStats.density.toFixed(3)}
									/>
									<StatRow
										label="Separability"
										value={mStats.separability.toFixed(3)}
									/>
									<StatRow
										label="Constraint Var."
										value={mStats.constraint_variability.toFixed(3)}
									/>
									<StatRow
										label="Typed Conn."
										value={mStats.typed_connections}
									/>
									{Object.entries(mStats.arc_type_counts)
										.sort(([a], [b]) => a.localeCompare(b))
										.map(([type, count]) => (
											<StatRow key={type} label={`  ${type}`} value={count} />
										))}
								</tbody>
							</table>
						</Section>
					)}

					<div className="sidebar-footer">
						WASM: {wasmReady ? "ready" : "loading..."}
					</div>
				</div>
			)}

			{/* Main viz area */}
			<div className="viz-area">
				{!sidebarOpen && (
					<button
						type="button"
						className="menu-toggle"
						onClick={() => setSidebarOpen(true)}
					>
						Menu
					</button>
				)}

				{/* Floating projection panel — upper right */}
				{constraints.length > 0 && (
					<div className="proj-panel">
						<button
							type="button"
							className="proj-toggle"
							onClick={() => setProjPanelOpen((v) => !v)}
						>
							Activity Projection
							{isProjectionActive && (
								<span className="proj-badge">
									{projActivities.size}/{modelActivities.length}
								</span>
							)}
						</button>

						{projPanelOpen && (
							<div className="proj-dropdown">
								<div className="proj-mode-toggle">
									<button
										type="button"
										className={`proj-mode-btn ${projMode === "naive" ? "active" : ""}`}
										onClick={() => setProjMode("naive")}
									>
										Naive
									</button>
									<button
										type="button"
										className={`proj-mode-btn ${projMode === "lossless" ? "active" : ""}`}
										onClick={() => setProjMode("lossless")}
									>
										Lossless
									</button>
								</div>

								<div className="activity-header">
									<span>
										{projActivities.size}/{modelActivities.length} activities
									</span>
									<span className="activity-actions">
										<button
											type="button"
											className="link-btn"
											onClick={() =>
												setProjActivities(new Set(modelActivities))
											}
										>
											all
										</button>
										<button
											type="button"
											className="link-btn"
											onClick={() => setProjActivities(new Set())}
										>
											none
										</button>
									</span>
								</div>

								<div className="activity-list proj-activity-list">
									{modelActivities.map((name) => (
										<label key={name} className="activity-item">
											<input
												type="checkbox"
												checked={projActivities.has(name)}
												onChange={(e) => {
													setProjActivities((prev) => {
														const next = new Set(prev);
														if (e.target.checked) next.add(name);
														else next.delete(name);
														return next;
													});
												}}
											/>
											<span className="activity-name" title={name}>
												{name}
											</span>
										</label>
									))}
								</div>

								{isProjectionActive && (
									<div className="proj-info">
										Showing {displayedConstraints.length} of{" "}
										{constraints.length} constraints
									</div>
								)}
							</div>
						)}
					</div>
				)}

				<OcDeclareViz
					constraints={displayedConstraints}
					onModelChange={(c) => setConstraints(c)}
					objectTypeNames={stableObjectTypeNames}
				/>
			</div>
		</div>
	);
}

function Section({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	return (
		<div className="section">
			<div className="section-title">{title}</div>
			{children}
		</div>
	);
}

function StatRow({ label, value }: { label: string; value: string | number }) {
	return (
		<tr>
			<td className="label">{label}</td>
			<td className="value">{value}</td>
		</tr>
	);
}
