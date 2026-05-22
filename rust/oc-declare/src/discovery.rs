use std::collections::{HashMap, HashSet};

use itertools::Itertools;
use process_mining::core::event_data::object_centric::linked_ocel::{LinkedOCELAccess, SlimLinkedOCEL};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};

use crate::{
    conformance::get_for_all_evs_perf_thresh,
    model::{
        get_activity_object_involvements, get_object_to_object_involvements,
        get_rev_object_to_object_involvements, OCDeclareArc, OCDeclareArcLabel, OCDeclareArcType,
        OCDeclareNode, ObjectInvolvementCounts, ObjectTypeAssociation, ALL_OC_DECLARE_ARC_TYPES,
    },
    reduction::reduce_oc_arcs,
};

/// O2O Mode for OC-DECLARE Discovery
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum O2OMode {
    None,
    Direct,
    Reversed,
    Bidirectional,
}

/// Mode for reducing OC-DECLARE constraints
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum OCDeclareReductionMode {
    None,
    Lossless,
    Lossy,
}

/// Options for the automatic discovery of OC-DECLARE constraints
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OCDeclareDiscoveryOptions {
    pub noise_threshold: f64,
    pub o2o_mode: O2OMode,
    pub acts_to_use: Option<Vec<String>>,
    pub counts_for_generation: (Option<usize>, Option<usize>),
    pub counts_for_filter: (Option<usize>, Option<usize>),
    pub reduction: OCDeclareReductionMode,
    pub refinement: bool,
    pub considered_arrow_types: HashSet<OCDeclareArcType>,
}

impl Default for OCDeclareDiscoveryOptions {
    fn default() -> Self {
        Self {
            noise_threshold: 0.2,
            o2o_mode: O2OMode::None,
            acts_to_use: None,
            counts_for_generation: (Some(1), Some(20)),
            counts_for_filter: (Some(1), Some(20)),
            reduction: OCDeclareReductionMode::None,
            refinement: false,
            considered_arrow_types: ALL_OC_DECLARE_ARC_TYPES.iter().copied().collect(),
        }
    }
}

/// Discover behavioral OC-DECLARE constraints from the given OCEL
pub fn discover_behavior_constraints(
    locel: &SlimLinkedOCEL,
    options: OCDeclareDiscoveryOptions,
) -> Vec<OCDeclareArc> {
    let act_ob_inv = get_activity_object_involvements(locel);
    let ob_ob_inv = get_object_to_object_involvements(locel);
    let ob_ob_rev_inv = get_rev_object_to_object_involvements(locel);
    let direction = OCDeclareArcType::AS;
    let acts_to_use = options
        .acts_to_use
        .clone()
        .unwrap_or_else(|| locel.get_ev_types().map(|et| et.to_string()).collect());
    let ret = acts_to_use
        .iter()
        .cartesian_product(acts_to_use.iter())
        .par_bridge()
        .flat_map(|(act1, act2)| {
            let obj_invs = get_direct_or_indirect_object_involvements(
                act1,
                act2,
                &act_ob_inv,
                &ob_ob_inv,
                &ob_ob_rev_inv,
                options.o2o_mode,
            );
            let act_arcs = get_oi_labels(
                act1,
                act2,
                obj_invs,
                direction,
                &options.counts_for_generation,
                options.noise_threshold,
                locel,
            );
            let old = combine_constraints(act_arcs, act1, act2, direction, &options, locel, true);
            let v = old
                .clone()
                .into_par_iter()
                .filter(move |arc1| {
                    !old.iter()
                        .any(|arc2| *arc1 != *arc2 && arc1.is_dominated_by(arc2))
                })
                .flat_map(|label| {
                    let mut arc = OCDeclareArc {
                        from: OCDeclareNode::new(act1.clone()),
                        to: OCDeclareNode::new(act2.clone()),
                        arc_type: OCDeclareArcType::AS,
                        label,
                        counts: options.counts_for_filter,
                    };
                    if arc.satisfies_threshold(locel, options.noise_threshold) {
                        arc.counts.1 = None;
                        get_stricter_arrows_for_as(arc, &options, locel)
                    } else {
                        vec![]
                    }
                });
            v
        })
        .collect();

    let reduced_ret = match options.reduction {
        OCDeclareReductionMode::None => ret,
        OCDeclareReductionMode::Lossless => reduce_oc_arcs(ret, true),
        OCDeclareReductionMode::Lossy => reduce_oc_arcs(ret, false),
    };
    if options.refinement {
        refine_oc_arcs(
            &reduced_ret,
            &act_ob_inv,
            &ob_ob_inv,
            &ob_ob_rev_inv,
            &options,
            locel,
        )
    } else {
        reduced_ret
    }
}

