use std::collections::{HashMap, HashSet, VecDeque};

use crate::model::{OCDeclareArc, OCDeclareArcLabel, OCDeclareArcType, OCDeclareNode};

/// Reduce OC-DECLARE arcs based on lossless/lossy transitive reduction
/// considering paths of arbitrary length.
pub fn reduce_oc_arcs(mut arcs: Vec<OCDeclareArc>, lossless: bool) -> Vec<OCDeclareArc> {
    arcs.sort();
    let mut adj: HashMap<&str, Vec<usize>> = HashMap::new();
    for (i, arc) in arcs.iter().enumerate() {
        adj.entry(arc.from.as_str()).or_default().push(i);
    }

    let mut active = vec![true; arcs.len()];

    for i in 0..arcs.len() {
        if has_dominating_path(i, &arcs, &adj, &active, lossless) {
            active[i] = false;
        }
    }

    arcs.into_iter()
        .enumerate()
        .filter(|(i, _)| active[*i])
        .map(|(_, arc)| arc)
        .collect()
}

fn has_dominating_path(
    candidate_idx: usize,
    arcs: &[OCDeclareArc],
    adj: &HashMap<&str, Vec<usize>>,
    active: &[bool],
    lossless: bool,
) -> bool {
    let c = &arcs[candidate_idx];

    let mut queue = VecDeque::new();
    let mut visited = HashSet::new();

    queue.push_back((c.from.as_str(), 0));
    visited.insert(c.from.as_str());

    while let Some((curr_node, depth)) = queue.pop_front() {
        if let Some(edge_indices) = adj.get(curr_node) {
            for &edge_idx in edge_indices {
                if !active[edge_idx] || edge_idx == candidate_idx {
                    continue;
                }

                let edge = &arcs[edge_idx];

                let dominated = c.arc_type.is_dominated_by_or_eq(&edge.arc_type)
                    && c.label.is_dominated_by(&edge.label);

                if !dominated {
                    continue;
                }

                if lossless && depth >= 1 {
                    let overlap = c
                        .label
                        .any
                        .iter()
                        .any(|any_label| edge.label.any.iter().any(|l| l == any_label));
                    if overlap {
                        continue;
                    }
                }

                // Checked per arc, not per dequeued node, so a self-loop needs a path of at least one arc.
                if edge.to == c.to {
                    return true;
                }

                if !visited.contains(edge.to.as_str()) {
                    visited.insert(edge.to.as_str());
                    queue.push_back((edge.to.as_str(), depth + 1));
                }
            }
        }
    }

    false
}

/// Compose two arc types for transitive closure
fn compose_arc_types(first: &OCDeclareArcType, second: &OCDeclareArcType) -> OCDeclareArcType {
    match (first, second) {
        (
            OCDeclareArcType::DF | OCDeclareArcType::EF,
            OCDeclareArcType::DF | OCDeclareArcType::EF,
        ) => OCDeclareArcType::EF,
        (
            OCDeclareArcType::DP | OCDeclareArcType::EP,
            OCDeclareArcType::DP | OCDeclareArcType::EP,
        ) => OCDeclareArcType::EP,
        _ => OCDeclareArcType::AS,
    }
}

/// Compose two arc labels for transitive closure (greatest lower bound)
fn compose_arc_labels(l1: &OCDeclareArcLabel, l2: &OCDeclareArcLabel) -> OCDeclareArcLabel {
    let new_all: Vec<_> = l1
        .all
        .iter()
        .filter(|x| l2.all.contains(x))
        .cloned()
        .collect();
    let l1_each_all: HashSet<_> = l1.each.iter().chain(l1.all.iter()).collect();
    let l2_each_all: HashSet<_> = l2.each.iter().chain(l2.all.iter()).collect();
    let new_each: Vec<_> = l1_each_all
        .intersection(&l2_each_all)
        .filter(|x| !new_all.contains(x))
        .cloned()
        .cloned()
        .collect();
    let l1_all_kinds: HashSet<_> = l1
        .any
        .iter()
        .chain(l1.each.iter())
        .chain(l1.all.iter())
        .collect();
    let l2_all_kinds: HashSet<_> = l2
        .any
        .iter()
        .chain(l2.each.iter())
        .chain(l2.all.iter())
        .collect();
    let new_any: Vec<_> = l1_all_kinds
        .intersection(&l2_all_kinds)
        .filter(|x| !new_all.contains(x) && !new_each.contains(x))
        .cloned()
        .cloned()
        .collect();
    OCDeclareArcLabel {
        each: new_each,
        any: new_any,
        all: new_all,
    }
}

