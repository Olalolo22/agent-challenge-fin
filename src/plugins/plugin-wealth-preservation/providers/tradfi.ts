import { join } from "path";
import { readFileSync } from "fs";

// Strict Typing here for the Macro Data
export interface MacroMetrics {
    currency: string;
    inflationRate: number;
    bankRate: number;
    lastUpdated: string;
    isMocked: boolean;
}

// Locate the mock data file securely
const MOCK_DATA_PATH = join(process.cwd(), "data", "macro_data.json");

/**
 * Fetches the current macroeconomic data for Traditional Finance metrics.
 * Built with an architecture ready for live API integration, currently
 * pointing to a local mock file for hackathon demo stability.
 */
export async function getTradfiMetrics(): Promise<MacroMetrics> {
    try {
        // In a production environment, this would be:
        // const response = await fetch("https://api.cbn.gov.ng/macro/latest");
        // const data = await response.json();
        
        // For hackathon stability, we read the local JSON file.
        const fileContent = readFileSync(MOCK_DATA_PATH, "utf-8");
        const rawData = JSON.parse(fileContent);

        // Data Validation (Security check against malformed JSON)
        if (
            typeof rawData.inflation !== "number" || 
            typeof rawData.bankRate !== "number" ||
            typeof rawData.currency !== "string"
        ) {
            throw new Error("Malformed macro_data.json file.");
        }

        return {
            currency: rawData.currency,
            inflationRate: rawData.inflation,
            bankRate: rawData.bankRate,
            lastUpdated: rawData.lastUpdated,
            isMocked: true // UI sees that this is stable demo data
        };

    } catch (error) {
        console.error("[TradFi Provider] Failed to load macro data:", error);
        
        // Fallback (If the JSON file gets deleted by accident)
        return {
            currency: "NGN",
            inflationRate: 15.06, // Fallback April 2026 estimate
            bankRate: 11.77,
            lastUpdated: new Date().toISOString().split('T')[0],
            isMocked: true
        };
    }
}