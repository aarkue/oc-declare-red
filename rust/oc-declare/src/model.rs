use chrono::{DateTime, Duration, FixedOffset};
use itertools::Itertools;
use process_mining::core::event_data::object_centric::linked_ocel::slim_linked_ocel::{
    EventIndex, ObjectIndex,
};
use process_mining::core::event_data::object_centric::linked_ocel::{LinkedOCELAccess, SlimLinkedOCEL};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::hash::Hash;

pub const INIT_EVENT_PREFIX: &str = "<init>";
pub const EXIT_EVENT_PREFIX: &str = "<exit>";

#[derive(Debug, Clone, Hash, PartialEq, Eq, Serialize, Deserialize, PartialOrd, Ord)]
/// OC-DECLARE node (Activity or Object Init/Exit)
pub struct OCDeclareNode(String);

impl<'a> From<&'a OCDeclareNode> for &'a String {
    fn from(val: &'a OCDeclareNode) -> Self {
        &val.0
    }
}

impl OCDeclareNode {
    pub fn new<T: Into<String>>(act: T) -> Self {
        Self(act.into())
    }

    pub fn as_str(&self) -> &str {
        self.0.as_str()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Hash, PartialOrd, Ord)]
/// OC-DECLARE Constraint arc/edge between two nodes
pub struct OCDeclareArc {
    pub from: OCDeclareNode,
    pub to: OCDeclareNode,
    pub arc_type: OCDeclareArcType,
    pub label: OCDeclareArcLabel,
    /// (min count, max count)
    pub counts: (Option<usize>, Option<usize>),
}

impl OCDeclareArc {
    pub fn clone_with_arc_type(&self, arc_type: OCDeclareArcType) -> Self {
        let mut ret = self.clone();
        ret.arc_type = arc_type;
        ret
    }

    pub fn as_template_string(&self) -> String {
        format!(
            "{}({}, {}, {},{},{})",
            self.arc_type.get_name(),
            self.from.0,
            self.to.0,
            self.label.as_template_string(),
            self.counts.0.unwrap_or_default(),
            self.counts
                .1
                .map(|x| x.to_string())
                .unwrap_or(String::from("∞"))
        )
    }

    pub fn get_violation_fraction(&self, linked_ocel: &SlimLinkedOCEL) -> f64 {
        crate::conformance::get_for_all_evs_perf(
            self.from.as_str(),
            self.to.as_str(),
            &self.label,
            &self.arc_type,
            &self.counts,
            linked_ocel,
        )
    }

    pub fn satisfies_threshold(
        &self,
        linked_ocel: &SlimLinkedOCEL,
        noise_thresh: f64,
    ) -> bool {
        crate::conformance::get_for_all_evs_perf_thresh(
            self.from.as_str(),
            self.to.as_str(),
            &self.label,
            &self.arc_type,
            &self.counts,
            linked_ocel,
            noise_thresh,
        )
    }
}

/// OC-DECLARE Arc Direction/Type
#[derive(Debug, Clone, Copy, Hash, PartialEq, Eq, Serialize, Deserialize, PartialOrd, Ord)]
pub enum OCDeclareArcType {
    /// Association: No temporal restrictions
    AS,
    /// Eventually-Follows: Target must occur after source event
    EF,
    /// Eventually-Precedes: Target must occur before source event
    EP,
    /// Directly-Follows: Target must occur directly after source event
    DF,
    /// Directly-Precedes: Target must occur directly before source event
    DP,
}

pub const ALL_OC_DECLARE_ARC_TYPES: &[OCDeclareArcType] = &[
    OCDeclareArcType::AS,
    OCDeclareArcType::EF,
    OCDeclareArcType::EP,
    OCDeclareArcType::DF,
    OCDeclareArcType::DP,
];

impl OCDeclareArcType {
    pub fn parse_str(s: impl AsRef<str>) -> Option<Self> {
        match s.as_ref() {
            "AS" => Some(Self::AS),
            "EF" => Some(Self::EF),
            "EP" => Some(Self::EP),
            "DF" => Some(Self::DF),
            "DP" => Some(Self::DP),
            _ => None,
        }
    }

