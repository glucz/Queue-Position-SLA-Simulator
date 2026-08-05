// === Parameter-space study for the Queue-Position SLA Simulator ===
//
// Runs the same engine the browser UI runs (../src/engine.js) headlessly over the parameter box and
// reports what changes: the fitted contract steepness δ and its goodness of fit, the conserved
// severity budget ε, the welfare-loss reduction of the separated menu against pooling, the burden
// ranking, and the spread of self-selected positions. Also reports the regions where the headline
// result weakens or the burden ranking changes — those are as much a part of the picture as the
// default case.
//
//   node scripts/sweep.mjs                  # tables to stdout
//   node scripts/sweep.mjs --csv sweep.csv  # also write a tidy CSV
//   node scripts/sweep.mjs --seeds 100      # deeper population robustness pass
import { writeFileSync } from "node:fs";
import { simulate, welfareReduction, burdenRanking, DEFAULTS } from "../src/engine.js";

const argv = process.argv.slice(2);
const argOf = (flag, fallback) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : fallback; };
const csvPath = argOf("--csv", null);
const nSeeds = Number(argOf("--seeds", 30));

const rows = [];                                     // tidy CSV rows
const pct = x => (100 * x).toFixed(1) + "%";
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = xs => { const m = mean(xs); return Math.sqrt(mean(xs.map(x => (x - m) ** 2))); };

// One measurement: run the engine and pull out the quantities the paper reports.
function measure(params) {
  const { sim, clients } = simulate(params);
  const qs = sim.clientQ;
  const byType = {};
  for (const t of ["batch", "office", "webshop", "gaming"]) {
    const idx = clients.map((c, i) => [c, i]).filter(([c]) => c.type === t).map(([, i]) => i);
    byType[t] = { q: mean(idx.map(i => qs[i])), d: mean(idx.map(i => sim.clientD[i])) };
  }
  return {
    eps: sim.epsAB, delta: sim.dqDelta, r2: sim.r2, shapeValid: sim.shapeValid,
    d0: sim.dqCurve[0].d, dFront: sim.dqCurve[sim.dqCurve.length - 1].d,
    Wsep: sim.dmgA, Wpool: sim.dmgB, reduction: welfareReduction(sim),
    burdenA: sim.burdenA, burdenB: sim.burdenB, burdenC: sim.burdenC, burdenD: sim.burdenD,
    ranking: burdenRanking(sim).join("<"),
    qMin: Math.min(...qs), qMax: Math.max(...qs),
    optSep: sim.optWfq.pct, optPool: sim.optPool.pct,
    byType,
  };
}

const record = (sweep, param, value, m) => rows.push({
  sweep, param, value,
  eps: m.eps, delta: m.delta, r2: m.r2, shape_valid: m.shapeValid,
  d_back: m.d0, d_front: m.dFront, W_sep: m.Wsep, W_pool: m.Wpool,
  welfare_reduction: m.reduction, burden_A: m.burdenA, burden_B: m.burdenB,
  burden_C: m.burdenC, burden_D: m.burdenD, ranking: m.ranking,
  q_min: m.qMin, q_max: m.qMax, opt_cap_sep: m.optSep, opt_cap_pool: m.optPool,
});

// ---------------------------------------------------------------- 1. the default case
const base = measure({});
record("default", "-", "-", base);
console.log("=== Default configuration ===");
console.log(`  deployed capacity ${DEFAULTS.capABpct}% of peak · k=${DEFAULTS.costK} · β=${DEFAULTS.beta} · wMin=${DEFAULTS.wMin} · α=${DEFAULTS.pExp} · seed=${DEFAULTS.seed}`);
console.log(`  conserved severity budget ε = ${base.eps.toFixed(4)}`);
console.log(`  fitted contract  δ = ${base.delta.toFixed(2)}  R² = ${base.r2.toFixed(4)}  d(0) = ${base.d0.toFixed(3)}  d(1) = ${base.dFront.toFixed(3)}  (ratio ${(base.d0 / base.dFront).toFixed(1)}×)`);
console.log(`  welfare loss     W_S = ${base.Wsep.toFixed(0)}   W_P = ${base.Wpool.toFixed(0)}   reduction ${pct(base.reduction)}`);
console.log(`  total burden     A=${base.burdenA.toFixed(0)} B=${base.burdenB.toFixed(0)} C=${base.burdenC.toFixed(0)} D=${base.burdenD.toFixed(0)}  ranking ${base.ranking}`);
console.log(`  optimal capacity separated ${base.optSep}% vs pooled ${base.optPool}% of peak`);
console.log("  self-selected positions per type:");
for (const t of ["batch", "office", "webshop", "gaming"]) {
  console.log(`    ${t.padEnd(8)} θ=${String(DEFAULTS.thetas[t]).padStart(4)}  q*=${base.byType[t].q.toFixed(3)}  d(q*)=${base.byType[t].d.toFixed(4)}`);
}

// ---------------------------------------------------------------- 2. population robustness
console.log(`\n=== Population robustness (${nSeeds} seeds) ===`);
const reductions = [], rankings = {};
let sepWins = 0;
for (let seed = 1; seed <= nSeeds; seed++) {
  const m = measure({ seed });
  record("seed", "seed", seed, m);
  reductions.push(m.reduction);
  rankings[m.ranking] = (rankings[m.ranking] || 0) + 1;
  if (m.Wsep <= m.Wpool) sepWins++;
}
console.log(`  welfare-loss reduction ${pct(mean(reductions))} ± ${(100 * sd(reductions)).toFixed(1)} pp  (min ${pct(Math.min(...reductions))}, max ${pct(Math.max(...reductions))})`);
console.log(`  W_S ≤ W_P in ${sepWins}/${nSeeds} populations`);
for (const [r, n] of Object.entries(rankings)) console.log(`  ranking ${r}: ${n}/${nSeeds}`);

