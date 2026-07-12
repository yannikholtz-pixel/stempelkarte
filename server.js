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
  const token = req.get('x-admin-token') || String(req.query.token || '');
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

function betragZuCent(wert) {
  if (wert === undefined || wert === null || wert === '') return null;
  const zahl = Number(String(wert).replace(',', '.'));
  if (!Number.isFinite(zahl) || zahl < 0 || zahl > 100000) return null;
  return Math.round(zahl * 100);
}

app.post('/api/stempel', requireAdmin, async (req, res) => {
  const { karteId, trotzdem, behandlung, betrag } = req.body || {};
  const karte = await karteMitStatus(String(karteId || ''));
  if (!karte) return res.status(404).json({ fehler: 'Karte nicht gefunden' });

  if (!trotzdem && karte.letzterStempel && Date.now() - Date.parse(karte.letzterStempel) < MIN_ABSTAND_MS) {
    return res.json({ nachfrage: 'Der letzte Stempel ist keine 4 Stunden her. Trotzdem stempeln?' });
  }

  const jetzt = new Date().toISOString();
  await query('INSERT INTO stempel (id, karte_id, erstellt) VALUES (?, ?, ?)', [randomUUID(), karte.id, jetzt]);

  const cent = betragZuCent(betrag);
  if (cent !== null && cent > 0) {
    await query('INSERT INTO umsaetze (id, karte_id, behandlung, betrag_cent, erstellt) VALUES (?, ?, ?, ?, ?)', [
      randomUUID(), karte.id, String(behandlung || '').trim().slice(0, 80) || null, cent, jetzt
    ]);
  }
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

app.post('/api/umsatz', requireAdmin, async (req, res) => {
  const cent = betragZuCent(req.body?.betrag);
  if (cent === null || cent <= 0) return res.status(400).json({ fehler: 'Bitte einen gültigen Betrag angeben.' });
  await query('INSERT INTO umsaetze (id, karte_id, behandlung, betrag_cent, erstellt) VALUES (?, ?, ?, ?, ?)', [
    randomUUID(), null, String(req.body?.behandlung || '').trim().slice(0, 80) || null, cent, new Date().toISOString()
  ]);
  res.json({ ok: true });
});

function berlinTag(iso) {
  return new Date(iso).toLocaleDateString('sv', { timeZone: 'Europe/Berlin' });
}

function zeitraum(req) {
  const von = String(req.query.von || '1970-01-01T00:00:00.000Z');
  const bis = String(req.query.bis || new Date().toISOString());
  return { von, bis };
}

async function umsatzZeilen(von, bis) {
  return query(
    `SELECT u.id, u.erstellt, u.behandlung, u.betrag_cent, u.karte_id, k.name
     FROM umsaetze u LEFT JOIN karten k ON k.id = u.karte_id
     WHERE u.erstellt >= ? AND u.erstellt <= ? ORDER BY u.erstellt`,
    [von, bis]
  );
}

app.get('/api/umsaetze', requireAdmin, async (req, res) => {
  const { von, bis } = zeitraum(req);
  const rows = await umsatzZeilen(von, bis);
  res.json({
    umsaetze: rows.slice(-200).reverse().map(u => ({
      id: u.id,
      erstellt: u.erstellt,
      behandlung: u.behandlung || '',
      betragCent: Number(u.betrag_cent),
      name: u.name || (u.karte_id ? 'Gelöschte Karte' : 'Ohne Karte')
    }))
  });
});

app.delete('/api/umsatz/:id', requireAdmin, async (req, res) => {
  await query('DELETE FROM umsaetze WHERE id = ?', [String(req.params.id)]);
  res.json({ ok: true });
});

app.get('/api/statistik', requireAdmin, async (req, res) => {
  const { von, bis } = zeitraum(req);
  const gruppe = req.query.gruppe === 'monat' ? 'monat' : 'tag';
  const umsaetze = await umsatzZeilen(von, bis);
  const stempelRows = await query('SELECT erstellt FROM stempel WHERE erstellt >= ? AND erstellt <= ?', [von, bis]);
  const rabattRows = await query('SELECT eingeloest FROM rabatte WHERE eingeloest IS NOT NULL AND eingeloest >= ? AND eingeloest <= ?', [von, bis]);
  const neueKarten = await query('SELECT erstellt FROM karten WHERE erstellt >= ? AND erstellt <= ?', [von, bis]);

  let gesamtCent = 0;
  const verlauf = new Map();
  const behandlungen = new Map();
  const kundinnen = new Map();

  for (const u of umsaetze) {
    const cent = Number(u.betrag_cent);
    gesamtCent += cent;
    const schluessel = gruppe === 'monat' ? berlinTag(u.erstellt).slice(0, 7) : berlinTag(u.erstellt);
    const v = verlauf.get(schluessel) || { schluessel, cent: 0, anzahl: 0 };
    v.cent += cent; v.anzahl += 1;
    verlauf.set(schluessel, v);
    const bName = (u.behandlung || 'Ohne Angabe').trim();
    const b = behandlungen.get(bName.toLowerCase()) || { name: bName, cent: 0, anzahl: 0 };
    b.cent += cent; b.anzahl += 1;
    behandlungen.set(bName.toLowerCase(), b);
    const kName = u.name || (u.karte_id ? 'Gelöschte Karte' : 'Ohne Karte');
    const k = kundinnen.get(kName) || { name: kName, cent: 0, anzahl: 0 };
    k.cent += cent; k.anzahl += 1;
    kundinnen.set(kName, k);
  }

  res.json({
    umsatzCent: gesamtCent,
    besuche: umsaetze.length,
    schnittCent: umsaetze.length ? Math.round(gesamtCent / umsaetze.length) : 0,
    stempel: stempelRows.length,
    rabatte: rabattRows.length,
    neueKundinnen: neueKarten.length,
    verlauf: [...verlauf.values()].sort((a, b) => a.schluessel.localeCompare(b.schluessel)),
    topBehandlungen: [...behandlungen.values()].sort((a, b) => b.cent - a.cent).slice(0, 6),
    topKundinnen: [...kundinnen.values()].sort((a, b) => b.cent - a.cent).slice(0, 6)
  });
});

function csvFeld(wert) {
  const s = String(wert ?? '');
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function euro(cent) {
  return (cent / 100).toFixed(2).replace('.', ',');
}

app.get('/api/export.csv', requireAdmin, async (req, res) => {
  const { von, bis } = zeitraum(req);
  const umsaetze = await umsatzZeilen(von, bis);
  const zeilen = [];

  if (req.query.typ === 'monate') {
    const monate = new Map();
    for (const u of umsaetze) {
      const m = berlinTag(u.erstellt).slice(0, 7);
      const e = monate.get(m) || { besuche: 0, cent: 0 };
      e.besuche += 1; e.cent += Number(u.betrag_cent);
      monate.set(m, e);
    }
    zeilen.push('Monat;Besuche;Umsatz (EUR)');
    for (const [m, e] of [...monate.entries()].sort()) {
      zeilen.push(`${m};${e.besuche};${euro(e.cent)}`);
    }
    let gesamt = 0; let besuche = 0;
    for (const e of monate.values()) { gesamt += e.cent; besuche += e.besuche; }
    zeilen.push(`Gesamt;${besuche};${euro(gesamt)}`);
  } else {
    zeilen.push('Datum;Uhrzeit;Kundin;Behandlung;Betrag (EUR)');
    let gesamt = 0;
    for (const u of umsaetze) {
      const d = new Date(u.erstellt);
      gesamt += Number(u.betrag_cent);
      zeilen.push([
        d.toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' }),
        d.toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' }),
        csvFeld(u.name || (u.karte_id ? 'Gelöschte Karte' : 'Ohne Karte')),
        csvFeld(u.behandlung || ''),
        euro(Number(u.betrag_cent))
      ].join(';'));
    }
    zeilen.push(`;;;Gesamt;${euro(gesamt)}`);
  }

  const name = `umsaetze_${berlinTag(von)}_bis_${berlinTag(bis)}${req.query.typ === 'monate' ? '_monate' : ''}.csv`;
  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-disposition', `attachment; filename="${name}"`);
  // Zwischen den Quotes steht ein unsichtbares BOM-Zeichen (U+FEFF), damit Excel die CSV als UTF-8 erkennt - nicht entfernen!
  res.send('﻿' + zeilen.join('\r\n'));
});

app.use(express.static(path.join(dirname, 'public')));
app.get('/k/:id', (req, res) => res.sendFile(path.join(dirname, 'public', 'karte.html')));
app.get('/julia', (req, res) => res.sendFile(path.join(dirname, 'public', 'julia.html')));

initDb().then(() => {
  app.listen(PORT, () => console.log(`Nails by Julss Stempelkarte läuft auf ${BASE_URL}`));
});
