// === Queue-Position SLA Simulator — simulation engine ===
// Pure, dependency-free model code: no React, no DOM, no I/O. The browser UI (App.jsx), the
// invariant test suite (test/engine.test.mjs) and the parameter sweep (scripts/sweep.mjs) all
// import THIS module, so every number reported in the paper comes from the same implementation
// the user drives with the sliders. Deterministic given `seed`.

export const SLOTS = 96;                       // 96 fifteen-minute windows = one 24-hour cycle
export const slotToHour = s => s / 4;
export const hourToSlot = h => { let s = Math.round(h * 4); if (s < 0) s += SLOTS; if (s >= SLOTS) s -= SLOTS; return s; };

// Seeded PRNG (mulberry32): the whole population is a pure function of the seed, so any result
// in the paper can be reproduced exactly from the seed alone.
export function mulberry32(a){return function(){let t=a+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296}}

// Price-curve exponent α in p(q) = e^(α·q), exposed as a slider. Together with the
// published severity-curve steepness δ (below) it sets the self-selection spread:
// clients solve q* = 1/2 + ln(θ/θ_ref)/(α+δ). The default is chosen so that
// α+δ ≈ ln(θ_max/θ_min) for the default population, i.e. the solved positions fill [0,1].
export const PRICE_EXPONENT_DEFAULT = 3;
// DRR scheduler parameters. β = quantum steepness (curvature of the concave-increasing quantum
// schedule); wMin = minimum-service floor reserved to every position (no starvation; caps tail
// severity). The scheduler is run over the 24-h load to produce the measured severity-vs-position
// profile, and the published contract steepness δ is FITTED to it — δ is no longer a free slider.
// Defaults chosen so the fitted δ lands near the historical 1.5 for the default population.
export const BETA_DEFAULT = 2;
export const W_MIN_DEFAULT = 0.15;

// The default configuration. Single source of truth: App.jsx seeds its sliders from here, and the
// tests and sweeps use it as the base case, so "default parameters" means one thing everywhere.
export const DEFAULTS = {
  n: 1000,
  ratios:   { batch: 25,  gaming: 25,  webshop: 30, office: 20 },
  thetas:   { batch: 0.5, gaming: 16,  webshop: 8,  office: 3 },
  peakMins: { batch: 22,  gaming: 20,  webshop: 14, office: 9 },
  peakMaxs: { batch: 6,   gaming: 22,  webshop: 21, office: 17 },
  sigmas:   { batch: 3.5, gaming: 1.5, webshop: 1,  office: 4 },
  sla: "99.99%",
  costK: 40,
  capABpct: 60,
  capCpct: 48,
  beta: BETA_DEFAULT,
  wMin: W_MIN_DEFAULT,
  pExp: PRICE_EXPONENT_DEFAULT,
  seed: 42,
};

export function gen(n,ratios,thetas,peakMins,peakMaxs,sigmas,seed){
  const rng=mulberry32(seed),lerp=(a,b)=>a+rng()*(b-a);
  const amps={batch:[0.5,1.5],gaming:[2,4],webshop:[1.5,3],office:[1,2]};
  const rT=ratios.batch+ratios.gaming+ratios.webshop+ratios.office,out=[];
  for(let i=0;i<n;i++){
    const r=rng()*rT;
    let type=r<ratios.batch?"batch":r<ratios.batch+ratios.gaming?"gaming":r<ratios.batch+ratios.gaming+ratios.webshop?"webshop":"office";
    const theta=thetas[type]*lerp(0.7,1.3);
    let pMin=peakMins[type],pMax=peakMaxs[type],peakH;
    if(pMin<=pMax){peakH=lerp(pMin,pMax);}
    else{peakH=lerp(pMin,pMax+24);if(peakH>=24)peakH-=24;}
    let peakSlot=hourToSlot(peakH);
    const sigma=sigmas[type]*4;
    const amp=lerp(amps[type][0],amps[type][1]);
    const wl=new Float64Array(SLOTS);
    for(let s=0;s<SLOTS;s++){let d=s-peakSlot;if(d>SLOTS/2)d-=SLOTS;if(d<-SLOTS/2)d+=SLOTS;wl[s]=amp*Math.exp(-0.5*(d/sigma)**2);}
    let tW=0;for(let s=0;s<SLOTS;s++)tW+=wl[s];
    out.push({type,theta,workload:wl,totalWork:tW});
  }
  return out;
}

