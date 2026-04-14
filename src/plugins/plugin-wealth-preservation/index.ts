import { Plugin } from "@elizaos/core";
import { generateStrategyAction } from "./actions/generateStrategy";
import { initializeSchema } from "./database/db";


initializeSchema();

export const wealthPreservationPlugin: Plugin = {
    name: "wealth-preservation",
    description: "A highly personalized quantitative agent bridging TradFi macroeconomics with Solana DeFi yields.",
    actions: [generateStrategyAction], // Exposes master controller
    evaluators: [], // Not needed
    providers: [],  // using direct imports in our Action instead of Eliza's auto-injection to avoid XML issues
};

export default wealthPreservationPlugin;