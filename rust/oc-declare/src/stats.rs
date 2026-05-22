use crate::{OCDeclareArc, OCDeclareArcLabel, OCDeclareArcType};
use process_mining::OCEL;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

/// OCEL log statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OcelStats {
    pub num_events: usize,
    pub num_objects: usize,
    pub num_event_types: usize,
    pub num_object_types: usize,
    pub event_types: HashMap<String, usize>,
    pub object_types: HashMap<String, usize>,
    /// For each object type, the maximum number of objects of that type associated with a single event
    pub max_objects_per_type_per_event: HashMap<String, usize>,
}

impl OcelStats {
    pub fn from_ocel(ocel: &OCEL) -> Self {
        let mut event_type_counts: HashMap<String, usize> = HashMap::new();
        let mut object_type_counts: HashMap<String, usize> = HashMap::new();
        let mut max_objects_per_type_per_event: HashMap<String, usize> = HashMap::new();

        let obj_type_map: HashMap<&str, &str> = ocel
            .objects
            .iter()
            .map(|o| (o.id.as_str(), o.object_type.as_str()))
            .collect();

        for obj in &ocel.objects {
            *object_type_counts
                .entry(obj.object_type.clone())
                .or_insert(0) += 1;
        }
        for ev in &ocel.events {
            *event_type_counts
                .entry(ev.event_type.clone())
                .or_insert(0) += 1;
            let mut per_type: HashMap<String, usize> = HashMap::new();
            for rel in &ev.relationships {
                if let Some(&ot) = obj_type_map.get(rel.object_id.as_str()) {
                    *per_type.entry(ot.to_string()).or_insert(0) += 1;
                }
            }
            for (ot, count) in per_type {
                let entry = max_objects_per_type_per_event.entry(ot).or_insert(0);
                if count > *entry {
                    *entry = count;
                }
            }
        }

        Self {
            num_events: ocel.events.len(),
            num_objects: ocel.objects.len(),
            num_event_types: event_type_counts.len(),
            num_object_types: object_type_counts.len(),
            event_types: event_type_counts,
            object_types: object_type_counts,
            max_objects_per_type_per_event,
        }
    }
}

/// OC-DECLARE model statistics (paper metrics)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelStats {
    /// Number of constraints |D|
    pub num_constraints: usize,
    /// Number of unique activities |A|
    pub num_nodes: usize,
    /// Size S(G) = |A| + |D|
    pub size: usize,
    /// Density D(G) = max over components C of |D_C| / |A_C|
    pub density: f64,
    /// Separability Sep(G) = |Comp(G)| / S(G)
    pub separability: f64,
    /// Constraint Variability CV(G) = max entropy of arrow type distribution in components
    pub constraint_variability: f64,
    /// Typed Connections TC(G) = sum of |dom(oi_d)| across all constraints
    pub typed_connections: usize,
    /// Arc type breakdown
    pub arc_type_counts: HashMap<String, usize>,
}

impl ModelStats {
    pub fn from_arcs(arcs: &[OCDeclareArc]) -> Self {
        let num_constraints = arcs.len();

        // Collect all unique nodes (activities)
        let mut nodes: HashSet<&str> = HashSet::new();
        for arc in arcs {
            nodes.insert(arc.from.as_str());
            nodes.insert(arc.to.as_str());
        }
        let num_nodes = nodes.len();

        // S(G) = |A| + |D|
        let size = num_nodes + num_constraints;

        // Compute weakly connected components
        let components = weakly_connected_components(arcs);

        // D(G) = max over components of |D_C| / |A_C|
        let density = components
            .iter()
            .filter(|c| !c.nodes.is_empty())
            .map(|c| c.num_arcs as f64 / c.nodes.len() as f64)
            .fold(0.0_f64, f64::max);

        // Sep(G) = |Comp(G)| / S(G)
        let separability = if size > 0 {
            components.len() as f64 / size as f64
        } else {
            0.0
        };

        // CV(G) = max entropy of arrow type distribution within components
        // Using log base |T| where T = {AS, EF, EP}
        let num_arrow_types = 3.0_f64; // AS, EF, EP
        let constraint_variability = components
            .iter()
            .filter(|c| c.num_arcs > 0)
            .map(|c| {
                let total = c.num_arcs as f64;
                let mut entropy = 0.0_f64;
                for &count in c.arc_type_counts.values() {
                    if count > 0 {
                        let p = count as f64 / total;
                        entropy -= p * p.ln() / num_arrow_types.ln();
                    }
                }
                entropy
            })
            .fold(0.0_f64, f64::max);

        // TC(G) = sum of |dom(oi_d)| = sum of object type associations per constraint
        let typed_connections: usize = arcs.iter().map(|a| label_size(&a.label)).sum();

        // Arc type breakdown
        let mut arc_type_counts: HashMap<String, usize> = HashMap::new();
        for arc in arcs {
            *arc_type_counts
                .entry(format!("{:?}", arc.arc_type))
                .or_insert(0) += 1;
        }

        Self {
            num_constraints,
            num_nodes,
            size,
            density,
            separability,
            constraint_variability,
            typed_connections,
            arc_type_counts,
        }
    }
}

/// A weakly connected component with its arcs stats
struct Component<'a> {
    nodes: HashSet<&'a str>,
    num_arcs: usize,
    arc_type_counts: HashMap<OCDeclareArcType, usize>,
}

/// Find weakly connected components using union-find
fn weakly_connected_components<'a>(arcs: &'a [OCDeclareArc]) -> Vec<Component<'a>> {
    // Collect all nodes
    let mut node_set: HashSet<&'a str> = HashSet::new();
    for arc in arcs {
        node_set.insert(arc.from.as_str());
        node_set.insert(arc.to.as_str());
    }
    let nodes: Vec<&'a str> = node_set.into_iter().collect();
    if nodes.is_empty() {
        return vec![];
    }

    let node_idx: HashMap<&str, usize> = nodes.iter().enumerate().map(|(i, &n)| (n, i)).collect();
    let mut parent: Vec<usize> = (0..nodes.len()).collect();

    fn find(parent: &mut Vec<usize>, mut x: usize) -> usize {
        while parent[x] != x {
            parent[x] = parent[parent[x]];
            x = parent[x];
        }
        x
    }

    fn union(parent: &mut Vec<usize>, a: usize, b: usize) {
        let ra = find(parent, a);
        let rb = find(parent, b);
        if ra != rb {
            parent[ra] = rb;
        }
    }

    // Union nodes connected by arcs (undirected)
    for arc in arcs {
        let a = node_idx[arc.from.as_str()];
        let b = node_idx[arc.to.as_str()];
        union(&mut parent, a, b);
    }

    // Group by component root
    let mut comp_map: HashMap<usize, Component<'a>> = HashMap::new();
    for (i, &node) in nodes.iter().enumerate() {
        let root = find(&mut parent, i);
        comp_map.entry(root).or_insert_with(|| Component {
            nodes: HashSet::new(),
            num_arcs: 0,
            arc_type_counts: HashMap::new(),
        }).nodes.insert(node);
    }

    // Assign arcs to components
    for arc in arcs {
        let root = find(&mut parent, node_idx[arc.from.as_str()]);
        let comp = comp_map.get_mut(&root).unwrap();
        comp.num_arcs += 1;
        *comp.arc_type_counts.entry(arc.arc_type).or_insert(0) += 1;
    }

    comp_map.into_values().collect()
}

fn label_size(label: &OCDeclareArcLabel) -> usize {
    label.each.len() + label.any.len() + label.all.len()
}
