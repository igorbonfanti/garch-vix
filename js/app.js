/* app.js — Vol Lab: carica i dati, costruisce KPI + sezioni, gestisce range
 * temporale e tema chiaro/scuro (standard d'ecosistema Antigravity).
 * Al cambio range i grafici vengono RICOSTRUITI sui soli dati della finestra,
 * così l'asse Y si auto-adatta alla vista (niente schiacciamenti da picchi fuori campo). */
(function () {
  'use strict';

  let D = null;          // dataset
  let charts = {};       // istanze Chart attive
  let rangeYears = 10;   // range visualizzato di default

  const $ = (s, r = document) => r.querySelector(s);
  const fmt = (v, d = 2) => (v == null || isNaN(v) ? '—' : Number(v).toFixed(d));
  const minMs = () => (rangeYears >= 99 ? D.ms[0] : Math.max(D.ms[0], Date.now() - rangeYears * 365.25 * 864e5));
  const maxMs = () => D.ms[D.ms.length - 1];

  function regime(pct, invert) {
    if (pct == null) return { cls: 'mid', txt: '—' };
    const hi = invert ? pct <= 33 : pct >= 66;
    const lo = invert ? pct >= 66 : pct <= 33;
    if (hi) return { cls: 'hi', txt: 'alto' };
    if (lo) return { cls: 'lo', txt: 'basso' };
    return { cls: 'mid', txt: 'medio' };
  }

  /* ── KPI ─────────────────────────────────────────────────────────────── */
  function kpis() {
    const c = D.current, m = D.meta;
    const vixR = regime(c.vixPct), rvR = regime(c.rvPct), vrpR = regime(c.vrpPct);
    return `<div class="kpis">
      <div class="kpi">
        <div class="lab">VIX · implicita</div>
        <div class="val">${fmt(c.vix)}<small>%</small></div>
        <div class="cmp">attesa del mercato a 30g</div>
        <span class="badge ${vixR.cls}">${vixR.txt} · ${fmt(c.vixPct,0)}° pct storico</span>
      </div>
      <div class="kpi">
        <div class="lab">Vol. realizzata · ${m.rollDays}g</div>
        <div class="val">${fmt(c.rv)}<small>%</small></div>
        <div class="cmp">oscillazione effettiva recente</div>
        <span class="badge ${rvR.cls}">${rvR.txt} · ${fmt(c.rvPct,0)}° pct storico</span>
      </div>
      <div class="kpi">
        <div class="lab">VRP · premio vol</div>
        <div class="val">${c.vrp>0?'+':''}${fmt(c.vrp)}</div>
        <div class="cmp">VIX − realizzata (punti)</div>
        <span class="badge ${vrpR.cls}">${vrpR.txt} · ${fmt(c.vrpPct,0)}° pct storico</span>
      </div>
      <div class="kpi">
        <div class="lab">Rapporto VIX / RV</div>
        <div class="val">${fmt(c.ratio,2)}<small>×</small></div>
        <div class="cmp">${c.ratio>=1?'opzioni "care"':'opzioni "a sconto"'}</div>
        <span class="badge ${c.ratio>=1.2?'hi':c.ratio>=0.9?'mid':'lo'}">${c.ratio>=1?'VIX > realizzata':'VIX < realizzata'}</span>
      </div>
      <div class="kpi">
        <div class="lab">Forecast GARCH(1,1)</div>
        <div class="val">${fmt(c.garch)}<small>%</small></div>
        <div class="cmp">stima econometrica 1-step</div>
        <span class="badge mid">long-run ${fmt(m.garch.longRunVol)}%</span>
      </div>
    </div>`;
  }

  function rangeBar() {
    const opts = [[1,'1A'],[3,'3A'],[5,'5A'],[10,'10A'],[99,'Max']];
    return `<div class="seg" id="rangebar">${opts.map(([y,l]) =>
      `<button data-y="${y}" class="${y===rangeYears?'on':''}">${l}</button>`).join('')}</div>`;
  }

  /* ── struttura sezioni ───────────────────────────────────────────────── */
  function layout() {
    const m = D.meta, mv = D.metrics.vix, mg = D.metrics.garch;
    const better = (a, b, lower) => (a == null || b == null) ? 0 : (lower ? (a < b ? -1 : 1) : (a > b ? -1 : 1));
    return `
    ${kpis()}

    <div class="card">
      <h2>📈 Volatilità nel tempo: implicita, realizzata, GARCH ${rangeBar()}</h2>
      <p class="desc">Le tre stime a confronto. La <b style="color:var(--blue)">blu (realizzata)</b> è ciò che è
        davvero accaduto negli ultimi ${m.rollDays} giorni; la <b style="color:var(--green)">verde (VIX)</b> è ciò che il
        mercato si aspetta; la <b style="color:var(--amber)">ambra tratteggiata (GARCH)</b> è la stima econometrica.
        La verde tende a stare <b>sopra</b> la blu: è il premio per il rischio. Usa i pulsanti per cambiare orizzonte.</p>
      <div class="chart-box tall"><canvas id="c-vol"></canvas></div>
      <div class="note">💡 <b>Come leggerlo:</b> i picchi coincidono con i grandi shock (2008, 2020 COVID, 2022, 2025).
        La volatilità è <b>mean-reverting</b>: tende a tornare verso la media di lungo periodo (~${fmt(m.garch.longRunVol)}%).
        Dopo uno shock il VIX rientra prima della realizzata, perché guarda avanti.</div>
    </div>

    <div class="grid2">
      <div class="card">
        <h2>🏔️ Prezzo dell'indice <span class="muted" style="font-size:12px;font-weight:400">(scala log)</span></h2>
        <p class="desc">Il sottostante in scala logaritmica (così le variazioni percentuali sono confrontabili nel tempo).
          Confrontalo con i picchi di volatilità qui sopra.</p>
        <div class="chart-box"><canvas id="c-price"></canvas></div>
      </div>
      <div class="card">
        <h2>🌊 Drawdown dai massimi</h2>
        <p class="desc">Quanto l'indice è sotto il suo massimo precedente. I fondi del drawdown coincidono con i
          picchi di volatilità: i ribassi fanno schizzare la vol molto più dei rialzi (<b>leverage effect</b>).</p>
        <div class="chart-box"><canvas id="c-dd"></canvas></div>
      </div>
    </div>

    <div class="grid2">
      <div class="card">
        <h2>💰 Variance Risk Premium (VRP)</h2>
        <p class="desc"><b>VIX − Volatilità realizzata.</b> Il sovrapprezzo pagato per la protezione. È stato
          <b>positivo nell'${fmt(m.vrpPosPct,0)}%</b> delle sedute (media <b>+${fmt(m.vrpMean)}</b> punti): chi vende
          protezione si fa pagare il rischio. Negativo solo quando il mercato è colto di sorpresa (es. crollo COVID).</p>
        <div class="chart-box sm"><canvas id="c-vrp"></canvas></div>
      </div>
      <div class="card">
        <h2>⚖️ Rapporto VIX / Realizzata</h2>
        <p class="desc">La stessa idea come <b>rapporto</b>. Sopra <b>1.0</b> il mercato prezza più volatilità di quella
          realizzata (premio); valori alti = protezione cara; sotto <b>1.0</b> la realizzata ha superato le attese.</p>
        <div class="chart-box sm"><canvas id="c-ratio"></canvas></div>
      </div>
    </div>

    <div class="grid2">
      <div class="card">
        <h2>🎯 Il VIX prevede la volatilità futura?</h2>
        <p class="desc">Ogni punto: <b>VIX oggi</b> (x) vs <b>volatilità realizzata nei 30 giorni successivi</b> (y),
          nel periodo out-of-sample. La <b>linea tratteggiata</b> è la parità. I punti stanno <b>in prevalenza sotto</b>
          la parità: in media il VIX <b>sovrastima</b> la volatilità che poi si realizza (il premio). Sopra la parità si
          finisce solo nelle crisi, quando la volatilità futura supera le attese.</p>
        <div class="chart-box sm"><canvas id="c-scatter"></canvas></div>
      </div>
      <div class="card">
        <h2>🔗 Correlazione rolling VIX ↔ Realizzata</h2>
        <p class="desc">Quanto si muovono <b>insieme</b>, giorno per giorno, su ${m.corrWin} sedute (correlazione delle
          variazioni). Alta = il VIX reagisce in tempo reale; cali segnalano fasi in cui implicita e realizzata si
          <b>scollegano</b>. L'asse non è troncato: i valori negativi sono mostrati per intero.</p>
        <div class="chart-box sm"><canvas id="c-corr"></canvas></div>
      </div>
    </div>

    <div class="card">
      <h2>🌋 Cono di volatilità</h2>
      <p class="desc">Per ogni <b>orizzonte</b> (10, 21, … 252 giorni) la <b>distribuzione storica</b> della volatilità
        realizzata: mediana, fasce 25–75 e 5–95 percentile. Il punto <b>ambra "oggi"</b> dice dove ci troviamo
        <b>adesso</b> rispetto alla storia, per ciascun orizzonte. Vicino al p95 = vol eccezionalmente alta (probabile
        rientro); vicino al p5 = insolitamente bassa.</p>
      <div class="chart-box"><canvas id="c-cone"></canvas></div>
    </div>

    <div class="card">
      <h2>📊 Chi prevede meglio la volatilità futura?</h2>
      <p class="desc">Test <b>previsivo onesto</b>: ogni stima a tempo <i>t</i> (VIX di oggi, forecast GARCH a 30 giorni)
        è confrontata con la volatilità <b>effettivamente realizzata nei 30 giorni successivi</b> (out-of-sample,
        dal ${m.splitDate}). <b>MAE/RMSE</b>: errore medio (più basso meglio). <b>Corr</b>: quanto segue la realizzata
        futura. <b>R²</b>: quota di varianza spiegata. <b>Bias</b>: errore sistematico.</p>
      <table>
        <thead><tr><th>Modello</th><th>MAE</th><th>RMSE</th><th>Corr</th><th>R²</th><th>Bias</th></tr></thead>
        <tbody>
          <tr><td class="tk">VIX (implicita)</td>
            <td class="mono-td ${better(mv.mae,mg.mae,1)<0?'win':''}">${fmt(mv.mae)}</td>
            <td class="mono-td ${better(mv.rmse,mg.rmse,1)<0?'win':''}">${fmt(mv.rmse)}</td>
            <td class="mono-td ${better(mv.corr,mg.corr,0)<0?'win':''}">${fmt(mv.corr,3)}</td>
            <td class="mono-td">${fmt(mv.r2,3)}</td>
            <td class="mono-td">+${fmt(mv.bias)}</td></tr>
          <tr><td class="tk">GARCH(1,1) a 30g</td>
            <td class="mono-td ${better(mg.mae,mv.mae,1)<0?'win':''}">${fmt(mg.mae)}</td>
            <td class="mono-td ${better(mg.rmse,mv.rmse,1)<0?'win':''}">${fmt(mg.rmse)}</td>
            <td class="mono-td ${better(mg.corr,mv.corr,0)<0?'win':''}">${fmt(mg.corr,3)}</td>
            <td class="mono-td">${fmt(mg.r2,3)}</td>
            <td class="mono-td">+${fmt(mg.bias)}</td></tr>
        </tbody>
      </table>
      <div class="note">💡 <b>Come leggerlo.</b> Prevedere la volatilità a 30 giorni è <b>intrinsecamente difficile</b>:
        l'R² è modesto per entrambi (la vol futura è molto rumorosa). Il <b>VIX correla meglio</b> con ciò che accadrà
        (${fmt(mv.corr,2)} vs ${fmt(mg.corr,2)}) — contiene informazione previsiva genuina — ma è <b>biased verso l'alto</b>
        di +${fmt(mv.bias)} punti, ed è esattamente il <b>premio per il rischio</b>. Il <b>GARCH è meno distorto</b>
        (bias +${fmt(mg.bias)}) e quindi ha MAE più basso. Confronto corretto e <b>non circolare</b>: la stima a tempo
        <i>t</i> non condivide dati col bersaglio futuro.</div>
    </div>

    <div class="card">
      <h2>🔧 Parametri del modello GARCH(1,1)</h2>
      <p class="desc">Stimati in-sample (prima del ${m.splitDate}) con massima verosimiglianza.
        h<sub>t</sub> = ω + α·ε²<sub>t-1</sub> + β·h<sub>t-1</sub>. <b>α</b> = reattività agli shock recenti,
        <b>β</b> = persistenza/memoria, <b>α+β</b> vicino a 1 ⇒ gli shock si riassorbono lentamente.</p>
      <div class="params">
        <div class="param"><div class="pl">ω (omega)</div><div class="pv">${fmt(m.garch.omega,5)}</div></div>
        <div class="param"><div class="pl">α (alpha)</div><div class="pv">${fmt(m.garch.alpha,3)}</div></div>
        <div class="param"><div class="pl">β (beta)</div><div class="pv">${fmt(m.garch.beta,3)}</div></div>
        <div class="param"><div class="pl">α + β · persistenza</div><div class="pv">${fmt(m.garch.persistence,3)}</div></div>
        <div class="param"><div class="pl">Vol. di lungo periodo</div><div class="pv">${fmt(m.garch.longRunVol)}%</div></div>
      </div>
    </div>

    <div class="card">
      <h2>📚 Glossario — capire cosa stiamo guardando</h2>
      <dl class="gloss">
        <div><dt>Volatilità implicita (VIX)</dt><dd>Ricavata dai prezzi delle opzioni: la volatilità che il mercato si <b>aspetta</b> nei prossimi 30 giorni, annualizzata. È <i>forward-looking</i> e contiene un premio per il rischio.</dd></div>
        <div><dt>Volatilità realizzata (trailing)</dt><dd>Deviazione standard dei rendimenti degli ultimi ${m.rollDays} giorni × √${m.tradingDays}. È ciò che è <b>davvero accaduto</b>. Usata nei grafici temporali.</dd></div>
        <div><dt>Volatilità realizzata futura (forward)</dt><dd>La stessa misura ma sui ${m.rollDays} giorni <b>successivi</b>. È il bersaglio corretto per valutare se VIX e GARCH <b>prevedono</b> davvero la volatilità.</dd></div>
        <div><dt>Variance / Volatility Risk Premium</dt><dd>VIX − realizzata. Compenso pagato per la protezione. Positivo nell'${fmt(m.vrpPosPct,0)}% delle sedute; base delle strategie di <i>vendita di volatilità</i>.</dd></div>
        <div><dt>GARCH(1,1)</dt><dd>Modello econometrico della volatilità che cambia nel tempo. Cattura il <i>volatility clustering</i> (le fasi turbolente si raggruppano). Qui stimato in JS con massima verosimiglianza.</dd></div>
        <div><dt>Annualizzazione (×√252)</dt><dd>La volatilità giornaliera si scala alla base annua moltiplicando per √252. Così tutte le misure sono in "% annua" e confrontabili col VIX.</dd></div>
        <div><dt>Mean reversion</dt><dd>La volatilità tende a tornare verso una media di lungo periodo: gli estremi (alti o bassi) tendono a non durare.</dd></div>
        <div><dt>Out-of-sample (OOS)</dt><dd>Il GARCH è stimato solo sui dati <b>prima</b> del ${m.splitDate} e proiettato in avanti senza re-fitting: un test onesto della reale capacità predittiva.</dd></div>
      </dl>
    </div>`;
  }

  /* ── costruzione grafici sulla finestra corrente ─────────────────────── */
  function buildCharts() {
    Object.values(charts).forEach((c) => c && c.destroy());
    charts = {};
    const min = minMs(), max = maxMs();
    charts.vol = VC.volChart($('#c-vol'), D, min, max);
    charts.price = VC.priceChart($('#c-price'), D, min, max);
    charts.dd = VC.drawdownChart($('#c-dd'), D, min, max);
    charts.vrp = VC.vrpChart($('#c-vrp'), D, min, max, D.meta.vrpMean);
    charts.ratio = VC.ratioChart($('#c-ratio'), D, min, max);
    charts.scatter = VC.scatterChart($('#c-scatter'), D);
    charts.corr = VC.corrChart($('#c-corr'), D, min, max);
    charts.cone = VC.coneChart($('#c-cone'), D);
  }

  function applyRange(y) {
    rangeYears = y;
    $('#rangebar').querySelectorAll('button').forEach((b) => b.classList.toggle('on', +b.dataset.y === y));
    buildCharts(); // ricostruisce sui dati della finestra → asse Y corretto
  }

  /* ── tema ────────────────────────────────────────────────────────────── */
  function setupTheme() {
    const btn = $('#theme-toggle');
    const sync = () => {
      const t = document.documentElement.getAttribute('data-theme') || 'dark';
      btn.textContent = t === 'dark' ? '🌙' : '☀️';
      const mc = document.querySelector('meta[name="theme-color"]');
      if (mc) mc.setAttribute('content', t === 'dark' ? '#0f1117' : '#f5f7fa');
    };
    sync();
    btn.addEventListener('click', () => {
      const t = (document.documentElement.getAttribute('data-theme') || 'dark') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', t);
      try { localStorage.setItem('antigravity-theme', t); } catch (e) {}
      sync();
      buildCharts();
    });
  }

  /* ── avvio ───────────────────────────────────────────────────────────── */
  async function init() {
    try {
      const res = await fetch('data/garch_data.json', { cache: 'no-cache' });
      D = await res.json();
    } catch (e) {
      $('#app').innerHTML = `<div class="card" style="border-color:var(--red)"><b>Impossibile caricare i dati.</b>
        Esegui prima <span class="mono">node scripts/fetch_data.js</span> per generare <span class="mono">data/garch_data.json</span>.</div>`;
      return;
    }
    D.ms = D.dates.map((d) => new Date(d + 'T00:00:00Z').getTime());

    const m = D.meta;
    $('#sub').innerHTML = `<b>${m.displayName}</b> · ${m.asset} vs ${m.vixTicker} · ${m.dataStart} → ${m.dataEnd}`;
    document.title = `${m.displayName} — VIX vs Vol Realizzata`;
    $('#app').innerHTML = layout();
    $('#foot').innerHTML = `Dati: Yahoo Finance · ${m.dataStart} → ${m.dataEnd} · ${D.dates.length} sedute · GARCH(1,1) stima propria ·
      generato il ${new Date(m.generatedAt).toLocaleString('it-IT')}<br>
      Strumento didattico di analisi quantitativa. Non è una raccomandazione d'investimento.`;

    setupTheme();
    buildCharts();
    $('#rangebar').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) applyRange(+b.dataset.y); });
  }

  init();
})();
