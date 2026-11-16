const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

let browser, page, pollTimer;
const DEFAULT_DISPLAY_SETTINGS = {
  title: 'PLAYER STATISTICS',
  showScore: true,
  mode: 'topScorers',
  playerCount: 6,
  stats: ['points', 'rebounds', 'assists'],
  accent: '#27a9ff',
  autoRotate: false,
  rotateSeconds: 10
};
const ALLOWED_MODES = ['topScorers', 'playerStats', 'teamComparison', 'scoreOnly'];
const ALLOWED_STATS = ['points', 'rebounds', 'assists', 'steals', 'turnovers', 'blocks', 'val', 'minutes', 'three', 'plusMinus'];
let displaySettings = { ...DEFAULT_DISPLAY_SETTINGS };
let state = { connected: false, url: '', updatedAt: null, status: 'Nincs csatlakoztatott mérkőzés', data: null, pageText: '', jsonSamples: [], error: null };
const broadcast = () => {
  const payload = JSON.stringify({ ...state, displaySettings });
  for (const client of wss.clients) if (client.readyState === WebSocket.OPEN) client.send(payload);
};
function setState(patch) { state = { ...state, ...patch }; broadcast(); }
function validateUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error('Érvénytelen URL.'); }
  if (u.protocol !== 'https:') throw new Error('Csak HTTPS mérkőzés URL engedélyezett.');
  const host = u.hostname.toLowerCase();
  if (!config.allowedHosts.some(h => host === h || host.endsWith('.' + h))) throw new Error('Ez a domain nincs az engedélyezett domainek között.');
  return u.toString();
}
function cleanText(s) { return (s || '').replace(/\s+/g, ' ').trim(); }
async function readSelector(selector) {
  if (!selector) return null;
  try { return cleanText(await page.locator(selector).first().innerText({ timeout: 800 })); }
  catch { return null; }
}
function isMkoszUrl(url) { return new URL(url).hostname === 'mkosz.hu' || new URL(url).hostname.endsWith('.mkosz.hu'); }

