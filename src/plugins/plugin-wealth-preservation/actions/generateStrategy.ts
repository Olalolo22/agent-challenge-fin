import { Action } from "@elizaos/core";
import { getTradfiMetrics } from "../providers/tradfi";
import { getDefiOptions } from "../providers/defi";
import { callQwen } from "../utils/qwen";
import db from "../database/db";

const searchKnowledgeStmt = db.prepare(`
    SELECT title, content FROM agent_knowledge 
    WHERE agent_knowledge MATCH ? 
    ORDER BY rank LIMIT 2
`);

const insertGoalStmt = db.prepare(`
    INSERT INTO user_goals (goal, target_amount, current_savings, time_horizon_months) VALUES (?, ?, ?, ?)
`);

const insertMacroStmt = db.prepare(`
    INSERT INTO tradfi_metrics (currency, inflation_rate, bank_rate) VALUES (?, ?, ?)
`);

function extractNumbers(text: string): { current: number; target: number; months?: number } {
    const matches = text.match(/[\d,]+(?:\.\d+)?/g);
    if (!matches) return { current: 50000, target: 190000 };
    const numbers = matches.map(m => parseFloat(m.replace(/,/g, '')));
    let current = numbers[0];
    let target = numbers.length > 1 ? numbers[1] : current * 2;
    let months = numbers.length > 2 ? numbers[2] : undefined;
    if (numbers.length === 1) {
        current = numbers[0];
        target = numbers[0] * 2;
    }
    return { current, target, months };
}

function extractGoal(text: string): string {
    const match = text.match(/for a (.+?)(\.|\,|$| in )/i) || 
                  text.match(/to buy (.+?)(\.|\,|$| in )/i) ||
                  text.match(/goal:?\s*(.+?)(\.|\,|$| in )/i);
    return match ? match[1].trim() : "savings goal";
}

function extractTimeHorizon(text: string): number | undefined {
    const match = text.match(/in (\d+) months?/i) || text.match(/time horizon:?\s*(\d+)/i);
    return match ? parseInt(match[1]) : undefined;
}

function isQwenResponseValid(response: string): boolean {
    if (!response || response.length < 100) return false;
    // Check if the response ends with a complete sentence and contains a recommendation
    const lastChar = response.trim().slice(-1);
    if (![".", "!", "?"].includes(lastChar)) return false;
    // Check for common cut‑off patterns (e.g., "2. Evaluate the Options:" without following content)
    if (response.includes("Evaluate the Options") && response.split("\n").length < 6) return false;
    // We ensure it doesn't end with an incomplete thought (e.g., "Give..." or "Wait,")
    if (response.match(/(Give|Wait|However|But)[,.]?\s*$/i)) return false;
    return true;
}