pub fn get_oi_labels<'a>(
    act1: &'a str,
    act2: &'a str,
    obj_invs: Vec<(ObjectTypeAssociation, bool)>,
    direction: OCDeclareArcType,
    counts_for_generation: &(Option<usize>, Option<usize>),
    noise_threshold: f64,
    locel: &SlimLinkedOCEL,
) -> Vec<OCDeclareArcLabel> {
    let mut ret = Vec::new();
    for (ot, is_multiple) in obj_invs {
        let any_label = OCDeclareArcLabel {
            each: vec![],
            any: vec![ot],
            all: vec![],
        };
        let sat = get_for_all_evs_perf_thresh(
            act1,
            act2,
            &any_label,
            &direction,
            counts_for_generation,
            locel,
            noise_threshold,
        );
        if sat {
            if is_multiple {
                ret.push(any_label.clone());
                let each_label = OCDeclareArcLabel {
                    all: vec![],
                    any: vec![],
                    each: any_label.any.clone(),
                };
                let each_sat = get_for_all_evs_perf_thresh(
                    act1,
                    act2,
                    &each_label,
                    &direction,
                    counts_for_generation,
                    locel,
                    noise_threshold,
                );
                if each_sat {
                    ret.push(each_label);
                    let all_label = OCDeclareArcLabel {
                        all: any_label.any.clone(),
                        any: vec![],
                        each: vec![],
                    };
                    let all_sat = get_for_all_evs_perf_thresh(
                        act1,
                        act2,
                        &all_label,
                        &direction,
                        counts_for_generation,
                        locel,
                        noise_threshold,
                    );
                    if all_sat {
                        ret.push(all_label);
                    }
                }
            } else {
                let each_label = OCDeclareArcLabel {
                    each: any_label.any.clone(),
                    any: vec![],
                    all: vec![],
                };
                ret.push(each_label);
            }
        }
    }
    ret
}

pub fn combine_constraints<'a>(
    mut act_arcs: Vec<OCDeclareArcLabel>,
    act1: &'a str,
    act2: &'a str,
    direction: OCDeclareArcType,
    options: &OCDeclareDiscoveryOptions,
    locel: &SlimLinkedOCEL,
    iteration_check: bool,
) -> HashSet<OCDeclareArcLabel> {
    let mut changed = true;
    let mut old: HashSet<_> = act_arcs.iter().cloned().collect();
    let mut iteration = 1;
    while changed {
        let x = 0..act_arcs.len();
        let new_res: HashSet<_> = x
            .flat_map(|arc1_i| ((arc1_i + 1)..act_arcs.len()).map(move |arc2_i| (arc1_i, arc2_i)))
            .filter_map(|(arc1_i, arc2_i)| {
                let arc1 = &act_arcs[arc1_i];
                let arc2 = &act_arcs[arc2_i];
                if arc1.is_dominated_by(arc2) || arc2.is_dominated_by(arc1) {
                    return None;
                }
                let new_arc_label = arc1.combine(arc2);
                let new_n =
                    new_arc_label.all.len() + new_arc_label.any.len() + new_arc_label.each.len();
                if iteration_check && new_n != iteration + 1 {
                    return None;
                }
                let sat = get_for_all_evs_perf_thresh(
                    act1,
                    act2,
                    &new_arc_label,
                    &direction,
                    &options.counts_for_generation,
                    locel,
                    options.noise_threshold,
                );
                if sat {
                    Some(new_arc_label)
                } else {
                    None
                }
            })
            .collect();

        changed = !new_res.is_empty();
        old.retain(|a: &OCDeclareArcLabel| {
            !new_res.iter().any(|a2| a != a2 && a.is_dominated_by(a2))
        });
        old.extend(new_res.clone().into_iter());
        act_arcs = new_res
            .iter()
            .filter(|a| !new_res.iter().any(|a2| *a != a2 && a.is_dominated_by(a2)))
            .cloned()
            .collect();
        iteration += 1;
    }
    let prev_old = old.clone();
    old.retain(|a: &OCDeclareArcLabel| !prev_old.iter().any(|a2| a != a2 && a.is_dominated_by(a2)));
    old
}

