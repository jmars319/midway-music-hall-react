// Midway Music Hall - Express server with full API endpoints
// Developer notes: This file contains the API surface for the app. Keep
// handlers small and descriptive; database access is done via the mysql2
// promise pool defined below. Sensitive config values are read from
// backend/.env (not checked into git).
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
// Simple health endpoint (useful for readiness checks)
app.get('/api/health', (req, res) => res.json({ success: true, status: 'ok' }));

// --- Authentication (demo + DB lookup) ---
// Authentication endpoint (development/demo + DB-backed)
// Input: { email, password }
// Output: { success: true, user } or 401 on failure
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
// The events endpoints are simple CRUD handlers used by the frontend to
// list and manage events. They return JSON objects with a `success` flag
// and the requested data.
app.get('/api/events', async (req, res) => {
	try {
		// Select a computed start_datetime so clients receive a usable datetime even
		// when start_datetime is NULL (fallback to event_date + event_time).
		const [events] = await pool.query("SELECT *, COALESCE(start_datetime, CAST(CONCAT(event_date, ' ', event_time) AS DATETIME)) AS computed_start_datetime FROM events ORDER BY computed_start_datetime ASC");
		// Normalize response to include start_datetime field
		const normalized = events.map(e => ({ ...e, start_datetime: e.computed_start_datetime }));
		res.json({ success: true, events: normalized });
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
		let { title, description, start_datetime, end_datetime, venue_section, event_date, event_time } = req.body;
		// If start_datetime isn't provided but event_date and event_time are, combine them
		if ((!start_datetime || start_datetime === '') && event_date && event_time) {
			start_datetime = `${event_date} ${event_time}`; // assume valid date and time strings
		}
		const [result] = await pool.query(
			'INSERT INTO events (title, description, start_datetime, end_datetime, venue_section, event_date, event_time) VALUES (?, ?, ?, ?, ?, ?, ?)',
			[title, description, start_datetime || null, end_datetime || null, venue_section || null, event_date || null, event_time || null]
		);
		res.json({ success: true, id: result.insertId });
	} catch (error) {
		console.error('POST /api/events error:', error);
		res.status(500).json({ success: false, message: 'Failed to create event' });
	}
});