/// Project OC-DECLARE arcs onto a subset of activities (naive mode)
pub fn project_oc_arcs_naive(
    arcs: Vec<OCDeclareArc>,
    activities: &HashSet<String>,
) -> Vec<OCDeclareArc> {
    arcs.into_iter()
        .filter(|arc| {
            activities.contains(arc.from.as_str()) && activities.contains(arc.to.as_str())
        })
        .collect()
}

/// Project OC-DECLARE arcs onto a subset of activities (smart mode)
///
/// Re-adds transitive closure of constraints through eliminated activities,
/// then applies transitive reduction.
pub fn project_oc_arcs_smart(
    arcs: Vec<OCDeclareArc>,
    activities: &HashSet<String>,
    lossless_reduction: bool,
) -> Vec<OCDeclareArc> {
    let mut adj: HashMap<&str, Vec<(&str, &OCDeclareArcType, &OCDeclareArcLabel)>> =
        HashMap::new();
    for arc in &arcs {
        adj.entry(arc.from.as_str())
            .or_default()
            .push((arc.to.as_str(), &arc.arc_type, &arc.label));
    }

    let mut result: Vec<OCDeclareArc> = arcs
        .iter()
        .filter(|a| activities.contains(a.from.as_str()) && activities.contains(a.to.as_str()))
        .cloned()
        .collect();

    for source in activities {
        let mut frontier: VecDeque<(&str, Vec<(OCDeclareArcType, OCDeclareArcLabel)>)> =
            VecDeque::new();
        let mut known_pairs: HashMap<&str, Vec<(OCDeclareArcType, OCDeclareArcLabel)>> =
            HashMap::new();
        known_pairs.insert(source.as_str(), Vec::new());

        if let Some(neighbors) = adj.get(source.as_str()) {
            let mut by_target: HashMap<&str, Vec<(OCDeclareArcType, OCDeclareArcLabel)>> =
                HashMap::new();
            for &(target, arc_type, label) in neighbors {
                if target == source.as_str() {
                    continue;
                }
                by_target
                    .entry(target)
                    .or_default()
                    .push((*arc_type, label.clone()));
            }
            for (target, pairs) in by_target {
                if activities.contains(target) {
                    continue;
                }
                let deduped = dedup_type_label_pairs(pairs);
                known_pairs.insert(target, deduped.clone());
                frontier.push_back((target, deduped));
            }
        }

        while let Some((current, current_pairs)) = frontier.pop_front() {
            if let Some(neighbors) = adj.get(current) {
                let mut by_target: HashMap<&str, Vec<(&OCDeclareArcType, &OCDeclareArcLabel)>> =
                    HashMap::new();
                for &(target, arc_type, label) in neighbors {
                    if target == source.as_str() {
                        continue;
                    }
                    by_target.entry(target).or_default().push((arc_type, label));
                }

                for (target, edges) in by_target {
                    let mut composed: Vec<(OCDeclareArcType, OCDeclareArcLabel)> = Vec::new();
                    for (cur_type, cur_label) in &current_pairs {
                        for &(edge_type, edge_label) in &edges {
                            let new_type = compose_arc_types(cur_type, edge_type);
                            let new_label = compose_arc_labels(cur_label, edge_label);
                            if new_label.each.is_empty()
                                && new_label.any.is_empty()
                                && new_label.all.is_empty()
                            {
                                continue;
                            }
                            composed.push((new_type, new_label));
                        }
                    }

                    if composed.is_empty() {
                        continue;
                    }
                    let composed = dedup_type_label_pairs(composed);

                    if activities.contains(target) {
                        for (arc_type, label) in &composed {
                            result.push(OCDeclareArc {
                                from: OCDeclareNode::new(source.clone()),
                                to: OCDeclareNode::new(target),
                                arc_type: *arc_type,
                                label: label.clone(),
                                counts: (Some(1), None),
                            });
                        }
                    } else {
                        if let Some(existing) = known_pairs.get(target) {
                            let novel: Vec<_> = composed
                                .into_iter()
                                .filter(|c| {
                                    !existing.iter().any(|e| {
                                        c.0.is_dominated_by_or_eq(&e.0)
                                            && c.1.is_dominated_by(&e.1)
                                    })
                                })
                                .collect();
                            if novel.is_empty() {
                                continue;
                            }
                            let mut merged = existing.clone();
                            merged.extend(novel.clone());
                            let merged = dedup_type_label_pairs(merged);
                            known_pairs.insert(target, merged);
                            frontier.push_back((target, novel));
                        } else {
                            known_pairs.insert(target, composed.clone());
                            frontier.push_back((target, composed));
                        };
                    }
                }
            }
        }
    }

    // Deduplicate: remove dominated arcs per (from, to) pair
    let mut by_pair: HashMap<(String, String), Vec<OCDeclareArc>> = HashMap::new();
    for arc in result {
        let key = (arc.from.as_str().to_string(), arc.to.as_str().to_string());
        by_pair.entry(key).or_default().push(arc);
    }
    let mut final_arcs: Vec<OCDeclareArc> = Vec::new();
    for (_, group) in by_pair {
        let all = group.clone();
        for arc in group {
            let dominated = all.iter().any(|b| {
                arc != *b
                    && arc.arc_type.is_dominated_by_or_eq(&b.arc_type)
                    && arc.label.is_dominated_by(&b.label)
            });
            if !dominated {
                final_arcs.push(arc);
            }
        }
    }

    reduce_oc_arcs(final_arcs, lossless_reduction)
}

