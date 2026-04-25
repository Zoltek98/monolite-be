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
  { id: 'bf974c5fe6e68d0d98ytou', name: 'Piano terra' },
   { id: 'bfabd364054e01dff7load', name: 'Corte' },
  { id: 'bf6dcdbe553ca9f9c0pune', name: 'Primo piano' },
  { id: 'bf253785d5959cca8btlmd', name: 'Bagno' }
];

async function updateHomeClimate() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log("--- Inizio Lettura Sensori ---");

    for (const sensor of SENSORS) {
      const response = await tuya.request({
        method: 'GET',
        path: `/v1.0/devices/${sensor.id}/status`,
      });

      if (response.success) {
        // Estraiamo i valori dall'array "code/value"
        const getVal = (code) => response.result.find(item => item.code === code)?.value;

        // Trasformazione dati (204 -> 20.4)
        const temp = getVal('va_temperature') ? getVal('va_temperature') / 10 : null;
        const hum = getVal('va_humidity') || null;
        const battery = getVal('battery_state') || null;

        if (temp !== null) {
          await client.query(
            `INSERT INTO device_readings (device_id, temperature, humidity, battery_state) 
             VALUES ($1, $2, $3, $4)`,
            [sensor.id, temp, hum, battery]
          );
          console.log(`✅ ${sensor.name}: ${temp}°C, ${hum}%`);
        }
      } else {
        console.error(`❌ Errore sensore ${sensor.name}:`, response.msg);
      }
    }
  } catch (err) {
    console.error('❌ Errore generale:', err.message);
  } finally {
    await client.end();
    process.exit();
  }
}

updateHomeClimate();