export function maxSlotSeverity(totalLoad,cap){
  let mx=0;
  for(let s=0;s<SLOTS;s++){if(totalLoad[s]>cap){const fr=Math.min(1,(totalLoad[s]-cap)/totalLoad[s]);if(fr>mx)mx=fr;}}
  return mx;
}

// === DRR severity engine (Deficit Round Robin — Shreedhar & Varghese, IEEE/ACM ToN 4(3), 1996) ===
// Each queue position q∈[0,1] (q=1 = front, best protected) is reserved a quantum = a GUARANTEED
// minimum service share. The quantum schedule is a floor wMin reserved to EVERY position plus a
// CONCAVE-increasing remainder, so: (a) the back keeps wMin>0 ⇒ no starvation (tail severity stays
// below 1, defeating the sigmoid); (b) the guaranteed-rate schedule g(q)=cap·share(q) is
// concave-increasing ⇒ realized severity s(q)=1−g(q)/demand is CONVEX-decreasing — the
// diminishing-returns-of-protection shape (moving off the back escapes the bulk of congestion,
// moving to the very front escapes only the residual). NB: s=1−A·w is an affine DECREASING map of
// the weight, so s''=−A·w''; convex severity needs CONCAVE weight (a convex weight would give a
// concave curve). wMin is the "minimum d(q)" floor slider; beta is the quantum steepness.
export function quantumShape(q,beta,wMin){
  const phi=beta>1e-6?(1-Math.exp(-beta*q))/(1-Math.exp(-beta)):q; // concave-increasing, phi(0)=0,phi(1)=1
  return wMin+(1-wMin)*phi;
}

// Run DRR over the 96 windows at capacity `cap`; return the realized severity-vs-position profile
// [{q,sev}] on an nBins grid. Each position carries an equal demand slice; the scheduler is
// WORK-CONSERVING (the front's unused capacity is redistributed to the back) — per window we solve
// for the water level λ so that Σ min(slice, λ·w(q)) = cap, then severity(q) = max(0, 1 − λ·w(q)/slice).
// Work-conservation guarantees: (a) every severity ∈ [0,1] (it is an unmet fraction), and (b) the
// work-weighted mean of the profile equals the conserved budget ε (total unmet / total work). The
// profile is a property of POSITION (not of any client), so there is no circularity with q*(θ).
export function drrSeverityProfile(totalLoad,cap,beta,wMin,nBins=40){
  const qs=Array.from({length:nBins},(_,i)=>i/(nBins-1));
  const w=qs.map(q=>quantumShape(q,beta,wMin));
  const wMinVal=Math.min(...w);
  const sev=new Array(nBins).fill(0),wsum=new Array(nBins).fill(0);
  for(let s=0;s<SLOTS;s++){
    const load=totalLoad[s];if(load<=0)continue;
    const slice=load/nBins; // demand per position this window
    if(load<=cap){for(let b=0;b<nBins;b++)wsum[b]+=slice;continue;} // no overload
    let lo=0,hi=slice/wMinVal+1; // bisect water level λ so Σ min(slice, λ·w(q)) = cap
    for(let it=0;it<60;it++){const mid=(lo+hi)/2;let tot=0;for(let b=0;b<nBins;b++)tot+=Math.min(slice,mid*w[b]);if(tot>cap)hi=mid;else lo=mid;}
    const lam=(lo+hi)/2;
    for(let b=0;b<nBins;b++){const a=Math.min(slice,lam*w[b]);sev[b]+=Math.max(0,1-a/slice)*slice;wsum[b]+=slice;}
  }
  return qs.map((q,b)=>({q,sev:wsum[b]>0?sev[b]/wsum[b]:0}));
}

