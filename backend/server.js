// Midway Music Hall - Express server with full API endpoints
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2');
const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5001;

// layout history retention configuration
const LAYOUT_HISTORY_MAX = parseInt(process.env.LAYOUT_HISTORY_MAX || '200', 10);
const LAYOUT_HISTORY_RETENTION_DAYS = parseInt(process.env.LAYOUT_HISTORY_RETENTION_DAYS || '90', 10);

app.use(cors());
app.use(express.json());

// Create MySQL connection pool (promise wrapper)
const pool = mysql.createPool({
	host: process.env.DB_HOST || 'localhost',
	user: process.env.DB_USER || 'root',
	password: process.env.DB_PASSWORD || '',
	database: process.env.DB_NAME || 'midway_music_hall',
	waitForConnections: true,
	connectionLimit: 10,
	queueLimit: 0
}).promise();

// Health
app.get('/api/health', (req, res) => res.json({ success: true, status: 'ok' }));

// --- Authentication (demo + DB lookup) ---
app.post('/api/login', async (req, res) => {
	const { email, password } = req.body || {};
	try {
		// Demo credentials (development)
		if (email === 'admin' && password === 'admin123') {
			return res.json({ success: true, user: { username: 'admin', email: 'admin@midwaymusichal.com' } });
		}

		// Try DB lookup by username or email
		const [rows] = await pool.query('SELECT * FROM admins WHERE username = ? OR email = ? LIMIT 1', [email, email]);
		if (!rows || rows.length === 0) return res.status(401).json({ success: false, message: 'Invalid credentials' });

		const user = rows[0];
		const match = await bcrypt.compare(password, user.password_hash);
		if (!match) return res.status(401).json({ success: false, message: 'Invalid credentials' });

		// Don't return password hash
		delete user.password_hash;
		res.json({ success: true, user });
	} catch (error) {
		console.error('Login error:', error);
		res.status(500).json({ success: false, message: 'Server error' });
	}
});

// --- Events CRUD ---
app.get('/api/events', async (req, res) => {
	try {
		const [events] = await pool.query('SELECT * FROM events ORDER BY start_datetime ASC');
		res.json({ success: true, events });
	} catch (error) {
		console.error('GET /api/events error:', error);
		res.status(500).json({ success: false, message: 'Failed to fetch events' });
	}
});

app.get('/api/events/:id', async (req, res) => {
	try {
		const [rows] = await pool.query('SELECT * FROM events WHERE id = ? LIMIT 1', [req.params.id]);
		if (!rows || rows.length === 0) return res.status(404).json({ success: false, message: 'Event not found' });
		res.json({ success: true, event: rows[0] });
	} catch (error) {
		console.error('GET /api/events/:id error:', error);
		res.status(500).json({ success: false, message: 'Failed to fetch event' });
	}
});

app.post('/api/events', async (req, res) => {
	try {
		const { title, description, start_datetime, end_datetime, venue_section } = req.body;
		const [result] = await pool.query(
			'INSERT INTO events (title, description, start_datetime, end_datetime, venue_section) VALUES (?, ?, ?, ?, ?)',
			[title, description, start_datetime, end_datetime, venue_section]
		);
		res.json({ success: true, id: result.insertId });
	} catch (error) {
		console.error('POST /api/events error:', error);
		res.status(500).json({ success: false, message: 'Failed to create event' });
	}
});

app.put('/api/events/:id', async (req, res) => {
	try {
		const { title, description, start_datetime, end_datetime, venue_section } = req.body;
		await pool.query(
			'UPDATE events SET title = ?, description = ?, start_datetime = ?, end_datetime = ?, venue_section = ? WHERE id = ?',
			[title, description, start_datetime, end_datetime, venue_section, req.params.id]
		);
		res.json({ success: true });
	} catch (error) {
		console.error('PUT /api/events/:id error:', error);
		res.status(500).json({ success: false, message: 'Failed to update event' });
	}
});

app.delete('/api/events/:id', async (req, res) => {
	try {
		await pool.query('DELETE FROM events WHERE id = ?', [req.params.id]);
		res.json({ success: true });
	} catch (error) {
		console.error('DELETE /api/events/:id error:', error);
		res.status(500).json({ success: false, message: 'Failed to delete event' });
	}
});

