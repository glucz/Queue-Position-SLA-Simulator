# Queue-Position SLA Simulator

Browser-based simulator for queue-position-based cloud SLA design. Runs entirely client-side.

Accompanies the paper:

> Lucz, G. & Forstner, B. (2026). Optimal Cloud Service-Level Agreement Design Using Contractible Reliability Curves. *Computers & Industrial Engineering* (submitted).

Archived on Zenodo: [https://doi.org/10.5281/zenodo.20026571](https://doi.org/10.5281/zenodo.20026571)

## What it does

The simulator generates 1,000 heterogeneous clients across four workload types (batch, gaming, webshop, office), each with a Gaussian time-varying load profile over a 24-hour cycle divided into 96 fifteen-minute windows. It then runs scheduling simulations under four provider strategies and compares them in terms of infrastructure cost, violation severity (the fraction of a client's demand that goes unserved during overload), and total economic burden.

The four scenarios:

- **A** -- Optimized capacity with weighted fair queuing (WFQ). The optimizer searches for the capacity that minimizes total burden H = C*k + W, where C is capacity, k is unit infrastructure cost, and W is the sensitivity-weighted aggregate damage across all clients.
- **B** -- Pooled allocation at A's optimized capacity. Same infrastructure cost, but equal treatment during overload. The only difference from A is the scheduling discipline.
- **C** -- Variable capacity with equal treatment. A user-controlled slider sets capacity from 50% to 100% of peak.
- **D** -- Worst-case honest provisioning. Every 15-minute window individually meets the SLA target.

Key notation: each client has a queue position q in [0, 1] (1 = front, best protected; 0 = back). The function d(q) is the expected violation severity at position q, and p(q) is the price. A client with sensitivity theta chooses the position that minimizes their burden h(theta, q) = p(q) + theta * d(q). The fitted severity curve takes the form d(q) = gamma * exp(-delta * q), where gamma and delta are estimated from the simulation output. In the welfare comparison tab, W_S and W_P denote aggregate welfare loss under separated and pooled allocation respectively. The price exponent alpha controls the convexity of p(q).

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
| Client ratios | Population share of batch, gaming, webshop, office types | 30/10/25/35 |
| Theta (per type) | Sensitivity to SLA violations. Higher theta = greater economic loss per unit of severity | batch=1, gaming=12, webshop=7, office=3 |
| Peak hours | Time interval for each type's demand peak | Varies by type |
| Sigma | Spread of the Gaussian load profile (hours) | Varies by type |
| k | Infrastructure cost per unit of capacity | 12 |
| Beta | WFQ scheduling aggressiveness. The front-to-back capacity ratio is exp(beta) | 3 |
| Price exponent | Controls convexity of the displayed p(q) curve | 3 |
| Capacity % | Scenario C capacity as percentage of peak load | 80% |
| Seed | Population random seed for reproducibility | 42 |

## Visualization tabs

1. **Load Profile** -- Stacked area chart of aggregate demand by client type with capacity level overlays for each scenario.
2. **Gaming d(q)** -- Time-series severity for gaming clients under separated (WFQ) versus pooled scheduling.
3. **All Types d(q)** -- Severity redistribution across all four client types, comparing WFQ against equal treatment.
4. **Burden (H = C*k + W)** -- Stacked bar chart decomposing total economic burden into infrastructure cost and sensitivity-weighted damage for each scenario.
5. **Theorem 1 (W_S vs W_P)** -- Welfare loss comparison between separated and pooled allocation as a function of infrastructure cost k.
6. **d(q) and p(q) Curves** -- Side-by-side severity and price curves. Coloured dots mark the optimal queue position q* for each type, computed from the first-order condition q* = ln(theta * delta * gamma / alpha) / (alpha + delta).
7. **Per-Type h(theta, q)** -- Client burden breakdown by type and scenario.

A **Notes** toggle shows or hides explanatory annotations on each chart. Turning notes off produces clean figures suitable for publication.

## How the simulation works

Each client gets a type, a theta drawn from +/-30% of the type mean, a peak hour drawn uniformly from the type's interval, and a Gaussian workload profile. The population is deterministic given the seed.

When total load in a window exceeds capacity, WFQ assigns weights w(q) = exp(beta * q) based on normalized sensitivity rank. Capacity is distributed iteratively: each client receives a share proportional to their weight, capped at their demand, with excess redistributed. Equal treatment (beta = 0) gives every client the same severity fraction.

Total burden is H = C*k + W, where C*k is capacity times infrastructure cost and W = sum of theta_i * average_severity_i * work_i across all clients.

After running Scenario A, the simulator fits an exponential gamma * exp(-delta * q) through the (queue position, average severity) scatter using log-linear regression, constrained to delta > 0. The d(q) and p(q) tab then computes optimal queue positions from the first-order condition of h(theta, q) = p(q) + theta * d(q), showing where each client type would self-select on the price curve.

## Project structure

```
├── src/
│   ├── App.jsx          # All simulation logic and UI (~575 lines)
│   ├── main.jsx         # React entry point
│   ├── index.css        # Root CSS variables
│   └── assets/          # Images
├── public/              # Favicon, icons
├── index.html           # HTML shell
├── package.json
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
  title     = {Queue-Position SLA Simulator},
  version   = {1.0.0},
  year      = {2026},
  publisher = {Zenodo},
  doi       = {10.5281/zenodo.20026571},
  url       = {https://github.com/glucz/Queue-Position-SLA-Simulator}
}
```

## License

[MIT](LICENSE)
