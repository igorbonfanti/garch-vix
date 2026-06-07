/* app.js — Vol Lab: carica i dati, costruisce KPI + sezioni, gestisce range
 * temporale e tema chiaro/scuro (standard d'ecosistema Antigravity). */
(function () {
  'use strict';

  let D = null;          // dataset
  let charts = {};       // istanze Chart attive
  let rangeYears = 10;   // range visualizzato di default

  const $ = (s, r = document) => r.querySelector(s);
  const fmt = (v, d = 2) => (v == null ? '—' : Number(v).toFixed(d));
  const yearsAgoMs = (y) => (y >= 99 ? D.ms[0] : Date.now() - y * 365.25 * 864e5);

  // regime da percentile
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
    const ratioTxt = c.ratio >= 1 ? 'opzioni "care"' : 'opzioni "a sconto"';
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
        <div class="cmp">${ratioTxt}</div>
        <span class="badge ${c.ratio>=1.2?'hi':c.ratio>=0.9?'mid':'lo'}">${c.ratio>=1?'VIX > realizzata':'VIX < realizzata'}</span>
      </div>
      <div class="kpi">
        <div class="lab">Forecast GARCH(1,1)</div>
        <div class="val">${fmt(c.garch)}<small>%</small></div>
        <div class="cmp">stima econometrica</div>
        <span class="badge mid">long-run ${fmt(m.garch.longRunVol)}%</span>
      </div>
    </div>`;
  }

  /* ── selettore range ─────────────────────────────────────────────────── */
  function rangeBar() {
    const opts = [[1,'1A'],[3,'3A'],[5,'5A'],[10,'10A'],[99,'Max']];
    return `<div class="seg" id="rangebar">${opts.map(([y,l]) =>
      `<button data-y="${y}" class="${y===rangeYears?'on':''}">${l}</button>`).join('')}</div>`;
  }

  /* ── struttura sezioni ───────────────────────────────────────────────── */
  function layout() {
    const m = D.meta, mv = D.metrics.vix, mg = D.metrics.garch;
    return `
    ${kpis()}

    <div class="card">
      <h2>📈 Volatilità nel tempo: implicita, realizzata, GARCH ${rangeBar()}</h2>
      <p class="desc">Le tre stime della volatilità a confronto. Quando la <b>verde (VIX)</b> stacca verso l'alto
        la <b>blu (realizzata)</b>, il mercato sta pagando un <b>premio</b> per proteggersi: succede quasi sempre,
        ma si allarga nelle fasi di paura. La <b>ambra (GARCH)</b> è una previsione puramente statistica basata
        sui rendimenti passati. Usa i pulsanti per cambiare l'orizzonte; passa il mouse per i valori puntuali.</p>
      <div class="chart-box tall"><canvas id="c-vol"></canvas></div>
      <div class="note">💡 <b>Come leggerlo:</b> i picchi coincidono con i grandi shock (2008, 2011, marzo 2020, 2022).
        Dopo lo shock la volatilità realizzata <b>rientra</b> più lentamente del VIX, perché il VIX guarda avanti e
        "annusa" la calma prima che si veda nei prezzi. La volatilità è <b>mean-reverting</b>: tende a tornare verso
        la sua media di lungo periodo (~${fmt(m.garch.longRunVol)}%).</div>
    </div>

    <div class="card">
      <h2>🏔️ Prezzo dell'indice e drawdown</h2>
      <p class="desc">Il sottostante (scala logaritmica) e la sua <b>perdita dai massimi</b> (drawdown).
        Mettilo a fianco del grafico sopra: i <b>crolli di prezzo</b> e i <b>picchi di volatilità</b> arrivano
        insieme. È il cosiddetto <b>"leverage effect"</b> — i ribassi fanno schizzare la volatilità molto più dei rialzi.</p>
      <div class="chart-box"><canvas id="c-price"></canvas></div>
    </div>

    <div class="grid2">
      <div class="card">
        <h2>💰 Variance Risk Premium (VRP)</h2>
        <p class="desc"><b>VIX − Volatilità realizzata.</b> È il sovrapprezzo che chi compra opzioni paga rispetto
          alla volatilità che poi si materializza. È <b>quasi sempre positivo</b> (chi vende protezione si fa pagare
          il rischio): storicamente in media <b>+${fmt(mv.bias)}</b> punti. Quando il VRP è <b>molto alto</b> le opzioni
          sono costose (utile per chi le vende); quando è <b>negativo</b> il mercato è stato colto di sorpresa.</p>
        <div class="chart-box sm"><canvas id="c-vrp"></canvas></div>
      </div>
      <div class="card">
        <h2>⚖️ Rapporto VIX / Realizzata</h2>
        <p class="desc">La stessa idea in forma di <b>rapporto</b>. Sopra <b>1.0</b> il mercato prezza più volatilità
          di quella realizzata di recente (premio); valori <b>molto alti</b> indicano protezione cara, valori
          <b>sotto 1.0</b> indicano che la realizzata ha superato le attese (raro, fasi di stress acuto).</p>
        <div class="chart-box sm"><canvas id="c-ratio"></canvas></div>
      </div>
    </div>

    <div class="grid2">
      <div class="card">
        <h2>🎯 VIX vs Realizzata — dispersione</h2>
        <p class="desc">Ogni punto è una seduta (periodo out-of-sample). La <b>linea tratteggiata</b> è la parità
          (VIX = realizzata); la <b>linea ambra</b> è la regressione. I punti stanno <b>quasi tutti sopra</b> la parità:
          è la prova visiva che il VIX <b>sovrastima sistematicamente</b> la volatilità che poi accade — di nuovo il premio.</p>
        <div class="chart-box sm"><canvas id="c-scatter"></canvas></div>
      </div>
      <div class="card">
        <h2>🔗 Correlazione rolling VIX ↔ Realizzata</h2>
        <p class="desc">Quanto si muovono <b>insieme</b>, giorno per giorno, su una finestra di ${m.corrWin} sedute
          (correlazione delle variazioni). Valori alti = il VIX reagisce in tempo reale a ciò che accade; cali della
          correlazione segnalano fasi in cui implicita e realizzata si <b>scollegano</b> (es. compiacenza o panico anticipato).</p>
        <div class="chart-box sm"><canvas id="c-corr"></canvas></div>
      </div>
    </div>

    <div class="card">
      <h2>🌋 Cono di volatilità</h2>
      <p class="desc">Strumento classico del vol-trading. Per ogni <b>orizzonte</b> (10, 21, … 252 giorni) mostra la
        <b>distribuzione storica</b> della volatilità realizzata: mediana, fasce 25–75 e 5–95 percentile. Il punto
        <b>ambra "oggi"</b> dice dove ci troviamo <b>adesso</b> rispetto alla storia, per ciascun orizzonte. Se "oggi"
        è vicino al p95 la volatilità è eccezionalmente alta (probabile rientro); vicino al p5 è insolitamente bassa.</p>
      <div class="chart-box"><canvas id="c-cone"></canvas></div>
    </div>

    <div class="card">
      <h2>📊 Chi prevede meglio la volatilità realizzata?</h2>
      <p class="desc">Accuratezza di VIX e GARCH nel <b>prevedere</b> la volatilità realizzata, nel periodo
        out-of-sample (dal ${m.splitDate}). <b>MAE/RMSE</b>: errore medio (più basso è meglio). <b>Corr</b> e <b>R²</b>:
        quanto seguono la realizzata (più alto è meglio). <b>Bias</b>: errore sistematico (il VIX è positivo perché
        sta sopra — il premio).</p>
      <table>
        <thead><tr><th>Modello</th><th>MAE</th><th>RMSE</th><th>Corr</th><th>R²</th><th>Bias</th></tr></thead>
        <tbody>
          <tr><td class="tk">VIX (implicita)</td>${row(mv,mg,'mae',true)}${row(mv,mg,'rmse',true)}${row(mv,mg,'corr')}${row(mv,mg,'r2')}<td class="mono-td">${fmt(mv.bias)}</td></tr>
          <tr><td class="tk">GARCH(1,1)</td>${row(mg,mv,'mae',true)}${row(mg,mv,'rmse',true)}${row(mg,mv,'corr')}${row(mg,mv,'r2')}<td class="mono-td">${fmt(mg.bias)}</td></tr>
        </tbody>
      </table>
      <div class="note">⚠️ <b>Attenzione all'interpretazione.</b> Il GARCH sembra "vincere" su R² e MAE, ma è in parte
        <b>circolare</b>: usa gli stessi rendimenti passati con cui si calcola la volatilità realizzata, quindi la
        "insegue" quasi per costruzione. Il VIX è un'informazione <b>diversa e indipendente</b> (le attese implicite nelle
        opzioni): il suo "errore" è in larga parte il <b>premio per il rischio</b>, non un difetto del modello.
        Non è una gara: i due strumenti rispondono a domande diverse.</div>
    </div>

    <div class="card">
      <h2>🔧 Parametri del modello GARCH(1,1)</h2>
      <p class="desc">Stimati in-sample (prima del ${m.splitDate}) con massima verosimiglianza.
        h<sub>t</sub> = ω + α·ε²<sub>t-1</sub> + β·h<sub>t-1</sub>. <b>α</b> = reattività agli shock recenti,
        <b>β</b> = memoria/persistenza, <b>α+β</b> = persistenza totale (vicino a 1 ⇒ gli shock si riassorbono lentamente).</p>
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
        <div><dt>Volatilità implicita (VIX)</dt><dd>Ricavata dai prezzi delle opzioni sull'indice: la volatilità che il mercato si <b>aspetta</b> nei prossimi 30 giorni, annualizzata. È <i>forward-looking</i> e contiene un premio per il rischio.</dd></div>
        <div><dt>Volatilità realizzata</dt><dd>Deviazione standard dei rendimenti giornalieri degli ultimi ${m.rollDays} giorni, moltiplicata per √${m.tradingDays} per annualizzarla. È ciò che è <b>davvero accaduto</b>.</dd></div>
        <div><dt>Variance / Volatility Risk Premium</dt><dd>La differenza VIX − realizzata. Compenso che gli investitori pagano per la protezione. Tipicamente positivo; è la base di molte strategie di <i>vendita di volatilità</i>.</dd></div>
        <div><dt>GARCH(1,1)</dt><dd>Modello econometrico che descrive come la volatilità <b>cambia nel tempo</b> a partire dagli shock passati. Cattura il <i>volatility clustering</i> (le fasi turbolente si raggruppano).</dd></div>
        <div><dt>Annualizzazione (×√252)</dt><dd>La volatilità giornaliera si scala alla base annua moltiplicando per la radice del numero di sedute (~252). Così tutte le misure sono confrontabili in "% annua".</dd></div>
        <div><dt>Mean reversion</dt><dd>La volatilità tende a tornare verso una media di lungo periodo: valori estremi (alti o bassi) tendono a non durare.</dd></div>
        <div><dt>Out-of-sample (OOS)</dt><dd>Il GARCH è stimato solo sui dati <b>prima</b> del ${m.splitDate} e poi proiettato in avanti senza re-fitting: un test più onesto della sua reale capacità predittiva.</dd></div>
        <div><dt>Stimatore Parkinson</dt><dd>Misura alternativa di volatilità che usa massimi/minimi di seduta: più efficiente del close-to-close. Oggi vale ${fmt(D.current.parkinson)}% (vs ${fmt(D.current.rv)}% close-to-close).</dd></div>
      </dl>
    </div>`;
  }

  function row(self, other, k, lowerBetter) {
    const a = self[k], b = other[k];
    const win = a != null && b != null && (lowerBetter ? a < b : a > b);
    return `<td class="mono-td ${win?'win':''}">${fmt(a, k==='corr'||k==='r2'?3:2)}</td>`;
  }

  /* ── costruzione / aggiornamento grafici ─────────────────────────────── */
  function buildCharts() {
    Object.values(charts).forEach((c) => c && c.destroy());
    const min = yearsAgoMs(rangeYears);
    charts.vol = VC.volChart($('#c-vol'), D, min);
    charts.price = VC.priceChart($('#c-price'), D, min);
    charts.vrp = VC.vrpChart($('#c-vrp'), D, min, D.metrics.vix.bias);
    charts.ratio = VC.ratioChart($('#c-ratio'), D, min);
    charts.scatter = VC.scatterChart($('#c-scatter'), D);
    charts.corr = VC.corrChart($('#c-corr'), D, min);
    charts.cone = VC.coneChart($('#c-cone'), D);
  }

  function applyRange(y) {
    rangeYears = y;
    const min = yearsAgoMs(y);
    ['vol', 'price', 'vrp', 'ratio', 'corr'].forEach((k) => {
      if (charts[k]) { charts[k].options.scales.x.min = min; charts[k].update('none'); }
    });
    $('#rangebar').querySelectorAll('button').forEach((b) => b.classList.toggle('on', +b.dataset.y === y));
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
      buildCharts();            // ridisegna con i colori del nuovo tema
      applyRange(rangeYears);
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