// --- Seating ---
app.get('/api/seating', async (req, res) => {
	try {
		const [rows] = await pool.query('SELECT id, event_id, section as section_name, row_label, seat_number, total_seats, seat_type, is_active, selected_seats, pos_x, pos_y, rotation, status FROM seating ORDER BY section, row_label, seat_number');
		res.json({ success: true, seating: rows });
	} catch (error) {
		console.error('GET /api/seating error:', error);
		res.status(500).json({ success: false, message: 'Failed to fetch seating' });
	}
});

	app.post('/api/seating', async (req, res) => {
	try {
		const { id, event_id, section, row_label, seat_number, status, total_seats, seat_type, is_active, selected_seats, pos_x, pos_y, rotation } = req.body;
		if (id) {
			await pool.query(
				'UPDATE seating SET event_id = ?, section = ?, row_label = ?, seat_number = ?, total_seats = ?, seat_type = ?, is_active = ?, pos_x = ?, pos_y = ?, rotation = ?, status = ? WHERE id = ?',
				[event_id || null, section, row_label, seat_number, total_seats || 1, seat_type || 'general', is_active ? 1 : 0, pos_x || null, pos_y || null, rotation || 0, status || 'available', id]
			);
			return res.json({ success: true, id });
		}

		const [result] = await pool.query(
					'INSERT INTO seating (event_id, section, row_label, seat_number, total_seats, seat_type, is_active, selected_seats, pos_x, pos_y, rotation, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
					[event_id || null, section, row_label, seat_number, total_seats || 1, seat_type || 'general', is_active ? 1 : 0, selected_seats ? JSON.stringify(selected_seats) : null, pos_x || null, pos_y || null, rotation || 0, status || 'available']
		);
		res.json({ success: true, id: result.insertId });
	} catch (error) {
		console.error('POST /api/seating error:', error);
		res.status(500).json({ success: false, message: 'Failed to save seating' });
	}
});

// Partial update for seating rows (patch only provided fields)
app.patch('/api/seating/:id', async (req, res) => {
	try {
		const id = req.params.id;
		const allowed = ['event_id','section','row_label','seat_number','total_seats','seat_type','is_active','selected_seats','pos_x','pos_y','rotation','status'];
		const updates = [];
		const values = [];
		for (const key of allowed) {
			if (Object.prototype.hasOwnProperty.call(req.body, key)) {
				updates.push(`\`${key}\` = ?`);
				// if selected_seats is provided as an object/array, stringify for JSON column
				if (key === 'selected_seats') {
					values.push(req.body[key] ? JSON.stringify(req.body[key]) : null);
				} else {
					values.push(req.body[key]);
				}
			}
		}
		if (updates.length === 0) return res.status(400).json({ success: false, message: 'No valid fields provided' });
		values.push(id);
		const sql = `UPDATE seating SET ${updates.join(', ')} WHERE id = ?`;
		await pool.query(sql, values);
		res.json({ success: true, id });
	} catch (err) {
		console.error('PATCH /api/seating/:id error:', err);
		res.status(500).json({ success: false, message: 'Failed to update seating' });
	}
});

// Stage settings endpoints
app.get('/api/stage-settings', async (req, res) => {
	try {
		const [rows] = await pool.query('SELECT key_name, value FROM stage_settings');
		const obj = {};
		rows.forEach(r => { obj[r.key_name] = r.value; });
		res.json({ success: true, settings: obj });
	} catch (err) {
		console.error('GET /api/stage-settings error:', err);
		res.status(500).json({ success: false, message: 'Failed to fetch stage settings' });
	}
});

app.put('/api/stage-settings', async (req, res) => {
	try {
		const settings = req.body || {};
		for (const [key, value] of Object.entries(settings)) {
			await pool.query('INSERT INTO stage_settings (key_name, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = ?', [key, value, value]);
		}
		res.json({ success: true });
	} catch (err) {
		console.error('PUT /api/stage-settings error:', err);
		res.status(500).json({ success: false, message: 'Failed to save stage settings' });
	}
});

