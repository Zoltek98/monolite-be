const axios = require('axios');
const { Client } = require('pg');

// Recuperiamo i segreti dalle variabili d'ambiente di GitHub
const API_KEY = process.env.ALPHA_VANTAGE_KEY;
const DATABASE_URL = process.env.DATABASE_URL;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function updateInvestments() {
    let client;
    try {
        // Configurazione PostgreSQL ottimizzata per Neon
        client = new Client({
            connectionString: DATABASE_URL,
            ssl: {
                rejectUnauthorized: false // Obbligatorio per Neon/Render
            }
        });
        
        await client.connect();
        console.log("--- Connessione al DB stabilita ---");

        const res = await client.query('SELECT * FROM assets');
        const assets = res.rows;
        const today = new Date().toISOString().split('T')[0];
        let totalPortfolioValue = 0;
        let updatedCount = 0;

        console.log(`--- Alpha Vantage Update: ${today} ---`);

        for (const asset of assets) {
            try {
                console.log(`Recupero prezzo per: ${asset.ticker}...`);
                
                const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${asset.ticker}&apikey=${API_KEY}`;
                const response = await axios.get(url);
                const data = response.data["Global Quote"];

                if (data && data["05. price"]) {
                    const price = parseFloat(data["05. price"]);
                    
                    // Aggiorna o Inserisce il prezzo dell'asset per oggi
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
                    console.warn("⚠️ Limite API Alpha Vantage raggiunto (5 chiamate/min).");
                    break; 
                } else {
                    console.error(`❌ Ticker non trovato o errore API: ${asset.ticker}`);
                }

                // Sleep di 15 secondi per rispettare il piano free di Alpha Vantage
                await sleep(15000); 

            } catch (e) {
                console.error(`❌ Errore durante l'aggiornamento di ${asset.ticker}: ${e.message}`);
            }
        }

        if (totalPortfolioValue > 0) {
            // Salva lo storico del valore totale del portafoglio
            await client.query(
                `INSERT INTO portfolio_history (total_value, date) 
                 VALUES ($1, $2) 
                 ON CONFLICT (date) 
                 DO UPDATE SET total_value = EXCLUDED.total_value`,
                [totalPortfolioValue, today]
            );

            // INSERIMENTO NOTIFICA NELLA WEBAPP
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