const { TuyaContext } = require('@tuya/tuya-connector-nodejs');
const { Client } = require('pg');

// Configurazione Tuya
const tuya = new TuyaContext({
  baseUrl: 'https://openapi.tuyaeu.com',
  accessKey: process.env.TUYA_ACCESS_ID,
  secretKey: process.env.TUYA_SECRET,
});

// Lista dei tuoi dispositivi (ID recuperati dal portale Tuya)
const SENSORS = [
  { id: 'bf974c5fe6e68d0d98ytou', name: 'terra' },
   { id: 'bfabd364054e01dff7load', name: 'corte' },
  { id: 'bf6dcdbe553ca9f9c0pune', name: 'primo' },
  { id: 'bf253785d5959cca8btlmd', name: 'bagno' }
];

async function updateHomeClimate() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log("--- Connessione DB OK ---");

    // Usa un ciclo for...of standard (non forEach) per gestire correttamente l'asincronia
    for (const sensor of SENSORS) {
    console.log(`--- Elaborazione: ${sensor.name} (ID: ${sensor.id}) ---`);
    
    const response = await tuya.request({
        method: 'GET',
        path: `/v1.0/devices/${sensor.id}/status`,
    });

    if (response.success) {
        const getVal = (code) => response.result.find(item => item.code === code)?.value;
        const temp = getVal('va_temperature') ? getVal('va_temperature') / 10 : null;
        const hum = getVal('va_humidity') || null;

        if (temp !== null) {
            try {
                // 1. FORZIAMO l'inserimento nell'anagrafica prima della lettura
                // Questo "sana" il database se il sensore non esiste o ha l'ID nuovo
                await client.query(
                    `INSERT INTO home_devices (id, name) 
                     VALUES ($1, $2) 
                     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
                    [sensor.id, sensor.name]
                );

                // 2. Inseriamo la lettura
                await client.query(
                    `INSERT INTO device_readings (device_id, temperature, humidity) 
                     VALUES ($1, $2, $3)`,
                    [sensor.id, temp, hum]
                );
                
                console.log(`✅ ${sensor.name} salvato correttamente.`);
            } catch (dbErr) {
                console.error(`❌ Errore DB per ${sensor.name} [ID: ${sensor.id}]:`, dbErr.message);
                // Se fallisce qui, il log ci dirà esattamente quale ID rompe il vincolo
            }
        }
    } else {
        console.error(`❌ Tuya non risponde per ${sensor.name}: ${response.msg}`);
    }
}
    
    console.log("--- Tutte le operazioni completate con successo ---");

  } catch (err) {
    // Questo catturerà qualsiasi errore di Foreign Key o di connessione
    console.error('❌ ERRORE CRITICO:', err.message);
    if (err.detail) console.error('Dettaglio errore:', err.detail);
  } finally {
    await client.end();
    console.log("--- Connessione DB Chiusa ---");
    process.exit();
  }
}

updateHomeClimate();