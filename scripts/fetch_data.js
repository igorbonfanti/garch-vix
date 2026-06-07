/* ============================================================================
 * fetch_data.js — pipeline dati per l'app "VIX vs Volatilità Realizzata".
 *
 *  1. Scarica OHLC di asset (^GSPC) e VIX (^VIX) da Yahoo (lato Node, no CORS).
 *  2. Allinea sulle date comuni, calcola log-return %.
 *  3. Volatilità realizzata annualizzata (close-to-close e Parkinson).
 *  4. GARCH(1,1) in-sample, forecast out-of-sample ricorsivo.
 *  5. Variance Risk Premium (VIX - RV), rapporto VIX/RV, correlazione rolling,
 *     drawdown del sottostante, cono di volatilità, percentili di regime.
 *  6. Metriche di accuratezza (MAE, RMSE, Corr, R², bias) di VIX e GARCH
 *     rispetto alla volatilità realizzata, nel periodo OOS.
 *  7. Scrive data/garch_data.json (consumato dall'app statica).
 *
 *  Uso:  node scripts/fetch_data.js
 * ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const { fetchOHLC } = require('./yahoo');
const { fitGarch11 } = require('./garch');

// ── PARAMETRI (modifica qui) ───────────────────────────────────────────────
const ASSET_TICKER = '^GSPC';     // sottostante (Yahoo)
const VIX_TICKER   = '^VIX';      // volatilità implicita
const DISPLAY_NAME = 'S&P 500 (SPX)';
const SPLIT_DATE   = '2010-01-01'; // inizio out-of-sample per il GARCH
const ROLL_DAYS    = 30;           // finestra volatilità realizzata
const TRADING_DAYS = 252;
const CORR_WIN     = 63;           // finestra correlazione rolling (~3 mesi)
const CONE_HORIZONS = [10, 21, 42, 63, 126, 252];
const OUTPUT_FILE  = path.join(__dirname, '..', 'data', 'garch_data.json');
// ───────────────────────────────────────────────────────────────────────────

const r2 = (x, d = 2) => (x == null || !isFinite(x)) ? null : Math.round(x * 10 ** d) / 10 ** d;
const iso = (ts) => new Date(ts * 1000).toISOString().slice(0, 10);

function rollingStd(arr, win) {
  const out = new Array(arr.length).fill(null);
  let sum = 0, sum2 = 0, q = [];
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    q.push(v); sum += v; sum2 += v * v;
    if (q.length > win) { const o = q.shift(); sum -= o; sum2 -= o * o; }
    if (q.length === win) {
      const mean = sum / win;
      const variance = (sum2 - win * mean * mean) / (win - 1);
      out[i] = Math.sqrt(Math.max(variance, 0));
    }
  }
  return out;
}

/** Volatilità realizzata annualizzata (%) close-to-close su finestra `win`. */
function realizedVol(logRetPct, win, tradingDays) {
  return rollingStd(logRetPct, win).map((s) => (s == null ? null : s * Math.sqrt(tradingDays)));
}

/** Stimatore Parkinson rolling: usa solo high/low, più efficiente del close-to-close. */
function parkinsonVol(high, low, win, tradingDays) {
  const f = 1 / (4 * Math.log(2));
  const hl = high.map((h, i) => f * Math.log(h / low[i]) ** 2); // varianza giornaliera
  const out = new Array(hl.length).fill(null);
  let sum = 0, q = [];
  for (let i = 0; i < hl.length; i++) {
    q.push(hl[i]); sum += hl[i];
    if (q.length > win) sum -= q.shift();
    if (q.length === win) out[i] = Math.sqrt(sum / win) * Math.sqrt(tradingDays) * 100;
  }
  return out;
}

/** Percentile (0-100) del valore `v` nella distribuzione storica `arr`. */
function percentileOf(arr, v) {
  const xs = arr.filter((x) => x != null && isFinite(x));
  if (!xs.length || v == null) return null;
  let c = 0; for (const x of xs) if (x <= v) c++;
  return r2((c / xs.length) * 100, 1);
}