fn get_stricter_arrows_for_as(
    mut a: OCDeclareArc,
    options: &OCDeclareDiscoveryOptions,
    locel: &SlimLinkedOCEL,
) -> Vec<OCDeclareArc> {
    let mut ret: Vec<OCDeclareArc> = Vec::new();
    if options
        .considered_arrow_types
        .contains(&OCDeclareArcType::EF)
    {
        a.arc_type = OCDeclareArcType::EF;
        if a.satisfies_threshold(locel, options.noise_threshold) {
            a.arc_type = OCDeclareArcType::DF;
            if options
                .considered_arrow_types
                .contains(&OCDeclareArcType::DF)
                && a.satisfies_threshold(locel, options.noise_threshold)
            {
                ret.push(a.clone());
            } else {
                a.arc_type = OCDeclareArcType::EF;
                ret.push(a.clone());
            }
        }
    } else if options
        .considered_arrow_types
        .contains(&OCDeclareArcType::DF)
    {
        a.arc_type = OCDeclareArcType::DF;
        if a.satisfies_threshold(locel, options.noise_threshold) {
            ret.push(a.clone());
        }
    }

    if options
        .considered_arrow_types
        .contains(&OCDeclareArcType::EP)
    {
        a.arc_type = OCDeclareArcType::EP;
        if a.satisfies_threshold(locel, options.noise_threshold) {
            a.arc_type = OCDeclareArcType::DP;
            if options
                .considered_arrow_types
                .contains(&OCDeclareArcType::DP)
                && a.satisfies_threshold(locel, options.noise_threshold)
            {
                ret.push(a.clone());
            } else {
                a.arc_type = OCDeclareArcType::EP;
                ret.push(a.clone());
            }
        }
    } else if options
        .considered_arrow_types
        .contains(&OCDeclareArcType::DP)
    {
        a.arc_type = OCDeclareArcType::DP;
        if a.satisfies_threshold(locel, options.noise_threshold) {
            ret.push(a.clone());
        }
    }

    if ret.is_empty()
        && options
            .considered_arrow_types
            .contains(&OCDeclareArcType::AS)
        && a.from != a.to
    {
        a.arc_type = OCDeclareArcType::AS;
        if a.satisfies_threshold(locel, options.noise_threshold) {
            ret.push(a);
        }
    }
    ret
}

