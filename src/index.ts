import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateStrategyAction } from './plugins/plugin-wealth-preservation/actions/generateStrategy.js';
import { initializeSchema } from './plugins/plugin-wealth-preservation/database/db.js';
import { getTradfiMetrics } from './plugins/plugin-wealth-preservation/providers/tradfi.js';
import { getDefiOptions } from './plugins/plugin-wealth-preservation/providers/defi.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize database
initializeSchema();

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Main message endpoint
app.post('/message', async (req, res) => {
    const { text, userId = 'user1' } = req.body;
    if (!text) {
        return res.status(400).json({ error: 'No text provided' });
    }

    // Create minimal runtime mock
    const mockRuntime = {} as any;
    const mockMessage = { 
        content: { text }, 
        userId,
        agentId: 'mock-agent',
        roomId: 'mock-room'
    } as any;
    const mockState = {} as any;
    let responseText = '';

    // Mock callback matching ElizaOS HandlerCallback signature
    const mockCallback = async (content: any) => {
        responseText = content.text;
        return []; // Return empty array as expected by some ElizaOS versions
    };

    try {
        const isValid = await generateStrategyAction.validate(mockRuntime, mockMessage, mockState);
        if (isValid) {
            await generateStrategyAction.handler(mockRuntime, mockMessage, mockState, {}, mockCallback);
            res.json({ response: responseText });
        } else {
            res.json({ response: "I can help with wealth preservation. Please provide your savings goal, target amount, and current savings (e.g., 'I have ₦50,000 for a ₦190,000 repair')." });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to generate strategy' });
    }
});

// API endpoints for frontend dashboard
app.get('/api/macro', async (req, res) => {
    const macro = await getTradfiMetrics();
    res.json(macro);
});

app.get('/api/defi', async (req, res) => {
    const options = await getDefiOptions();
    const best = options[0];
    res.json({
        protocol: best.protocol,
        product: best.product,
        asset: best.asset,
        apy: best.apy,
        isCached: best.isCached,
        allOptions: options
    });
});

const PORT = process.env.SERVER_PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Wealth Preservation Agent running on http://localhost:${PORT}`);
});