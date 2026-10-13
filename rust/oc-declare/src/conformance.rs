use std::collections::HashSet;
use std::sync::atomic::AtomicU32;

use chrono::{DateTime, FixedOffset};
use process_mining::core::event_data::object_centric::linked_ocel::{
    slim_linked_ocel::ObjectIndex, LinkedOCELAccess, SlimLinkedOCEL,
};
use rayon::prelude::*;

use crate::model::{EventOrSynthetic, OCDeclareArc, OCDeclareArcLabel, OCDeclareArcType, SetFilter};

/// Get all events of the given event type satisfying the filters
pub fn get_evs_with_objs_perf<'a>(
    objs: &'a [SetFilter<&ObjectIndex>],
    linked_ocel: &'a SlimLinkedOCEL,
    etype: &'a str,
) -> impl Iterator<Item = EventOrSynthetic> + use<'a> {
    let initial: Box<dyn Iterator<Item = EventOrSynthetic>> = if objs.is_empty() {
        Box::new(EventOrSynthetic::get_all_syn_evs(linked_ocel, etype).into_iter())
    } else {
        match &objs[0] {
            // ANY is a union: an event referencing several of the objects still counts once.
            SetFilter::Any(items) if items.len() > 1 => {
                let mut seen: HashSet<EventOrSynthetic> = HashSet::new();
                Box::new(
                    items
                        .iter()
                        .flat_map(|o| {
                            EventOrSynthetic::get_all_of_et_for_ob(linked_ocel, etype, **o)
                        })
                        .filter(move |e| seen.insert(*e)),
                )
            }
            SetFilter::Any(items) => Box::new(
                items
                    .iter()
                    .flat_map(|o| EventOrSynthetic::get_all_of_et_for_ob(linked_ocel, etype, **o)),
            ),
            SetFilter::All(items) => {
                if items.is_empty() {
                    Box::new(Vec::new().into_iter())
                } else {
                    Box::new(
                        EventOrSynthetic::get_all_of_et_for_ob(linked_ocel, etype, *items[0])
                            .filter(|e| {
                                items
                                    .iter()
                                    .skip(1)
                                    .all(|o| e.get_e2o_set(linked_ocel).contains(o))
                            }),
                    )
                }
            }
        }
    };
    initial.filter(|e| {
        let obs = &e.get_e2o_set(linked_ocel);
        for o in objs.iter() {
            if !o.check(obs) {
                return false;
            }
        }
        true
    })
}

fn get_df_or_dp_event_perf<'a>(
    objs: &'a [SetFilter<&'a ObjectIndex>],
    linked_ocel: &'a SlimLinkedOCEL,
    reference_time: &'a DateTime<FixedOffset>,
    following: bool,
) -> Option<EventOrSynthetic> {
    let initial: Box<dyn Iterator<Item = EventOrSynthetic>> = if objs.is_empty() {
        Box::new(linked_ocel.get_all_evs().map(EventOrSynthetic::Event))
    } else {
        match &objs[0] {
            SetFilter::Any(items) => Box::new(items.iter().flat_map(|o| {
                EventOrSynthetic::get_all_for_ob(linked_ocel, **o)
                    .into_iter()
                    .filter(|e| {
                        let e_time = e.get_timestamp(linked_ocel);
                        if following {
                            e_time > *reference_time
                        } else {
                            e_time < *reference_time
                        }
                    })
            })),
            SetFilter::All(items) => {
                if items.is_empty() {
                    Box::new(Vec::new().into_iter())
                } else {
                    Box::new(
                        EventOrSynthetic::get_all_for_ob(linked_ocel, *items[0])
                            .into_iter()
                            .filter(|e| {
                                let e_time = e.get_timestamp(linked_ocel);
                                if following {
                                    e_time > *reference_time
                                } else {
                                    e_time < *reference_time
                                }
                            }),
                    )
                }
            }
        }
    };
    let x = initial.filter(|e| {
        for o in objs.iter() {
            let obs = &e.get_e2o_set(linked_ocel);
            if !o.check(obs) {
                return false;
            }
        }
        true
    });
    match following {
        true => x.min_by_key(|a| a.get_timestamp(linked_ocel)),
        false => x.max_by_key(|a| a.get_timestamp(linked_ocel)),
    }
}