    pub fn get_name(&self) -> &'static str {
        match self {
            OCDeclareArcType::AS => "AS",
            OCDeclareArcType::EF => "EF",
            OCDeclareArcType::EP => "EP",
            OCDeclareArcType::DF => "DF",
            OCDeclareArcType::DP => "DP",
        }
    }

    pub fn is_dominated_by_or_eq(&self, arc_type: &OCDeclareArcType) -> bool {
        if *self == OCDeclareArcType::AS || self == arc_type {
            return true;
        }
        if *arc_type == OCDeclareArcType::AS {
            return false;
        }
        match arc_type {
            OCDeclareArcType::DF => *self == OCDeclareArcType::EF,
            OCDeclareArcType::DP => *self == OCDeclareArcType::EP,
            _ => false,
        }
    }
}

/// Object Type Association: Direct or O2O Object Types
#[derive(Debug, Clone, Hash, PartialEq, Eq, Serialize, Deserialize, PartialOrd, Ord)]
#[serde(tag = "type")]
pub enum ObjectTypeAssociation {
    Simple { object_type: String },
    O2O {
        first: String,
        second: String,
        reversed: bool,
    },
}

impl ObjectTypeAssociation {
    pub fn new_simple<T: Into<String>>(ot: T) -> Self {
        Self::Simple {
            object_type: ot.into(),
        }
    }

    pub fn new_o2o<T: Into<String>>(ot1: T, ot2: T) -> Self {
        Self::O2O {
            first: ot1.into(),
            second: ot2.into(),
            reversed: false,
        }
    }

    pub fn new_o2o_rev<T: Into<String>>(ot1: T, ot2: T) -> Self {
        Self::O2O {
            first: ot1.into(),
            second: ot2.into(),
            reversed: true,
        }
    }

    pub fn as_template_string(&self) -> String {
        match self {
            ObjectTypeAssociation::Simple { object_type } => object_type.clone(),
            ObjectTypeAssociation::O2O {
                first,
                second,
                reversed,
            } => format!("{}{}{}", first, if !reversed { ">" } else { "<" }, second),
        }
    }

    pub fn get_for_ev<'a>(
        &'a self,
        ev: &'a EventOrSynthetic,
        linked_ocel: &'a SlimLinkedOCEL,
    ) -> Vec<&'a ObjectIndex> {
        match self {
            ObjectTypeAssociation::Simple { object_type } => ev
                .get_e2o(linked_ocel)
                .filter(|o| o.get_ob_type(linked_ocel) == object_type)
                .collect(),
            ObjectTypeAssociation::O2O {
                first,
                second,
                reversed,
            } => ev
                .get_e2o(linked_ocel)
                .filter(|o| o.get_ob_type(linked_ocel) == first)
                .flat_map(|o| {
                    if !reversed {
                        o.get_o2o(linked_ocel)
                            .filter(|o2| o2.get_ob_type(linked_ocel) == second)
                            .collect_vec()
                    } else {
                        o.get_o2o_rev(linked_ocel)
                            .filter(|o2| o2.get_ob_type(linked_ocel) == second)
                            .collect_vec()
                    }
                })
                .collect(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default, Hash, PartialOrd, Ord)]
/// Object Involvement Label of an OC-DECLARE arc
pub struct OCDeclareArcLabel {
    pub each: Vec<ObjectTypeAssociation>,
    pub any: Vec<ObjectTypeAssociation>,
    pub all: Vec<ObjectTypeAssociation>,
}

impl OCDeclareArcLabel {
    pub fn as_template_string(&self) -> String {
        let mut ret = String::new();
        if !self.each.is_empty() {
            ret.push_str(&format!(
                "Each({})",
                self.each.iter().map(|ot| ot.as_template_string()).join(",")
            ));
        }
        if !self.all.is_empty() {
            if !self.each.is_empty() {
                ret.push_str(", ");
            }
            ret.push_str(&format!(
                "All({})",
                self.all.iter().map(|ot| ot.as_template_string()).join(",")
            ));
        }
        if !self.any.is_empty() {
            if !self.each.is_empty() || !self.all.is_empty() {
                ret.push_str(", ");
            }
            ret.push_str(&format!(
                "Any({})",
                self.any.iter().map(|ot| ot.as_template_string()).join(",")
            ));
        }
        ret
    }

