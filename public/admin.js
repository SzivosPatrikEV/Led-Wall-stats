const $ = id => document.getElementById(id);
let latestState = null;

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}

function selectedStats() {
  return [...document.querySelectorAll('input[name="stat"]:checked')].map(input => input.value);
}

function collectSettings() {
  return {
    mode: $('displayMode').value,
    showScore: $('showScore').checked,
    title: $('graphicTitle').value.trim() || 'PLAYER STATISTICS',
    playerCount: Number($('playerCount').value),
    accent: $('accent').value,
    stats: selectedStats(),
    autoRotate: $('autoRotate').checked,
    rotateSeconds: Number($('rotateSeconds').value)
  };
}

function setSettings(settings) {
  $('displayMode').value = settings.mode || 'topScorers';
  $('showScore').checked = settings.showScore !== false;
  $('graphicTitle').value = settings.title || 'PLAYER STATISTICS';
  $('playerCount').value = String(settings.playerCount || 6);
  $('accent').value = settings.accent || '#27a9ff';
  $('autoRotate').checked = Boolean(settings.autoRotate);
  $('rotateSeconds').value = String(settings.rotateSeconds || 10);
  document.querySelectorAll('input[name="stat"]').forEach(input => {
    input.checked = (settings.stats || []).includes(input.value);
  });
  updatePreview();
}

function statValue(player, key) {
  const values = {
    points: player.points,
    rebounds: player.rebounds?.total,
    assists: player.assists,
    steals: player.steals,
    turnovers: player.turnovers,
    blocks: player.blocks?.made,
    val: player.val,
    minutes: player.minutes,
    three: player.three?.percent,
    plusMinus: player.plusMinus
  };
  return values[key] ?? '—';
}

const labels = {
  points: 'PONT', rebounds: 'LEP.', assists: 'GÓLP.',
  steals: 'LABDASZ.', turnovers: 'ELAD.', blocks: 'BLOKK',
  val: 'VAL', minutes: 'IDŐ', three: '3P%', plusMinus: '+/-'
};

function renderPreview(state) {
  const data = state?.data;
  const settings = collectSettings();
  $('previewTitle').textContent = settings.title.toUpperCase();
  $('previewFrame')?.style.setProperty('--accent', settings.accent);
  document.querySelector('.preview-frame').style.setProperty('--accent', settings.accent);

  $('previewScore').style.display = settings.showScore ? '' : 'none';
  $('previewHome').textContent = data?.homeTeam || 'HAZAI CSAPAT';
  $('previewAway').textContent = data?.awayTeam || 'VENDÉG CSAPAT';
  $('previewHomeScore').textContent = data?.homeScore || '—';
  $('previewAwayScore').textContent = data?.awayScore || '—';

  const chosen = settings.stats.slice(0, 3);
  if (!chosen.length) chosen.push('points');
  $('previewHead').innerHTML = `<span>JÁTÉKOS</span>${chosen.map(key => `<span>${labels[key] || key}</span>`).join('')}`;

  let players = data?.playerStats || [];
  if (settings.mode === 'topScorers') {
    players = [...players].sort((a,b) => (Number(b.points)||0) - (Number(a.points)||0));
  }
  players = players.slice(0, settings.playerCount);

  if (!players.length) {
    $('previewRows').innerHTML = '<div class="empty-preview">Csatlakoztass egy mérkőzést az adatok előnézetéhez.</div>';
  } else {
    $('previewRows').innerHTML = players.slice(0, 6).map(player =>
      `<div class="preview-row"><span>${escapeHtml(player.name)}</span>${chosen.map(key => `<span>${escapeHtml(String(statValue(player,key) ?? '—'))}</span>`).join('')}</div>`
    ).join('');
  }
  $('playerTotal').textContent = `${(data?.playerStats || []).length} játékos beolvasva`;
  $('boxscore').textContent = data?.playerStats?.length
    ? data.playerStats.map(p => `${p.name}: ${p.points} PTS | ${p.rebounds?.total} REB | ${p.assists} AST | VAL ${p.val}`).join('\n')
    : 'A mérkőzés Box Score adatai itt jelennek meg.';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[char]));
}

function updatePreview() {
  renderPreview(latestState);
}

async function loadSettings() {
  const settings = await api('/api/display-settings');
  setSettings(settings);
}

$('saveDisplay').addEventListener('click', async () => {
  try {
    const result = await api('/api/display-settings', {
      method: 'POST',
      body: JSON.stringify(collectSettings())
    });
    setSettings(result.displaySettings);
    $('saveMessage').textContent = 'Beállítások alkalmazva – a LED kimenet frissült.';
    $('saveMessage').style.color = '#43d69b';
  } catch (error) {
    $('saveMessage').textContent = error.message;
    $('saveMessage').style.color = '#ff9292';
  }
});

['displayMode','graphicTitle','playerCount','accent','autoRotate','rotateSeconds','showScore'].forEach(id => {
  $(id).addEventListener('input', updatePreview);
});
document.querySelectorAll('input[name="stat"]').forEach(input => input.addEventListener('change', updatePreview));

$('connect').addEventListener('click', async () => {
  try {
    $('error').textContent = 'Csatlakozás folyamatban…';
    const result = await api('/api/connect', {
      method: 'POST',
      body: JSON.stringify({ url: $('url').value.trim() })
    });
    $('error').textContent = result.message || 'Csatlakozás elindult.';
  } catch (error) {
    $('error').textContent = error.message;
  }
});

$('disconnect').addEventListener('click', async () => {
  try {
    await api('/api/disconnect', { method: 'POST', body: '{}' });
  } catch (error) {
    $('error').textContent = error.message;
  }
});

function updateState(state) {
  latestState = state;
  $('status').textContent = state.status || 'Állapot ismeretlen';
  $('sideStatus').textContent = state.connected ? 'Adatforrás csatlakoztatva' : 'Nincs adatforrás';
  $('dot').classList.toggle('ok', Boolean(state.connected));
  $('updated').textContent = state.updatedAt
    ? `Frissítve: ${new Date(state.updatedAt).toLocaleTimeString('hu-HU')}`
    : 'Még nem érkezett adat';
  $('error').textContent = state.error || 'Nincs hiba.';
  renderPreview(state);
}

async function init() {
  try {
    setSettings(await api('/api/display-settings'));
    updateState(await api('/api/state'));
  } catch (error) {
    $('error').textContent = error.message;
  }

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${protocol}//${location.host}`);
  socket.addEventListener('message', event => {
    try { updateState(JSON.parse(event.data)); } catch {}
  });
  socket.addEventListener('close', () => {
    $('sideStatus').textContent = 'Kapcsolat megszakadt';
  });
}

init();