export const generateStrategyAction: Action = {
    name: "GENERATE_WEALTH_STRATEGY",
    similes: ["SHOW_STRATEGY", "PRESERVE_WEALTH"],
    description: "Uses Qwen LLM (Nosana) to generate strategy, falls back to deterministic if needed.",

    validate: async (runtime, message) => {
        const text = (message.content?.text || "").toLowerCase();
        const hasNumberToNumber = /\d+(?:[.,]\d+)?\s+to\s+\d+(?:[.,]\d+)?/.test(text);
        return text.includes("strategy") || text.includes("preserve") || text.includes("save") || text.includes("have") || hasNumberToNumber;
    },

    handler: async (runtime, message, state, options, callback) => {
        const userText = message.content?.text || "";
        const goal = extractGoal(userText);
        const { current: currentSavings, target: targetAmount, months: parsedMonths } = extractNumbers(userText);
        const timeHorizon = extractTimeHorizon(userText) || parsedMonths;

        const macro = await getTradfiMetrics();
        const defiOptions = await getDefiOptions();
        defiOptions.sort((a, b) => b.apy - a.apy);
        const bestDeFi = defiOptions[0];

        const realBank = macro.bankRate - macro.inflationRate;
        const realBestDeFi = bestDeFi.apy - macro.inflationRate;

        // Store user goal (for deterministic fallback as well)
        insertGoalStmt.run(goal, targetAmount, currentSavings, timeHorizon || null);
        insertMacroStmt.run(macro.currency, macro.inflationRate, macro.bankRate);

        // Prepare prompt for Qwen
        const prompt = `
You are a financial preservation assistant. User goal: ${goal}. Current savings: ₦${currentSavings.toLocaleString()}. Target: ₦${targetAmount.toLocaleString()}. Time horizon: ${timeHorizon ? timeHorizon + " months" : "not specified"}.
Macro: inflation ${macro.inflationRate}%, bank rate ${macro.bankRate}% (real return ${realBank.toFixed(2)}%).
DeFi: ${bestDeFi.protocol} ${bestDeFi.product} offers ${bestDeFi.apy}% APY (real return ${realBestDeFi.toFixed(2)}%).

Provide a concise, urgent strategy (3-4 steps) explaining which option is better and why. Keep under 200 words.
`;

        // Try Qwen first
        let llmSuccess = false;
        let llmResponse = "";
        try {
            llmResponse = await callQwen(prompt, {
                inflation: macro.inflationRate,
                bankRate: macro.bankRate,
                defiApy: bestDeFi.apy,
                userSavings: currentSavings,
                userGoal: targetAmount
            });
            if (isQwenResponseValid(llmResponse)) {
                llmSuccess = true;
            } else {
                console.warn("[Strategy] Qwen response invalid (incomplete or lacking recommendation). Falling back.");
            }
        } catch (e) {
            console.warn("[Strategy] Qwen failed, using deterministic fallback", e);
        }

        let strategy = "";
        if (llmSuccess) {
            strategy = `**🤖 Qwen‑Generated Strategy (Nosana endpoint)**\n\n${llmResponse}`;
        } else {
            // DETERMINISTIC FALLBACK 
            strategy = `**📊 Deterministic Strategy (Qwen unavailable)**\n\n`;

            let winner: "bank" | "defi" | "tie" = "tie";
            if (realBestDeFi > realBank) winner = "defi";
            else if (realBank > realBestDeFi) winner = "bank";

            strategy += `📊 **Current data:**\n- Inflation: ${macro.inflationRate}%\n- Bank rate: ${macro.bankRate}% → real return: ${realBank.toFixed(2)}%\n- Best DeFi (${bestDeFi.protocol} ${bestDeFi.product}): ${bestDeFi.apy}% → real return: ${realBestDeFi.toFixed(2)}%\n\n`;

            if (winner === "bank") {
                strategy += `✅ **Recommendation:** The bank offers a higher real return (less negative) than DeFi. Keep your savings in a traditional bank account.\n`;
                strategy += `⚠️ *Both options have negative real returns due to high inflation. Consider increasing your savings rate or shortening your time horizon.*\n`;
            } 
            else if (winner === "defi") {
                strategy += `✅ **Recommendation:** DeFi provides a better real return than the bank. Here are the top DeFi options (USDC on Solana):\n`;
                for (let i = 0; i < Math.min(3, defiOptions.length); i++) {
                    const opt = defiOptions[i];
                    const real = opt.apy - macro.inflationRate;
                    strategy += `  ${i+1}. **${opt.protocol} ${opt.product}**: ${opt.apy}% APY (real ${real.toFixed(2)}%)\n`;
                }
                strategy += `\n📈 **With the best option (${bestDeFi.protocol} ${bestDeFi.product}):**\n`;
            } 
            else {
                strategy += `⚖️ **Tie:** Bank and DeFi offer the same real return (${realBank.toFixed(2)}%). Your choice depends on risk preference and convenience.\n`;
                strategy += `If you prefer DeFi, here are top options:\n`;
                for (let i = 0; i < Math.min(3, defiOptions.length); i++) {
                    const opt = defiOptions[i];
                    const real = opt.apy - macro.inflationRate;
                    strategy += `  ${i+1}. **${opt.protocol} ${opt.product}**: ${opt.apy}% APY (real ${real.toFixed(2)}%)\n`;
                }
                strategy += `\nIf you prefer the bank, keep your savings in a traditional account.\n`;
            }

            // Projections (deterministic)
            if (winner !== "bank") {
                const recommendedYield = bestDeFi.apy;
                const monthlyRate = recommendedYield / 100 / 12;
                let monthsToGoal = Math.log(targetAmount / currentSavings) / Math.log(1 + monthlyRate);
                if (monthsToGoal > 0 && isFinite(monthsToGoal)) {
                    strategy += `- Time to reach ₦${targetAmount.toLocaleString()} from ₦${currentSavings.toLocaleString()}: ~${Math.ceil(monthsToGoal)} months (assuming no extra savings).\n`;
                } else {
                    strategy += `- Your savings will grow, but inflation may still outpace if you don't add more.\n`;
                }

                if (timeHorizon && timeHorizon > 0) {
                    const fvCurrent = currentSavings * Math.pow(1 + monthlyRate, timeHorizon);
                    const neededFuture = targetAmount - fvCurrent;
                    let requiredMonthly = 0;
                    if (neededFuture > 0 && monthlyRate > 0) {
                        const annuityFactor = (Math.pow(1 + monthlyRate, timeHorizon) - 1) / monthlyRate;
                        requiredMonthly = neededFuture / annuityFactor;
                    } else if (neededFuture <= 0) {
                        requiredMonthly = 0;
                    } else {
                        requiredMonthly = neededFuture / timeHorizon;
                    }
                    if (requiredMonthly <= 0) {
                        strategy += `\n🎯 **With your ${timeHorizon}-month goal:** You already have enough (with growth) to reach ₦${targetAmount.toLocaleString()}.`;
                    } else {
                        strategy += `\n🎯 **To reach ₦${targetAmount.toLocaleString()} in ${timeHorizon} months:** Save ~₦${Math.ceil(requiredMonthly).toLocaleString()} per month (in ${bestDeFi.protocol} ${bestDeFi.product}).`;
                    }
                }
            } else {
                const monthlyRate = macro.bankRate / 100 / 12;
                let monthsToGoal = Math.log(targetAmount / currentSavings) / Math.log(1 + monthlyRate);
                if (monthsToGoal > 0 && isFinite(monthsToGoal)) {
                    strategy += `- Time to reach ₦${targetAmount.toLocaleString()} from ₦${currentSavings.toLocaleString()} with bank: ~${Math.ceil(monthsToGoal)} months.\n`;
                }
                if (timeHorizon && timeHorizon > 0) {
                    const fvCurrent = currentSavings * Math.pow(1 + monthlyRate, timeHorizon);
                    const neededFuture = targetAmount - fvCurrent;
                    let requiredMonthly = neededFuture > 0 ? neededFuture / timeHorizon : 0;
                    if (requiredMonthly <= 0) {
                        strategy += `\n🎯 **With your ${timeHorizon}-month goal:** You already have enough.`;
                    } else {
                        strategy += `\n🎯 **To reach ₦${targetAmount.toLocaleString()} in ${timeHorizon} months:** Save ~₦${Math.ceil(requiredMonthly).toLocaleString()} per month in a bank account.`;
                    }
                }
            }
            strategy += `\n\n*This is for educational purposes. Consult a financial advisor before making decisions.*`;
        }

        if (callback) callback({ text: strategy, action: "GENERATE_WEALTH_STRATEGY" });
    },

    examples: []
};