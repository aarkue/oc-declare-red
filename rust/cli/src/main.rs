use std::path::PathBuf;
use std::time::Instant;

use clap::{Parser, Subcommand, ValueEnum};
use oc_declare::{
    discover_behavior_constraints, reduce_oc_arcs, oc_declare_conformance,
    OCDeclareDiscoveryOptions, OCDeclareReductionMode, O2OMode, OCDeclareArcType,
    OcelStats, ModelStats,
};
use process_mining::core::event_data::object_centric::linked_ocel::SlimLinkedOCEL;
use process_mining::core::event_data::object_centric::ocel_json::import_ocel_json_path;
use process_mining::core::event_data::object_centric::ocel_xml::xml_ocel_import::import_ocel_xml_path;
use process_mining::OCEL;

#[derive(Parser)]
#[command(
    name = "oc-declare",
    about = "OC-DECLARE: Object-Centric Declarative Process Model Discovery and Reduction",
    version
)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Clone, ValueEnum)]
enum ReductionMode {
    None,
    Lossless,
}

#[derive(Clone, ValueEnum)]
enum O2OModeArg {
    None,
    Direct,
    Reversed,
    Bidirectional,
}

#[derive(Clone, ValueEnum)]
enum ArrowType {
    AS,
    EF,
    EP,
}

#[derive(Subcommand)]
enum Commands {
    /// Discover an OC-DECLARE model from an OCEL file (JSON or XML)
    Discover {
        /// Path to the input OCEL file (JSON or XML)
        input: PathBuf,

        /// Output file path (prints to stdout if omitted)
        #[arg(short, long)]
        output: Option<PathBuf>,

        /// Noise threshold: fraction of source events allowed to violate a constraint (0.0 - 1.0)
        #[arg(short, long, default_value_t = 0.2)]
        noise_threshold: f64,

        /// Transitive reduction mode to apply after discovery
        #[arg(short, long, value_enum, default_value_t = ReductionMode::None)]
        reduction: ReductionMode,

        /// Object-to-object relationship mode
        #[arg(long, value_enum, default_value_t = O2OModeArg::None)]
        o2o: O2OModeArg,

        /// Disable refinement of object involvement labels (refinement is ON by default)
        #[arg(long, default_value_t = false)]
        no_refine: bool,

        /// Max count for candidate generation (0 = unlimited, default: 20 = pre-pruning)
        #[arg(long, default_value_t = 20)]
        max_count_gen: usize,

        /// Max count for candidate filtering (0 = unlimited, default: 20 = pre-pruning)
        #[arg(long, default_value_t = 20)]
        max_count_filter: usize,

        /// Arrow types to consider (default: AS, EF, EP)
        #[arg(long, value_enum, num_args = 1..)]
        arrow_types: Option<Vec<ArrowType>>,

        /// Only discover constraints involving these activities (default: all)
        #[arg(long, num_args = 1..)]
        activities: Option<Vec<String>>,
    },

    /// Apply lossless transitive reduction to an existing OC-DECLARE model
    Reduce {
        /// Path to the model JSON file (array of OC-DECLARE arcs)
        input: PathBuf,

        /// Output file path (prints to stdout if omitted)
        #[arg(short, long)]
        output: Option<PathBuf>,
    },

    /// Check conformance of a model against an OCEL file
    Conformance {
        /// Path to the model JSON file (array of OC-DECLARE arcs)
        model: PathBuf,

        /// Path to the OCEL file (JSON or XML)
        ocel: PathBuf,

        /// Output file path (prints to stdout if omitted)
        #[arg(short, long)]
        output: Option<PathBuf>,
    },

    /// Show OCEL statistics (event/object types, counts)
    Info {
        /// Path to the OCEL file (JSON or XML)
        input: PathBuf,
    },

    /// Compute OC-DECLARE model statistics (paper metrics)
    Stats {
        /// Path to the model JSON file (array of OC-DECLARE arcs)
        input: PathBuf,

        /// Output file path (prints to stdout if omitted)
        #[arg(short, long)]
        output: Option<PathBuf>,
    },

    /// Full pipeline: discover + reduce in one step
    Pipeline {
        /// Path to the input OCEL file (JSON or XML)
        input: PathBuf,

        /// Output file path (prints to stdout if omitted)
        #[arg(short, long)]
        output: Option<PathBuf>,

        /// Noise threshold (0.0 - 1.0)
        #[arg(short, long, default_value_t = 0.2)]
        noise_threshold: f64,

        /// Transitive reduction mode
        #[arg(short, long, value_enum, default_value_t = ReductionMode::Lossless)]
        reduction: ReductionMode,

        /// Object-to-object relationship mode
        #[arg(long, value_enum, default_value_t = O2OModeArg::None)]
        o2o: O2OModeArg,

        /// Disable refinement of object involvement labels (refinement is ON by default)
        #[arg(long, default_value_t = false)]
        no_refine: bool,

        /// Only discover constraints involving these activities (default: all)
        #[arg(long, num_args = 1..)]
        activities: Option<Vec<String>>,
    },