// Fit the measured profile to γ·e^(−δq) by least squares in LINEAR space. A log-linear fit is
// dominated by the near-zero front tail (fully-protected positions) and blows δ up; linear-space
// NLS weights by magnitude. Grid the decay δ, take the closed-form γ for each, keep the min-SSE
// pair. δ>0 ⇒ genuinely decreasing; δ≤0/flat ⇒ the sliders left the convex-decreasing window.
export function fitDelta(profile){
  const pts=profile.filter(p=>p.sev>1e-9);
  if(pts.length<3)return{delta:0,gamma:0,r2:0,shapeValid:false};
  let best={sse:Infinity,delta:0,gamma:0};
  for(let d=0.1;d<=12;d+=0.05){
    let a=0,b=0;for(const p of pts){const e=Math.exp(-d*p.q);a+=p.sev*e;b+=e*e;}
    const g=b>0?a/b:0;let sse=0;for(const p of pts){const r=p.sev-g*Math.exp(-d*p.q);sse+=r*r;}
    if(sse<best.sse)best={sse,delta:d,gamma:g};
  }
  const mean=pts.reduce((s,p)=>s+p.sev,0)/pts.length;
  const sst=pts.reduce((s,p)=>s+(p.sev-mean)**2,0);
  const r2=sst>0?1-best.sse/sst:1; // goodness-of-fit of the exponential to the measured profile
  return{delta:best.delta,gamma:best.gamma,r2,shapeValid:best.delta>1e-3};
}