// Layout history endpoints (server-side snapshots)
app.post('/api/layout-history', async (req, res) => {
	try {
		const { snapshot } = req.body || {};
		if (!snapshot) return res.status(400).json({ success: false, message: 'No snapshot provided' });
		const [result] = await pool.query('INSERT INTO layout_history (snapshot) VALUES (?)', [JSON.stringify(snapshot)]);
		// prune by count and age
		try{
			// delete oldest rows if over max
			await pool.query(`DELETE FROM layout_history WHERE id IN (SELECT id FROM (SELECT id FROM layout_history ORDER BY id DESC LIMIT 18446744073709551615 OFFSET ?) tmp)`, [LAYOUT_HISTORY_MAX]);
			// delete by age
			await pool.query('DELETE FROM layout_history WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)', [LAYOUT_HISTORY_RETENTION_DAYS]);
		}catch(e){ console.error('Prune after insert error', e); }
		res.json({ success: true, id: result.insertId });
	} catch (err) {
		console.error('POST /api/layout-history error:', err);
		res.status(500).json({ success: false, message: 'Failed to store snapshot' });
	}
});

// Manual prune endpoint
app.post('/api/layout-history/prune', async (req, res) => {
	try{
		const { maxEntries, olderThanDays } = req.body || {};
		const maxE = parseInt(maxEntries || LAYOUT_HISTORY_MAX, 10);
		const days = parseInt(olderThanDays || LAYOUT_HISTORY_RETENTION_DAYS, 10);
		try{
			await pool.query(`DELETE FROM layout_history WHERE id IN (SELECT id FROM (SELECT id FROM layout_history ORDER BY id DESC LIMIT 18446744073709551615 OFFSET ?) tmp)`, [maxE]);
			await pool.query('DELETE FROM layout_history WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)', [days]);
		}catch(e){ console.error('Manual prune error', e); }
		res.json({ success: true });
	}catch(err){ console.error('POST /api/layout-history/prune error', err); res.status(500).json({ success:false }); }
});

app.get('/api/layout-history', async (req, res) => {
	try {
		const limit = parseInt(req.query.limit || '50', 10);
		const [rows] = await pool.query('SELECT id, snapshot, created_at FROM layout_history ORDER BY id DESC LIMIT ?', [limit]);
		res.json({ success: true, history: rows.map(r => ({ id: r.id, snapshot: r.snapshot, created_at: r.created_at })) });
	} catch (err) {
		console.error('GET /api/layout-history error:', err);
		res.status(500).json({ success: false, message: 'Failed to fetch history' });
	}
});

app.get('/api/layout-history/:id', async (req, res) => {
	try {
		const [rows] = await pool.query('SELECT id, snapshot, created_at FROM layout_history WHERE id = ? LIMIT 1', [req.params.id]);
		if (!rows || rows.length === 0) return res.status(404).json({ success: false, message: 'Snapshot not found' });
		res.json({ success: true, snapshot: rows[0] });
	} catch (err) {
		console.error('GET /api/layout-history/:id error:', err);
		res.status(500).json({ success: false, message: 'Failed to fetch snapshot' });
	}
});

app.delete('/api/seating/:id', async (req, res) => {
	try {
		await pool.query('DELETE FROM seating WHERE id = ?', [req.params.id]);
		res.json({ success: true });
	} catch (error) {
		console.error('DELETE /api/seating/:id error:', error);
		res.status(500).json({ success: false, message: 'Failed to delete seating' });
	}
});