async function parseMkosz() {
  // Az MKOSZ oldalon a Box Score a mérkőzés összefoglalója és az interjúk UTÁN található.
  // Csak a Box Score fejléceit és a játékossorokat tartalmazó táblázatokat dolgozzuk fel.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
  await page.waitForTimeout(1200);

  const extracted = await page.evaluate(() => {
    const clean = value => (value || '').replace(/\s+/g, ' ').trim();
    const body = document.body?.innerText || '';
    const lines = body.split(/\r?\n/).map(clean).filter(Boolean);
    const unavailable = /temporarily unavailable|service unavailable|too many requests|access denied/i.test(body);

    const scoreIndex = lines.findIndex(line => /^\d{1,3}\s*[-–:]\s*\d{1,3}$/.test(line));
    const scoreLine = scoreIndex >= 0 ? lines[scoreIndex] : '';
    const scoreMatch = scoreLine.match(/(\d{1,3})\s*[-–:]\s*(\d{1,3})/);
    const homeTeam = scoreIndex >= 2 ? lines[scoreIndex - 2] : '';
    const awayTeam = scoreIndex >= 1 ? lines[scoreIndex - 1] : '';

    const allTables = [...document.querySelectorAll('table')];
    const boxScoreTables = allTables.map((table, tableIndex) => {
      const rows = [...table.querySelectorAll('tr')].map(tr => {
        const cells = [...tr.querySelectorAll('th,td')].map(td => clean(td.innerText));
        const links = [...tr.querySelectorAll('a')].map(a => clean(a.innerText)).filter(Boolean);
        return { cells, links };
      }).filter(row => row.cells.some(Boolean));
      const text = clean(table.innerText);
      const hasBoxHeaders = /JÁTÉKOS/i.test(text) && /VAL/i.test(text) && /Lepattanó/i.test(text) && /Idő/i.test(text);
      if (!hasBoxHeaders) return null;
      const playerRows = rows.filter(row => {
        const name = row.links.find(x => !/stat download|image/i.test(x)) || row.cells[1] || '';
        const numericCells = row.cells.filter(x => /^[-+]?\d+(?:[,.]\d+)?$/.test(x)).length;
        return row.cells.length >= 28 && name && !/^(Csapat|Összesen|JÁTÉKOS)$/i.test(name) && numericCells >= 20;
      }).map(row => ({ ...row, name: row.links.find(x => !/stat download|image/i.test(x)) || row.cells[1] }));
      return playerRows.length ? { tableIndex, rows, playerRows } : null;
    }).filter(Boolean);

    return {
      body, lines, scoreLine, homeTeam, awayTeam,
      score: scoreMatch ? [Number(scoreMatch[1]), Number(scoreMatch[2])] : null,
      boxScoreTables,
      title: document.title,
      unavailable,
      tableCount: allTables.length
    };
  });

  if (extracted.unavailable) {
    setState({ connected: true, status: 'Az MKOSZ átmeneti hibaoldalt adott vissza; újrapróbálkozás szükséges', updatedAt: new Date().toISOString(), data: null, pageText: extracted.body.slice(0, 12000), error: 'Az MKOSZ oldal jelenleg „temporarily unavailable” választ ad.' });
    return;
  }

  const playerTables = extracted.boxScoreTables || [];
  const teams = [extracted.homeTeam || 'Hazai csapat', extracted.awayTeam || 'Vendég csapat'];
  const playerStats = playerTables.flatMap((table, tableIndex) => table.playerRows.map(row => {
    const c = row.cells;
    const num = i => (c[i] ?? '').trim();
    return {
      team: teams[tableIndex] || `Csapat ${tableIndex + 1}`,
      name: row.name,
      starter: num(2),
      points: num(3),
      close: { made: num(4), attempts: num(5), percent: num(6) },
      mid: { made: num(7), attempts: num(8), percent: num(9) },
      three: { made: num(10), attempts: num(11), percent: num(12) },
      fieldGoals: { made: num(13), attempts: num(14), percent: num(15) },
      freeThrows: { made: num(16), attempts: num(17), percent: num(18) },
      rebounds: { offensive: num(19), defensive: num(20), total: num(21) },
      steals: num(22), turnovers: num(23),
      fouls: { drawn: num(24), committed: num(25) },
      assists: num(26), blocks: { made: num(27), received: num(28) },
      val: num(29), minutes: num(30), plusMinus: num(31),
      rawCells: c
    };
  }));

  // A LED-grafikán kizárólag a Box Score játékossoraiból képzünk tartalmat.
  // Az interjúk/oldalszövegek soha nem kerülhetnek a statsRows mezőbe.
  const topPlayers = [...playerStats].sort((a, b) => (Number(b.points) || 0) - (Number(a.points) || 0)).slice(0, 6);
  const statsRows = topPlayers.map(p => `${p.name} — ${p.points} PTS · ${p.rebounds.total} REB · ${p.assists} AST`);
  const rawPlayerRows = playerTables.flatMap(t => t.playerRows.map(r => r.cells));
  const score = extracted.score || [null, null];
  const found = playerStats.length >= 2;
  const data = {
    source: 'MKOSZ Box Score', sourceUrl: state.url,
    homeTeam: teams[0], awayTeam: teams[1],
    homeScore: score[0] == null ? '' : String(score[0]),
    awayScore: score[1] == null ? '' : String(score[1]),
    period: score ? 'Végeredmény' : 'Mérkőzésadatok', clock: score ? 'Vége' : '—',
    statsRows, playerRows: rawPlayerRows, playerStats,
    playerTables: playerTables.map((t, i) => ({ heading: teams[i] || `Csapat ${i + 1}`, rows: t.playerRows.map(r => r.cells) })),
    boxScoreTableCount: playerTables.length
  };

  setState({
    connected: true,
    status: found ? `MKOSZ Box Score beolvasva (${playerStats.length} játékossor, ${playerTables.length} csapat)` : 'Az oldal betöltött, de a Box Score táblázatot nem sikerült felismerni',
    updatedAt: new Date().toISOString(), data: found ? data : { ...data, statsRows: [], playerRows: [], playerStats: [] },
    pageText: found ? `Box Score táblák: ${playerTables.length}\nJátékossorok: ${playerStats.length}\n\n${statsRows.join('\n')}` : `HTML táblák az oldalon: ${extracted.tableCount}\nBox Score fejléccel felismert táblák: 0\n\n${extracted.body.slice(0, 5000)}`,
    error: found ? null : 'Nem találtam olyan táblázatot, amelyben a JÁTÉKOS, Lepattanó, VAL és Idő oszlopok, valamint játékossorok együtt szerepelnek.'
  });
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
}

