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
    const query = 'SELECT id, month_ref, month, year, price FROM luce ORDER BY id ASC';
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
            lastLuce: 'SELECT price, month, year FROM luce ORDER BY year DESC, month DESC LIMIT 1',
            lastGas: 'SELECT price, mc, month, year FROM gas ORDER BY year DESC, month DESC LIMIT 1',
            portfolio: 'SELECT total_value FROM portfolio_history ORDER BY date DESC LIMIT 1'
        };
        const mortgage = await pool.query(queries.mortgage);
        const luce = await pool.query(queries.lastLuce);
        const gas = await pool.query(queries.lastGas);
        const portfolio = await pool.query(queries.portfolio);

        res.json({
            mortgage: mortgage.rows[0]?.price || 0,
            luce: luce.rows[0] || null,
            gas: gas.rows[0] || null,
            portfolio: portfolio.rows[0]?.total_value || 0
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- ROTTE DI SERVIZIO (Libere o Protette a scelta) ---

app.post('/api/luce/auto', async (req, res) => {
    // Nota: Se questo viene chiamato dal tuo script cron, 
    // potresti voler gestire un'API KEY o lasciare libera se l'IP è locale
    const { year, month, price, month_ref } = req.body;
    try {
        const check = await pool.query('SELECT id FROM luce WHERE year = $1 AND month = $2', [year, month]);
        if (check.rows.length > 0) return res.status(409).json({ message: 'Esiste già' });
        await pool.query('INSERT INTO luce (year, month, price, month_ref) VALUES ($1, $2, $3, $4)', [year, month, price, month_ref]);
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

app.get('/health', (req, res) => res.json({ status: 'OK' }));

app.listen(port, () => {
    console.log(`🚀 Backend sicuro in ascolto sulla porta ${port}`);
});