/// Get fraction of source events violating this constraint arc (0 = all satisfy, 1 = all violate)
pub fn get_for_all_evs_perf(
    from_et: &str,
    to_et: &str,
    label: &OCDeclareArcLabel,
    arc_type: &OCDeclareArcType,
    counts: &(Option<usize>, Option<usize>),
    linked_ocel: &SlimLinkedOCEL,
) -> f64 {
    let evs = EventOrSynthetic::get_all_syn_evs(linked_ocel, from_et);
    let ev_count = evs.len();
    let violated_evs_count = evs
        .into_iter()
        .filter(|ev| get_for_ev_perf(ev, label, to_et, arc_type, counts, linked_ocel))
        .count();
    violated_evs_count as f64 / ev_count as f64
}

/// Checks whether violations are below the noise threshold (early-exit optimized with rayon)
pub fn get_for_all_evs_perf_thresh(
    from_et: &str,
    to_et: &str,
    label: &OCDeclareArcLabel,
    arc_type: &OCDeclareArcType,
    counts: &(Option<usize>, Option<usize>),
    linked_ocel: &SlimLinkedOCEL,
    violation_thresh: f64,
) -> bool {
    let evs = EventOrSynthetic::get_all_syn_evs(linked_ocel, from_et);
    let ev_count = evs.len();
    let min_s = (ev_count as f64 * (1.0 - violation_thresh)).ceil() as u32;
    let min_v = (ev_count as f64 * violation_thresh).floor() as u32 + 1;

    let min_v_atomic = AtomicU32::new(0);
    let min_s_atomic = AtomicU32::new(0);
    evs.into_par_iter()
        .map(|ev| {
            let violated = get_for_ev_perf(&ev, label, to_et, arc_type, counts, linked_ocel);
            if violated {
                min_v_atomic.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            } else {
                min_s_atomic.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            }
        })
        .take_any_while(|_| {
            if min_s_atomic.load(std::sync::atomic::Ordering::Relaxed) >= min_s {
                return false;
            }
            if min_v_atomic.load(std::sync::atomic::Ordering::Relaxed) >= min_v {
                return false;
            }
            true
        })
        .for_each(|_| {});
    let min_s_atomic = min_s_atomic.into_inner();
    let min_v_atomic = min_v_atomic.into_inner();
    if min_s_atomic >= min_s {
        return true;
    }
    if min_v_atomic >= min_v {
        return false;
    }
    unreachable!()
}

/// Returns true if the event violates the constraint
pub fn get_for_ev_perf(
    ev_index: &EventOrSynthetic,
    label: &OCDeclareArcLabel,
    to_et: &str,
    arc_type: &OCDeclareArcType,
    counts: &(Option<usize>, Option<usize>),
    linked_ocel: &SlimLinkedOCEL,
) -> bool {
    let syn_time = ev_index.get_timestamp(linked_ocel);
    label.get_bindings(ev_index, linked_ocel).any(|binding| {
        match arc_type {
            OCDeclareArcType::AS | OCDeclareArcType::EF | OCDeclareArcType::EP => {
                let target_ev_iterator = get_evs_with_objs_perf(&binding, linked_ocel, to_et)
                    .filter(|ev2| {
                        let ev2_time = ev2.get_timestamp(linked_ocel);
                        match arc_type {
                            OCDeclareArcType::EF => syn_time < ev2_time,
                            OCDeclareArcType::EP => syn_time > ev2_time,
                            OCDeclareArcType::AS => true,
                            _ => unreachable!(),
                        }
                    });
                if counts.1.is_none() {
                    if counts.0.unwrap_or_default()
                        > target_ev_iterator
                            .take(counts.0.unwrap_or_default())
                            .count()
                    {
                        return true;
                    }
                } else if let Some(c) = counts.1 {
                    let count = target_ev_iterator.take(c + 1).count();
                    if c < count || count < counts.0.unwrap_or_default() {
                        return true;
                    }
                }
                false
            }
            OCDeclareArcType::DF | OCDeclareArcType::DP => {
                let df_ev = get_df_or_dp_event_perf(
                    &binding,
                    linked_ocel,
                    &syn_time,
                    arc_type == &OCDeclareArcType::DF,
                );
                let count = if df_ev.is_some_and(|e| e.get_as_event_type(linked_ocel) == to_et) {
                    1
                } else {
                    0
                };
                if let Some(min_c) = counts.0 {
                    if count < min_c {
                        return true;
                    }
                }
                if let Some(max_c) = counts.1 {
                    if count > max_c {
                        return true;
                    }
                }
                false
            }
        }
    })
}