    /// Combine this label with another, merging object involvements
    pub fn combine(&self, other: &Self) -> Self {
        let all = self
            .all
            .iter()
            .chain(other.all.iter())
            .cloned()
            .collect::<HashSet<_>>();
        let each = self
            .each
            .iter()
            .chain(other.each.iter())
            .filter(|e| !all.contains(e))
            .cloned()
            .collect::<HashSet<_>>();
        let any = self
            .any
            .iter()
            .chain(other.any.iter())
            .filter(|e| !all.contains(e) && !each.contains(e))
            .cloned()
            .collect::<HashSet<_>>();
        Self {
            each: each.into_iter().sorted().collect(),
            all: all.into_iter().sorted().collect(),
            any: any.into_iter().sorted().collect(),
        }
    }

    /// Tests if this arc label is dominated by the other one
    pub fn is_dominated_by(&self, other: &Self) -> bool {
        let all_all = self.all.iter().all(|a| other.all.contains(a));
        if !all_all {
            return false;
        }
        let all_each = self
            .each
            .iter()
            .all(|a| other.each.contains(a) || other.all.contains(a));
        if !all_each {
            return false;
        }
        self.any
            .iter()
            .all(|a| other.any.contains(a) || other.each.contains(a) || other.all.contains(a))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum SetFilter<T: Eq + Hash> {
    Any(Vec<T>),
    All(Vec<T>),
}

impl<T: Eq + Hash + Ord> SetFilter<T> {
    pub fn check(&self, s: &[T]) -> bool {
        match self {
            SetFilter::Any(items) => items.iter().any(|i| s.binary_search(i).is_ok()),
            SetFilter::All(items) => items.iter().all(|i| s.binary_search(i).is_ok()),
        }
    }
}

impl<'b> OCDeclareArcLabel {
    pub fn get_bindings<'a>(
        &'a self,
        ev: &'a EventOrSynthetic,
        linked_ocel: &'a SlimLinkedOCEL,
    ) -> impl Iterator<Item = Vec<SetFilter<&'a ObjectIndex>>> + use<'a, 'b> {
        self.each
            .iter()
            .sorted_by_key(|ot| match ot {
                ObjectTypeAssociation::Simple { object_type } => {
                    -(linked_ocel.get_obs_of_type(object_type).count() as i32)
                }
                ObjectTypeAssociation::O2O { second, .. } => {
                    -(linked_ocel.get_obs_of_type(second).count() as i32)
                }
            })
            .map(|otass| otass.get_for_ev(ev, linked_ocel))
            // Types without objects in `ev` impose no requirement, for EACH, ALL and ANY alike.
            .filter(|obs| !obs.is_empty())
            .multi_cartesian_product()
            .map(|product| {
                self.all
                    .iter()
                    .sorted_by_key(|ot| match ot {
                        ObjectTypeAssociation::Simple { object_type } => {
                            -(linked_ocel.get_obs_of_type(object_type).count() as i32)
                        }
                        ObjectTypeAssociation::O2O { second, .. } => {
                            -(linked_ocel.get_obs_of_type(second).count() as i32)
                        }
                    })
                    .map(|otass| otass.get_for_ev(ev, linked_ocel))
                    .filter(|obs| !obs.is_empty())
                    .map(SetFilter::All)
                    .chain(if product.is_empty() {
                        Vec::default()
                    } else {
                        vec![SetFilter::All(product)]
                    })
                    .chain(
                        self.any
                            .iter()
                            .sorted_by_key(|ot| match ot {
                                ObjectTypeAssociation::Simple { object_type } => {
                                    -(linked_ocel.get_obs_of_type(object_type).count() as i32)
                                }
                                ObjectTypeAssociation::O2O { second, .. } => {
                                    -(linked_ocel.get_obs_of_type(second).count() as i32)
                                }
                            })
                            .map(|otass| otass.get_for_ev(ev, linked_ocel))
                            .filter(|x| !x.is_empty())
                            .map(|x| {
                                if x.len() == 1 {
                                    SetFilter::All(x)
                                } else {
                                    SetFilter::Any(x)
                                }
                            }),
                    )
                    .collect_vec()
            })
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ObjectInvolvementCounts {
    pub min: usize,
    pub max: usize,
}

impl Default for ObjectInvolvementCounts {
    fn default() -> Self {
        Self {
            min: usize::MAX,
            max: Default::default(),
        }
    }
}

pub fn get_activity_object_involvements(
    locel: &SlimLinkedOCEL,
) -> HashMap<String, HashMap<String, ObjectInvolvementCounts>> {
    locel
        .get_ev_types()
        .map(|et| {
            let mut nums_of_objects_per_type: HashMap<String, ObjectInvolvementCounts> = locel
                .get_ob_types()
                .map(|ot| (ot.to_string(), ObjectInvolvementCounts::default()))
                .collect();
            for ev in locel.get_evs_of_type(et) {
                let mut num_of_objects_for_ev: HashMap<&str, usize> = HashMap::new();
                for oi in ev.get_e2o(locel) {
                    let ot = oi.get_ob_type(locel);
                    *num_of_objects_for_ev.entry(ot).or_default() += 1;
                }
                for (ot, count) in num_of_objects_for_ev {
                    let num_ob_per_type = nums_of_objects_per_type.get_mut(ot).unwrap();
                    if count < num_ob_per_type.min {
                        num_ob_per_type.min = count;
                    }
                    if count > num_ob_per_type.max {
                        num_ob_per_type.max = count;
                    }
                }
            }
            (
                et.to_string(),
                nums_of_objects_per_type
                    .into_iter()
                    .filter(|(_, y)| y.max > 0)
                    .collect(),
            )
        })
        .collect()
}

pub fn get_object_to_object_involvements(
    locel: &SlimLinkedOCEL,
) -> HashMap<String, HashMap<String, ObjectInvolvementCounts>> {
    locel
        .get_ob_types()
        .map(|ot| {
            let mut nums_of_objects_per_type: HashMap<String, ObjectInvolvementCounts> = locel
                .get_ob_types()
                .map(|ot| (ot.to_string(), ObjectInvolvementCounts::default()))
                .collect();
            for ob in locel.get_obs_of_type(ot) {
                let mut num_of_objects_for_ob: HashMap<&str, usize> = HashMap::new();
                for oi in ob.get_o2o(locel) {
                    let ot = oi.get_ob_type(locel);
                    *num_of_objects_for_ob.entry(ot).or_default() += 1;
                }
                for (ot, count) in num_of_objects_for_ob {
                    let num_ob_per_type = nums_of_objects_per_type.get_mut(ot).unwrap();
                    if count < num_ob_per_type.min {
                        num_ob_per_type.min = count;
                    }
                    if count > num_ob_per_type.max {
                        num_ob_per_type.max = count;
                    }
                }
            }
            (
                ot.to_string(),
                nums_of_objects_per_type
                    .into_iter()
                    .filter(|(_, y)| y.max > 0)
                    .collect(),
            )
        })
        .collect()
}

pub fn get_rev_object_to_object_involvements(
    locel: &SlimLinkedOCEL,
) -> HashMap<String, HashMap<String, ObjectInvolvementCounts>> {
    locel
        .get_ob_types()
        .map(|ot| {
            let mut nums_of_objects_per_type: HashMap<String, ObjectInvolvementCounts> = locel
                .get_ob_types()
                .map(|ot| (ot.to_string(), ObjectInvolvementCounts::default()))
                .collect();
            for ob in locel.get_obs_of_type(ot) {
                let mut num_of_objects_for_ob: HashMap<&str, usize> = HashMap::new();
                for oi in ob.get_o2o_rev(locel) {
                    let ot = oi.get_ob_type(locel);
                    *num_of_objects_for_ob.entry(ot).or_default() += 1;
                }
                for (ot, count) in num_of_objects_for_ob {
                    let num_ob_per_type = nums_of_objects_per_type.get_mut(ot).unwrap();
                    if count < num_ob_per_type.min {
                        num_ob_per_type.min = count;
                    }
                    if count > num_ob_per_type.max {
                        num_ob_per_type.max = count;
                    }
                }
            }
            (
                ot.to_string(),
                nums_of_objects_per_type
                    .into_iter()
                    .filter(|(_, y)| y.max > 0)
                    .collect(),
            )
        })
        .collect()
}

/// Represents either a regular event or a synthetic initialization/exit event for an object.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum EventOrSynthetic {
    Event(EventIndex),
    Init(ObjectIndex),
    Exit(ObjectIndex),
}