fn dedup_type_label_pairs(
    mut pairs: Vec<(OCDeclareArcType, OCDeclareArcLabel)>,
) -> Vec<(OCDeclareArcType, OCDeclareArcLabel)> {
    if pairs.len() <= 1 {
        return pairs;
    }
    pairs.sort();
    pairs.dedup();
    let all = pairs.clone();
    pairs.retain(|a| {
        !all.iter().any(|b| {
            a != b && a.0.is_dominated_by_or_eq(&b.0) && a.1.is_dominated_by(&b.1)
        })
    });
    pairs
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::ObjectTypeAssociation;

    fn ef_each(from: &str, to: &str, ot: &str) -> OCDeclareArc {
        OCDeclareArc {
            from: OCDeclareNode::new(from),
            to: OCDeclareNode::new(to),
            arc_type: OCDeclareArcType::EF,
            label: OCDeclareArcLabel {
                each: vec![ObjectTypeAssociation::new_simple(ot)],
                any: vec![],
                all: vec![],
            },
            counts: (Some(1), None),
        }
    }

    #[test]
    fn self_loop_without_implying_path_is_kept() {
        let arcs = vec![ef_each("a", "a", "order")];
        assert_eq!(reduce_oc_arcs(arcs.clone(), true), arcs);
    }

    #[test]
    fn self_loop_implied_by_cycle_is_removed() {
        let arcs = vec![
            ef_each("a", "a", "order"),
            ef_each("a", "b", "order"),
            ef_each("b", "a", "order"),
        ];
        assert_eq!(
            reduce_oc_arcs(arcs, true),
            vec![ef_each("a", "b", "order"), ef_each("b", "a", "order")]
        );
    }
}