/// Returns the confidence (1 - violation fraction) of an OC-DECLARE arc on the given OCEL
pub fn oc_declare_conformance(ocel: &SlimLinkedOCEL, arc: &OCDeclareArc) -> f64 {
    1.0 - get_for_all_evs_perf(
        arc.from.as_str(),
        arc.to.as_str(),
        &arc.label,
        &arc.arc_type,
        &arc.counts,
        ocel,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{OCDeclareNode, ObjectTypeAssociation};
    use process_mining::core::event_data::object_centric::{
        OCELEvent, OCELObject, OCELRelationship, OCELType,
    };
    use process_mining::OCEL;

    /// Events as `(id, type, day, objects)`, all objects of type `order`.
    fn log(events: &[(&str, &str, u32, &[&str])], orders: &[&str]) -> SlimLinkedOCEL {
        let ty = |n: &str| OCELType {
            name: n.into(),
            attributes: vec![],
        };
        SlimLinkedOCEL::from_ocel(OCEL {
            event_types: vec![ty("place"), ty("ship"), ty("pay")],
            object_types: vec![ty("order")],
            events: events
                .iter()
                .map(|(id, et, day, obs)| OCELEvent {
                    id: (*id).into(),
                    event_type: (*et).into(),
                    time: DateTime::parse_from_rfc3339(&format!("2024-01-0{day}T00:00:00Z"))
                        .unwrap(),
                    attributes: vec![],
                    relationships: obs
                        .iter()
                        .map(|o| OCELRelationship {
                            object_id: (*o).into(),
                            qualifier: String::new(),
                        })
                        .collect(),
                })
                .collect(),
            objects: orders
                .iter()
                .map(|o| OCELObject {
                    id: (*o).into(),
                    object_type: "order".into(),
                    attributes: vec![],
                    relationships: vec![],
                })
                .collect(),
        })
    }

    /// `place` has no order object, a later `ship` involves one, and there is no `pay` event.
    fn log_with_objectless_source() -> SlimLinkedOCEL {
        log(
            &[("e1", "place", 1, &[]), ("e2", "ship", 2, &["o1"])],
            &["o1"],
        )
    }

    fn place_ef(
        to: &str,
        label: OCDeclareArcLabel,
        counts: (Option<usize>, Option<usize>),
    ) -> OCDeclareArc {
        OCDeclareArc {
            from: OCDeclareNode::new("place"),
            to: OCDeclareNode::new(to),
            arc_type: OCDeclareArcType::EF,
            label,
            counts,
        }
    }

    fn order() -> Vec<ObjectTypeAssociation> {
        vec![ObjectTypeAssociation::new_simple("order")]
    }

    #[test]
    fn empty_any_set_is_vacuous() {
        let label = OCDeclareArcLabel {
            any: order(),
            ..Default::default()
        };
        let arc = place_ef("ship", label, (Some(1), None));
        assert_eq!(
            oc_declare_conformance(&log_with_objectless_source(), &arc),
            1.0
        );
    }

    #[test]
    fn empty_all_set_is_vacuous() {
        let label = OCDeclareArcLabel {
            all: order(),
            ..Default::default()
        };
        let arc = place_ef("ship", label, (Some(1), None));
        assert_eq!(
            oc_declare_conformance(&log_with_objectless_source(), &arc),
            1.0
        );
    }

    #[test]
    fn empty_each_set_still_requires_a_target_event() {
        let label = OCDeclareArcLabel {
            each: order(),
            ..Default::default()
        };
        let arc = place_ef("pay", label, (Some(1), None));
        assert_eq!(
            oc_declare_conformance(&log_with_objectless_source(), &arc),
            0.0
        );
    }

    #[test]
    fn any_counts_a_target_event_sharing_several_objects_once() {
        let l = log(
            &[
                ("e1", "place", 1, &["o1", "o2"]),
                ("e2", "ship", 2, &["o1", "o2"]),
            ],
            &["o1", "o2"],
        );
        let label = OCDeclareArcLabel {
            any: order(),
            ..Default::default()
        };
        assert_eq!(
            oc_declare_conformance(&l, &place_ef("ship", label, (Some(1), Some(1)))),
            1.0
        );
    }
}