impl EventOrSynthetic {
    pub fn get_as_event_type(&self, locel: &SlimLinkedOCEL) -> String {
        match self {
            EventOrSynthetic::Event(event_index) => event_index.get_ev_type(locel).to_string(),
            EventOrSynthetic::Init(object_index) => {
                format!("{INIT_EVENT_PREFIX} {}", object_index.get_ob_type(locel))
            }
            EventOrSynthetic::Exit(object_index) => {
                format!("{EXIT_EVENT_PREFIX} {}", object_index.get_ob_type(locel))
            }
        }
    }

    fn get_mock_ev_index(&self, locel: &SlimLinkedOCEL) -> EventIndex {
        match self {
            EventOrSynthetic::Event(event_index) => *event_index,
            EventOrSynthetic::Init(x) | EventOrSynthetic::Exit(x) => {
                let evs = x.get_e2o_rev(locel);
                if matches!(self, EventOrSynthetic::Init(_)) {
                    evs.min_by_key(|ev| locel.get_ev_time(*ev))
                        .copied()
                        .unwrap_or(0_usize.into())
                } else {
                    evs.max_by_key(|ev| locel.get_ev_time(*ev))
                        .copied()
                        .unwrap_or(0_usize.into())
                }
            }
        }
    }

    pub fn get_timestamp(&self, locel: &SlimLinkedOCEL) -> DateTime<FixedOffset> {
        let mock_ev_index = self.get_mock_ev_index(locel);
        let time = mock_ev_index.get_time(locel);
        match self {
            EventOrSynthetic::Event(_) => *time,
            EventOrSynthetic::Init(_) => *time - Duration::milliseconds(1),
            EventOrSynthetic::Exit(_) => *time + Duration::milliseconds(1),
        }
    }

