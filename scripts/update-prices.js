const axios = require('axios');
const { Client } = require('pg');

const API_KEY = process.env.ALPHA_VANTAGE_KEY;
const DATABASE_URL = process.env.DATABASE_URL;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function getUsdToEurRate() {
    const url = `https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=USD&to_currency=EUR&apikey=${API_KEY}`;
    const { data } = await axios.get(url);

    if (data["Note"]) {
        throw new Error(`Alpha Vantage rate limit: ${data["Note"]}`);
    }

    if (data["Information"]) {
        throw new Error(`Alpha Vantage info: ${data["Information"]}`);
    }

    if (data["Error Message"]) {
        throw new Error(`Alpha Vantage error: ${data["Error Message"]}`);
    }

    const fx = data["Realtime Currency Exchange Rate"];
    const rate = fx && fx["5. Exchange Rate"];

    if (!rate) {
        throw new Error(`Risposta FX non valida: ${JSON.stringify(data)}`);
    }

    return parseFloat(rate);
}

async function updateInvestments() {
    let client;

    try {
        client = new Client({
            connectionString: DATABASE_URL,
            ssl: {
                rejectUnauthorized: false
            }
        });

        await client.connect();
        console.log("--- Connessione al DB stabilita ---");

        const res = await client.query('SELECT * FROM assets');
        const assets = res.rows;
        const today = new Date().toISOString().split('T')[0];
        let totalPortfolioValue = 0;
        let updatedCount = 0;
        let usdToEurRate = null;

        console.log(`--- Alpha Vantage Update: ${today} ---`);

        for (const asset of assets) {
            try {
                console.log(`Recupero prezzo per: ${asset.ticker}...`);

                const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${asset.ticker}&apikey=${API_KEY}`;
                const response = await axios.get(url);
                const data = response.data["Global Quote"];

                if (data && data["05. price"]) {
                    let price = parseFloat(data["05. price"]);

                    if (asset.ticker === '3GOL.LON') {
                        if (!usdToEurRate) {
                            usdToEurRate = await getUsdToEurRate();
                            console.log(`Cambio USD/EUR: ${usdToEurRate}`);
                            await sleep(15000);
                        }

                        price = price * usdToEurRate;
                        console.log(`🔁 ${asset.ticker} convertito da USD a EUR: ${price.toFixed(2)}€`);
                    }

                    await client.query(
                        `INSERT INTO asset_prices (asset_id, price, date) 
                         VALUES ($1, $2, $3) 
                         ON CONFLICT (asset_id, date) 
                         DO UPDATE SET price = EXCLUDED.price`,
                        [asset.id, price, today]
                    );

                    totalPortfolioValue += (price * asset.shares);
                    updatedCount++;
                    console.log(`✅ ${asset.ticker}: ${price.toFixed(2)}€`);
                } else if (response.data["Note"]) {
                    console.warn("⚠️ Limite API Alpha Vantage raggiunto.");
                    break;
                } else {
                    console.error(`❌ Ticker non trovato o errore API: ${asset.ticker}`);
                }

                await sleep(15000);

            } catch (e) {
                console.error(`❌ Errore durante l'aggiornamento di ${asset.ticker}: ${e.message}`);
            }
        }

        if (totalPortfolioValue > 0) {
            await client.query(
                `INSERT INTO portfolio_history (total_value, date) 
                 VALUES ($1, $2) 
                 ON CONFLICT (date) 
                 DO UPDATE SET total_value = EXCLUDED.total_value`,
                [totalPortfolioValue, today]
            );

            const logMsg = `Aggiornamento completato per ${updatedCount} asset. Valore totale portafoglio: ${totalPortfolioValue.toFixed(2)}€`;
            await client.query(
                'INSERT INTO notifications (category, message) VALUES ($1, $2)',
                ['INVESTIMENTI', logMsg]
            );

            console.log(`📊 Valore Totale Portafoglio: ${totalPortfolioValue.toFixed(2)}€`);
        }

    } catch (err) {
        console.error('❌ Errore Generale dello script:', err);
    } finally {
        if (client) {
            await client.end();
            console.log("--- Connessione chiusa ---");
        }
        process.exit();
    }
}

updateInvestments();