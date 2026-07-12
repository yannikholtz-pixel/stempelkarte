import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { initDb, query } from './db.js';
import * as wallet from './wallet.js';

const PORT = process.env.PORT || 3535;
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'julia';
const MIN_ABSTAND_MS = 4 * 60 * 60 * 1000;

if (!process.env.ADMIN_PASSWORD) {
  console.warn('WARNUNG: ADMIN_PASSWORD nicht gesetzt – Standard-Passwort "julia" aktiv. Für den Live-Betrieb unbedingt setzen!');
}

const dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

function passwortOk(eingabe) {
  const a = createHash('sha256').update(String(eingabe)).digest();
  const b = createHash('sha256').update(ADMIN_PASSWORD).digest();
  return timingSafeEqual(a, b);
}

async function requireAdmin(req, res, next) {
  const token = req.get('x-admin-token') || '';
  if (token) {
    const rows = await query('SELECT token FROM sitzungen WHERE token = ?', [token]);
    if (rows.length) return next();
  }
  res.status(401).json({ fehler: 'Nicht angemeldet' });
}

async function karteMitStatus(id) {
  const rows = await query('SELECT * FROM karten WHERE id = ?', [id]);
  if (!rows.length) return null;
  const karte = rows[0];
  const rabatte = await query(
    'SELECT id, art, erstellt FROM rabatte WHERE karte_id = ? AND eingeloest IS NULL ORDER BY erstellt',
    [id]
  );
  const letzte = await query(
    'SELECT erstellt FROM stempel WHERE karte_id = ? ORDER BY erstellt DESC LIMIT 1',
    [id]
  );
  const stempel = Number(karte.stempel);
  const position = stempel === 0 ? 0 : ((stempel - 1) % 10) + 1;
  return {
    id: karte.id,
    name: karte.name,
    stempel,
    position,
    offeneRabatte: rabatte,
    letzterStempel: letzte.length ? letzte[0].erstellt : null
  };
}

app.post('/api/karten', async (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 60);
  if (!name) return res.status(400).json({ fehler: 'Bitte gib deinen Namen an.' });
  const id = randomUUID();
  await query('INSERT INTO karten (id, name, stempel, erstellt) VALUES (?, ?, 0, ?)', [
    id, name, new Date().toISOString()
  ]);
  res.json({ id });
});

app.get('/api/karten/:id', async (req, res) => {
  const karte = await karteMitStatus(req.params.id);
  if (!karte) return res.status(404).json({ fehler: 'Karte nicht gefunden' });
  res.json(karte);
});

app.get('/api/wallet/:id', async (req, res) => {
  if (!wallet.konfiguriert()) return res.json({ verfuegbar: false });
  const karte = await karteMitStatus(req.params.id);
  if (!karte) return res.status(404).json({ fehler: 'Karte nicht gefunden' });
  res.json({ verfuegbar: true, url: wallet.saveUrl(karte, BASE_URL) });
});

app.post('/api/login', async (req, res) => {
  if (!passwortOk(req.body?.passwort || '')) {
    return res.status(401).json({ fehler: 'Falsches Passwort' });
  }
  const token = randomBytes(24).toString('hex');
  await query('INSERT INTO sitzungen (token, erstellt) VALUES (?, ?)', [token, new Date().toISOString()]);
  res.json({ token });
});

app.post('/api/stempel', requireAdmin, async (req, res) => {
  const { karteId, trotzdem } = req.body || {};
  const karte = await karteMitStatus(String(karteId || ''));
  if (!karte) return res.status(404).json({ fehler: 'Karte nicht gefunden' });

  if (!trotzdem && karte.letzterStempel && Date.now() - Date.parse(karte.letzterStempel) < MIN_ABSTAND_MS) {
    return res.json({ nachfrage: 'Der letzte Stempel ist keine 4 Stunden her. Trotzdem stempeln?' });
  }

  const jetzt = new Date().toISOString();
  await query('INSERT INTO stempel (id, karte_id, erstellt) VALUES (?, ?, ?)', [randomUUID(), karte.id, jetzt]);
  await query('UPDATE karten SET stempel = stempel + 1 WHERE id = ?', [karte.id]);

  const neu = await karteMitStatus(karte.id);
  if (neu.position === 5) {
    await query('INSERT INTO rabatte (id, karte_id, art, erstellt) VALUES (?, ?, ?, ?)', [
      randomUUID(), karte.id, '5eur', jetzt
    ]);
  } else if (neu.position === 10) {
    await query('INSERT INTO rabatte (id, karte_id, art, erstellt) VALUES (?, ?, ?, ?)', [
      randomUUID(), karte.id, '50pct', jetzt
    ]);
  }

  const ergebnis = await karteMitStatus(karte.id);
  wallet.punkteAktualisieren(ergebnis).catch(err => console.warn('Google-Wallet-Update:', err.message));
  res.json({ karte: ergebnis });
});

app.post('/api/einloesen', requireAdmin, async (req, res) => {
  const { rabattId, karteId } = req.body || {};
  const rows = await query('SELECT id FROM rabatte WHERE id = ? AND karte_id = ? AND eingeloest IS NULL', [
    String(rabattId || ''), String(karteId || '')
  ]);
  if (!rows.length) return res.status(404).json({ fehler: 'Rabatt nicht gefunden oder schon eingelöst' });
  await query('UPDATE rabatte SET eingeloest = ? WHERE id = ?', [new Date().toISOString(), rabattId]);
  res.json({ karte: await karteMitStatus(karteId) });
});

app.get('/api/kundinnen', requireAdmin, async (req, res) => {
  const suche = `%${String(req.query.suche || '').trim().toLowerCase()}%`;
  const rows = await query(
    'SELECT id, name, stempel, erstellt FROM karten WHERE lower(name) LIKE ? ORDER BY erstellt DESC LIMIT 50',
    [suche]
  );
  res.json({ kundinnen: rows });
});

app.get('/api/heute', requireAdmin, async (req, res) => {
  const seit = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  const heuteBerlin = new Date().toLocaleDateString('sv', { timeZone: 'Europe/Berlin' });
  const istHeute = iso =>
    new Date(iso).toLocaleDateString('sv', { timeZone: 'Europe/Berlin' }) === heuteBerlin;

  const stempelRows = await query('SELECT erstellt FROM stempel WHERE erstellt >= ?', [seit]);
  const rabattRows = await query('SELECT eingeloest FROM rabatte WHERE eingeloest IS NOT NULL AND eingeloest >= ?', [seit]);
  res.json({
    stempel: stempelRows.filter(r => istHeute(r.erstellt)).length,
    eingeloest: rabattRows.filter(r => istHeute(r.eingeloest)).length
  });
});

app.use(express.static(path.join(dirname, 'public')));
app.get('/k/:id', (req, res) => res.sendFile(path.join(dirname, 'public', 'karte.html')));
app.get('/julia', (req, res) => res.sendFile(path.join(dirname, 'public', 'julia.html')));

initDb().then(() => {
  app.listen(PORT, () => console.log(`Nails by Julss Stempelkarte läuft auf ${BASE_URL}`));
});
