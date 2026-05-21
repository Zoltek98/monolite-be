const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// CHIAVE SEGRETA (Mettila nel file .env per produzione!)
const SECRET_KEY = process.env.JWT_SECRET;

app.use(cors({
  origin: [
    'https://casa-boschetto.com',
    'https://www.casa-boschetto.com',
    'http://localhost:5173' // Aggiungilo per poter testare ancora in locale
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));
app.use(express.json());

const pool = new Pool({
    host: process.env.DB_HOST ,
    user: process.env.DB_USER ,
    password: process.env.DB_PASS ,
    database: process.env.DB_NAME,
    port: 5432,
    ssl: {
    rejectUnauthorized: false 
  }
});

// --- MIDDLEWARE DI AUTENTICAZIONE ---
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ message: "Token mancante" });

    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) return res.status(403).json({ message: "Token non valido o scaduto" });
        req.user = user;
        next();
    });
};

// --- ROTTA LOGIN ---
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;

    // Credenziali hardcoded (sostituisci con valori nel .env o nel DB)
    const ADMIN_USER = process.env.ADMIN_USER || "yuri";
    const ADMIN_PASS_HASH = bcrypt.hashSync(process.env.ADMIN_PASSWORD, 10);

    if (username === ADMIN_USER && bcrypt.compareSync(password, ADMIN_PASS_HASH)) {
        // Genera il token valido per 24 ore
        const token = jwt.sign({ user: username }, SECRET_KEY, { expiresIn: '24h' });
        return res.json({ token });
    }

    res.status(401).json({ message: "Credenziali errate" });
});

// --- ROTTE PROTETTE (Aggiunto authenticateToken) ---

app.get('/api/mutuo', authenticateToken, async (req, res) => {
    const query = 'SELECT id, month, year, price FROM mutuo ORDER BY id ASC';
    try {
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Errore interno' });
    }
});

