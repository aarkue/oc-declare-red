import { createContext, useContext } from "react";
import type { QuantifierMode } from "./types";

interface VizContextValue {
    objectTypeColors: Record<string, string>;
    quantifierMode: QuantifierMode;
    animateEdges: boolean;
}

const VizContext = createContext<VizContextValue>({
    objectTypeColors: {},
    quantifierMode: "multi",
    animateEdges: false,
});

export const VizProvider = VizContext.Provider;

export function useVizContext() {
    return useContext(VizContext);
}
