const axios = require('axios');
const cheerio = require('cheerio');
const { Client } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;
const URL_BORSA = "https://www.borsaitaliana.it/borsa/fondi/dettaglio/4PPSECU.html";

async function updateTfr() {
    let client;
    try {
        client = new Client({
            connectionString: DATABASE_URL,
            ssl: { rejectUnauthorized: false }
        });
        await client.connect();
        console.log("--- Connessione DB stabilita ---");

        // 1. Fetch della pagina con User-Agent
        const { data } = await axios.get(URL_BORSA, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });

        const $ = cheerio.load(data);

        // 2. Scraping del Prezzo
        const priceRaw = $('span.t-text.-black-warm-60.-formatPrice strong').first().text();
        const price = parseFloat(priceRaw.replace(',', '.').trim());

        // 3. Scraping della Data di aggiornamento (evitando lo span EUR)
        const dateContainer = $('span.t-text:contains("Data:")');
        const dateRaw = dateContainer.find('strong').text().trim(); // Esempio: "15/04/26"
        
        if (!isNaN(price) && dateRaw) {
            // Scomposizione data
            const dateParts = dateRaw.split('/');
            if (dateParts.length !== 3) throw new Error("Formato data non valido");

            let [day, month, year] = dateParts;

            // Trasformiamo l'anno "26" in "2026"
            if (year.length === 2) {
                year = `20${year}`;
            }

            // Formattazione ISO YYYY-MM-DD (es. 2026-04-15)
            // padStart aggiunge lo '0' se mancano cifre (es. mese '4' diventa '04')
            const formattedDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;

            console.log(`Dati trovati: Prezzo ${price} | Data Originale ${dateRaw} | Data Formattata ${formattedDate}`);

            // 4. Inserimento con controllo duplicati sulla data
            const result = await client.query(
                `INSERT INTO tfr_history (valore, data_osservazione) 
                 VALUES ($1, $2) 
                 ON CONFLICT (data_osservazione) 
                 DO UPDATE SET valore = EXCLUDED.valore
                 RETURNING *`,
                [price, formattedDate]
            );

            if (result.rowCount > 0) {
                console.log("✅ Dati TFR aggiornati con successo.");
                
                await client.query(
                    'INSERT INTO notifications (category, message) VALUES ($1, $2)',
                    ['TFR', `Nuovo valore TFR: ${price}€ (Data: ${dateRaw})`]
                );
            }
        } else {
            throw new Error(`Impossibile recuperare i dati. Prezzo: ${priceRaw}, Data: ${dateRaw}`);
        }

    } catch (err) {
        // Stampiamo l'errore per il debug
        console.error('❌ Errore script TFR:', err.message);
    } finally {
        if (client) await client.end();
        console.log("--- Connessione chiusa ---");
        process.exit();
    }
}

updateTfr();