    /// Project an existing model onto a subset of activities
    Project {
        /// Path to the model JSON file (array of OC-DECLARE arcs)
        input: PathBuf,

        /// Output file path (prints to stdout if omitted)
        #[arg(short, long)]
        output: Option<PathBuf>,

        /// Activities to keep in the projection
        #[arg(long, num_args = 1..)]
        activities: Vec<String>,

        /// Use naive projection (simple filter) instead of lossless (transitive closure)
        #[arg(long, default_value_t = false)]
        naive: bool,
    },
}

fn to_reduction_mode(m: &ReductionMode) -> OCDeclareReductionMode {
    match m {
        ReductionMode::None => OCDeclareReductionMode::None,
        ReductionMode::Lossless => OCDeclareReductionMode::Lossless,
    }
}

fn to_o2o_mode(m: &O2OModeArg) -> O2OMode {
    match m {
        O2OModeArg::None => O2OMode::None,
        O2OModeArg::Direct => O2OMode::Direct,
        O2OModeArg::Reversed => O2OMode::Reversed,
        O2OModeArg::Bidirectional => O2OMode::Bidirectional,
    }
}

fn to_arc_type(a: &ArrowType) -> OCDeclareArcType {
    match a {
        ArrowType::AS => OCDeclareArcType::AS,
        ArrowType::EF => OCDeclareArcType::EF,
        ArrowType::EP => OCDeclareArcType::EP,
    }
}

fn load_ocel(path: &PathBuf) -> OCEL {
    eprintln!("Loading OCEL from {}...", path.display());
    let start = Instant::now();
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
    let ocel = match ext {
        "xml" | "xmlocel" => import_ocel_xml_path(path).expect("Failed to load OCEL XML"),
        _ => import_ocel_json_path(path).expect("Failed to load OCEL JSON"),
    };
    eprintln!(
        "Loaded: {} events, {} objects ({:.2?})",
        ocel.events.len(),
        ocel.objects.len(),
        start.elapsed()
    );
    ocel
}

fn output_json(arcs: &[oc_declare::OCDeclareArc], output: &Option<PathBuf>) {
    let json = serde_json::to_string_pretty(arcs).expect("Failed to serialize");
    if let Some(path) = output {
        std::fs::write(path, &json).expect("Failed to write output file");
        eprintln!("Written {} constraints to {}", arcs.len(), path.display());
    } else {
        println!("{json}");
    }
}

fn build_options(
    noise_threshold: f64,
    reduction: &ReductionMode,
    o2o: &O2OModeArg,
    refine: bool,
    max_count_gen: usize,
    max_count_filter: usize,
    arrow_types: &Option<Vec<ArrowType>>,
    activities: &Option<Vec<String>>,
) -> OCDeclareDiscoveryOptions {
    let considered_arrow_types = arrow_types
        .as_ref()
        .map(|types| types.iter().map(to_arc_type).collect())
        .unwrap_or_else(|| vec![OCDeclareArcType::EF, OCDeclareArcType::EP, OCDeclareArcType::AS].into_iter().collect());

    let max_gen = if max_count_gen == 0 { None } else { Some(max_count_gen) };
    let max_filter = if max_count_filter == 0 { None } else { Some(max_count_filter) };

    OCDeclareDiscoveryOptions {
        noise_threshold,
        reduction: to_reduction_mode(reduction),
        o2o_mode: to_o2o_mode(o2o),
        refinement: refine,
        counts_for_generation: (Some(1), max_gen),
        counts_for_filter: (Some(1), max_filter),
        considered_arrow_types,
        acts_to_use: activities.clone(),
    }
}

