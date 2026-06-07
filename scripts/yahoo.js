/* ============================================================================
 * yahoo.js — download serie storiche OHLC da Yahoo chart API.
 * Funziona lato Node (no CORS). Stesso approccio collaudato in coma-screener/rrg,
 * qui esteso per restituire anche open/high/low (servono per gli stimatori di
 * volatilità Parkinson / Garman-Klass).
 * ========================================================================== */
'use strict';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept': 'application/json',
};

const HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Scarica la serie OHLC giornaliera per `symbol`.
 * @returns {Promise<{symbol, currency, ts:number[], open:number[], high:number[],
 *                     low:number[], close:number[]}|null>}
 */
async function fetchOHLC(symbol, { interval = '1d', retries = 4 } = {}) {
  const period2 = Math.floor(Date.now() / 1000);
  for (let attempt = 0; attempt < retries; attempt++) {
    const host = HOSTS[attempt % HOSTS.length];
    const url = `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}` +
      `?period1=0&period2=${period2}&interval=${interval}`;
    try {
      const res = await fetch(url, { headers: HEADERS });
      if (res.status === 429 || res.status === 503) { await sleep(900 * (attempt + 1)); continue; }
      if (!res.ok) return null;
      const j = await res.json();
      const r = j?.chart?.result?.[0];
      if (!r || !r.timestamp) return null;
      const q = r.indicators?.quote?.[0];
      if (!q || !q.close) return null;
      const ts = [], open = [], high = [], low = [], close = [];
      for (let i = 0; i < r.timestamp.length; i++) {
        const c = q.close[i];
        if (c == null || !isFinite(c) || c <= 0) continue;
        ts.push(r.timestamp[i]);
        close.push(c);
        open.push(q.open[i] ?? c);
        high.push(q.high[i] ?? c);
        low.push(q.low[i] ?? c);
      }
      if (close.length < 2) return null;
      return { symbol, currency: r.meta?.currency || null, ts, open, high, low, close };
    } catch (e) {
      await sleep(600 * (attempt + 1));
    }
  }
  return null;
}

module.exports = { fetchOHLC };
