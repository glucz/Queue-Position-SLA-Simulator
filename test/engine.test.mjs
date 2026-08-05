// === Invariant tests for the Queue-Position SLA Simulator engine ===
//
// These are property checks, not unit tests against golden numbers: each one asserts a structural
// property the model must satisfy for its results to mean anything, and each is checked across a
// range of parameter settings rather than at the default alone. They are the reason to believe the
// engine implements the model it claims to implement.
//
//   1. determinism           — a seed fixes the population and every reported quantity
//   2. severity bounds       — measured and published severity stay in [0,1] (0 = perfect, 1 = total failure)
//   3. work conservation     — the work-weighted mean of the measured profile equals ε(C) exactly
//   4. budget calibration    — the work-weighted mean of d(q*) equals ε(C): both arms share one budget
//   5. shape                 — the measured profile and the published contract are convex-decreasing
//   6. incentive compatibility— q*(θ) is monotone non-decreasing in θ, and depends on θ alone
//   7. separation            — W_S ≤ W_P at equal capacity, over many populations
//   8. goodness of fit       — R² of the exponential contract stays high across overload regimes
//   9. limits                — ε → 0 as capacity → peak; no NaN/Infinity anywhere in the parameter box
//
// Run with:  npm test
import test from "node:test";
import assert from "node:assert/strict";
import { simulate, welfareReduction, burdenRanking, drrSeverityProfile, fitDelta, DEFAULTS, SLOTS } from "../src/engine.js";

const base = simulate();

// Second differences of a sampled curve; ≥ 0 everywhere means convex on the sample grid.
const secondDiffs = ys => ys.slice(2).map((_, i) => ys[i] - 2 * ys[i + 1] + ys[i + 2]);

test("1. deterministic given a seed; a different seed gives a different population", () => {
  const a = simulate(), b = simulate();
  assert.equal(a.sim.dmgA, b.sim.dmgA);
  assert.equal(a.sim.dmgB, b.sim.dmgB);
  assert.equal(a.sim.dqDelta, b.sim.dqDelta);
  assert.deepEqual(a.sim.clientQ, b.sim.clientQ);

  const other = simulate({ seed: DEFAULTS.seed + 1 });
  assert.notEqual(other.sim.dmgA, a.sim.dmgA, "a new seed must draw a new population");
});

test("2. every severity — measured and published — lies in [0,1]", () => {
  for (const capABpct of [45, 60, 75, 85, 100]) {
    const { sim } = simulate({ capABpct });
    for (const p of sim.profile) {
      assert.ok(p.sev >= 0 && p.sev <= 1, `measured severity ${p.sev} out of [0,1] at cap ${capABpct}%`);
    }
    for (const p of sim.dqCurve) {
      assert.ok(p.d >= 0 && p.d <= 1, `published d(q)=${p.d} out of [0,1] at cap ${capABpct}%`);
    }
    for (const d of sim.clientD) {
      assert.ok(d >= 0 && d <= 1, `client severity ${d} out of [0,1] at cap ${capABpct}%`);
    }
  }
});

test("3. work conservation: the mean measured severity equals the conserved budget ε(C)", () => {
  // The scheduler is work-conserving, so the severity it distributes across positions must add back
  // up to the unmet demand the capacity shortfall created — no severity invented, none destroyed.
  for (const capABpct of [45, 55, 70, 85]) {
    const { sim } = simulate({ capABpct });
    const mean = sim.profile.reduce((s, p) => s + p.sev, 0) / sim.profile.length;
    assert.ok(Math.abs(mean - sim.epsAB) < 1e-12,
      `mean profile ${mean} vs ε ${sim.epsAB} at cap ${capABpct}% (err ${Math.abs(mean - sim.epsAB)})`);
  }
});

test("4. budget calibration: the work-weighted mean of d(q*) equals ε(C)", () => {
  // This is what makes the A-vs-B comparison a pure rearrangement: both arms carry the same
  // per-unit severity budget on average, and only its distribution across clients differs.
  for (const capABpct of [50, 60, 80]) {
    const { clients, sim } = simulate({ capABpct });
    const totalWork = clients.reduce((s, c) => s + c.totalWork, 0);
    const weighted = clients.reduce((s, c, i) => s + c.totalWork * sim.clientD[i], 0) / totalWork;
    assert.ok(Math.abs(weighted - sim.epsAB) < 1e-12,
      `weighted mean d(q*) ${weighted} vs ε ${sim.epsAB} at cap ${capABpct}%`);
  }
});

test("5. the measured profile and the published contract are convex and decreasing", () => {
  for (const [beta, wMin] of [[0.5, 0.15], [2, 0.15], [4, 0.15], [2, 0.02], [2, 0.5]]) {
    const { sim } = simulate({ beta, wMin });
    const sev = sim.profile.map(p => p.sev);
    for (let i = 1; i < sev.length; i++) {
      assert.ok(sev[i] <= sev[i - 1] + 1e-12, `profile not decreasing at bin ${i} (β=${beta}, wMin=${wMin})`);
    }
    for (const sd of secondDiffs(sev)) {
      assert.ok(sd >= -1e-9, `profile not convex (second difference ${sd}; β=${beta}, wMin=${wMin})`);
    }
    const d = sim.dqCurve.map(p => p.d);
    for (let i = 1; i < d.length; i++) {
      assert.ok(d[i] <= d[i - 1] + 1e-12, `published d(q) not decreasing at ${i}`);
    }
    for (const sd of secondDiffs(d)) {
      assert.ok(sd >= -1e-9, `published d(q) not convex (second difference ${sd})`);
    }
  }
});

