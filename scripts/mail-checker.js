const { ImapFlow } = require('imapflow');
const axios = require('axios');

const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    logger: false, // Disabilita i log pesanti se non ti servono
    auth: {
        user: process.env.EMAIL,
        pass: process.env.EMAIL_PASS.trim() // .trim() rimuove eventuali spazi bianchi invisibili
    },
    // Forza il client a non usare SASL PLAIN se Gmail fa i capricci
    capabilities: ['IMAP4rev1', 'AUTH=LOGIN'], 
    authMethod: 'LOGIN'
});

const autoInsert = async () => {
    await client.connect();
    let lock = await client.getMailboxLock('INBOX');
    
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);

    try {
        let i = 0;
        for await (let message of client.fetch({ since: yesterday }, { source: true, envelope: true })) {
            const body = message.source.toString();
            const subject = message.envelope.subject;

            if (subject.includes("Fattura Edison Energia")) {
                const priceMatch = body.match(/Importo bolletta:.*?([\d,]+)/);
                const consumptionMatch = body.match(/Consumi:.*?(\d+)\s*(Smc|kWh)/i);
                const periodMatch = body.match(/Periodo di competenza:.*?([A-Z]{3})\s*\d{4}\s*-\s*([A-Z]{3})\s*(\d{4})/);

                if (priceMatch && consumptionMatch && periodMatch) {
                    i++;
                    const price = parseFloat(priceMatch[1].replace(',', '.'));
                    const value = parseInt(consumptionMatch[1]);
                    const unit = consumptionMatch[2].toLowerCase();
                    const endMonthName = periodMatch[2];
                    let billYear = parseInt(periodMatch[3]);

                    const monthsMap = { 'GEN': 1, 'FEB': 2, 'MAR': 3, 'APR': 4, 'MAG': 5, 'GIU': 6, 'LUG': 7, 'AGO': 8, 'SET': 9, 'OTT': 10, 'NOV': 11, 'DIC': 12 };
                    
                    // LOGICA +2 MESI
                    let endMonthNum = monthsMap[endMonthName];
                    let targetMonth = endMonthNum + 2;
                    let targetYear = billYear;

                    if (targetMonth > 12) {
                        targetMonth = targetMonth - 12;
                        targetYear = targetYear + 1; // Se era Nov/Dic, la competenza è l'anno dopo
                    }

                    const type = unit === 'kwh' ? 'luce' : 'gas';
                    const payload = { 
                        year: targetYear, 
                        month: targetMonth, 
                        price: price, 
                        [unit === 'kwh' ? 'kwh' : 'mc']: value, 
                        month_ref: `${periodMatch[1]}/${periodMatch[2]}` 
                    };

                    try {
                        await axios.post(`https://api.casa-boschetto.com/api/${type}/auto`, payload);
                        await axios.post(`https://api.casa-boschetto.com/api/notifications`, {
                            type: 'SUCCESS',
                            category: 'BOLLETTE',
                            message: `Edison: inserita bolletta da ${price}€ per ${targetMonth}/${targetYear}`
                        });
                        console.log(`✅ ${type.toUpperCase()} inserita correttamente (Mese competenza: ${targetMonth}/${targetYear}): ${price}€`);
                    } catch (error) {
                        if (error.response && error.response.status === 409) {
                            console.warn(`⚠️ Record ${type} ${targetMonth}/${targetYear} già esistente.`);
                        } else {
                            console.error(`❌ Errore API per ${type}:`, error.message);
                        }
                    }
                }
            }
        }
        if(i==0) console.log('Non sono arrivate fatture');
    } finally {
        lock.release();
        await client.logout();
    }
};

autoInsert().catch(console.error);