export function runSim(clients,slaKey,costK,capABpct,capCpct,beta,wMin,pExp){
  const slaViolBudget={"99.9%":0.001,"99.99%":0.0001,"99.999%":0.00001}[slaKey]||0.0001;

  const totalLoad=new Float64Array(SLOTS);
  const tLoad={batch:new Float64Array(SLOTS),gaming:new Float64Array(SLOTS),webshop:new Float64Array(SLOTS),office:new Float64Array(SLOTS)};
  clients.forEach(c=>{for(let s=0;s<SLOTS;s++){totalLoad[s]+=c.workload[s];tLoad[c.type][s]+=c.workload[s]}});
  const peak=Math.max(...totalLoad);
  const totalWorkAll=clients.reduce((s,c)=>s+c.totalWork,0);
  const sumNTheta=clients.reduce((s,c)=>s+c.totalWork*c.theta,0); // Σ nθ (workload-weighted sensitivity)

  // === Fixed capacities ===  A & B share the deployed (conventional-SLA) capacity; C is the
  // underdeployment slider; D is honest per-window provisioning. Capacity is NOT optimized here
  // (that dual problem lives in the Infrastructure Cost Sensitivity tab; see preprint 7.8).
  const capA=peak*capABpct/100, capB=capA, capC=peak*capCpct/100;
  let dLo=peak*0.5,dHi=peak*1.01;
  for(let iter=0;iter<40;iter++){const mid=(dLo+dHi)/2;if(maxSlotSeverity(totalLoad,mid)<=slaViolBudget)dHi=mid;else dLo=mid;}
  const capD=dHi;

  // === Measured contract shape ===  Run DRR over the real load at the deployed capacity to get the
  // realized severity-vs-position profile, then fit γ·e^(−δq) to it. δ is now MEASURED from the
  // scheduler (β, wMin and the load) rather than a free slider; it feeds both the self-selection
  // FOC and the published curve shape. The profile is a property of position (not of q*), so there
  // is no circularity with self-selection.
  const profile=drrSeverityProfile(totalLoad,capA,beta,wMin);
  const fit=fitDelta(profile);
  const dqDelta=fit.shapeValid?fit.delta:1.5; // fall back to a sane decreasing shape if the fit is invalid

  // === Self-selection (per unit of work) ===
  // Each client solves its first-order condition for the burden-minimizing position against the
  // published contract  p(q)=e^(αq),  d(q)=γe^(−δq):
  //     q*(θ) = ½ + ln(θ/θ_ref)/(α+δ),   θ_ref = geometric-mean sensitivity.
  // Closed form, monotone increasing in θ (incentive compatibility; preprint Prop. 3). The price
  // shape α is exogenous and δ is measured from DRR, so positions are stable — no fixed point.
  const thetaRef=Math.exp(clients.reduce((s,c)=>s+Math.log(c.theta),0)/clients.length);
  const aPlusD=pExp+dqDelta;
  const clientQ=clients.map(c=>Math.max(0,Math.min(1,0.5+Math.log(c.theta/thetaRef)/aPlusD)));

  // === ε(C): the conserved total severity = (total unmet demand)/(total work) over the cycle ===
  // Under ANY allocation the same unmet demand is shared out, so a separated menu only
  // REDISTRIBUTES it (Theorem 1 = pure reallocation). ε(C) is also the pooled per-unit severity.
  const epsAt=(cap)=>{let u=0;for(let s=0;s<SLOTS;s++)if(totalLoad[s]>cap)u+=totalLoad[s]-cap;return u/totalWorkAll;};
  const epsAB=epsAt(capA), epsC=epsAt(capC), epsD=epsAt(capD);

  // === Published convex contract d(q)=γ·e^(−δq) ∈ [0,1] (per unit of work) ===
  // d(q)=E[v|q] is the expected violation severity (v∈[0,1], 0 = perfect, 1 = complete failure;
  // preprint §4.1, §4.5). SHAPE δ is measured from the DRR profile (diminishing-returns convexity,
  // Kleinrock §3.8); LEVEL γ is scaled so the work-weighted mean of d(q*) equals the conserved
  // budget ε(capAB), so both welfare arms stay on the same mean and W_pooled − W_separated is the
  // EXACT rearrangement gain. This published curve IS the contractible ceiling (preprint §5.1): the
  // work-conserving DRR severity stays at/below it within tolerance. d(q) is clamped to ≤1 for safety.
  const dShape=(q)=>Math.exp(-dqDelta*q);
  const meanShape=clients.reduce((s,c,i)=>s+c.totalWork*dShape(clientQ[i]),0)/totalWorkAll;
  const dGamma=meanShape>0?epsAB/meanShape:0;
  const dAt=(q)=>Math.min(1,dGamma*dShape(q));
  const clientD=clients.map((c,i)=>dAt(clientQ[i])); // per-unit severity each client gets = d(q*)

  // === Welfare loss W = Σ n·θ·d(q) ===  A (separated): each client's own d(q*).  B/C/D (pooled): ε.
  const dmgA=clients.reduce((s,c,i)=>s+c.totalWork*c.theta*clientD[i],0);
  const dmgB=epsAB*sumNTheta, dmgC=epsC*sumNTheta, dmgD=epsD*sumNTheta;
  const infraA=capA*costK, infraB=capB*costK, infraC=capC*costK, infraD=capD*costK;

  // Unit prices (infrastructure pass-through per unit of work)
  const upA=infraA/totalWorkAll, upB=infraB/totalWorkAll, upC=infraC/totalWorkAll, upD=infraD/totalWorkAll;

  // d(q) curve + per-client scatter + measured DRR profile (all severities ∈ [0,1]).
  //  • dqCurve   — the published convex contract d(q) (the ceiling; clients self-select on THIS).
  //  • dqScatter — each client at its solved position q* on the published curve, type-tagged.
  //  • dqMeasured— the work-conserving DRR severity-vs-position profile the contract is fitted to.
  const dqCurve=[];for(let qi=0;qi<=100;qi++){const q=qi/100;dqCurve.push({q,d:dAt(q)});}
  const dqStep=Math.max(1,Math.floor(clients.length/240));
  const dqScatter=[];for(let i=0;i<clients.length;i+=dqStep)dqScatter.push({q:Math.round(clientQ[i]*1000)/1000,d:Math.round(clientD[i]*1e5)/1e5,type:clients[i].type});
  const dqMeasured=profile.map(p=>({q:Math.round(p.q*1000)/1000,d:Math.round(p.sev*1e5)/1e5}));

  // Per-type work-weighted aggregates (mean θ, mean q*, mean d(q*)) for the rearrangement view.
  const TYPES=["gaming","webshop","office","batch"];
  const ag={};for(const t of TYPES)ag[t]={n:0,nq:0,nd:0,th:0,cnt:0};
  clients.forEach((c,i)=>{const a=ag[c.type];a.n+=c.totalWork;a.nq+=c.totalWork*clientQ[i];a.nd+=c.totalWork*clientD[i];a.th+=c.theta;a.cnt++;});
  const typeRows=TYPES.map(t=>{const a=ag[t];return{type:t,theta:a.th/a.cnt,q:a.nq/a.n,d:a.nd/a.n};});

  // Per-type burden breakdown: price (n·unitPrice) + damage (n·θ·d). A uses d(q*); B/C/D use ε.
  const mkTb=(getD,up)=>{const tw={};for(const t of TYPES)tw[t]={price:0,dmg:0};clients.forEach((c,i)=>{tw[c.type].price+=c.totalWork*up;tw[c.type].dmg+=c.totalWork*c.theta*getD(i);});return tw;};
  const tbA=mkTb(i=>clientD[i],upA), tbB=mkTb(()=>epsAB,upB), tbC=mkTb(()=>epsC,upC), tbD=mkTb(()=>epsD,upD);
  const maxSevC=maxSlotSeverity(totalLoad,capC), maxSevD=maxSlotSeverity(totalLoad,capD);

  // === Infrastructure-cost sensitivity: provider trades C·k against W(C) ===
  // ε(C) falls as capacity rises. W_pool(C)=ε(C)·Σnθ; W_sep(C)=(dmgA/εAB)·ε(C) — positions are
  // fixed, the d-level scales with ε, so both → 0 as C → peak. Marginal damage prevented = −dW/dC.
  const sepFac=epsAB>0?dmgA/epsAB:0;
  const capGrid=[];
  for(let p=55;p<=100;p+=1){const C=peak*p/100,e=epsAt(C);capGrid.push({pct:p,C,Wsep:sepFac*e,Wpool:e*sumNTheta});}
  const margData=[];
  for(let i=1;i<capGrid.length-1;i++){const dC=capGrid[i+1].C-capGrid[i-1].C;
    margData.push({pct:capGrid[i].pct,mSep:-(capGrid[i+1].Wsep-capGrid[i-1].Wsep)/dC,mPool:-(capGrid[i+1].Wpool-capGrid[i-1].Wpool)/dC});}
  const optCapBy=(key)=>{let b=capGrid[0],bH=Infinity;for(const g of capGrid){const H=g.C*costK+g[key];if(H<bH){bH=H;b=g;}}return b;};
  const optWfq=optCapBy('Wsep'),optPool=optCapBy('Wpool');
  const kSweep=[];
  for(let kk=1;kk<=50;kk+=1){let bw=Infinity,Ww=0;
    for(const g of capGrid){const Hw=g.C*kk+g.Wsep;if(Hw<bw){bw=Hw;Ww=g.Wsep;}}
    kSweep.push({k:kk,Wsep:Ww});}

  // Load profile chart data (demand by type over the cycle + capacity overlays).
  const loadData=[];
  for(let s=0;s<SLOTS;s++)loadData.push({hour:slotToHour(s),batch:tLoad.batch[s],office:tLoad.office[s],webshop:tLoad.webshop[s],gaming:tLoad.gaming[s],capA,capC,capD});
  const tc={batch:0,gaming:0,webshop:0,office:0};
  clients.forEach(c=>tc[c.type]++);

  return{loadData,dqCurve,dqScatter,dqMeasured,typeRows,thetaRef,dqDelta,dGamma,
    profile,clientQ,clientD, // exposed for the invariant tests and the parameter sweep
    shapeValid:fit.shapeValid,r2:fit.r2,epsAB,epsC,epsD,
    margData,kSweep,optWfq,optPool,capA,capB,capC,capD,peak,
    infraA,infraB,infraC,infraD,dmgA,dmgB,dmgC,dmgD,
    burdenA:infraA+dmgA,burdenB:infraB+dmgB,burdenC:infraC+dmgC,burdenD:infraD+dmgD,
    upA,upB,upC,upD,tbA,tbB,tbC,tbD,
    actualSlaD:(1-epsD)*100,maxSevC,maxSevD,avgSevC:epsC,availAB:1-epsAB,
    tc,totalWorkAll};
}