fn main() {
    let cli = Cli::parse();

    match cli.command {
        Commands::Discover {
            input,
            output,
            noise_threshold,
            reduction,
            o2o,
            no_refine,
            max_count_gen,
            max_count_filter,
            arrow_types,
            activities,
        } => {
            let ocel = load_ocel(&input);
            let locel = SlimLinkedOCEL::from_ocel(ocel);
            let options = build_options(
                noise_threshold,
                &reduction,
                &o2o,
                !no_refine,
                max_count_gen,
                max_count_filter,
                &arrow_types,
                &activities,
            );
            eprintln!("Discovering OC-DECLARE constraints (noise={noise_threshold})...");
            let start = Instant::now();
            let arcs = discover_behavior_constraints(&locel, options);
            eprintln!(
                "Discovered {} constraints ({:.2?})",
                arcs.len(),
                start.elapsed()
            );
            output_json(&arcs, &output);
        }
        Commands::Reduce {
            input,
            output,
        } => {
            let json = std::fs::read_to_string(&input).expect("Failed to read model file");
            let arcs: Vec<oc_declare::OCDeclareArc> =
                serde_json::from_str(&json).expect("Failed to parse model JSON");
            eprintln!(
                "Reducing {} constraints (lossless)...",
                arcs.len()
            );
            let start = Instant::now();
            let reduced = reduce_oc_arcs(arcs, true);
            eprintln!(
                "Reduced to {} constraints ({:.2?})",
                reduced.len(),
                start.elapsed()
            );
            output_json(&reduced, &output);
        }
        Commands::Conformance {
            model,
            ocel,
            output,
        } => {
            let json = std::fs::read_to_string(&model).expect("Failed to read model file");
            let arcs: Vec<oc_declare::OCDeclareArc> =
                serde_json::from_str(&json).expect("Failed to parse model JSON");
            let ocel_data = load_ocel(&ocel);
            let locel = SlimLinkedOCEL::from_ocel(ocel_data);
            eprintln!("Checking conformance of {} constraints...", arcs.len());
            let start = Instant::now();
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
            eprintln!("Conformance checked ({:.2?})", start.elapsed());
            let json_out = serde_json::to_string_pretty(&scores).expect("Failed to serialize");
            if let Some(path) = output {
                std::fs::write(&path, &json_out).expect("Failed to write output file");
                eprintln!("Written {} scores to {}", scores.len(), path.display());
            } else {
                println!("{json_out}");
            }
        }
        Commands::Info { input } => {
            let ocel = load_ocel(&input);
            let stats = OcelStats::from_ocel(&ocel);
            println!("{}", serde_json::to_string_pretty(&stats).unwrap());
        }
        Commands::Stats { input, output } => {
            let json = std::fs::read_to_string(&input).expect("Failed to read model file");
            let arcs: Vec<oc_declare::OCDeclareArc> =
                serde_json::from_str(&json).expect("Failed to parse model JSON");
            let stats = ModelStats::from_arcs(&arcs);
            let json_out = serde_json::to_string_pretty(&stats).expect("Failed to serialize");
            if let Some(path) = output {
                std::fs::write(&path, &json_out).expect("Failed to write output file");
                eprintln!("Written stats to {}", path.display());
            } else {
                println!("{json_out}");
            }
        }
        Commands::Project {
            input,
            output,
            activities,
            naive,
        } => {
            let json = std::fs::read_to_string(&input).expect("Failed to read model file");
            let arcs: Vec<oc_declare::OCDeclareArc> =
                serde_json::from_str(&json).expect("Failed to parse model JSON");
            let act_set: std::collections::HashSet<String> = activities.into_iter().collect();
            eprintln!(
                "Projecting {} constraints onto {} activities ({})...",
                arcs.len(),
                act_set.len(),
                if naive { "naive" } else { "lossless" }
            );
            let start = Instant::now();
            let projected = if naive {
                oc_declare::project_oc_arcs_naive(arcs, &act_set)
            } else {
                oc_declare::project_oc_arcs_smart(arcs, &act_set, true)
            };
            eprintln!(
                "Projected to {} constraints ({:.2?})",
                projected.len(),
                start.elapsed()
            );
            output_json(&projected, &output);
        }
        Commands::Pipeline {
            input,
            output,
            noise_threshold,
            reduction,
            o2o,
            no_refine,
            activities,
        } => {
            let ocel = load_ocel(&input);
            let locel = SlimLinkedOCEL::from_ocel(ocel);
            let options = build_options(
                noise_threshold,
                &reduction,
                &o2o,
                !no_refine,
                20,
                20,
                &None,
                &activities,
            );
            eprintln!("Running full pipeline (noise={noise_threshold}, reduction={:?})...", reduction.to_possible_value().unwrap().get_name());
            let start = Instant::now();
            let arcs = discover_behavior_constraints(&locel, options);
            eprintln!(
                "Result: {} constraints ({:.2?})",
                arcs.len(),
                start.elapsed()
            );
            output_json(&arcs, &output);
        }
    }
}
