// === Runtime benchmark ===
// Times a full recompute — generate the 1,000-client population, run the DRR scheduler over the 96
// windows, fit the contract, solve every client's position, and evaluate all four scenarios — which
// is exactly the work one slider move triggers in the browser. Chart re-rendering is on top of this
// and is Recharts' cost, not the model's.
//
//   node scripts/bench.mjs [--reps 50]
import os from "node:os";
import { gen, runSim, DEFAULTS } from "../src/engine.js";

const argv = process.argv.slice(2);
const i = argv.indexOf("--reps");
const reps = i >= 0 ? Number(argv[i + 1]) : 50;
const p = DEFAULTS;

const time = fn => { const t0 = performance.now(); const out = fn(); return [performance.now() - t0, out]; };

// Warm up the JIT so we report steady-state interaction cost, not first-call compile time.
for (let w = 0; w < 5; w++) {
  const clients = gen(p.n, p.ratios, p.thetas, p.peakMins, p.peakMaxs, p.sigmas, p.seed);
  runSim(clients, p.sla, p.costK, p.capABpct, p.capCpct, p.beta, p.wMin, p.pExp);
}

const full = [], simOnly = [], genOnly = [];
for (let r = 0; r < reps; r++) {
  const [tg, clients] = time(() => gen(p.n, p.ratios, p.thetas, p.peakMins, p.peakMaxs, p.sigmas, p.seed + r));
  const [ts] = time(() => runSim(clients, p.sla, p.costK, p.capABpct, p.capCpct, p.beta, p.wMin, p.pExp));
  genOnly.push(tg); simOnly.push(ts); full.push(tg + ts);
}

const stat = xs => {
  const s = [...xs].sort((a, b) => a - b);
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  return { mean, median: s[Math.floor(s.length / 2)], min: s[0], max: s[s.length - 1],
           p95: s[Math.min(s.length - 1, Math.floor(0.95 * s.length))] };
};
const fmt = (name, s) => `  ${name.padEnd(26)} median ${s.median.toFixed(1).padStart(6)} ms   mean ${s.mean.toFixed(1).padStart(6)} ms   min ${s.min.toFixed(1)}   p95 ${s.p95.toFixed(1)}`;

console.log(`Queue-Position SLA Simulator — runtime over ${reps} repetitions`);
console.log(`  ${os.cpus()[0].model.trim()} · ${os.cpus().length} logical cores · ${os.type()} ${os.release()} · Node ${process.versions.node} (V8 ${process.versions.v8})`);
console.log(`  population ${p.n} clients · ${96} windows · deployed capacity ${p.capABpct}% of peak\n`);
console.log(fmt("population generation", stat(genOnly)));
console.log(fmt("four-scenario recompute", stat(simOnly)));
console.log(fmt("full slider recompute", stat(full)));
