/* charts.js — costruttori dei grafici Chart.js per il Vol Lab.
 * Ogni funzione legge i colori dalle variabili CSS (così segue il tema) e
 * restituisce un'istanza Chart. L'app distrugge e ricostruisce i grafici al
 * cambio tema. Serie lunghe (~9k sedute) gestite con la decimation LTTB. */
(function () {
  'use strict';

  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const C = () => ({
    tx: css('--tx'), tx2: css('--tx2'), tx3: css('--tx3'), line: css('--line'),
    grid: css('--line') + '88', bg2: css('--bg2'),
    amber: css('--amber'), green: css('--green'), red: css('--red'),
    blue: css('--blue'), purple: css('--purple'),
  });
  const alpha = (hex, a) => {
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${a})`;
  };

  /** Trasforma dati paralleli (ms[], val[]) in punti {x,y} scartando i null. */
  const pts = (xs, ys) => {
    const out = [];
    for (let i = 0; i < xs.length; i++) if (ys[i] != null) out.push({ x: xs[i], y: ys[i] });
    return out;
  };

  const baseOpts = (c, extra = {}) => ({
    responsive: true, maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    parsing: false, normalized: true,
    plugins: {
      legend: { display: true, labels: { color: c.tx2, usePointStyle: true, pointStyle: 'line', boxWidth: 22, font: { size: 12, family: 'DM Sans' } } },
      decimation: { enabled: true, algorithm: 'lttb', samples: 600 },
      tooltip: {
        backgroundColor: c.bg2, borderColor: c.line, borderWidth: 1, titleColor: c.tx,
        bodyColor: c.tx2, padding: 10, cornerRadius: 8, titleFont: { family: 'DM Sans' },
        bodyFont: { family: 'JetBrains Mono', size: 12 },
      },
      ...(extra.plugins || {}),
    },
    scales: extra.scales || {},
    ...(extra.root || {}),
  });

  const timeX = (c, min) => ({
    type: 'time', min,
    time: { unit: 'year', tooltipFormat: 'dd MMM yyyy', displayFormats: { year: 'yyyy', month: "MMM ''yy" } },
    grid: { color: c.grid, drawTicks: false }, border: { display: false },
    ticks: { color: c.tx3, font: { family: 'JetBrains Mono', size: 11 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 9 },
  });
  const linY = (c, title, opts = {}) => ({
    position: opts.position || 'left',
    grid: { color: opts.noGrid ? 'transparent' : c.grid, drawTicks: false }, border: { display: false },
    title: { display: !!title, text: title, color: c.tx3, font: { size: 11, family: 'DM Sans' } },
    ticks: { color: c.tx3, font: { family: 'JetBrains Mono', size: 11 }, callback: opts.fmt },
    ...opts.extra,
  });

  function line(ds, color, axis, opts = {}) {
    return {
      label: ds.label, data: ds.data, borderColor: color, backgroundColor: opts.fill ? alpha(color, .12) : color,
      yAxisID: axis || 'y', borderWidth: opts.bw || 1.6, pointRadius: 0, pointHoverRadius: 3,
      tension: opts.tension ?? .1, fill: opts.fill || false, hidden: opts.hidden || false,
      borderDash: opts.dash || undefined, order: opts.order ?? 1, spanGaps: true,
    };
  }

  /* ── Volatilità: VIX / RV / GARCH ───────────────────────────────────── */
  function volChart(ctx, d, min) {
    const c = C();
    return new Chart(ctx, {
      type: 'line',
      data: { datasets: [
        line({ label: 'VIX (implicita)', data: pts(d.ms, d.series.vix) }, c.green, 'y', { bw: 1.4 }),
        line({ label: 'Vol. realizzata 30g', data: pts(d.ms, d.series.rv) }, c.blue, 'y', { bw: 1.7 }),
        line({ label: 'GARCH(1,1) OOS', data: pts(d.ms, d.series.garch) }, c.amber, 'y', { bw: 1.4, hidden: false }),
      ] },
      options: baseOpts(c, { scales: { x: timeX(c, min), y: linY(c, 'Volatilità annua (%)', { fmt: (v) => v + '%' }) } }),
    });
  }

  /* ── Prezzo + drawdown ──────────────────────────────────────────────── */
  function priceChart(ctx, d, min) {
    const c = C();
    return new Chart(ctx, {
      type: 'line',
      data: { datasets: [
        line({ label: 'Prezzo indice', data: pts(d.ms, d.series.price) }, c.purple, 'y', { bw: 1.5 }),
        line({ label: 'Drawdown', data: pts(d.ms, d.series.drawdown) }, c.red, 'y1', { bw: 1, fill: true }),
      ] },
      options: baseOpts(c, { scales: {
        x: timeX(c, min),
        y: linY(c, 'Prezzo', { extra: { type: 'logarithmic' } }),
        y1: linY(c, 'Drawdown %', { position: 'right', noGrid: true, fmt: (v) => v + '%', extra: { max: 0 } }),
      } }),
    });
  }

  /* ── Variance Risk Premium (VIX - RV) ──────────────────────────────── */
  function vrpChart(ctx, d, min, mean) {
    const c = C();
    return new Chart(ctx, {
      type: 'line',
      data: { datasets: [
        line({ label: 'VRP = VIX − Vol. realizzata', data: pts(d.ms, d.series.vrp) }, c.amber, 'y', { fill: true, bw: 1.3 }),
        line({ label: `media (${mean.toFixed(1)})`, data: [{ x: min, y: mean }, { x: d.ms[d.ms.length - 1], y: mean }] }, c.tx3, 'y', { bw: 1, dash: [5, 4] }),
      ] },
      options: baseOpts(c, { scales: { x: timeX(c, min), y: linY(c, 'Punti di vol', { fmt: (v) => v }) },
        plugins: { tooltip: { callbacks: { label: (i) => ' ' + i.dataset.label.split(' ')[0] + ': ' + i.parsed.y.toFixed(2) } } } }),
    });
  }

  /* ── Rapporto VIX / RV ──────────────────────────────────────────────── */
  function ratioChart(ctx, d, min) {
    const c = C();
    return new Chart(ctx, {
      type: 'line',
      data: { datasets: [
        line({ label: 'VIX / Vol. realizzata', data: pts(d.ms, d.series.ratio) }, c.blue, 'y', { bw: 1.3 }),
        line({ label: 'parità (1.0)', data: [{ x: min, y: 1 }, { x: d.ms[d.ms.length - 1], y: 1 }] }, c.tx3, 'y', { bw: 1, dash: [5, 4] }),
      ] },
      options: baseOpts(c, { scales: { x: timeX(c, min), y: linY(c, '× volte', { fmt: (v) => v + '×' }) } }),
    });
  }

  /* ── Scatter VIX vs RV + bisettrice + regressione ──────────────────── */
  function scatterChart(ctx, d) {
    const c = C();
    const xs = d.scatter.map((p) => p[0]), ys = d.scatter.map((p) => p[1]);
    // regressione OLS y = a + b x
    const n = xs.length, sx = xs.reduce((a, b) => a + b, 0), sy = ys.reduce((a, b) => a + b, 0);
    const sxx = xs.reduce((a, b) => a + b * b, 0), sxy = xs.reduce((a, b, i) => a + b * ys[i], 0);
    const b = (n * sxy - sx * sy) / (n * sxx - sx * sx), a = (sy - b * sx) / n;
    const xmin = Math.min(...xs), xmax = Math.max(...xs);
    return new Chart(ctx, {
      type: 'scatter',
      data: { datasets: [
        { label: 'sedute (VIX, RV)', data: d.scatter.map((p) => ({ x: p[0], y: p[1] })), backgroundColor: alpha(c.blue, .35), pointRadius: 2, order: 3 },
        { type: 'line', label: 'regressione', data: [{ x: xmin, y: a + b * xmin }, { x: xmax, y: a + b * xmax }], borderColor: c.amber, borderWidth: 2, pointRadius: 0, order: 1 },
        { type: 'line', label: 'parità (VIX = RV)', data: [{ x: xmin, y: xmin }, { x: xmax, y: xmax }], borderColor: c.tx3, borderWidth: 1.2, borderDash: [5, 4], pointRadius: 0, order: 2 },
      ] },
      options: baseOpts(c, { root: { parsing: true }, scales: {
        x: { ...linY(c, 'VIX (implicita, %)'), type: 'linear', grid: { color: c.grid } },
        y: linY(c, 'Vol. realizzata 30g (%)'),
      }, plugins: { decimation: { enabled: false } } }),
    });
  }

  /* ── Correlazione rolling ───────────────────────────────────────────── */
  function corrChart(ctx, d, min) {
    const c = C();
    return new Chart(ctx, {
      type: 'line',
      data: { datasets: [
        line({ label: `Correlazione rolling ${d.meta.corrWin}g (Δvix, Δrv)`, data: pts(d.ms, d.series.rollCorr) }, c.purple, 'y', { bw: 1.2, fill: true }),
      ] },
      options: baseOpts(c, { scales: { x: timeX(c, min), y: linY(c, 'ρ', { extra: { min: -0.2, max: 1 } }) },
        plugins: { legend: { display: true } } }),
    });
  }

  /* ── Cono di volatilità ─────────────────────────────────────────────── */
  function coneChart(ctx, d) {
    const c = C();
    const labels = d.cone.horizons.map((h) => h + 'g');
    const band = (key, color, w, dash) => ({ label: key, data: d.cone[key], borderColor: color, borderWidth: w, borderDash: dash, pointRadius: 0, tension: .3, fill: false });
    return new Chart(ctx, {
      type: 'line',
      data: { labels, datasets: [
        band('p95', alpha(c.red, .8), 1.2, [4, 3]),
        band('p75', alpha(c.amber, .9), 1.2, [4, 3]),
        { ...band('p50', c.tx2, 1.8), label: 'mediana' },
        band('p25', alpha(c.green, .9), 1.2, [4, 3]),
        band('p5', alpha(c.blue, .8), 1.2, [4, 3]),
        { label: 'oggi', data: d.cone.current, borderColor: c.amber, backgroundColor: c.amber, borderWidth: 2.6, pointRadius: 4, pointHoverRadius: 6, tension: .25, fill: false },
      ] },
      options: {
        responsive: true, maintainAspectRatio: false, parsing: true,
        plugins: {
          legend: { labels: { color: c.tx2, usePointStyle: true, boxWidth: 18, font: { size: 11 } } },
          tooltip: { backgroundColor: c.bg2, borderColor: c.line, borderWidth: 1, titleColor: c.tx, bodyColor: c.tx2, padding: 10, cornerRadius: 8 },
        },
        scales: {
          x: { title: { display: true, text: 'Orizzonte (giorni di trading)', color: c.tx3, font: { size: 11 } }, grid: { color: c.grid }, ticks: { color: c.tx3, font: { family: 'JetBrains Mono', size: 11 } } },
          y: linY(c, 'Vol. realizzata annua (%)', { fmt: (v) => v + '%' }),
        },
      },
    });
  }

  window.VC = { volChart, priceChart, vrpChart, ratioChart, scatterChart, corrChart, coneChart };
})();
