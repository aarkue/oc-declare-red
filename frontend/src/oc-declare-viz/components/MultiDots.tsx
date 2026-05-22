/** Info about one object type involvement in a constraint */
export interface DotInfo {
    objectType: string;
    color: string;
    quantifier: "each" | "any" | "all";
}

/** Darken a hex color by mixing toward black */
function darken(hex: string, amount = 0.35): string {
    const c = hex.replace("#", "");
    const r = Math.round(parseInt(c.substring(0, 2), 16) * (1 - amount));
    const g = Math.round(parseInt(c.substring(2, 4), 16) * (1 - amount));
    const b = Math.round(parseInt(c.substring(4, 6), 16) * (1 - amount));
    return `rgb(${r},${g},${b})`;
}

/** Mode 6 "multi": overlapping bordered dots
 *  ALL = 3 overlapping filled dots with dark border
 *  ANY = 1 filled + 2 border-only (no fill) overlapping
 *  EACH = single filled dot with dark border
 */
export function MultiDot({ dot }: { dot: DotInfo }) {
    const r = 4.33;
    const step = 3.1;
    const sw = 1;
    const border = darken(dot.color);
    const w = r * 2 + step * 2 + sw * 2;
    const h = r * 2 + sw * 2;
    const cy = h / 2;
    const x0 = r + sw;

    if (dot.quantifier === "all") {
        return (
            <span title={`all(${dot.objectType})`}>
                <svg width={w} height={h} style={{ flexShrink: 0, display: "block" }}>
                    <circle cx={x0 + step * 2} cy={cy} r={r} fill={dot.color} stroke={border} strokeWidth={sw} />
                    <circle cx={x0 + step} cy={cy} r={r} fill={dot.color} stroke={border} strokeWidth={sw} />
                    <circle cx={x0} cy={cy} r={r} fill={dot.color} stroke={border} strokeWidth={sw} />
                </svg>
            </span>
        );
    } else if (dot.quantifier === "any") {
        return (
            <span title={`any(${dot.objectType})`}>
                <svg width={w} height={h} style={{ flexShrink: 0, display: "block" }}>
                    <circle cx={x0 + step * 2} cy={cy} r={r} fill="white" stroke={border} strokeWidth={sw} />
                    <circle cx={x0 + step} cy={cy} r={r} fill="white" stroke={border} strokeWidth={sw} />
                    <circle cx={x0} cy={cy} r={r} fill={dot.color} stroke={border} strokeWidth={sw} />
                </svg>
            </span>
        );
    } else {
        const s = r * 2 + sw * 2;
        return (
            <span title={`each(${dot.objectType})`}>
                <svg width={s} height={s} style={{ flexShrink: 0, display: "block" }}>
                    <circle cx={s / 2} cy={s / 2} r={r} fill={dot.color} stroke={border} strokeWidth={sw} />
                </svg>
            </span>
        );
    }
}