    pub fn get_e2o<'a>(
        &'a self,
        locel: &'a SlimLinkedOCEL,
    ) -> Box<dyn Iterator<Item = &'a ObjectIndex> + 'a> {
        match self {
            EventOrSynthetic::Event(event_index) => Box::new(event_index.get_e2o(locel)),
            EventOrSynthetic::Init(x) | EventOrSynthetic::Exit(x) => {
                Box::new(vec![x].into_iter())
            }
        }
    }

    pub fn get_e2o_set<'a>(&'a self, locel: &'a SlimLinkedOCEL) -> Vec<&'a ObjectIndex> {
        match self {
            EventOrSynthetic::Event(event_index) => event_index.get_e2o(locel).collect(),
            EventOrSynthetic::Init(x) | EventOrSynthetic::Exit(x) => vec![x],
        }
    }

    pub fn get_all_syn_evs(locel: &SlimLinkedOCEL, ev_type: &str) -> Vec<Self> {
        if ev_type.starts_with(INIT_EVENT_PREFIX) {
            let ob_type = &ev_type[INIT_EVENT_PREFIX.len() + 1..ev_type.len()];
            locel
                .get_obs_of_type(ob_type)
                .map(|ob| EventOrSynthetic::Init(*ob))
                .collect()
        } else if ev_type.starts_with(EXIT_EVENT_PREFIX) {
            let ob_type = &ev_type[EXIT_EVENT_PREFIX.len() + 1..ev_type.len()];
            locel
                .get_obs_of_type(ob_type)
                .map(|ob| EventOrSynthetic::Exit(*ob))
                .collect()
        } else {
            locel
                .get_evs_of_type(ev_type)
                .map(|ev| EventOrSynthetic::Event(*ev))
                .collect()
        }
    }

    pub fn get_all_of_et_for_ob<'a>(
        locel: &'a SlimLinkedOCEL,
        ev_type: &'a str,
        ob: ObjectIndex,
    ) -> Box<dyn Iterator<Item = Self> + 'a> {
        if ev_type.starts_with(INIT_EVENT_PREFIX) {
            let ob_type = &ev_type[INIT_EVENT_PREFIX.len() + 1..ev_type.len()];
            if ob.get_ob_type(locel) == ob_type {
                Box::new(vec![Self::Init(ob)].into_iter())
            } else {
                Box::new(Vec::default().into_iter())
            }
        } else if ev_type.starts_with(EXIT_EVENT_PREFIX) {
            let ob_type = &ev_type[EXIT_EVENT_PREFIX.len() + 1..ev_type.len()];
            if ob.get_ob_type(locel) == ob_type {
                Box::new(vec![Self::Exit(ob)].into_iter())
            } else {
                Box::new(Vec::default().into_iter())
            }
        } else {
            Box::new(
                ob.get_e2o_rev_of_evtype(locel, ev_type)
                    .map(|ev| Self::Event(*ev)),
            )
        }
    }

    pub fn get_all_for_ob(locel: &SlimLinkedOCEL, ob: ObjectIndex) -> Vec<Self> {
        ob.get_e2o_rev(locel)
            .map(|e| Self::Event(*e))
            .chain(vec![Self::Init(ob), Self::Exit(ob)])
            .collect()
    }
}
