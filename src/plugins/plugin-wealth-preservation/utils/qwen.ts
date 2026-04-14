export async function callQwen(prompt: string, fallbackContext?: { inflation: number; bankRate: number; defiApy: number; userSavings: number; userGoal: number }): Promise<string> {
    try {
        const apiUrl = process.env.OPENAI_API_URL;
        const apiKey = process.env.OPENAI_API_KEY || "nosana";
        const modelName = process.env.MODEL_NAME || "Qwen3.5-9B-FP8";

        if (!apiUrl) throw new Error("OPENAI_API_URL missing");

        const endpoint = `${apiUrl.replace(/\/$/, '')}/chat/completions`;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);

        
        const systemPrompt = `You are a financial assistant. Respond ONLY with the final answer. Do not include any analysis, reasoning, step numbers, or internal monologue. Do not use phrases like "Analyze", "Evaluate", "Drafting", "Step". Just give the answer directly in 3-4 short sentences. Start your response with a clear recommendation.`;

        const response = await fetch(endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: modelName,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: prompt }
                ],
                temperature: 0.2,
                max_tokens: 400
            }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`API returned ${response.status}: ${errText}`);
        }

        const data = await response.json();

        let text = data.choices?.[0]?.message?.content;
        if (!text || text.trim() === "") {
            text = data.choices?.[0]?.message?.reasoning;
        }
        if (!text) text = data.content || data.response;

        if (!text || text.trim() === "") throw new Error("Empty response");

        // remove everything before the first occurrence of a recommendation keyword
        const keywords = ["recommend", "strategy", "you should", "consider", "the best option", "I recommend", "based on"];
        let cleaned = text;
        for (const kw of keywords) {
            const idx = text.toLowerCase().indexOf(kw);
            if (idx !== -1) {
                cleaned = text.slice(idx);
                break;
            }
        }
        // If still too long, we take last paragraph
        if (cleaned.length > 500) {
            const paras = cleaned.split(/\n\s*\n/);
            cleaned = paras[paras.length - 1];
        }
        // Removing any leftover numbering or bullet symbols
        cleaned = cleaned.replace(/^[\d\-\*•]+\s*/, '').trim();

        return cleaned;
    } catch (error) {
        console.warn("[Qwen] Live API failed, using fallback:", error);
        if (fallbackContext) {
            const { inflation, bankRate, defiApy, userSavings, userGoal } = fallbackContext;
            const realBank = (bankRate - inflation).toFixed(2);
            const realDeFi = (defiApy - inflation).toFixed(2);
            return `Based on current data: inflation ${inflation}%, bank rate ${bankRate}% (real return ${realBank}%), DeFi yield ${defiApy}% (real return ${realDeFi}%). Your savings of ₦${userSavings.toLocaleString()} toward ₦${userGoal.toLocaleString()} are losing purchasing power in fiat. Consider moving a portion to USDC on Solana DeFi to earn ~${defiApy}% APY, which outpaces the bank rate. Keep an emergency fund in NGN. This is not financial advice.`;
        }
        return "Strategy: Move a portion of your savings to USDC and deposit into Kamino Finance on Solana to earn ~8.5% APY, protecting against inflation.";
    }
}