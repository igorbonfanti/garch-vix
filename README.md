# VIX vs Volatilità Realizzata — Vol Lab

App web statica per **confrontare la volatilità implicita (VIX) con la volatilità realizzata** di un indice
azionario, con tutto il corredo di strumenti utili per capire *cosa* stiamo guardando. Nasce dal notebook
Colab `garch_export`, ma elimina il giro "esporta JSON a mano": i dati si rigenerano con **un solo comando**
(o una GitHub Action) e l'app è pura HTML/JS/CSS, deployabile su GitHub Pages.

> Strumento **didattico** di analisi quantitativa. Non è una raccomandazione d'investimento.

---

## Cosa mostra

| Strumento | A cosa serve |
|---|---|
| **VIX vs Vol realizzata vs GARCH** | Le tre stime della volatilità nel tempo, con selettore di orizzonte (1A→Max). Linee a piena risoluzione, asse Y auto-adattato alla finestra |
| **Prezzo (log)** | Il sottostante in scala logaritmica con tick puliti |
| **Drawdown** | Underwater chart: lega i crolli di prezzo ai picchi di volatilità (*leverage effect*) |
| **Variance Risk Premium (VIX − RV)** | Il premio che si paga per la protezione: positivo nell'~88% delle sedute |
| **Rapporto VIX / RV** | "Quanto sono care" le opzioni rispetto alla volatilità realizzata |
| **Scatter VIX vs realizzata futura** | Il VIX prevede la vol dei 30g *successivi*? I punti stanno in prevalenza sotto la parità (premio) |
| **Correlazione rolling** | Quanto implicita e realizzata si muovono insieme (asse non troncato) |
| **Cono di volatilità** | Dove sta la volatilità di *oggi* rispetto alla sua distribuzione storica, per orizzonte |
| **Tabella di accuratezza previsiva** | MAE / RMSE / Corr / R² / Bias di VIX e GARCH **vs realizzata futura 30g** (test onesto, non circolare) |
| **Parametri GARCH(1,1)** | ω, α, β, persistenza, volatilità di lungo periodo |
| **Glossario** | Spiegazione in chiaro di ogni concetto |

Ogni sezione ha una **spiegazione integrata** ("come leggerlo") per chi non mastica il gergo.

---

## I concetti in breve

- **Volatilità implicita (VIX)** — ricavata dai prezzi delle opzioni: quanta oscillazione il mercato *si aspetta*
  nei prossimi 30 giorni (annualizzata). È *forward-looking* e include un premio per il rischio.
- **Volatilità realizzata** — deviazione standard dei rendimenti degli ultimi 30 giorni × √252: ciò che è
  *davvero* accaduto. È *backward-looking*.
- **Variance Risk Premium** — la differenza fra le due. Il compenso per chi vende protezione. Storicamente positivo.
- **GARCH(1,1)** — modello econometrico della volatilità che cambia nel tempo (`h_t = ω + α·ε²_{t-1} + β·h_{t-1}`),
  stimato in-sample e proiettato out-of-sample, come nel Colab originale.

---

## Uso locale

```bash
# 1. genera/aggiorna i dati (scarica da Yahoo, calcola GARCH e analytics)
node scripts/fetch_data.js

# 2. apri l'app (qualunque server statico)
npx serve .        # oppure: python -m http.server
```

Poi apri `http://localhost:3000` (o la porta indicata).

### Cambiare asset

Modifica le costanti in testa a [`scripts/fetch_data.js`](scripts/fetch_data.js):

```js
const ASSET_TICKER = '^GSPC';      // ^NDX, ^GDAXI, ^STOXX50E, ...
const VIX_TICKER   = '^VIX';       // ^VXN (Nasdaq), ^VDAX, ...
const DISPLAY_NAME = 'S&P 500 (SPX)';
const SPLIT_DATE   = '2010-01-01'; // inizio out-of-sample del GARCH
const ROLL_DAYS    = 30;           // finestra volatilità realizzata
```

Rilancia `node scripts/fetch_data.js` e ricarica la pagina.

---

## Deploy su GitHub Pages

1. Crea il repo e fai push di questa cartella.
2. Settings → Pages → *Deploy from branch* → `main` / root.
3. Il file `.nojekyll` è già incluso. L'app è interamente client-side: legge `data/garch_data.json`.

Per **aggiornare i dati automaticamente** puoi aggiungere una GitHub Action schedulata che esegue
`node scripts/fetch_data.js` e committa il JSON (es. una volta al giorno a mercati chiusi).

---

## Struttura

```
garch-vix/
├── index.html              UI + tema Antigravity (dark/light) + spiegazioni
├── js/
│   ├── app.js              caricamento dati, KPI, sezioni, range, tema
│   └── charts.js           costruttori Chart.js (decimation per ~9k sedute)
├── scripts/
│   ├── fetch_data.js       pipeline: download + calcolo + scrittura JSON
│   ├── yahoo.js            download OHLC da Yahoo (lato Node, no CORS)
│   └── garch.js            stima GARCH(1,1) MLE (Nelder-Mead, variance targeting)
├── data/
│   └── garch_data.json     output della pipeline (consumato dall'app)
└── manifest.json / icon.svg
```

## Note tecniche

- **Dati**: Yahoo Finance chart API, scaricati lato Node (niente problemi di CORS) e committati come JSON statico.
- **GARCH**: stima propria in JavaScript con massima verosimiglianza gaussiana e *variance targeting*; replica
  nella sostanza l'output della libreria Python `arch` del Colab (α+β ≈ 0.99 per gli indici azionari).
- **Metodologia di valutazione (corretta)**: l'accuratezza si misura confrontando ogni stima fatta a tempo *t*
  (VIX di oggi, forecast GARCH a orizzonte 30g con mean-reversion) con la volatilità **realizzata nei 30 giorni
  successivi** (forward). È il test previsivo onesto, **non circolare**: la stima non condivide dati col bersaglio
  futuro. Risultato tipico: prevedere la vol a 30g è difficile (R² modesto per entrambi); il VIX correla meglio
  ma è biased verso l'alto (= premio per il rischio), il GARCH è meno distorto.
