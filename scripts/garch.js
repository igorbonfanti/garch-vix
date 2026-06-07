/* ============================================================================
 * garch.js — stima GARCH(1,1) con massima verosimiglianza gaussiana.
 *
 * Modello:  r_t = mu + e_t ,  e_t = sqrt(h_t) * z_t ,  z_t ~ N(0,1)
 *           h_t = omega + alpha * e_{t-1}^2 + beta * h_{t-1}
 *
 * Per stabilità numerica si usa "variance targeting": la varianza di lungo
 * periodo e' fissata alla varianza campionaria  sigma2 = omega/(1-alpha-beta),
 * quindi  omega = sigma2 * (1 - alpha - beta).  Si ottimizzano solo (alpha,beta)
 * con un Nelder-Mead 2D, vincolati a alpha>0, beta>0, alpha+beta<1.
 * Replica nella sostanza l'output della libreria Python `arch` usata nel Colab.
 * ========================================================================== */
'use strict';

/** Negativo della log-verosimiglianza gaussiana del GARCH(1,1) (variance targeting). */
function negLogLik(alpha, beta, eps, sampleVar) {
  if (alpha <= 1e-6 || beta <= 1e-6 || alpha + beta >= 0.99999) return 1e12;
  const omega = sampleVar * (1 - alpha - beta);
  if (omega <= 0) return 1e12;
  let h = sampleVar;        // varianza iniziale
  let nll = 0;
  const n = eps.length;
  for (let t = 0; t < n; t++) {
    const e2 = eps[t] * eps[t];
    // contributo: 0.5 * ( log(2*pi) + log(h) + e2/h )
    nll += 0.5 * (Math.log(2 * Math.PI) + Math.log(h) + e2 / h);
    h = omega + alpha * e2 + beta * h;
    if (!isFinite(h) || h <= 0) return 1e12;
  }
  return nll;
}

/** Nelder-Mead minimizzatore 2D semplice e robusto. */
function nelderMead(f, x0, { maxIter = 2000, tol = 1e-10 } = {}) {
  const n = 2;
  const alphaR = 1, gamma = 2, rho = 0.5, sigma = 0.5;
  // simplex iniziale
  let simplex = [x0.slice(), [x0[0] + 0.05, x0[1]], [x0[0], x0[1] + 0.05]];
  let fv = simplex.map(f);
  for (let iter = 0; iter < maxIter; iter++) {
    // ordina
    const order = [0, 1, 2].sort((a, b) => fv[a] - fv[b]);
    simplex = order.map((i) => simplex[i]);
    fv = order.map((i) => fv[i]);
    if (Math.abs(fv[2] - fv[0]) < tol) break;
    // centroide dei migliori n
    const c = [0, 0];
    for (let i = 0; i < n; i++) { c[0] += simplex[i][0]; c[1] += simplex[i][1]; }
    c[0] /= n; c[1] /= n;
    const worst = simplex[2];
    const xr = [c[0] + alphaR * (c[0] - worst[0]), c[1] + alphaR * (c[1] - worst[1])];
    const fr = f(xr);
    if (fr < fv[0]) {
      const xe = [c[0] + gamma * (xr[0] - c[0]), c[1] + gamma * (xr[1] - c[1])];
      const fe = f(xe);
      if (fe < fr) { simplex[2] = xe; fv[2] = fe; } else { simplex[2] = xr; fv[2] = fr; }
    } else if (fr < fv[1]) {
      simplex[2] = xr; fv[2] = fr;
    } else {
      const xc = [c[0] + rho * (worst[0] - c[0]), c[1] + rho * (worst[1] - c[1])];
      const fc = f(xc);
      if (fc < fv[2]) { simplex[2] = xc; fv[2] = fc; }
      else {
        for (let i = 1; i < 3; i++) {
          simplex[i] = [simplex[0][0] + sigma * (simplex[i][0] - simplex[0][0]),
                        simplex[0][1] + sigma * (simplex[i][1] - simplex[0][1])];
          fv[i] = f(simplex[i]);
        }
      }
    }
  }
  const order = [0, 1, 2].sort((a, b) => fv[a] - fv[b]);
  return { x: simplex[order[0]], f: fv[order[0]] };
}

/**
 * Stima GARCH(1,1) sui rendimenti `returns` (in %, come nel Colab).
 * @returns {{mu, omega, alpha, beta, persistence, longRunVar}}
 */
function fitGarch11(returns) {
  const n = returns.length;
  const mu = returns.reduce((a, b) => a + b, 0) / n;
  const eps = returns.map((r) => r - mu);
  const sampleVar = eps.reduce((a, b) => a + b * b, 0) / n;

  const obj = (x) => negLogLik(x[0], x[1], eps, sampleVar);
  // multi-start per evitare minimi locali
  const starts = [[0.08, 0.90], [0.05, 0.93], [0.10, 0.85], [0.03, 0.95], [0.15, 0.80]];
  let best = null;
  for (const s of starts) {
    const r = nelderMead(obj, s);
    // clamp dentro la regione ammissibile
    let a = Math.min(Math.max(r.x[0], 1e-5), 0.5);
    let b = Math.min(Math.max(r.x[1], 1e-5), 0.999);
    if (a + b >= 0.999) b = 0.999 - a;
    const fval = negLogLik(a, b, eps, sampleVar);
    if (!best || fval < best.f) best = { a, b, f: fval };
  }
  const alpha = best.a, beta = best.b;
  const omega = sampleVar * (1 - alpha - beta);
  return {
    mu, omega, alpha, beta,
    persistence: alpha + beta,
    longRunVar: sampleVar,
  };
}

/**
 * Forecast ricorsivo della varianza condizionata (replica il loop del Colab).
 * Restituisce la volatilità ANNUALIZZATA in % per ogni data.
 * @param returns serie completa dei log-return %
 * @param params  output di fitGarch11
 * @param tradingDays 252
 */
function recursiveVol(returns, params, tradingDays) {
  const { mu, omega, alpha, beta, longRunVar } = params;
  let h = longRunVar;
  const out = new Array(returns.length);
  for (let i = 0; i < returns.length; i++) {
    out[i] = Math.sqrt(h * tradingDays);
    const e = returns[i] - mu;
    h = omega + alpha * e * e + beta * h;
  }
  return out;
}

module.exports = { fitGarch11, recursiveVol };
