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

        const { data } = await axios.get(URL_BORSA, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });

        const $ = cheerio.load(data);

        const priceRaw = $('span.t-text.-black-warm-60.-formatPrice strong').first().text();
        const price = parseFloat(priceRaw.replace(',', '.').trim());

        const dateContainer = $('span.t-text:contains("Data:")');
        const dateRaw = dateContainer.find('strong').text().trim(); 
        
        if (!isNaN(price) && dateRaw) {
            const dateParts = dateRaw.split('/');
            if (dateParts.length !== 3) throw new Error("Formato data non valido");

            let [day, month, year] = dateParts;
            if (year.length === 2) year = `20${year}`;
            const formattedDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;

            console.log(`Analisi: Prezzo ${price} | Data ${formattedDate}`);

            // --- MODIFICA QUI ---
            // Usiamo una clausola WHERE nell'UPDATE per agire solo se il valore è diverso.
            // Se il valore è uguale, rowCount sarà 0.
            const query = `
                INSERT INTO tfr_history (valore, data_osservazione) 
                VALUES ($1, $2) 
                ON CONFLICT (data_osservazione) 
                DO UPDATE SET valore = EXCLUDED.valore
                WHERE tfr_history.valore IS DISTINCT FROM EXCLUDED.valore
                RETURNING *;
            `;

            const result = await client.query(query, [price, formattedDate]);

            if (result.rowCount > 0) {
                console.log("✅ Dati TFR nuovi o variati. Database aggiornato.");
                
                // Recupera la quota più recente da tfr_quotas
                const quotaQuery = `
                    SELECT number FROM tfr_quotas 
                    ORDER BY date DESC 
                    LIMIT 1;
                `;
                const quotaResult = await client.query(quotaQuery);
                
                let notificationMessage = `Nuovo valore TFR: ${price}€ (Data: ${dateRaw})`;
                
                if (quotaResult.rowCount > 0) {
                    const currentQuotas = parseFloat(quotaResult.rows[0].number);
                    const totalValue = currentQuotas * price;
                    
                    // Arricchisce il messaggio con il numero di quote e il controvalore totale
                    notificationMessage += ` | Quote attuali: ${currentQuotas.toFixed(4)} | Valore totale: ${totalValue.toFixed(2)}€`;
                    console.log(`Calcolato valore totale: ${totalValue.toFixed(2)}€ basato su ${currentQuotas} quote.`);
                } else {
                    console.log("ℹ️ Nessuna quota trovata in tfr_quotas. Invio notifica standard.");
                }
                
                await client.query(
                    'INSERT INTO notifications (category, message) VALUES ($1, $2)',
                    ['TFR', notificationMessage]
                );
            } else {
                console.log("ℹ️ Nessuna variazione rilevata (stesso prezzo per la stessa data). Skip notifiche.");
            }
        } else {
            throw new Error(`Impossibile recuperare i dati. Prezzo: ${priceRaw}, Data: ${dateRaw}`);
        }

    } catch (err) {
        console.error('❌ Errore script TFR:', err.message);
    } finally {
        if (client) await client.end();
        console.log("--- Connessione chiusa ---");
        process.exit();
    }
}

updateTfr();