// --- Seat Requests ---
app.get('/api/seat-requests', async (req, res) => {
	try {
		// optional filters
		const filters = [];
		const values = [];
		if (req.query.event_id) { filters.push('sr.event_id = ?'); values.push(req.query.event_id); }
		if (req.query.status) { filters.push('sr.status = ?'); values.push(req.query.status); }
		const where = filters.length ? ('WHERE ' + filters.join(' AND ')) : '';
		const sql = `SELECT sr.*, e.title as event_title, e.start_datetime FROM seat_requests sr LEFT JOIN events e ON sr.event_id = e.id ${where} ORDER BY sr.created_at DESC`;
		const [requests] = await pool.query(sql, values);
		// normalize response: parse selected_seats and include contact object from separate columns if present
		requests.forEach(r => {
			if (r.selected_seats && typeof r.selected_seats === 'string') {
				try { r.selected_seats = JSON.parse(r.selected_seats); } catch (e) { r.selected_seats = []; }
			}
			// assemble contact object if email/phone columns exist
			if (!r.contact) {
				r.contact = { email: r.customer_email || null, phone: r.customer_phone || null };
			}
		});
		res.json({ success: true, requests });
	} catch (error) {
		console.error('GET /api/seat-requests error:', error);
		res.status(500).json({ success: false, message: 'Failed to fetch seat requests' });
	}
});

	// Approve a seat request: mark request approved and merge seats into seating.selected_seats
	app.post('/api/seat-requests/:id/approve', async (req, res) => {
		const rid = req.params.id;
		const conn = await pool.getConnection();
		try {
			await conn.beginTransaction();
			const [[reqRow]] = await conn.query('SELECT * FROM seat_requests WHERE id = ? LIMIT 1', [rid]);
			if (!reqRow) {
				await conn.rollback();
				conn.release();
				return res.status(404).json({ success: false, message: 'Request not found' });
			}
				let seats = [];
				try { seats = JSON.parse(reqRow.selected_seats || '[]'); } catch(e) { seats = []; }
				// Check for conflicts first: if any seat is already reserved, abort
				const conflicts = [];
				for (const seatId of seats) {
					const parts = seatId.split('-');
					const seatNum = parts.pop();
					const row_label = parts.pop();
					const section = parts.join('-');
					const [rows] = await conn.query('SELECT id, selected_seats FROM seating WHERE section = ? AND row_label = ? LIMIT 1', [section, row_label]);
					if (!rows || rows.length === 0) continue;
					const sRow = rows[0];
					let existing = [];
					try { existing = sRow.selected_seats ? JSON.parse(sRow.selected_seats) : []; } catch(e) { existing = []; }
					if (existing.includes(seatId)) conflicts.push(seatId);
				}
				if (conflicts.length > 0) {
					await conn.rollback();
					conn.release();
					return res.status(409).json({ success: false, message: 'Conflict - seats already reserved', conflicts });
				}
				// No conflicts: persist
				for (const seatId of seats) {
					const parts = seatId.split('-');
					const seatNum = parts.pop();
					const row_label = parts.pop();
					const section = parts.join('-');
					const [rows] = await conn.query('SELECT id, selected_seats FROM seating WHERE section = ? AND row_label = ? LIMIT 1', [section, row_label]);
					if (!rows || rows.length === 0) continue;
					const sRow = rows[0];
					let existing = [];
					try { existing = sRow.selected_seats ? JSON.parse(sRow.selected_seats) : []; } catch(e) { existing = []; }
					if (!existing.includes(seatId)) {
						existing.push(seatId);
						await conn.query('UPDATE seating SET selected_seats = ? WHERE id = ?', [JSON.stringify(existing), sRow.id]);
					}
				}
			// mark request approved
			await conn.query('UPDATE seat_requests SET status = ? WHERE id = ?', ['approved', rid]);
			await conn.commit();
			conn.release();
			res.json({ success: true });
		} catch (err) {
			try{ await conn.rollback(); }catch(e){}
			conn.release();
			console.error('POST /api/seat-requests/:id/approve error:', err);
			res.status(500).json({ success: false, message: 'Failed to approve request' });
		}
	});

	// Deny a seat request
	app.post('/api/seat-requests/:id/deny', async (req, res) => {
		try {
			const rid = req.params.id;
			await pool.query('UPDATE seat_requests SET status = ? WHERE id = ?', ['denied', rid]);
			res.json({ success: true });
		} catch (err) {
			console.error('POST /api/seat-requests/:id/deny error:', err);
			res.status(500).json({ success: false, message: 'Failed to deny request' });
		}
	});

app.post('/api/seat-requests', async (req, res) => {
	try {
		const { event_id, customer_name, contact, selected_seats, special_requests } = req.body;
		const seatsJson = JSON.stringify(selected_seats || []);
		const customerEmail = contact && contact.email ? contact.email : null;
		const customerPhone = contact && contact.phone ? contact.phone : null;
			const totalSeats = Array.isArray(selected_seats) ? selected_seats.length : (selected_seats ? JSON.parse(selected_seats).length : 0);
			const [result] = await pool.query(
				'INSERT INTO seat_requests (event_id, customer_name, customer_email, customer_phone, selected_seats, total_seats, special_requests, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())',
				[event_id, customer_name, customerEmail, customerPhone, seatsJson, totalSeats, special_requests || null, 'pending']
			);
		res.json({ success: true, id: result.insertId });
	} catch (error) {
		console.error('POST /api/seat-requests error:', error);
		res.status(500).json({ success: false, message: 'Failed to submit seat request' });
	}
});

