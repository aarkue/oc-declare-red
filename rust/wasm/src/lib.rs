use wasm_bindgen::prelude::*;

use oc_declare::{
    discover_behavior_constraints, reduce_oc_arcs, oc_declare_conformance,
    project_oc_arcs_smart,
    OCDeclareDiscoveryOptions, OcelStats, ModelStats,
};
use process_mining::core::event_data::object_centric::linked_ocel::SlimLinkedOCEL;
use process_mining::core::event_data::object_centric::ocel_xml::xml_ocel_import::import_ocel_xml_slice;
use process_mining::OCEL;

/// Parse OCEL from either JSON or XML string
fn parse_ocel(data: &str) -> OCEL {
    let trimmed = data.trim_start();
    if trimmed.starts_with('<') {
        import_ocel_xml_slice(data.as_bytes()).expect("Failed to parse OCEL XML")
    } else {
        serde_json::from_str(data).expect("Failed to parse OCEL JSON")
    }
}

#[wasm_bindgen]
pub fn discover(ocel_data: &str, options_json: &str) -> String {
    let ocel = parse_ocel(ocel_data);
    let locel = SlimLinkedOCEL::from_ocel(ocel);
    let options: OCDeclareDiscoveryOptions =
        serde_json::from_str(options_json).unwrap_or_default();
    let arcs = discover_behavior_constraints(&locel, options);
    serde_json::to_string(&arcs).expect("Failed to serialize result")
}

#[wasm_bindgen]
pub fn reduce(model_json: &str, lossless: bool) -> String {
    let arcs: Vec<oc_declare::OCDeclareArc> =
        serde_json::from_str(model_json).expect("Failed to parse model JSON");
    let reduced = reduce_oc_arcs(arcs, lossless);
    serde_json::to_string(&reduced).expect("Failed to serialize result")
}

#[wasm_bindgen]
pub fn conformance(model_json: &str, ocel_data: &str) -> String {
    let arcs: Vec<oc_declare::OCDeclareArc> =
        serde_json::from_str(model_json).expect("Failed to parse model JSON");
    let ocel = parse_ocel(ocel_data);
    let locel = SlimLinkedOCEL::from_ocel(ocel);
    let scores: Vec<serde_json::Value> = arcs
        .iter()
        .map(|arc| {
            let score = oc_declare_conformance(&locel, arc);
            serde_json::json!({
                "from": arc.from.as_str(),
                "to": arc.to.as_str(),
                "arc_type": arc.arc_type,
                "conformance": score,
            })
        })
        .collect();
    serde_json::to_string(&scores).expect("Failed to serialize result")
}

#[wasm_bindgen]
pub fn ocel_info(ocel_data: &str) -> String {
    let ocel = parse_ocel(ocel_data);
    let stats = OcelStats::from_ocel(&ocel);
    serde_json::to_string(&stats).expect("Failed to serialize result")
}

#[wasm_bindgen]
pub fn model_stats(model_json: &str) -> String {
    let arcs: Vec<oc_declare::OCDeclareArc> =
        serde_json::from_str(model_json).expect("Failed to parse model JSON");
    let stats = ModelStats::from_arcs(&arcs);
    serde_json::to_string(&stats).expect("Failed to serialize result")
}

/// Project a model onto a subset of activities (lossless = transitive closure)
#[wasm_bindgen]
pub fn project_smart(model_json: &str, activities_json: &str) -> String {
    let arcs: Vec<oc_declare::OCDeclareArc> =
        serde_json::from_str(model_json).expect("Failed to parse model JSON");
    let activities: std::collections::HashSet<String> =
        serde_json::from_str(activities_json).expect("Failed to parse activities JSON");
    let projected = project_oc_arcs_smart(arcs, &activities, true);
    serde_json::to_string(&projected).expect("Failed to serialize result")
}
