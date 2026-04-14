import db from "../database/db";

export interface DefiOption {
    protocol: string;
    product: string;
    asset: string;
    apy: number;
    isCached: boolean;
}

const insertYieldStmt = db.prepare(`
    INSERT INTO defi_metrics (protocol, asset, apy, product) VALUES (?, ?, ?, ?)
`);

const getLatestYieldStmt = db.prepare(`
    SELECT apy FROM defi_metrics 
    WHERE protocol = ? AND asset = ? AND product = ?
    ORDER BY timestamp DESC LIMIT 1
`);

async function fetchDefiLlamaSolanaApy(): Promise<{ protocol: string; apy: number } | null> {
    try {
        console.log("[DeFi] Fetching from DefiLlama...");
        const response = await fetch('https://yields.llama.fi/pools', {
            headers: { 'User-Agent': 'WealthPreservationAgent/1.0' },
            signal: AbortSignal.timeout(10000)
        });
        if (!response.ok) {
            console.warn(`[DeFi] DefiLlama responded with status ${response.status}`);
            return null;
        }
        const data = await response.json();
        const pools = data.data || [];
        console.log(`[DeFi] Retrieved ${pools.length} pools total`);

        
        const solanaUsdc = pools.filter((p: any) => {
            const chain = p.chain?.toLowerCase();
            const symbol = p.symbol?.toUpperCase();
            const apy = p.apy;
            return chain === 'solana' && symbol === 'USDC' && apy && apy > 0;
        });

        console.log(`[DeFi] Found ${solanaUsdc.length} Solana USDC pools with positive APY`);
        if (solanaUsdc.length === 0) {
            // Logging a few pools to see what's available
            const sample = pools.slice(0, 5).map((p: any) => ({ chain: p.chain, symbol: p.symbol, apy: p.apy }));
            console.log("[DeFi] Sample pools:", sample);
            return null;
        }

        solanaUsdc.sort((a: any, b: any) => b.apy - a.apy);
        const best = solanaUsdc[0];
        console.log(`[DeFi] Best pool: ${best.project} - ${best.apy}% APY`);

        let protocol = best.project || 'Unknown';
        if (protocol.toLowerCase().includes('kamino')) protocol = 'Kamino';
        else if (protocol.toLowerCase().includes('solend')) protocol = 'Solend';
        else if (protocol.toLowerCase().includes('marginfi')) protocol = 'Marginfi';

        return { protocol, apy: parseFloat(best.apy) };
    } catch (e) {
        console.warn('[DeFi] DefiLlama fetch failed:', e);
        return null;
    }
}

export async function getDefiOptions(): Promise<DefiOption[]> {
    const options: DefiOption[] = [];

    const live = await fetchDefiLlamaSolanaApy();
    if (live !== null) {
        options.push({
            protocol: live.protocol,
            product: 'Lending (USDC)',
            asset: 'USDC',
            apy: live.apy,
            isCached: false
        });
        insertYieldStmt.run(live.protocol, 'USDC', live.apy, 'Lending');
        console.log(`[DeFi] Using live yield: ${live.protocol} ${live.apy}%`);
    } else {
        // Try cache
        const cached = getLatestYieldStmt.get('DefiLlama', 'USDC', 'Lending') as { apy: number } | undefined;
        if (cached) {
            options.push({
                protocol: 'Cached (DefiLlama)',
                product: 'Lending (USDC)',
                asset: 'USDC',
                apy: cached.apy,
                isCached: true
            });
            console.log(`[DeFi] Using cached yield: ${cached.apy}%`);
        } else {
            console.warn('[DeFi] All sources failed. Using mock fallback.');
            options.push({
                protocol: 'Mock',
                product: 'Simulated Yield',
                asset: 'USDC',
                apy: 8.5,
                isCached: true
            });
        }
    }

    return options;
}