app.get('/api/luce', authenticateToken, async (req, res) => {
    const query = 'SELECT id, month_ref, month, year, price, kwh FROM luce ORDER BY id ASC';
    try {
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/gas', authenticateToken, async (req, res) => {
    const query = 'SELECT * FROM gas ORDER BY year ASC, month ASC';
    try {
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/assets', authenticateToken, async (req, res) => {
    const query = `
        SELECT a.*, p.price as "currentPrice" 
        FROM assets a
        LEFT JOIN (
            SELECT asset_id, price 
            FROM asset_prices 
            WHERE (asset_id, date) IN (SELECT asset_id, MAX(date) FROM asset_prices GROUP BY asset_id)
        ) p ON a.id = p.asset_id
    `;
    try {
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/portfolio-history', authenticateToken, async (req, res) => {
    const query = "SELECT TO_CHAR(date, 'YYYY-MM-DD') as date, total_value FROM portfolio_history ORDER BY date ASC";
    try {
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/assets/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { name, shares, color } = req.body;
    try {
        await pool.query('UPDATE assets SET name = $1, shares = $2, color = $3 WHERE id = $4', [name, shares, color, id]);
        res.json({ status: 'Success' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/dashboard/summary', authenticateToken, async (req, res) => {
    try {
        const queries = {
            mortgage: 'SELECT price FROM mutuo ORDER BY id DESC LIMIT 1',
            lastLuce: 'SELECT price, month, year, kwh FROM luce ORDER BY year DESC, month DESC LIMIT 1',
            lastGas: 'SELECT price, mc, month, year FROM gas ORDER BY year DESC, month DESC LIMIT 1',
            portfolio: 'SELECT total_value FROM portfolio_history ORDER BY date DESC LIMIT 1',
            temperatures: 'SELECT DISTINCT ON (device_id) device_id, temperature, humidity, recorded_at, h.name FROM device_readings d JOIN home_devices h ON d.device_id = h.id ORDER BY device_id, recorded_at DESC;'
        };
        const mortgage = await pool.query(queries.mortgage);
        const luce = await pool.query(queries.lastLuce);
        const gas = await pool.query(queries.lastGas);
        const portfolio = await pool.query(queries.portfolio);
        const temperatures = await pool.query(queries.temperatures);

        res.json({
            mortgage: mortgage.rows[0]?.price || 0,
            luce: luce.rows[0] || null,
            gas: gas.rows[0] || null,
            portfolio: portfolio.rows[0]?.total_value || 0,
            temperatures: temperatures.rows || null
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/home-status',authenticateToken, async (req, res) => {
  try {
    const query = `
      SELECT DISTINCT ON (device_id) 
             device_id, temperature, humidity, recorded_at, h.name
      FROM device_readings d
      JOIN home_devices h ON d.device_id = h.id
      ORDER BY device_id, recorded_at DESC;
    `;
    const result = await pool.query(query); 
    res.json(result.rows);
  } catch (err) {
    console.error("Errore API home-status:", err);
    res.status(500).json({ error: err.message });
  }
});

// Recupera le ultime 10 notifiche
app.get('/api/notifications', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM notifications ORDER BY created_at DESC LIMIT 10'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Creazione notifica (usata dagli script)
app.post('/api/notifications', authenticateToken, async (req, res) => {
  const { category, message } = req.body;
  try {
    await pool.query(
      'INSERT INTO notifications (category, message) VALUES ($1, $2)',
      [category, message]
    );
    res.status(201).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- ROTTE DI SERVIZIO (Libere o Protette a scelta) ---

app.post('/api/luce/auto', async (req, res) => {
    // Nota: Se questo viene chiamato dal tuo script cron, 
    // potresti voler gestire un'API KEY o lasciare libera se l'IP è locale
    const { year, month, price, month_ref, kwh } = req.body;
    try {
        const check = await pool.query('SELECT id FROM luce WHERE year = $1 AND month = $2', [year, month]);
        if (check.rows.length > 0) return res.status(409).json({ message: 'Esiste già' });
        await pool.query('INSERT INTO luce (year, month, price, month_ref, kwh) VALUES ($1, $2, $3, $4, $5)', [year, month, price, month_ref, kwh]);
        res.json({ status: 'Success' });
    } catch (err) {
        res.status(500).send(err.message);
    }
});

app.post('/api/gas/auto', async (req, res) => {
    const { year, month, price, month_ref, mc } = req.body;
    try {
        const check = await pool.query('SELECT id FROM gas WHERE year = $1 AND month = $2', [year, month]);
        if (check.rows.length > 0) return res.status(409).json({ message: 'Esiste già' });
        await pool.query('INSERT INTO gas (year, month, price, month_ref, mc) VALUES ($1, $2, $3, $4, $5)', [year, month, price, month_ref, mc]);
        res.json({ status: 'Success' });
    } catch (err) {
        res.status(500).send(err.message);
    }
});

// 1. Lista di tutti i report (per lo storico generale)
app.get('/api/music/reports', authenticateToken, async (req, res) => {
    const query = "SELECT id, TO_CHAR(report_date, 'YYYY-MM-DD') as date, total_minutes, total_scrobbles FROM music_reports ORDER BY report_date DESC";
    try {
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. Dettaglio dell'ultimo mese (aggregato dai report settimanali)
app.get('/api/music/monthly-summary', authenticateToken, async (req, res) => {
    const query = `
        SELECT month, year, SUM(total_minutes) as monthly_minutes, SUM(total_scrobbles) as monthly_scrobbles 
        FROM music_reports 
        WHERE report_date >= CURRENT_DATE - INTERVAL '1 month'
        GROUP BY month, year`;
    try {
        const result = await pool.query(query);
        res.json(result.rows[0] || { monthly_minutes: 0, monthly_scrobbles: 0 });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 3. Dettaglio singolo report (con i top artist/track)
app.get('/api/music/report/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const query = `
        SELECT r.*, d.item_type, d.item_name, d.play_count 
        FROM music_reports r
        LEFT JOIN music_report_details d ON r.id = d.report_id
        WHERE r.id = $1
        ORDER BY d.play_count DESC`;
    try {
        const result = await pool.query(query, [id]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

//TFR

app.get('/api/tfr', authenticateToken, async(req,res)=>{
    try {
        const queries = {
            a: 'SELECT * FROM tfr_history ORDER BY data_osservazione DESC',
            b: 'SELECT * FROM tfr_quotas ORDER BY date DESC LIMIT 1',
            };
        const a = await pool.query(queries.a);
        const b = await pool.query(queries.b);
        res.json({
            tfr_history: a.rows || null,
            tfr_quotas: b.rows[0] || null,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get

app.get('/health', (req, res) => res.json({ status: 'OK' }));

app.listen(port, () => {
    console.log(`🚀 Backend sicuro in ascolto sulla porta ${port}`);
});