app.put('/api/events/:id', async (req, res) => {
	try {
		let { title, description, start_datetime, end_datetime, venue_section, event_date, event_time } = req.body;
		if ((!start_datetime || start_datetime === '') && event_date && event_time) {
			start_datetime = `${event_date} ${event_time}`;
		}
		await pool.query(
			'UPDATE events SET title = ?, description = ?, start_datetime = ?, end_datetime = ?, venue_section = ?, event_date = ?, event_time = ? WHERE id = ?',
			[title, description, start_datetime || null, end_datetime || null, venue_section || null, event_date || null, event_time || null, req.params.id]
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
// Seating rows represent either linear seat rows or grouped seat types
// (e.g., table-6). The `selected_seats` column stores a JSON array of
// reserved seat identifiers like "SECTION-ROW-1".
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

// Partial update for seating rows (PATCH accepts only the fields provided)
// This is used by admin tools to update position, rotation, selected_seats, etc.
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
// The admin layout editor can POST snapshots here. Server prunes older
// snapshots by count and age to avoid unbounded growth.
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
// Seat requests are created by customers and reviewed by admins. The
// approval flow checks for conflicts and merges seat ids into the
// corresponding `seating.selected_seats` JSON column when approved.
/*
	Developer notes - seat request approval contract

	- Endpoint: POST /api/seat-requests/:id/approve
	- Input: request id in the URL path. No body required.
	- Behavior: within a DB transaction, the server will:
			1) load the seat_request row and parse its `selected_seats` JSON
			2) for each requested seat, verify the corresponding seating row's
				 `selected_seats` does not already include that seat id
			3) if any conflict is detected, return 409 with a list of conflicts
			4) otherwise, merge each seat id into the seating.selected_seats JSON
				 field for the appropriate seating row and mark the request approved
	- Output: 200 on success { success: true } or 409 { success: false, conflicts: [...] }

	Important edge-cases & notes:
	- Seat id format is SECTION-ROW-<seatNumber> (e.g. "Main-A-3"); the code
		splits on '-' to recover section and row_label. This is simple but fragile
		for section or row names that contain hyphens; keep this in mind if you
		change naming conventions.
	- The transaction uses `SELECT` then `UPDATE` per seating row. This is
		intentionally simple and portable across MySQL versions; if you expect
		very high concurrency consider SELECT ... FOR UPDATE to lock rows.
	- The handler normalizes JSON stored as string in DB; defensive parsing
		is used throughout to avoid crashing on malformed data.
*/
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
	// This handler runs inside a DB transaction to avoid race conditions.
	// If any requested seat is already reserved, it returns 409 with conflicts.
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
				// Parse the selected_seats on the request row. It may be stored as
				// a JSON string or already as an array depending on how it was inserted.
				let seats = [];
				try { seats = JSON.parse(reqRow.selected_seats || '[]'); } catch(e) { seats = []; }
				// Check for conflicts first: if any seat is already reserved, abort.
				// We iterate seats and map each to the seating row. Note: this is a
				// conservative check — it doesn't reserve seats until the commit step.
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

	// Deny a seat request (simple state change)
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
		// Normalize rows to include fields the frontend admin expects
		const normalized = rows.map(r => {
			const out = { ...r };
			// Artist name was stored in `name` column
			out.artist_name = r.name;

			// Parse contact JSON if present and expose common fields
			let contactObj = null;
			if (r.contact) {
				try {
					contactObj = typeof r.contact === 'string' ? JSON.parse(r.contact) : r.contact;
				} catch (e) {
					contactObj = null;
				}
			}
			if (contactObj) {
				out.contact_name = contactObj.name || contactObj.contact_name || null;
				out.contact_email = contactObj.email || contactObj.contact_email || null;
				out.contact_phone = contactObj.phone || contactObj.contact_phone || null;
				out.music_links = contactObj.music_links || null;
				out.social_media = contactObj.social_media || null;
				// genre may be provided by the public form; prefer contactObj.genre if available
				out.genre = contactObj.genre || null;
			} else {
				out.contact_name = null;
				out.contact_email = null;
				out.contact_phone = null;
				out.music_links = null;
				out.social_media = null;
				out.genre = null;
			}

			// Notes / message
			out.message = r.notes || null;

			return out;
		});

		res.json({ success: true, suggestions: normalized });
	} catch (error) {
		console.error('GET /api/suggestions error:', error);
		res.status(500).json({ success: false, message: 'Failed to fetch suggestions' });
	}
});

app.post('/api/suggestions', async (req, res) => {
	try {
		// Accept both legacy and newer flattened payloads from the frontend
		const body = req.body || {};
		const artistName = body.artist_name || body.name || 'Unknown Artist';
		const submission_type = body.submission_type || body.type || 'general';

		// Build contact object from either a provided `contact` object/string or flattened fields
		let contactObj = null;
		if (body.contact) {
			if (typeof body.contact === 'string') {
				try { contactObj = JSON.parse(body.contact); } catch (e) { contactObj = { raw: body.contact }; }
			} else if (typeof body.contact === 'object') {
				contactObj = body.contact;
			}
		}
		contactObj = contactObj || {};
		// Map flattened contact fields if present
		if (!contactObj.name && body.contact_name) contactObj.name = body.contact_name;
		if (!contactObj.email && body.contact_email) contactObj.email = body.contact_email;
		if (!contactObj.phone && body.contact_phone) contactObj.phone = body.contact_phone;
		if (!contactObj.music_links && body.music_links) contactObj.music_links = body.music_links;
		if (!contactObj.social_media && body.social_media) contactObj.social_media = body.social_media;
		if (!contactObj.genre && body.genre) contactObj.genre = body.genre;

		const notes = body.notes || body.message || '';

		const [result] = await pool.query(
			'INSERT INTO suggestions (name, contact, notes, submission_type, created_at) VALUES (?, ?, ?, ?, NOW())',
			[artistName, Object.keys(contactObj).length ? JSON.stringify(contactObj) : null, notes, submission_type]
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
	let conn;
	try {
		// Compute local timezone offset (hours:minutes) based on the Node process tz
		// new Date().getTimezoneOffset() returns minutes behind UTC (negative = ahead)
		const offsetMinutes = -new Date().getTimezoneOffset();
		const sign = offsetMinutes >= 0 ? '+' : '-';
		const pad = n => String(Math.abs(n)).padStart(2, '0');
		const hh = pad(Math.floor(Math.abs(offsetMinutes) / 60));
		const mm = pad(Math.abs(offsetMinutes) % 60);
		const tzOffset = `${sign}${hh}:${mm}`; // e.g. +02:00 or -07:00

		// Use a single connection so the session time_zone applies to subsequent queries
		conn = await pool.getConnection();
		await conn.query('SET time_zone = ?', [tzOffset]);

				// Upcoming events: next 2 months from now (inclusive)
				// Some rows store date/time separately (event_date + event_time) and may have NULL start_datetime.
				// Use COALESCE to prefer start_datetime and fall back to the combined date+time value.
						const [[{ upcoming_events }]] = await conn.query(
								`SELECT COUNT(*) AS upcoming_events FROM events
								 WHERE start_datetime >= NOW()
									 AND start_datetime < DATE_ADD(NOW(), INTERVAL 2 MONTH)`
						);

		// Pending seat requests
		const [[{ pending_requests }]] = await conn.query("SELECT COUNT(*) AS pending_requests FROM seat_requests WHERE status = 'pending'");

		// Pending suggestions (try to filter by status, fall back to total count)
		let pending_suggestions = 0;
		try {
			const [[r]] = await conn.query("SELECT COUNT(*) AS pending_suggestions FROM suggestions WHERE status = 'pending'");
			pending_suggestions = r.pending_suggestions || 0;
		} catch (e) {
			const [[r2]] = await conn.query('SELECT COUNT(*) AS pending_suggestions FROM suggestions');
			pending_suggestions = r2.pending_suggestions || 0;
		}

				// Events this calendar month (based on session timezone)
						const [[{ events_this_month }]] = await conn.query(
								`SELECT COUNT(*) AS events_this_month FROM events
								 WHERE YEAR(start_datetime) = YEAR(CURDATE())
									 AND MONTH(start_datetime) = MONTH(CURDATE())`
						);

		conn.release();
		res.json({ success: true, stats: { upcoming_events, pending_requests, pending_suggestions, events_this_month } });
	} catch (error) {
		if (conn) try { conn.release(); } catch (e) {}
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