// Convenience wrapper: build the population and run the four scenarios from one parameter object.
// Any field left out falls back to DEFAULTS, so callers can vary one knob at a time —
//   simulate({ capABpct: 85 })   →  the default case at 85% deployed capacity.
export function simulate(params = {}){
  const p = { ...DEFAULTS, ...params };
  const clients = gen(p.n, p.ratios, p.thetas, p.peakMins, p.peakMaxs, p.sigmas, p.seed);
  const sim = runSim(clients, p.sla, p.costK, p.capABpct, p.capCpct, p.beta, p.wMin, p.pExp);
  return { params: p, clients, sim };
}

// Welfare-loss reduction of the separated menu against pooling at the SAME capacity (Theorem 1).
// k-independent: both arms carry identical infrastructure cost, so this is pure reallocation.
export function welfareReduction(sim){
  return sim.dmgB > 0 ? (sim.dmgB - sim.dmgA) / sim.dmgB : 0;
}

// Burden ranking, cheapest total burden H = C·k + W first (the default case gives A < D < B < C).
export function burdenRanking(sim){
  return [["A",sim.burdenA],["B",sim.burdenB],["C",sim.burdenC],["D",sim.burdenD]]
    .sort((x,y)=>x[1]-y[1]).map(([name])=>name);
}
