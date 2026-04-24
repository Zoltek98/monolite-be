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

        // 1. Fetch della pagina con User-Agent per evitare blocchi
        const { data } = await axios.get(URL_BORSA, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });

        const $ = cheerio.load(data);

        // 2. Scraping del Prezzo
        // Cerchiamo il testo strong dentro le classi indicate
        const priceRaw = $('span.t-text.-black-warm-60.-formatPrice strong').first().text();
        // Pulizia del prezzo: togliamo spazi e sostituiamo la virgola con il punto
        const price = parseFloat(priceRaw.replace(',', '.').trim());

        // 3. Scraping della Data di aggiornamento
        // Spesso è in uno span vicino o identificato da t-text -black-warm-60
        // Nota: Il selettore potrebbe variare leggermente in base alla struttura esatta
        const dateRaw = $('span.t-text.-black-warm-60:contains("/")').first().text().trim(); 
        
        // Convertiamo la data da DD/MM/YYYY a YYYY-MM-DD per Postgres
        const [day, month, year] = dateRaw.split('/');
        const formattedDate = `${year}-${month}-${day}`;
        console.log("->",price, dateRaw);

        if (!isNaN(price) && dateRaw) {
            console.log(`Dati trovati: Prezzo ${price} | Data ${formattedDate}`);

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
                
                // Inserimento notifica (opzionale)
                await client.query(
                    'INSERT INTO notifications (category, message) VALUES ($1, $2)',
                    ['TFR', `Nuovo valore TFR: ${price}€ del ${dateRaw}`]
                );
            }
        } else {
            throw new Error("Impossibile recuperare prezzo o data dalla pagina.");
        }

    } catch (err) {
        console.error('❌ Errore script TFR:', err.message);
    } finally {
        if (client) await client.end();
        process.exit();
    }
}

updateTfr();