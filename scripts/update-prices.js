const axios = require('axios');
const { Client } = require('pg'); // Cambiato driver

const API_KEY = 'FB9IDV63IHDFZ2FH'; 

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function updateInvestments() {
    let client;
    try {
        // Configurazione PostgreSQL
        client = new Client({
            host: process.env.DB_HOST || 'db',
            user: process.env.DB_USER || 'user',
            password: process.env.DB_PASS || 'password',
            database: process.env.DB_NAME || 'main',
            port: 5432
        });
        await client.connect();

        const res = await client.query('SELECT * FROM assets');
        const assets = res.rows;
        const today = new Date().toISOString().split('T')[0];
        let totalPortfolioValue = 0;

        console.log(`--- Alpha Vantage Update (Postgres): ${today} ---`);

        for (const asset of assets) {
            try {
                console.log(`Recupero ${asset.ticker}...`);
                
                const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${asset.ticker}&apikey=${API_KEY}`;
                const response = await axios.get(url);
                const data = response.data["Global Quote"];

                if (data && data["05. price"]) {
                    const price = parseFloat(data["05. price"]);
                    
                    // SINTASSI POSTGRES: ON CONFLICT
                    // Nota: Assicurati che asset_id e date abbiano un vincolo UNIQUE insieme
                    await client.query(
                        `INSERT INTO asset_prices (asset_id, price, date) 
                         VALUES ($1, $2, $3) 
                         ON CONFLICT (asset_id, date) 
                         DO UPDATE SET price = EXCLUDED.price`,
                        [asset.id, price, today]
                    );

                    totalPortfolioValue += (price * asset.shares);
                    console.log(`✅ ${asset.ticker}: ${price.toFixed(2)}`);
                } else if (response.data["Note"]) {
                    console.warn("⚠️ Limite API raggiunto.");
                    break; 
                } else {
                    console.error(`❌ Ticker non trovato: ${asset.ticker}`);
                }

                await sleep(15000); 

            } catch (e) {
                console.error(`❌ Errore per ${asset.ticker}: ${e.message}`);
            }
        }

        if (totalPortfolioValue > 0) {
            // SINTASSI POSTGRES: ON CONFLICT
            await client.query(
                `INSERT INTO portfolio_history (total_value, date) 
                 VALUES ($1, $2) 
                 ON CONFLICT (date) 
                 DO UPDATE SET total_value = EXCLUDED.total_value`,
                [totalPortfolioValue, today]
            );
            console.log(`📊 Valore Totale: ${totalPortfolioValue.toFixed(2)}`);
        }

    } catch (err) {
        console.error('Errore Generale:', err);
    } finally {
        if (client) await client.end();
        process.exit();
    }
}

updateInvestments();