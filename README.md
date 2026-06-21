# Queue-Position SLA Simulator

Browser-based simulator for queue-position-based cloud SLA design. Runs entirely client-side.

Accompanies the paper:

> Lucz, G. & Forstner, B. (2026). A Reliability Curve Approach to Cloud Service Contract Optimization and Service. SSRN preprint. [https://doi.org/10.2139/ssrn.6881381](https://doi.org/10.2139/ssrn.6881381)

Archived on Zenodo: [https://doi.org/10.5281/zenodo.20026570](https://doi.org/10.5281/zenodo.20026570) (latest release).

## What it does

The simulator generates 1,000 heterogeneous clients across four workload types (batch, gaming, webshop, office), each with a Gaussian time-varying load profile over a 24-hour cycle divided into 96 fifteen-minute windows. It then compares four provider strategies in terms of infrastructure cost, violation severity, and total economic burden.

The model is **per unit of work**. A standard scheduler produces the severity at each queue position; the provider then publishes a convex contract fitted to it (matches the theory paper [1], §4):

1. **Congestion sets the severity budget.** Over the 24-hour cycle, wherever total load exceeds the deployed capacity *C* the unmet demand accumulates. The conserved per-unit severity is `ε(C) = (total unmet demand) / (total work)`. Under *any* allocation the same unmet demand is shared out, so a differentiated menu only **redistributes** ε — it never creates or destroys it. `ε(C)` is exactly the pooled (equal-treatment) per-unit severity.
2. **A real scheduler produces the severity.** A work-conserving **Deficit Round Robin** scheduler (Shreedhar & Varghese, 1996; a latency-rate server in the sense of Stiliadis & Varma, 1998) runs over the load. Each queue position gets a quantum from a concave-increasing schedule with a **minimum-service floor** reserved to every position, so the back of the queue is never starved; in each congested window the service level is solved by water-filling so the allocation exactly clears capacity. The severity it produces at each position is a genuine unmet fraction in `[0, 1]` (0 = perfect, 1 = complete failure).
3. **Published convex contract, fitted to the measurement.** The provider publishes `d(q) = γ·e^(−δ·q)`, fitted to the measured severity profile. The *steepness* δ is **measured** from the scheduler (it is not a free slider); the *level* γ is scaled so the work-weighted mean of `d(q*)` equals `ε(C)`, so separation redistributes the severity budget without changing its total. The fit is reported (R² ≈ 1.00 at the default), and `d(q)` is the contractual **ceiling** clients self-select against. Convexity is not an assumption: realized severity is an affine-decreasing map of the scheduler's concave-increasing guaranteed rate, so it is convex and decreasing on its own (the diminishing returns of finite-capacity scheduling — Kleinrock; the exponential is one convenient convex form, and any convex `d(q)` gives the same result).
4. **Self-selection (solved, not assigned).** Each client solves its first-order condition against the published price `p(q) = e^(α·q)` and severity `d(q)`, giving the closed form `q*(θ) = ½ + ln(θ / θ_ref) / (α + δ)`, where `θ_ref` is the geometric-mean sensitivity. `q*` depends only on θ — it is **scale-independent** (per unit of work), so workload volume *n* does not affect where a client sits. `q*` is monotone increasing in θ (incentive compatibility), and the client's realized severity is exactly `d(q*)`.
5. **Separation = the rearrangement inequality, made visible.** Because `d(q)` is decreasing and high-θ clients self-select low-`d` positions, the smallest severities pair, per unit of work, with the largest **sensitivities θ**. This is the opposite-order case of the rearrangement inequality, so separated welfare loss `W_S = Σ nᵢ·θᵢ·d(q*ᵢ)` is strictly below pooled welfare loss `W_P = ε·Σ nᵢθᵢ` (here *n* enters only as the workload weight in the aggregate, not in the matching). The scheduler is a generic, off-the-shelf discipline — not designed around the welfare objective — so the result is the rearrangement inequality the simulator visualizes, not a scheduler effect.

The four scenarios:

- **A** — Separated allocation: clients self-select positions on the published convex curve, at the deployed (conventional-SLA) capacity. Here `H = C·k + W`, where *C* is capacity, *k* is unit infrastructure cost, and `W = Σ nᵢ·θᵢ·d(q*ᵢ)` is the workload-weighted aggregate welfare loss.
- **B** — Pooled / equal-treatment at the **same** fixed capacity. A and B share capacity, so they share infrastructure cost; the only difference is the severity allocation — exactly the setting of Theorem 1.
- **C** — Underdeployment: pooled allocation at a lower, user-set capacity (the "cutting corners" worst case).
- **D** — Honest provisioning: capacity is raised until every 15-minute window individually meets the SLA target.

Key notation: each client has a queue position `q ∈ [0, 1]` (1 = front, best protected; 0 = back), sensitivity θ, and workload volume *n*. `d(q) = E[v | q]` is the expected per-unit violation severity at position *q*, a fraction in `[0, 1]`; `p(q)` is the price. A client with sensitivity θ chooses the position that minimizes its burden `h(θ, q) = p(q) + θ·d(q)`; the simulator solves this first-order condition for each client. The price exponent α and the **measured** severity-curve steepness δ together set the self-selection spread.

## Key equations

The simulator implements the following model (equation numbers match the paper):

- **(1) Individual burden:** `h(θ, q) = p(q) + θ·d(q)`, where `p(q)` is the price at queue position *q* and `d(q) = E[v | q]` is the expected violation severity, a fraction in `[0, 1]` (1 = complete failure).
- **(2) Total economic burden:** `H = C·k + W`, where `W = Σ nᵢ·θᵢ·d(q*ᵢ)` is the aggregate welfare loss, with `nᵢ` the workload volume of client *i*.
- **(3) Published convex contract:** `d(q) = γ·e^(−δ·q)`, fitted to the work-conserving DRR severity-vs-position profile and serving as the contractual ceiling (realized severity stays at or below it, in `[0, 1]`). The *steepness* δ is **measured** from the scheduler; the *level* γ is scaled so the work-weighted mean of `d(q*)` equals the conserved per-unit severity `ε(C) = (total unmet demand) / (total work)`.
- **(4) Self-selection position:** each client solves `q* = ½ + ln(θ / θ_ref) / (α + δ)`, where α is the price exponent, δ the measured severity steepness, and `θ_ref` the geometric mean of all client sensitivities. `q*` depends only on θ (scale-independent, per unit of work) and is monotone increasing in θ (incentive compatibility).

## Quick start

Requires [Node.js](https://nodejs.org/) v18 or later.

```bash
npm install
npm run dev
```

Open http://localhost:5173 in your browser.

For a production build:

```bash
npm run build
npm run preview
```

## Parameters

All parameters are adjustable via sliders and update all visualizations immediately.

| Parameter | Description | Default |
|-----------|-------------|---------|
| Client ratios | Population share of batch, gaming, webshop, office types | 25/25/30/20 |
| Theta (per type) | Sensitivity to SLA violations. Higher theta = greater economic loss per unit of severity | batch=0.5, gaming=16, webshop=8, office=3 |
| Peak hours | Time interval for each type's demand peak | Varies by type |
| Sigma | Spread of the Gaussian load profile (hours) | Varies by type |
| k | Infrastructure cost per unit of capacity | 40 |
| DRR quantum steepness (β) | Curvature of the scheduler's concave-increasing quantum schedule. Higher β concentrates protection toward the front | 2 |
| Minimum-service floor (wMin) | Guaranteed minimum share reserved to every queue position; prevents starvation and caps the tail severity | 0.15 |
| Price exponent (α) | Convexity of `p(q) = e^(α·q)`; together with the measured δ it sets the self-selection spread | 3 |
| Deployed capacity (A & B) | Fixed conventional-SLA capacity shared by A and B, as percentage of peak | 60% |
| Underdeployed capacity (C) | Scenario C capacity as percentage of peak | 48% |
| Seed | Population random seed for reproducibility | 42 |

The contract steepness δ is an **output**: it is fitted to the measured profile (≈ 2.7 at the defaults, with the back of the queue carrying `e^δ ≈ 15×` the severity of the front), not set directly.

## Visualization tabs

1. **Load Profile** — Stacked area chart of aggregate demand by client type, with capacity-level overlays for each scenario.
2. **Burden (H = C·k + W)** — Stacked bar chart decomposing total economic burden into infrastructure cost (grey, `C·k`) and welfare loss (red, `W`) for each scenario.
3. **Theorem 1 (W_S vs W_P)** — Bar chart of each type's self-selected severity `d(q*)` (bars, sorted by ascending θ) against a reference line at the pooled level ε. The welfare-loss reduction is the visible gap; the panel reports `W_S`, `W_P`, and the % reduction.
4. **d(q) and p(q) Curves** — The work-conserving DRR-measured severity at each position (points), the published convex contract `d(q)` fitted to it (the ceiling, on a 0–1 axis), with each client at its self-selected `q*` (coloured by type), alongside the price schedule `p(q)`.
5. **Infrastructure Cost Sensitivity** — Marginal customer damage prevented per unit of capacity (`−dW/dC`) for separated (green) vs pooled (purple) against the marginal hardware cost *k*, and the welfare loss at the provider's chosen capacity as *k* sweeps.
6. **Per-Type h(θ, q)** — Per-type burden breakdown (price + damage) by scenario.

A **Notes** toggle shows or hides explanatory annotations on each chart. Turning notes off produces clean figures suitable for publication.

## How the simulation works

Each client gets a type, a θ drawn from ±30% of the type mean, a peak hour drawn uniformly from the type's interval, and a Gaussian workload profile. The population is deterministic given the seed.

**Congestion → ε(C).** Over the 24-hour cycle the simulator sums, in every 15-minute window where total load exceeds capacity *C*, the unmet demand. The conserved per-unit severity is `ε(C) = (total unmet demand) / (total work)`. This is the pooled (equal-treatment) severity every client absorbs under scenarios B, C, and D — under any allocation the same unmet demand is shared out, so a separated menu only redistributes ε.

**The scheduler measures the severity profile.** A work-conserving Deficit Round Robin scheduler runs over the load. Its quantum schedule is concave-increasing with a minimum-service floor `wMin` on every position; per congested window the simulator solves for the water level that exactly clears capacity, so each position's realized severity is a true unmet fraction in `[0, 1]` and the work-weighted mean of the profile equals `ε(C)`. Because realized severity is an affine-decreasing map of the concave-increasing guaranteed rate, the profile is convex and decreasing; the floor keeps the back of the queue from being starved.

**Published contract, fitted.** An exponential `d(q) = γ·e^(−δ·q)` is fitted to the measured profile by least squares in linear space; the steepness δ comes from the fit (the goodness-of-fit R² is reported, ≈ 1.00 at the defaults) and the level γ is scaled so the work-weighted mean of `d(q*)` equals `ε(C)`. The published curve is the ceiling clients self-select against, bounded in `[0, 1]`.

**Self-selection (solved, not assigned).** The simulator solves each client's first-order condition `q* = ½ + ln(θ / θ_ref) / (α + δ)` — where `θ_ref` is the geometric mean of all sensitivities — against the published `p(q) = e^(α·q)` and the fitted `d(q)`. `q*` depends only on θ, so it is scale-independent: a client's workload volume *n* does not change where it sits. Under separation high-θ clients self-select the low-`d` front and low-θ clients the high-`d` back.

**Welfare loss and the rearrangement inequality.** Separated welfare loss is `W_S = Σ nᵢ·θᵢ·d(q*ᵢ)`; pooled is `W_P = ε·Σ nᵢθᵢ`. Because `d(q)` is decreasing and high-θ work pairs (per unit of work) with low severity, the smallest severities are matched in opposite order to the largest sensitivities θ — the rearrangement inequality forces `W_S < W_P`. The workload volume *n* enters only as the weight in the aggregate sums, not in the matching. The scheduler is a standard, off-the-shelf discipline, so the simulator visualizes a proven inequality rather than engineering a scheduler around the welfare objective.

**Total burden.** `H = C·k + W`, where `C·k` is capacity times infrastructure cost and `W` is the workload-weighted aggregate welfare loss.

With the default population (capAB = 60%, capC = 48%, k = 40, β = 2, wMin = 0.15, α = 3, θ = 0.5/16/8/3, seed 42): the fitted contract has δ ≈ 2.7 (R² ≈ 1.00) and peaks at `d(0) ≈ 0.33`, well below the `d = 1` complete-failure level. `W_S ≈ 15321` vs `W_P ≈ 28824`, a welfare-loss reduction of about **46%** (46.2 ± 1.1% over 30 seeds; min 43.7%, max 48.6%), independent of *k*. The total-burden ranking is **A < D < B < C** (preserved across all 30 seeds); A vs B is about a 25% total-burden reduction. In the Infrastructure Cost Sensitivity tab, at *k* = 40 the welfare-optimal capacity is 78% of peak under separation vs 94% under pooling — the separated menu runs leaner because residual damage falls on low-θ clients.

## Project structure

```
├── src/
│   ├── App.jsx          # All simulation logic and UI (~576 lines)
│   ├── App.css          # Component styles
│   ├── main.jsx         # React entry point
│   ├── index.css        # Root CSS variables
│   └── assets/          # Images
├── public/              # Favicon, icons
├── index.html           # HTML shell
├── package.json
├── package-lock.json
└── vite.config.js
```

## Tech stack

- React 19
- Vite 8
- Recharts 3

No server-side computation. Everything runs in the browser.

## Citation

```bibtex
@software{lucz2026qpsla,
  author    = {Lucz, Géza and Forstner, Bertalan},
  title     = {{Queue-Position SLA Simulator}},
  version   = {1.0.1},
  year      = {2026},
  publisher = {Zenodo},
  doi       = {10.5281/zenodo.20026570},
  url       = {https://github.com/glucz/Queue-Position-SLA-Simulator}
}
```

## License

[MIT](LICENSE)