app.put('/api/seat-requests/:id', async (req, res) => {
	try {
		const { status } = req.body;
		await pool.query('UPDATE seat_requests SET status = ? WHERE id = ?', [status, req.params.id]);
		res.json({ success: true });
	} catch (error) {
		console.error('PUT /api/seat-requests/:id error:', error);
		res.status(500).json({ success: false, message: 'Failed to update seat request' });
	}
});

// --- Artist Suggestions ---
app.get('/api/suggestions', async (req, res) => {
	try {
		const [rows] = await pool.query('SELECT * FROM suggestions ORDER BY created_at DESC');
		res.json({ success: true, suggestions: rows });
	} catch (error) {
		console.error('GET /api/suggestions error:', error);
		res.status(500).json({ success: false, message: 'Failed to fetch suggestions' });
	}
});

app.post('/api/suggestions', async (req, res) => {
	try {
		const { name, contact, notes, submission_type } = req.body;
		const [result] = await pool.query(
			'INSERT INTO suggestions (name, contact, notes, submission_type, created_at) VALUES (?, ?, ?, ?, NOW())',
			[name, contact, notes, submission_type]
		);
		res.json({ success: true, id: result.insertId });
	} catch (error) {
		console.error('POST /api/suggestions error:', error);
		res.status(500).json({ success: false, message: 'Failed to submit suggestion' });
	}
});

app.put('/api/suggestions/:id', async (req, res) => {
	try {
		const { status, notes } = req.body;
		await pool.query('UPDATE suggestions SET status = ?, notes = ? WHERE id = ?', [status, notes, req.params.id]);
		res.json({ success: true });
	} catch (error) {
		console.error('PUT /api/suggestions/:id error:', error);
		res.status(500).json({ success: false, message: 'Failed to update suggestion' });
	}
});

// --- Dashboard stats ---
app.get('/api/dashboard-stats', async (req, res) => {
	try {
		const [[{ total_events }]] = await pool.query('SELECT COUNT(*) AS total_events FROM events');
		const [[{ pending_requests }]] = await pool.query("SELECT COUNT(*) AS pending_requests FROM seat_requests WHERE status = 'pending'");
		const [[{ total_suggestions }]] = await pool.query('SELECT COUNT(*) AS total_suggestions FROM suggestions');
		res.json({ success: true, stats: { total_events, pending_requests, total_suggestions } });
	} catch (error) {
		console.error('GET /api/dashboard-stats error:', error);
		res.status(500).json({ success: false, message: 'Failed to fetch dashboard stats' });
	}
});

// --- Settings ---
app.get('/api/settings', async (req, res) => {
	try {
		const [settings] = await pool.query('SELECT * FROM business_settings');
		const settingsObj = {};
		settings.forEach(s => { settingsObj[s.setting_key] = s.setting_value; });
		res.json({ success: true, settings: settingsObj });
	} catch (error) {
		console.error('GET /api/settings error:', error);
		res.status(500).json({ success: false, message: 'Failed to fetch settings' });
	}
});

app.put('/api/settings', async (req, res) => {
	try {
		const settings = req.body || {};
		for (const [key, value] of Object.entries(settings)) {
			await pool.query(
				'INSERT INTO business_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?',
				[key, value, value]
			);
		}
		res.json({ success: true });
	} catch (error) {
		console.error('PUT /api/settings error:', error);
		res.status(500).json({ success: false, message: 'Failed to update settings' });
	}
});

// Start server with DB connection test
pool.getConnection()
	.then(conn => {
		console.log('✅ Database connected successfully');
		conn.release();
		app.listen(PORT, () => console.log(`🎵 Midway Music Hall server running on port ${PORT}`));
	})
	.catch(err => {
		console.error('❌ Database connection failed:', err);
		// Start server anyway so API surface is available for non-DB endpoints
		app.listen(PORT, () => console.log(`🎵 Midway Music Hall server running on port ${PORT} (DB connection failed)`));
	});
