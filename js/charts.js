/* charts.js — costruttori dei grafici Chart.js per il Vol Lab.
 * I grafici temporali condividono lo stesso asse X (stesso range) e un
 * CROSSHAIR sincronizzato: passando il mouse su uno, una linea verticale alla
 * stessa data compare su tutti e ognuno evidenzia il proprio valore (gestito in
 * app.js). Niente decimation: linee a piena risoluzione; al cambio range i
 * grafici si ricostruiscono sulla finestra → asse Y auto-adattato. */
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

  // Larghezza fissa dell'asse Y: allinea verticalmente i crosshair fra i grafici impilati.
  const FIX_Y = (ax) => { ax.width = 62; };

  // Plugin crosshair: disegna la linea verticale condivisa (chart.$crossPx) sui grafici temporali.
  if (typeof Chart !== 'undefined' && !Chart.__crosshair) {
    Chart.register({
      id: 'crosshair',
      afterDatasetsDraw(chart) {
        const px = chart.$crossPx;
        if (px == null) return;
        const { ctx, chartArea: { top, bottom } } = chart;
        ctx.save();
        ctx.beginPath(); ctx.moveTo(px, top); ctx.lineTo(px, bottom);
        ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
        ctx.strokeStyle = css('--tx3') || '#888';
        ctx.stroke();
        ctx.restore();
      },
    });
    Chart.__crosshair = true;
  }

  /** Punti {x,y} (ms, valore) scartando i null e tenendo solo x >= min. */
  const pts = (xs, ys, min) => {
    const out = [];
    for (let i = 0; i < xs.length; i++) if (ys[i] != null && xs[i] >= min) out.push({ x: xs[i], y: ys[i] });
    return out;
  };
  const hline = (y, min, max) => [{ x: min, y }, { x: max, y }];

  const baseOpts = (c, extra = {}) => ({
    responsive: true, maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    parsing: false, normalized: true, animation: false,
    plugins: {
      legend: { display: true, labels: { color: c.tx2, usePointStyle: true, pointStyle: 'line', boxWidth: 24, padding: 14, font: { size: 12, family: 'DM Sans' } } },
      tooltip: {
        backgroundColor: c.bg2, borderColor: c.line, borderWidth: 1, titleColor: c.tx,
        bodyColor: c.tx2, padding: 9, cornerRadius: 8, titleFont: { family: 'DM Sans', size: 11 },
        bodyFont: { family: 'JetBrains Mono', size: 11.5 }, position: 'nearest', caretSize: 4,
        ...(extra.tooltip || {}),
      },
      ...(extra.plugins || {}),
    },
    scales: extra.scales || {},
    ...(extra.root || {}),
  });

  // base per i grafici TEMPORALI: eventi DOM gestiti manualmente (sync) → events:[].
  const tBase = (c, extra) => baseOpts(c, { ...extra, root: { events: [], ...(extra.root || {}) } });

  const timeX = (c, min, max) => ({
    type: 'time', min, max,
    time: { tooltipFormat: 'dd MMM yyyy', displayFormats: { year: 'yyyy', month: "MMM ''yy", week: 'dd MMM', day: 'dd MMM' } },
    grid: { color: c.grid, drawTicks: false }, border: { display: false },
    ticks: { color: c.tx3, font: { family: 'JetBrains Mono', size: 11 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 9 },
  });
  const linY = (c, title, opts = {}) => ({
    position: opts.position || 'left',
    grid: { color: opts.noGrid ? 'transparent' : c.grid, drawTicks: false }, border: { display: false },
    title: { display: !!title, text: title, color: c.tx3, font: { size: 11, family: 'DM Sans' } },
    ticks: { color: c.tx3, font: { family: 'JetBrains Mono', size: 11 }, callback: opts.fmt, maxTicksLimit: opts.maxTicks },
    afterFit: opts.noFix ? undefined : FIX_Y,
    ...opts.extra,
  });

  function ds(label, data, color, opts = {}) {
    return {
      label, data, borderColor: color, backgroundColor: opts.fill ? alpha(color, opts.fillA || .12) : color,
      yAxisID: opts.axis || 'y', borderWidth: opts.bw || 1.5, pointRadius: 0, pointHoverRadius: 4,
      tension: opts.tension ?? 0, fill: opts.fill || false, hidden: opts.hidden || false,
      borderDash: opts.dash || undefined, order: opts.order ?? 1, spanGaps: false,
    };
  }

  /* ── Volatilità: VIX / RV trailing / GARCH ──────────────────────────── */
  function volChart(ctx, d, min, max) {
    const c = C();
    return new Chart(ctx, {
      type: 'line',
      data: { datasets: [
        ds('Vol. realizzata 30g', pts(d.ms, d.series.rv, min), c.blue, { bw: 1.9 }),
        ds('VIX (implicita)', pts(d.ms, d.series.vix, min), c.green, { bw: 1.4 }),
        ds('GARCH(1,1) 1-step', pts(d.ms, d.series.garch, min), c.amber, { bw: 1.3, dash: [4, 3] }),
      ] },
      options: tBase(c, {
        scales: { x: timeX(c, min, max), y: linY(c, 'Volatilità annua (%)', { fmt: (v) => v + '%' }) },
        tooltip: { callbacks: { label: (i) => '  ' + i.dataset.label + ': ' + (i.parsed.y == null ? '—' : i.parsed.y.toFixed(1) + '%') } },
      }),
    });
  }

  /* ── Prezzo (log, tick puliti) ──────────────────────────────────────── */
  function priceChart(ctx, d, min, max) {
    const c = C();
    const isNice = (v) => { const p = Math.pow(10, Math.floor(Math.log10(v))); const r = v / p; return [1, 2, 3, 5, 7].some((k) => Math.abs(r - k) < 0.02 * k); };
    const lab = (v) => (v >= 1000 ? +(v / 1000).toFixed(1) + 'k' : '' + Math.round(v));
    return new Chart(ctx, {
      type: 'line',
      data: { datasets: [ds(d.meta.displayName, pts(d.ms, d.series.price, min), c.purple, { bw: 1.7, fill: true, fillA: .06 })] },
      options: tBase(c, {
        plugins: { legend: { display: false } },
        scales: { x: timeX(c, min, max), y: linY(c, 'Prezzo (log)', {
          fmt: (v) => (isNice(v) ? lab(v) : ''),
          extra: { type: 'logarithmic', afterBuildTicks: (axis) => { axis.ticks = axis.ticks.filter((t) => isNice(t.value)); } },
        }) },
        tooltip: { callbacks: { label: (i) => '  Prezzo: ' + i.parsed.y.toLocaleString('it-IT') } },
      }),
    });
  }

  /* ── Drawdown del sottostante (underwater) ──────────────────────────── */
  function drawdownChart(ctx, d, min, max) {
    const c = C();
    return new Chart(ctx, {
      type: 'line',
      data: { datasets: [ds('Drawdown dai massimi', pts(d.ms, d.series.drawdown, min), c.red, { bw: 1, fill: true, fillA: .18 })] },
      options: tBase(c, {
        plugins: { legend: { display: false } },
        scales: { x: timeX(c, min, max), y: linY(c, 'Drawdown (%)', { fmt: (v) => v + '%', extra: { max: 0 } }) },
        tooltip: { callbacks: { label: (i) => '  Drawdown: ' + i.parsed.y.toFixed(1) + '%' } },
      }),
    });
  }

  /* ── Variance Risk Premium (VIX − RV) ──────────────────────────────── */
  function vrpChart(ctx, d, min, max, mean) {
    const c = C();
    return new Chart(ctx, {
      type: 'line',
      data: { datasets: [
        ds('VRP = VIX − Vol. realizzata', pts(d.ms, d.series.vrp, min), c.amber, { fill: true, bw: 1.2, fillA: .14 }),
        ds(`media (${mean.toFixed(1)})`, hline(mean, min, max), c.tx3, { bw: 1, dash: [5, 4] }),
        ds('zero', hline(0, min, max), c.tx2, { bw: 1 }),
      ] },
      options: tBase(c, {
        scales: { x: timeX(c, min, max), y: linY(c, 'Punti di vol') },
        tooltip: { filter: (i) => i.datasetIndex === 0, callbacks: { label: (i) => '  VRP: ' + (i.parsed.y > 0 ? '+' : '') + i.parsed.y.toFixed(1) } },
      }),
    });
  }

  /* ── Rapporto VIX / RV ──────────────────────────────────────────────── */
  function ratioChart(ctx, d, min, max) {
    const c = C();
    return new Chart(ctx, {
      type: 'line',
      data: { datasets: [
        ds('VIX / Vol. realizzata', pts(d.ms, d.series.ratio, min), c.blue, { bw: 1.2 }),
        ds('parità (1.0)', hline(1, min, max), c.tx3, { bw: 1, dash: [5, 4] }),
      ] },
      options: tBase(c, {
        scales: { x: timeX(c, min, max), y: linY(c, '× volte', { fmt: (v) => v + '×' }) },
        tooltip: { filter: (i) => i.datasetIndex === 0, callbacks: { label: (i) => '  VIX/RV: ' + i.parsed.y.toFixed(2) + '×' } },
      }),
    });
  }

  /* ── Correlazione rolling (asse libero, niente clipping) ────────────── */
  function corrChart(ctx, d, min, max) {
    const c = C();
    return new Chart(ctx, {
      type: 'line',
      data: { datasets: [
        ds(`Correlazione rolling ${d.meta.corrWin}g (Δvix, Δrv)`, pts(d.ms, d.series.rollCorr, min), c.purple, { bw: 1.1, fill: true, fillA: .12 }),
        ds('zero', hline(0, min, max), c.tx3, { bw: 1, dash: [5, 4] }),
      ] },
      options: tBase(c, {
        scales: { x: timeX(c, min, max), y: linY(c, 'ρ', { fmt: (v) => (Math.round(v * 100) / 100), extra: { suggestedMin: -0.5, suggestedMax: 1 } }) },
        tooltip: { filter: (i) => i.datasetIndex === 0, callbacks: { label: (i) => '  ρ: ' + i.parsed.y.toFixed(2) } },
      }),
    });
  }

  /* ── Scatter VIX vs realizzata futura (non temporale, no sync) ──────── */
  function scatterChart(ctx, d) {
    const c = C();
    const xs = d.scatter.map((p) => p[0]), ys = d.scatter.map((p) => p[1]);
    const n = xs.length, sx = xs.reduce((a, b) => a + b, 0), sy = ys.reduce((a, b) => a + b, 0);
    const sxx = xs.reduce((a, b) => a + b * b, 0), sxy = xs.reduce((a, b, i) => a + b * ys[i], 0);
    const b = (n * sxy - sx * sy) / (n * sxx - sx * sx), a = (sy - b * sx) / n;
    const xmin = Math.min(...xs), xmax = Math.max(...xs);
    return new Chart(ctx, {
      type: 'scatter',
      data: { datasets: [
        { label: 'sedute (VIX, realizzata futura)', data: d.scatter.map((p) => ({ x: p[0], y: p[1] })), backgroundColor: alpha(c.blue, .30), pointRadius: 1.8, order: 3 },
        { type: 'line', label: 'regressione', data: [{ x: xmin, y: a + b * xmin }, { x: xmax, y: a + b * xmax }], borderColor: c.amber, borderWidth: 2, pointRadius: 0, order: 1 },
        { type: 'line', label: 'parità (VIX = realizzata)', data: [{ x: xmin, y: xmin }, { x: xmax, y: xmax }], borderColor: c.tx2, borderWidth: 1.3, borderDash: [5, 4], pointRadius: 0, order: 2 },
      ] },
      options: baseOpts(c, {
        root: { parsing: true },
        scales: {
          x: { ...linY(c, 'VIX oggi (implicita, %)', { noFix: true }), type: 'linear', grid: { color: c.grid }, min: 0 },
          y: { ...linY(c, 'Vol. realizzata nei 30g successivi (%)', { noFix: true }), min: 0 },
        },
        tooltip: { callbacks: { label: (i) => `VIX ${i.parsed.x}%  →  realizz. ${i.parsed.y}%` } },
      }),
    });
  }

  /* ── Cono di volatilità (non temporale, no sync) ────────────────────── */
  function coneChart(ctx, d) {
    const c = C();
    const labels = d.cone.horizons.map((h) => h + 'g');
    const band = (key, color, w, dash) => ({ label: key, data: d.cone[key], borderColor: color, borderWidth: w, borderDash: dash, pointRadius: 0, tension: .3, fill: false });
    return new Chart(ctx, {
      type: 'line',
      data: { labels, datasets: [
        band('p95', alpha(c.red, .85), 1.3, [4, 3]),
        band('p75', alpha(c.amber, .9), 1.3, [4, 3]),
        { ...band('p50', c.tx2, 1.9), label: 'mediana' },
        band('p25', alpha(c.green, .9), 1.3, [4, 3]),
        band('p5', alpha(c.blue, .85), 1.3, [4, 3]),
        { label: 'oggi', data: d.cone.current, borderColor: c.amber, backgroundColor: c.amber, borderWidth: 2.8, pointRadius: 4.5, pointHoverRadius: 6, tension: .25, fill: false },
      ] },
      options: {
        responsive: true, maintainAspectRatio: false, parsing: true, animation: false,
        plugins: {
          legend: { labels: { color: c.tx2, usePointStyle: true, boxWidth: 18, padding: 12, font: { size: 11 } } },
          tooltip: { backgroundColor: c.bg2, borderColor: c.line, borderWidth: 1, titleColor: c.tx, bodyColor: c.tx2, padding: 10, cornerRadius: 8, callbacks: { label: (i) => '  ' + i.dataset.label + ': ' + i.parsed.y + '%' } },
        },
        scales: {
          x: { title: { display: true, text: 'Orizzonte (giorni di trading)', color: c.tx3, font: { size: 11 } }, grid: { color: c.grid }, ticks: { color: c.tx3, font: { family: 'JetBrains Mono', size: 11 } } },
          y: linY(c, 'Vol. realizzata annua (%)', { fmt: (v) => v + '%', noFix: true }),
        },
      },
    });
  }

  window.VC = { volChart, priceChart, drawdownChart, vrpChart, ratioChart, scatterChart, corrChart, coneChart };
})();