test("6. incentive compatibility: q* is monotone in θ and a function of θ alone", () => {
  const { clients, sim } = simulate();
  const order = clients.map((c, i) => ({ theta: c.theta, q: sim.clientQ[i] })).sort((a, b) => a.theta - b.theta);
  for (let i = 1; i < order.length; i++) {
    assert.ok(order[i].q >= order[i - 1].q - 1e-12,
      `q* fell as θ rose (θ ${order[i - 1].theta}→${order[i].theta}, q ${order[i - 1].q}→${order[i].q})`);
  }
  // Two clients with the same sensitivity must land at the same position regardless of how much
  // work they bring: selection is per unit of work, so workload volume n must not enter q*.
  const byTheta = new Map();
  clients.forEach((c, i) => {
    const key = c.theta.toFixed(12);
    if (byTheta.has(key)) assert.equal(sim.clientQ[i], byTheta.get(key), "same θ, different q*");
    else byTheta.set(key, sim.clientQ[i]);
  });
});

test("7. separation: W_S ≤ W_P at equal capacity, across populations and regimes", () => {
  for (let seed = 1; seed <= 12; seed++) {
    const { sim } = simulate({ seed });
    assert.ok(sim.dmgA <= sim.dmgB, `W_S ${sim.dmgA} > W_P ${sim.dmgB} at seed ${seed}`);
    assert.equal(sim.infraA, sim.infraB, "A and B must share infrastructure cost for this to be a pure rearrangement");
  }
  for (const capABpct of [45, 60, 85]) {
    const { sim } = simulate({ capABpct });
    assert.ok(welfareReduction(sim) >= 0, `negative welfare reduction at cap ${capABpct}%`);
  }
});

test("8. the exponential contract fits the measured profile well across overload regimes", () => {
  for (const capABpct of [50, 60, 70, 80]) {
    const { sim } = simulate({ capABpct });
    assert.ok(sim.shapeValid, `fit reported an invalid shape at cap ${capABpct}%`);
    assert.ok(sim.r2 > 0.99, `R² ${sim.r2} too low at cap ${capABpct}%`);
  }
});

test("9. limits and numerical hygiene over the whole parameter box", () => {
  // ε → 0 as deployed capacity approaches peak demand: no shortfall, nothing to allocate.
  const full = simulate({ capABpct: 100 });
  assert.ok(full.sim.epsAB < 1e-9, `ε should vanish at peak capacity, got ${full.sim.epsAB}`);
  assert.ok(full.sim.dmgA < 1e-6 && full.sim.dmgB < 1e-6, "welfare loss should vanish at peak capacity");
  assert.equal(welfareReduction(full.sim), 0, "reduction must be defined (not NaN) when both arms are zero");

  // Sweep the corners of the slider box; every reported scalar must stay finite.
  const scalars = ["dmgA", "dmgB", "dmgC", "dmgD", "burdenA", "burdenB", "burdenC", "burdenD",
    "epsAB", "epsC", "epsD", "dqDelta", "dGamma", "r2", "capA", "capC", "capD", "peak"];
  for (const capABpct of [45, 70, 100]) {
    for (const beta of [0.5, 4]) {
      for (const wMin of [0.02, 0.6]) {
        for (const pExp of [1, 8]) {
          const { sim } = simulate({ capABpct, beta, wMin, pExp, capCpct: 40 });
          for (const key of scalars) {
            assert.ok(Number.isFinite(sim[key]),
              `${key} = ${sim[key]} at cap ${capABpct}%, β ${beta}, wMin ${wMin}, α ${pExp}`);
          }
          for (const q of sim.clientQ) assert.ok(q >= 0 && q <= 1, `q* ${q} outside [0,1]`);
        }
      }
    }
  }
});

test("10. a flat profile is reported as an invalid shape rather than silently fitted", () => {
  // Degenerate input: no congestion at all, so there is no decreasing profile to fit. The fit must
  // say so (shapeValid false) instead of returning a spurious δ.
  const flat = Array.from({ length: 40 }, (_, i) => ({ q: i / 39, sev: 0 }));
  assert.equal(fitDelta(flat).shapeValid, false);

  // And the profile of an uncongested load is identically zero.
  const load = new Float64Array(SLOTS).fill(1);
  const profile = drrSeverityProfile(load, 100, DEFAULTS.beta, DEFAULTS.wMin);
  assert.ok(profile.every(p => p.sev === 0), "an uncongested cycle must produce zero severity");
});

test("11. the default case reproduces the burden ranking reported in the paper", () => {
  assert.deepEqual(burdenRanking(base.sim), ["A", "D", "B", "C"]);
});