async function scrape() {
  if (!page || page.isClosed()) return;
  try {
    if (isMkoszUrl(state.url)) return await parseMkosz();
    const selectors = config.selectors;
    const [homeTeam, awayTeam, homeScore, awayScore, period, clock] = await Promise.all([
      readSelector(selectors.homeTeam), readSelector(selectors.awayTeam), readSelector(selectors.homeScore),
      readSelector(selectors.awayScore), readSelector(selectors.period), readSelector(selectors.clock)
    ]);
    const pageText = cleanText(await page.locator('body').innerText({ timeout: 3000 }).catch(() => ''));
    let statsRows = [];
    if (selectors.statsRows) statsRows = await page.locator(selectors.statsRows).evaluateAll(nodes => nodes.map(n => (n.innerText || '').replace(/\s+/g, ' ').trim()).filter(Boolean)).catch(() => []);
    const hasSelectors = [homeTeam, awayTeam, homeScore, awayScore, period, clock].some(Boolean) || statsRows.length;
    const data = hasSelectors ? { homeTeam, awayTeam, homeScore, awayScore, period, clock, statsRows, source: 'FIBA' } : null;
    setState({ connected: true, status: data ? 'Adatok olvasása folyamatban' : 'Az oldal betöltött; a FIBA mezőket még hozzá kell igazítani', updatedAt: new Date().toISOString(), data, pageText: pageText.slice(0, 12000), error: null });
  } catch (e) { setState({ error: e.message, status: 'Adatolvasási hiba' }); }
}
async function stopWatcher() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  if (page && !page.isClosed()) await page.close().catch(() => {});
  page = null;
  setState({ connected: false, status: 'A figyelés leállítva' });
}
app.get('/api/state', (_req, res) => res.json({ ...state, displaySettings }));

app.get('/api/display-settings', (_req, res) => res.json(displaySettings));

app.post('/api/display-settings', (req, res) => {
  const body = req.body || {};
  const mode = ALLOWED_MODES.includes(body.mode) ? body.mode : DEFAULT_DISPLAY_SETTINGS.mode;
  const count = Number(body.playerCount);
  const playerCount = Number.isFinite(count) ? Math.min(12, Math.max(1, Math.round(count))) : 6;
  const stats = Array.isArray(body.stats)
    ? [...new Set(body.stats.filter(value => ALLOWED_STATS.includes(value)))]
    : DEFAULT_DISPLAY_SETTINGS.stats;
  const accent = /^#[0-9a-fA-F]{6}$/.test(body.accent || '') ? body.accent : DEFAULT_DISPLAY_SETTINGS.accent;
  displaySettings = {
    title: String(body.title || DEFAULT_DISPLAY_SETTINGS.title).slice(0, 50),
    showScore: body.showScore !== false,
    mode,
    playerCount,
    stats,
    accent,
    autoRotate: Boolean(body.autoRotate),
    rotateSeconds: Math.min(60, Math.max(3, Number(body.rotateSeconds) || 10))
  };
  broadcast();
  res.json({ success: true, displaySettings });
});
app.post('/api/connect', async (req, res) => {
  try {
    const url = validateUrl(req.body.url || '');
    await stopWatcher();
    if (!browser) browser = await chromium.launch({ headless: process.env.HEADLESS === 'true', args: ['--disable-blink-features=AutomationControlled'] });
    page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: 'hu-HU', timezoneId: 'Europe/Budapest', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36' });
    const jsonSamples = [];
    page.on('response', async response => {
      const ct = (response.headers()['content-type'] || '').toLowerCase();
      if (!ct.includes('json')) return;
      try {
        const body = await response.text();
        if (body.length < 500000 && jsonSamples.length < 25) {
          jsonSamples.push({ url: response.url().slice(0, 500), body: body.slice(0, 12000) });
          setState({ jsonSamples: [...jsonSamples] });
        }
      } catch {}
    });
    setState({ url, status: 'Mérkőzésoldal betöltése…', error: null, jsonSamples: [], pageText: '', data: null });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(isMkoszUrl(url) ? 3500 : 5000);
    if (isMkoszUrl(url)) {
      const firstText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
      if (/temporarily unavailable|service unavailable/i.test(firstText)) {
        await page.waitForTimeout(2500);
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
        await page.waitForTimeout(3500);
      }
    }
    await scrape();
    pollTimer = setInterval(scrape, Math.max(1500, Number(config.pollIntervalMs) || 3000));
    res.json({ ok: true, message: 'A figyelés elindult.' });
  } catch (e) {
    setState({ connected: false, status: 'Csatlakozási hiba', error: e.message });
    res.status(400).json({ ok: false, error: e.message });
  }
});
app.post('/api/disconnect', async (_req, res) => { await stopWatcher(); res.json({ ok: true }); });
app.get('/api/config', (_req, res) => res.json(config));
app.get('/health', (_req, res) => res.json({ ok: true }));

const PORT = Number(process.env.PORT || 3030);
server.on('error', err => { if (err.code === 'EADDRINUSE') console.error(`A ${PORT}-as port foglalt. Állítsd le a korábbi példányt, vagy indítsd PORT=${PORT+1} npm start paranccsal.`); else console.error(err); process.exit(1); });
server.listen(PORT, '127.0.0.1', () => console.log(`FIBA / MKOSZ LED Agent: http://127.0.0.1:${PORT}`));
process.on('SIGINT', async () => { await stopWatcher(); if (browser) await browser.close(); process.exit(0); });