// ---------------------------------------------------------------- 3. deployed capacity
console.log("\n=== Deployed capacity (the overload regime) ===");
console.log("   cap     ε      δ      R²    d(0)   W_S     W_P    reduction  q* span      ranking");
for (let cap = 45; cap <= 100; cap += 5) {
  const m = measure({ capABpct: cap });
  record("capacity", "capABpct", cap, m);
  console.log(`  ${String(cap).padStart(3)}%  ${m.eps.toFixed(3)}  ${m.delta.toFixed(2).padStart(5)}  ${m.r2.toFixed(3)}  ${m.d0.toFixed(3)}  ${m.Wsep.toFixed(0).padStart(6)}  ${m.Wpool.toFixed(0).padStart(6)}   ${pct(m.reduction).padStart(6)}    ${m.qMin.toFixed(2)}–${m.qMax.toFixed(2)}   ${m.ranking}`);
}

// ---------------------------------------------------------------- 4. infrastructure cost k
console.log("\n=== Infrastructure cost k (A vs D: does separation beat honest provisioning?) ===");
console.log("    k    burden_A  burden_D   ranking");
for (let k = 10; k <= 50; k += 5) {
  const m = measure({ costK: k });
  record("costK", "costK", k, m);
  console.log(`  ${String(k).padStart(3)}   ${m.burdenA.toFixed(0).padStart(7)}   ${m.burdenD.toFixed(0).padStart(7)}   ${m.ranking}`);
}
// Locate the crossover in k where A overtakes D.
let kCross = null;
for (let k = 1; k <= 60; k += 0.5) {
  const m = measure({ costK: k });
  if (m.burdenA < m.burdenD) { kCross = k; break; }
}
console.log(`  A overtakes D above k ≈ ${kCross ?? "never in [1,60]"}`);

// ---------------------------------------------------------------- 5. scheduler shape knobs
console.log("\n=== DRR quantum steepness β ===");
console.log("     β      δ      R²    d(0)   reduction  ranking");
for (const beta of [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4]) {
  const m = measure({ beta });
  record("beta", "beta", beta, m);
  console.log(`  ${String(beta).padStart(4)}  ${m.delta.toFixed(2).padStart(5)}  ${m.r2.toFixed(3)}  ${m.d0.toFixed(3)}   ${pct(m.reduction).padStart(6)}    ${m.ranking}`);
}

console.log("\n=== Minimum-service floor wMin ===");
console.log("   wMin     δ      R²    d(0)   reduction  ranking");
for (const wMin of [0.02, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.6]) {
  const m = measure({ wMin });
  record("wMin", "wMin", wMin, m);
  console.log(`  ${String(wMin).padStart(5)}  ${m.delta.toFixed(2).padStart(5)}  ${m.r2.toFixed(3)}  ${m.d0.toFixed(3)}   ${pct(m.reduction).padStart(6)}    ${m.ranking}`);
}

console.log("\n=== Price exponent α (pricing convexity) ===");
console.log("     α    q* span     reduction  ranking");
for (const pExp of [1, 2, 3, 4, 5, 6, 7, 8]) {
  const m = measure({ pExp });
  record("pExp", "pExp", pExp, m);
  console.log(`  ${String(pExp).padStart(4)}   ${m.qMin.toFixed(2)}–${m.qMax.toFixed(2)}     ${pct(m.reduction).padStart(6)}    ${m.ranking}`);
}

// ---------------------------------------------------------------- 6. client heterogeneity
// Compress the sensitivity spread toward its geometric mean: θ_i(λ) = θ_ref·(θ_i/θ_ref)^λ.
// λ=1 is the default population; λ=0 makes every client identical, which removes the only thing
// separation can exploit. This is the sharpest limit of the mechanism, so it is worth measuring.
console.log("\n=== Client heterogeneity (θ spread compressed toward the mean) ===");
const TYPES = ["batch", "office", "webshop", "gaming"];
const gm = Math.exp(mean(TYPES.map(t => Math.log(DEFAULTS.thetas[t]))));
console.log("     λ   θ range          q* span     reduction  ranking");
for (const lambda of [1, 0.8, 0.6, 0.4, 0.2, 0.1, 0]) {
  const thetas = {};
  for (const t of TYPES) thetas[t] = gm * (DEFAULTS.thetas[t] / gm) ** lambda;
  const m = measure({ thetas });
  record("theta_spread", "lambda", lambda, m);
  const lo = Math.min(...TYPES.map(t => thetas[t])), hi = Math.max(...TYPES.map(t => thetas[t]));
  console.log(`  ${lambda.toFixed(1)}   ${lo.toFixed(2).padStart(5)}–${hi.toFixed(2).padEnd(6)}   ${m.qMin.toFixed(2)}–${m.qMax.toFixed(2)}     ${pct(m.reduction).padStart(6)}    ${m.ranking}`);
}

// ---------------------------------------------------------------- CSV
if (csvPath) {
  const cols = Object.keys(rows[0]);
  const csv = [cols.join(","), ...rows.map(r => cols.map(c => {
    const v = r[c];
    return typeof v === "number" ? (Number.isInteger(v) ? v : v.toPrecision(8)) : v;
  }).join(","))].join("\n");
  writeFileSync(csvPath, csv + "\n");
  console.log(`\nWrote ${rows.length} rows to ${csvPath}`);
}