function quantile(sorted, p) {
  if (!sorted.length) return null;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function metrics(pred, actual) {
  const P = [], A = [];
  for (let i = 0; i < pred.length; i++) {
    if (pred[i] != null && actual[i] != null && isFinite(pred[i]) && isFinite(actual[i])) {
      P.push(pred[i]); A.push(actual[i]);
    }
  }
  const n = P.length;
  if (n < 2) return null;
  let mae = 0, mse = 0, bias = 0;
  for (let i = 0; i < n; i++) { mae += Math.abs(P[i] - A[i]); mse += (P[i] - A[i]) ** 2; bias += P[i] - A[i]; }
  mae /= n; mse /= n; bias /= n;
  const mP = P.reduce((a, b) => a + b, 0) / n, mA = A.reduce((a, b) => a + b, 0) / n;
  let cov = 0, vP = 0, vA = 0, ssRes = 0, ssTot = 0;
  for (let i = 0; i < n; i++) {
    cov += (P[i] - mP) * (A[i] - mA); vP += (P[i] - mP) ** 2; vA += (A[i] - mA) ** 2;
    ssRes += (A[i] - P[i]) ** 2; ssTot += (A[i] - mA) ** 2;
  }
  return {
    mae: r2(mae, 3), rmse: r2(Math.sqrt(mse), 3),
    corr: r2(cov / Math.sqrt(vP * vA), 3), r2: r2(1 - ssRes / ssTot, 3),
    bias: r2(bias, 3),
  };
}

async function main() {
  console.log(`📥 Download ${ASSET_TICKER} e ${VIX_TICKER} da Yahoo...`);
  const [asset, vix] = await Promise.all([fetchOHLC(ASSET_TICKER), fetchOHLC(VIX_TICKER)]);
  if (!asset || !vix) throw new Error('Download fallito (Yahoo non ha risposto).');
  console.log(`   asset: ${asset.close.length} barre, vix: ${vix.close.length} barre`);

  // ── allineamento sulle date comuni ──
  const vixMap = new Map();
  for (let i = 0; i < vix.ts.length; i++) vixMap.set(iso(vix.ts[i]), vix.close[i]);

  const dates = [], price = [], open = [], high = [], low = [], vixLevel = [];
  for (let i = 0; i < asset.ts.length; i++) {
    const d = iso(asset.ts[i]);
    if (!vixMap.has(d)) continue;
    dates.push(d); price.push(asset.close[i]); open.push(asset.open[i]);
    high.push(asset.high[i]); low.push(asset.low[i]); vixLevel.push(vixMap.get(d));
  }
  const n = dates.length;
  console.log(`   allineate ${n} sedute comuni (${dates[0]} → ${dates[n - 1]})`);

  // ── log-return % ──
  const logRet = new Array(n).fill(null);
  for (let i = 1; i < n; i++) logRet[i] = Math.log(price[i] / price[i - 1]) * 100;

  // ── volatilità realizzata ──
  // Il primo log-return (i=0) è indefinito: lo lasciamo a 0 ma viene escluso da
  // ogni finestra valida (la prima RV è all'indice ROLL_DAYS, finestra 1..ROLL_DAYS).
  const logRetClean = logRet.map((x) => (x == null ? 0 : x));
  const rv = realizedVol(logRetClean, ROLL_DAYS, TRADING_DAYS).map((v, i) => (i < ROLL_DAYS ? null : v));
  const parkinson = parkinsonVol(high, low, ROLL_DAYS, TRADING_DAYS);

  // Volatilità realizzata FORWARD: ciò che accade nei ROLL_DAYS giorni SUCCESSIVI.
  // rvFwd[t] = volatilità realizzata sulla finestra [t+1 .. t+ROLL_DAYS] = rv[t+ROLL_DAYS].
  // È il bersaglio corretto per valutare la capacità PREVISIVA di VIX e GARCH.
  const rvFwd = new Array(n).fill(null);
  for (let i = 0; i < n - ROLL_DAYS; i++) rvFwd[i] = rv[i + ROLL_DAYS];

  // ── GARCH(1,1): fit in-sample, forecast ricorsivo su tutta la serie ──
  const splitIdx = dates.findIndex((d) => d >= SPLIT_DATE);
  const retIS = logRet.slice(1, splitIdx).filter((x) => x != null && isFinite(x));
  console.log(`🔧 Fit GARCH(1,1) su ${retIS.length} osservazioni in-sample (< ${SPLIT_DATE})...`);
  const g = fitGarch11(retIS);
  console.log(`   ω=${g.omega.toFixed(6)}  α=${g.alpha.toFixed(4)}  β=${g.beta.toFixed(4)}  (α+β=${g.persistence.toFixed(4)})`);

  // Varianza condizionata ricorsiva. garch1 = vol annualizzata 1-step (per il grafico).
  // garchFwd = previsione GARCH della vol MEDIA sui prossimi ROLL_DAYS giorni
  // (formula multi-step a orizzonte H con mean-reversion verso la varianza di lungo periodo),
  // bersaglio: rvFwd. È il confronto previsivo corretto, non quello contemporaneo.
  const { mu, omega, alpha, beta, longRunVar } = g;
  const persist = alpha + beta, H = ROLL_DAYS, sLR = longRunVar;
  const garch1 = new Array(n).fill(null), garchFwd = new Array(n).fill(null);
  let h = sLR;
  for (let i = 0; i < n; i++) {
    garch1[i] = Math.sqrt(h * TRADING_DAYS);
    const e = logRetClean[i] - mu;
    const hNext = omega + alpha * e * e + beta * h;              // varianza attesa per t+1
    // media di E[h_{t+k}] per k=1..H:  H*sLR + (hNext-sLR)*(1-persist^H)/(1-persist)
    const geom = persist < 1 ? (1 - Math.pow(persist, H)) / (1 - persist) : H;
    const avgVar = (H * sLR + (hNext - sLR) * geom) / H;
    garchFwd[i] = Math.sqrt(Math.max(avgVar, 0) * TRADING_DAYS);
    h = hNext;
  }
  // serie GARCH mostrata a video: 1-step, solo out-of-sample
  const garch = garch1.map((v, i) => (i < splitIdx ? null : v));

  // ── variance risk premium, rapporto, drawdown ──
  const vrp = new Array(n).fill(null), ratio = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (rv[i] != null) { vrp[i] = vixLevel[i] - rv[i]; ratio[i] = vixLevel[i] / rv[i]; }
  }
  const vrpVals = vrp.filter((v) => v != null && isFinite(v));
  const vrpMean = vrpVals.reduce((a, b) => a + b, 0) / vrpVals.length;
  const vrpPos = (100 * vrpVals.filter((v) => v > 0).length / vrpVals.length); // % di giorni col premio positivo

  // drawdown del sottostante (%)
  const drawdown = new Array(n); let peak = -Infinity;
  for (let i = 0; i < n; i++) { peak = Math.max(peak, price[i]); drawdown[i] = (price[i] / peak - 1) * 100; }

  // ── correlazione rolling fra variazioni giornaliere di VIX e RV ──
  const dVix = new Array(n).fill(null), dRv = new Array(n).fill(null);
  for (let i = 1; i < n; i++) {
    dVix[i] = vixLevel[i] - vixLevel[i - 1];
    if (rv[i] != null && rv[i - 1] != null) dRv[i] = rv[i] - rv[i - 1];
  }
  const rollCorr = new Array(n).fill(null);
  for (let i = CORR_WIN; i < n; i++) {
    const xs = [], ys = [];
    for (let k = i - CORR_WIN + 1; k <= i; k++) {
      if (dVix[k] != null && dRv[k] != null) { xs.push(dVix[k]); ys.push(dRv[k]); }
    }
    if (xs.length > 10) {
      const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
      let cov = 0, vx = 0, vy = 0;
      for (let k = 0; k < xs.length; k++) { cov += (xs[k] - mx) * (ys[k] - my); vx += (xs[k] - mx) ** 2; vy += (ys[k] - my) ** 2; }
      rollCorr[i] = vx > 0 && vy > 0 ? cov / Math.sqrt(vx * vy) : null;
    }
  }

  // ── cono di volatilità (percentili del RV annualizzato per orizzonte) ──
  const cone = { horizons: CONE_HORIZONS, p5: [], p25: [], p50: [], p75: [], p95: [], current: [] };
  for (const h of CONE_HORIZONS) {
    const series = realizedVol(logRetClean, h, TRADING_DAYS).filter((v) => v != null && isFinite(v));
    const sorted = series.slice().sort((a, b) => a - b);
    cone.p5.push(r2(quantile(sorted, 0.05)));
    cone.p25.push(r2(quantile(sorted, 0.25)));
    cone.p50.push(r2(quantile(sorted, 0.50)));
    cone.p75.push(r2(quantile(sorted, 0.75)));
    cone.p95.push(r2(quantile(sorted, 0.95)));
    cone.current.push(r2(series[series.length - 1]));
  }

  // ── metriche di accuratezza PREVISIVA (out-of-sample, vs realizzata FORWARD) ──
  // Ogni stima fatta a tempo t (VIX_t, forecast GARCH a 30g) è confrontata con la
  // volatilità realizzata nei 30 giorni SUCCESSIVI. È il test onesto: niente
  // circolarità (il GARCH non "insegue" più una realizzata che condivide gli stessi dati).
  const target = (i) => (i >= splitIdx && rvFwd[i] != null ? rvFwd[i] : null);
  const vixPred = vixLevel.map((v, i) => (target(i) != null ? v : null));
  const garchPred = garchFwd.map((v, i) => (target(i) != null ? v : null));
  const tgt = vixLevel.map((_, i) => target(i));
  const mVix = metrics(vixPred, tgt);
  const mGarch = metrics(garchPred, tgt);
  console.log(`📊 Forecast OOS (vs realizzata futura 30g)  VIX → R²=${mVix.r2} corr=${mVix.corr} bias=${mVix.bias}  |  GARCH → R²=${mGarch.r2} corr=${mGarch.corr} bias=${mGarch.bias}`);

  // ── scatter VIX vs realizzata FUTURA (il VIX prevede la vol dei 30g successivi?) ──
  const scatter = [];
  for (let i = splitIdx; i < n; i++) {
    if (rvFwd[i] != null && (i % 2 === 0)) scatter.push([r2(vixLevel[i]), r2(rvFwd[i])]);
  }

  // ── snapshot corrente + percentili di regime ──
  const last = n - 1;
  const current = {
    date: dates[last], price: r2(price[last]),
    vix: r2(vixLevel[last]), rv: r2(rv[last]), vrp: r2(vrp[last]),
    ratio: r2(ratio[last], 3), garch: r2(garch[last]), parkinson: r2(parkinson[last]),
    vixPct: percentileOf(vixLevel, vixLevel[last]),
    rvPct: percentileOf(rv, rv[last]),
    vrpPct: percentileOf(vrp, vrp[last]),
  };

  const out = {
    meta: {
      asset: ASSET_TICKER, vixTicker: VIX_TICKER, displayName: DISPLAY_NAME,
      splitDate: SPLIT_DATE, rollDays: ROLL_DAYS, tradingDays: TRADING_DAYS,
      corrWin: CORR_WIN, currency: asset.currency,
      dataStart: dates[0], dataEnd: dates[last],
      generatedAt: new Date().toISOString(),
      vrpMean: r2(vrpMean), vrpPosPct: r2(vrpPos, 1),
      garch: {
        mu: r2(g.mu, 6), omega: r2(g.omega, 8), alpha: r2(g.alpha, 6), beta: r2(g.beta, 6),
        persistence: r2(g.persistence, 4), longRunVol: r2(Math.sqrt(g.longRunVar * TRADING_DAYS), 2),
      },
    },
    metrics: { vix: mVix, garch: mGarch },
    current,
    cone,
    scatter,
    dates,
    series: {
      price: price.map((v) => r2(v)),
      rv: rv.map((v) => r2(v)),
      vix: vixLevel.map((v) => r2(v)),
      garch: garch.map((v) => r2(v)),
      vrp: vrp.map((v) => r2(v)),
      ratio: ratio.map((v) => r2(v, 3)),
      parkinson: parkinson.map((v) => r2(v)),
      rollCorr: rollCorr.map((v) => r2(v, 3)),
      drawdown: drawdown.map((v) => r2(v)),
    },
  };

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(out));
  const kb = (fs.statSync(OUTPUT_FILE).size / 1024).toFixed(0);
  console.log(`✅ Scritto ${OUTPUT_FILE} (${kb} KB, ${n} punti)`);
}

main().catch((e) => { console.error('❌', e); process.exit(1); });