pub fn refine_oc_arcs(
    all_arcs: &[OCDeclareArc],
    act_ob_inv: &HashMap<String, HashMap<String, ObjectInvolvementCounts>>,
    ob_ob_inv: &HashMap<String, HashMap<String, ObjectInvolvementCounts>>,
    ob_ob_rev_inv: &HashMap<String, HashMap<String, ObjectInvolvementCounts>>,
    options: &OCDeclareDiscoveryOptions,
    locel: &SlimLinkedOCEL,
) -> Vec<OCDeclareArc> {
    let act_pairs: HashSet<(_, _)> = all_arcs
        .iter()
        .map(|arc| (arc.from.as_str(), arc.to.as_str()))
        .collect();
    act_pairs
        .into_iter()
        .flat_map(|(act1, act2)| {
            let arcs = all_arcs
                .iter()
                .filter(|arc| arc.from.as_str() == act1 && arc.to.as_str() == act2)
                .cloned()
                .collect_vec();
            let obj_invs = get_direct_or_indirect_object_involvements(
                act1,
                act2,
                act_ob_inv,
                ob_ob_inv,
                ob_ob_rev_inv,
                options.o2o_mode,
            );
            let oi_labels = get_oi_labels(
                act1,
                act2,
                obj_invs,
                OCDeclareArcType::AS,
                &(Some(1), None),
                options.noise_threshold,
                locel,
            );

            let mut new_arcs = Vec::new();
            for arc in arcs {
                let mut labels: Vec<_> = oi_labels
                    .iter()
                    .filter_map(|l| {
                        if l.is_dominated_by(&arc.label) {
                            None
                        } else {
                            let combined = l.combine(&arc.label);
                            let sat = get_for_all_evs_perf_thresh(
                                act1,
                                act2,
                                &combined,
                                &arc.arc_type,
                                &options.counts_for_filter,
                                locel,
                                options.noise_threshold,
                            );
                            if sat {
                                Some(combined)
                            } else {
                                None
                            }
                        }
                    })
                    .collect();
                labels.push(arc.label);
                let combined =
                    combine_constraints(labels, act1, act2, arc.arc_type, options, locel, false);
                new_arcs.extend(combined.into_iter().map(|a| OCDeclareArc {
                    from: OCDeclareNode::new(act1),
                    to: OCDeclareNode::new(act2),
                    arc_type: arc.arc_type,
                    label: a,
                    counts: (Some(1), None),
                }));
            }
            new_arcs
        })
        .collect()
}

fn get_direct_or_indirect_object_involvements<'a>(
    act1: &'a str,
    act2: &'a str,
    act_ob_involvement: &'a HashMap<String, HashMap<String, ObjectInvolvementCounts>>,
    obj_obj_involvement: &'a HashMap<String, HashMap<String, ObjectInvolvementCounts>>,
    rev_obj_obj_involvement: &'a HashMap<String, HashMap<String, ObjectInvolvementCounts>>,
    o2o_mode: O2OMode,
) -> Vec<(ObjectTypeAssociation, bool)> {
    let act1_obs: HashSet<_> = act_ob_involvement.get(act1).unwrap().keys().collect();
    let act2_obs: HashSet<_> = act_ob_involvement.get(act2).unwrap().keys().collect();
    let mut res = act1_obs
        .iter()
        .filter(|ot| act2_obs.contains(*ot))
        .map(|ot| {
            (
                ObjectTypeAssociation::new_simple(*ot),
                act_ob_involvement.get(act1).unwrap().get(*ot).unwrap().max > 1,
            )
        })
        .collect_vec();
    if o2o_mode == O2OMode::Direct || o2o_mode == O2OMode::Bidirectional {
        res.extend(act1_obs.iter().flat_map(|ot| {
            obj_obj_involvement
                .get(*ot)
                .into_iter()
                .flat_map(|ots2| {
                    ots2.iter()
                        .filter(|(ot2, _)| act2_obs.contains(ot2))
                        .map(|(ot2, oi)| {
                            (
                                ot,
                                ot2,
                                oi.max > 1
                                    || act_ob_involvement.get(act1).unwrap().get(*ot).unwrap().max
                                        > 1,
                            )
                        })
                })
                .map(|(ot1, ot2, multiple)| (ObjectTypeAssociation::new_o2o(*ot1, ot2), multiple))
                .collect_vec()
        }));
    }
    if o2o_mode == O2OMode::Reversed || o2o_mode == O2OMode::Bidirectional {
        res.extend(act1_obs.iter().flat_map(|ot| {
            rev_obj_obj_involvement
                .get(*ot)
                .into_iter()
                .flat_map(|ots2| {
                    ots2.iter()
                        .filter(|(ot2, _)| act2_obs.contains(ot2))
                        .map(|(ot2, oi)| {
                            (
                                ot,
                                ot2,
                                oi.max > 1
                                    || act_ob_involvement.get(act1).unwrap().get(*ot).unwrap().max
                                        > 1,
                            )
                        })
                })
                .map(|(ot1, ot2, multiple)| {
                    (ObjectTypeAssociation::new_o2o_rev(*ot1, ot2), multiple)
                })
                .collect_vec()
        }));
    }
    res
}
