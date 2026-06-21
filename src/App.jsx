import { useState, useMemo, useCallback } from "react";
import { Area, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ComposedChart, ReferenceLine, ReferenceDot, Cell, Scatter, ScatterChart, ZAxis } from "recharts";

function mulberry32(a){return function(){let t=a+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296}}
const SLOTS=96,slotToHour=s=>s/4,hourToSlot=h=>{let s=Math.round(h*4);if(s<0)s+=SLOTS;if(s>=SLOTS)s-=SLOTS;return s};
const fH=h=>{const hh=((Math.floor(h)%24)+24)%24,mm=Math.round((h%1)*60);return`${hh}:${mm.toString().padStart(2,'0')}`};

// Price-curve exponent α in p(q) = e^(α·q), exposed as a slider. Together with the
// published severity-curve steepness δ (below) it sets the self-selection spread:
// clients solve q* = 1/2 + ln(θ/θ_ref)/(α+δ). The default is chosen so that
// α+δ ≈ ln(θ_max/θ_min) for the default population, i.e. the solved positions fill [0,1].
const PRICE_EXPONENT_DEFAULT = 3;
// DRR scheduler parameters. β = quantum steepness (curvature of the concave-increasing quantum
// schedule); wMin = minimum-service floor reserved to every position (no starvation; caps tail
// severity). The scheduler is run over the 24-h load to produce the measured severity-vs-position
// profile, and the published contract steepness δ is FITTED to it — δ is no longer a free slider.
// Defaults chosen so the fitted δ lands near the historical 1.5 for the default population.
const BETA_DEFAULT = 2;
const W_MIN_DEFAULT = 0.15;

function gen(n,ratios,thetas,peakMins,peakMaxs,sigmas,seed){
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

function maxSlotSeverity(totalLoad,cap){
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
function quantumShape(q,beta,wMin){
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
function drrSeverityProfile(totalLoad,cap,beta,wMin,nBins=40){
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
function fitDelta(profile){
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

function runSim(clients,slaKey,costK,capABpct,capCpct,beta,wMin,pExp){
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
    shapeValid:fit.shapeValid,r2:fit.r2,epsAB,epsC,epsD,
    margData,kSweep,optWfq,optPool,capA,capB,capC,capD,peak,
    infraA,infraB,infraC,infraD,dmgA,dmgB,dmgC,dmgD,
    burdenA:infraA+dmgA,burdenB:infraB+dmgB,burdenC:infraC+dmgC,burdenD:infraD+dmgD,
    upA,upB,upC,upD,tbA,tbB,tbC,tbD,
    actualSlaD:(1-epsD)*100,maxSevC,maxSevD,avgSevC:epsC,availAB:1-epsAB,
    tc,totalWorkAll};
}

const Sl=({label,value,onChange,min,max,step,color})=>(<div style={{marginBottom:3}}><div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:color||"#94a3b8"}}><span>{label}</span><span style={{color:"#1e293b",fontFamily:"monospace",fontSize:10}}>{typeof value==="number"&&value%1!==0?value.toFixed(1):value}</span></div><input type="range" min={min} max={max} step={step} value={value} onChange={e=>onChange(Number(e.target.value))} style={{width:"100%",accentColor:color||"#6366f1",height:3}}/></div>);
const St=({label,value,color="#e2e8f0",sub})=>(<div style={{background:"#f8fafc",borderRadius:5,padding:"4px 6px",flex:1,minWidth:75}}><div style={{fontSize:7,color:"#94a3b8",textTransform:"uppercase",letterSpacing:0.6}}>{label}</div><div style={{fontSize:12,fontWeight:700,color,fontFamily:"monospace"}}>{value}</div>{sub&&<div style={{fontSize:7,color:"#94a3b8"}}>{sub}</div>}</div>);
const Tb=({active,onClick,children})=>(<button onClick={onClick} style={{padding:"4px 9px",fontSize:10,cursor:"pointer",fontWeight:active?700:400,background:active?"#6366f1":"transparent",color:active?"#fff":"#94a3b8",border:`1px solid ${active?"#6366f1":"#cbd5e1"}`,borderRadius:4}}>{children}</button>);
const CL={A:"#047857",B:"#6d28d9",C:"#b91c1c",D:"#1d4ed8"};
const tC={gaming:"#be185d",webshop:"#b45309",office:"#0369a1",batch:"#334155"};

export default function App(){
  const[ratios,setRatios]=useState({batch:25,gaming:25,webshop:30,office:20});
  const[thetas,setThetas]=useState({batch:0.5,gaming:16,webshop:8,office:3});
  const[peakMins,setPeakMins]=useState({batch:22,gaming:20,webshop:14,office:9});
  const[peakMaxs,setPeakMaxs]=useState({batch:6,gaming:22,webshop:21,office:17});
  const[sigmas,setSigmas]=useState({batch:3.5,gaming:1.5,webshop:1,office:4});
  const[sla,setSla]=useState("99.99%");
  const[costK,setCostK]=useState(40);
  const[capABpct,setCapABpct]=useState(60);
  const[capCpct,setCapCpct]=useState(48);
  const[beta,setBeta]=useState(BETA_DEFAULT);
  const[wMin,setWMin]=useState(W_MIN_DEFAULT);
  const[seed,setSeed]=useState(42);
  const[pExp,setPExp]=useState(PRICE_EXPONENT_DEFAULT);
  const[showNotes,setShowNotes]=useState(true);
  const[tab,setTab]=useState("load");
  const sR=useCallback((k,v)=>setRatios(p=>({...p,[k]:v})),[]);
  const sT=useCallback((k,v)=>setThetas(p=>({...p,[k]:v})),[]);
  const sPn=useCallback((k,v)=>setPeakMins(p=>({...p,[k]:v})),[]);
  const sPx=useCallback((k,v)=>setPeakMaxs(p=>({...p,[k]:v})),[]);
  const sS=useCallback((k,v)=>setSigmas(p=>({...p,[k]:v})),[]);

  const clients=useMemo(()=>gen(1000,ratios,thetas,peakMins,peakMaxs,sigmas,seed),[ratios,thetas,peakMins,peakMaxs,sigmas,seed]);
  const sim=useMemo(()=>runSim(clients,sla,costK,capABpct,capCpct,beta,wMin,pExp),[clients,sla,costK,capABpct,capCpct,beta,wMin,pExp]);
  const pqCurveData=useMemo(()=>{const d=[];for(let qi=0;qi<=100;qi++){const q=qi/100;d.push({q,price:Math.exp(pExp*q)});}return d;},[pExp]);

  const pAB=sim.burdenB>0?((sim.burdenB-sim.burdenA)/sim.burdenB*100).toFixed(1):"0";
  const pAC=sim.burdenC>0?((sim.burdenC-sim.burdenA)/sim.burdenC*100).toFixed(1):"0";
  const pAD=sim.burdenD>0?((sim.burdenD-sim.burdenA)/sim.burdenD*100).toFixed(1):"0";
  const wRed=sim.dmgB>0?((sim.dmgB-sim.dmgA)/sim.dmgB*100).toFixed(1):"0"; // welfare-loss reduction A vs B (k-independent, Theorem 1)
  const cm={top:8,right:16,left:8,bottom:4};

  return(<div style={{background:"#ffffff",color:"#1e293b",minHeight:"100vh",fontFamily:"'IBM Plex Sans',system-ui,sans-serif",padding:14}}>
  <div style={{maxWidth:1280,margin:"0 auto"}}>
    <div style={{marginBottom:10,borderBottom:"1px solid #e2e8f0",paddingBottom:8}}>
      <h1 style={{fontSize:18,fontWeight:800,margin:0,color:"#0f172a"}}>Queue-Position SLA Simulator</h1>
      <p style={{fontSize:11,color:"#94a3b8",margin:"2px 0 0"}}>1000 clients · A DRR scheduler over the 24-h load gives the severity-vs-position profile; the provider publishes a convex contract d(q) fitted to it (shape measured, level mean-matched to ε). Clients self-select their position, giving welfare loss W = Σ nᵢ·θᵢ·d(q*ᵢ). Total social cost H = C·k + W (C·k = infrastructure cost)</p>
    </div>
    <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
      <div style={{width:250,flexShrink:0,maxHeight:"calc(100vh - 80px)",overflowY:"auto",paddingRight:4}}>
        <div style={{background:"#f8fafc",borderRadius:6,padding:8,marginBottom:5}}>
          <div style={{fontSize:9,color:"#6366f1",fontWeight:700,textTransform:"uppercase",letterSpacing:1,marginBottom:4}}>Client Mix</div>
          {["batch","gaming","webshop","office"].map(t=>(<Sl key={t} label={t.charAt(0).toUpperCase()+t.slice(1)} value={ratios[t]} onChange={v=>sR(t,v)} min={0} max={60} step={5} color={tC[t]}/>))}
          <div style={{fontSize:9,color:"#94a3b8",marginTop:1}}>B:{sim.tc.batch} G:{sim.tc.gaming} W:{sim.tc.webshop} O:{sim.tc.office}</div>
        </div>
        <div style={{background:"#f8fafc",borderRadius:6,padding:8,marginBottom:5}}>
          <div style={{fontSize:9,color:"#ec4899",fontWeight:700,textTransform:"uppercase",letterSpacing:1,marginBottom:4}}>Sensitivity (θ)</div>
          {["batch","gaming","webshop","office"].map(t=>(<Sl key={t} label={`θ ${t}`} value={thetas[t]} onChange={v=>sT(t,v)} min={0.5} max={20} step={0.5} color={tC[t]}/>))}
        </div>
        <div style={{background:"#f8fafc",borderRadius:6,padding:8,marginBottom:5}}>
          <div style={{fontSize:9,color:"#22d3ee",fontWeight:700,textTransform:"uppercase",letterSpacing:1,marginBottom:4}}>Peak Interval</div>
          {["batch","gaming","webshop","office"].map(t=>(<div key={t} style={{marginBottom:3}}>
            <div style={{fontSize:9,color:tC[t],fontWeight:600}}>{t}: {fH(peakMins[t])}–{fH(peakMaxs[t])}</div>
            <Sl label="From" value={peakMins[t]} onChange={v=>sPn(t,v)} min={0} max={23.5} step={0.5} color={tC[t]}/>
            <Sl label="To" value={peakMaxs[t]} onChange={v=>sPx(t,v)} min={0} max={23.5} step={0.5} color={tC[t]}/>
          </div>))}
        </div>
        <div style={{background:"#f8fafc",borderRadius:6,padding:8,marginBottom:5}}>
          <div style={{fontSize:9,color:"#a3e635",fontWeight:700,textTransform:"uppercase",letterSpacing:1,marginBottom:4}}>Spread σ (hours)</div>
          {["batch","gaming","webshop","office"].map(t=>(<Sl key={t} label={`σ ${t}`} value={sigmas[t]} onChange={v=>sS(t,v)} min={0.5} max={6} step={0.25} color={tC[t]}/>))}
        </div>
        <div style={{background:"#f8fafc",borderRadius:6,padding:8,marginBottom:5,border:"1px solid #e2e8f0"}}>
          <div style={{fontSize:9,color:CL.A,fontWeight:700,textTransform:"uppercase",letterSpacing:1,marginBottom:4}}>A & B: Deployed Capacity</div>
          <Sl label={`Capacity: ${capABpct}% of peak`} value={capABpct} onChange={setCapABpct} min={45} max={100} step={1} color={CL.A}/>
          <div style={{fontSize:9,color:"#64748b",marginTop:2}}>The deployed capacity A and B share (A = separated menu, B = pooled). It sets the <b>overload regime</b>, which drives the measured d(q): high capacity → mild overload → the front is fully protected and d(q) is steep; lower capacity → deeper overload shared across positions → milder, more spread d(q). Avg availability: {sim.availAB!=null?(sim.availAB*100).toFixed(2):"—"}% (ε={sim.epsAB!=null?(sim.epsAB*100).toFixed(1):"—"}% unmet).</div>
        </div>
        <div style={{background:"#f8fafc",borderRadius:6,padding:8,marginBottom:5,border:"1px solid #e2e8f0"}}>
          <div style={{fontSize:9,color:CL.C,fontWeight:700,textTransform:"uppercase",letterSpacing:1,marginBottom:4}}>C: Worst-case Underdeployment</div>
          <Sl label={`Capacity: ${capCpct}% of peak`} value={capCpct} onChange={setCapCpct} min={40} max={80} step={1} color={CL.C}/>
          <div style={{fontSize:9,color:"#64748b",marginTop:2}}>Cutting corners below the deployed capacity, pooled — the worst case. Peak severity: {sim.maxSevC?sim.maxSevC.toFixed(3):"0"}</div>
        </div>
        <div style={{background:"#f8fafc",borderRadius:6,padding:8,marginBottom:5,border:"1px solid #e2e8f0"}}>
          <div style={{fontSize:9,color:CL.D,fontWeight:700,textTransform:"uppercase",letterSpacing:1,marginBottom:4}}>D: Honest SLA Target</div>
          {["99.9%","99.99%","99.999%"].map(k=>(<button key={k} onClick={()=>setSla(k)} style={{display:"block",width:"100%",textAlign:"left",padding:"3px 6px",marginBottom:2,background:sla===k?"#dbeafe":"transparent",border:sla===k?"1px solid "+CL.D:"1px solid transparent",borderRadius:4,cursor:"pointer",color:sla===k?"#1e40af":"#64748b",fontSize:11}}>{k}</button>))}
          <div style={{fontSize:9,color:"#64748b",marginTop:2}}>D provisions so every 15-min window individually meets this.</div>
        </div>
        <div style={{background:"#f8fafc",borderRadius:6,padding:8,marginBottom:5,border:"1px solid #e2e8f0"}}>
          <Sl label="Infrastructure cost (k)" value={costK} onChange={setCostK} min={1} max={50} step={1}/>
          <Sl label={`DRR quantum steepness β: ${beta}`} value={beta} onChange={setBeta} min={0.5} max={4} step={0.25} color={CL.A}/>
          <Sl label={`Minimum d(q) floor wMin: ${wMin} (back-of-queue guaranteed share)`} value={wMin} onChange={setWMin} min={0.02} max={0.6} step={0.02} color={CL.A}/>
          <Sl label={`Price exponent: ${pExp} (p(q) = e^(${pExp}·q))`} value={pExp} onChange={setPExp} min={1} max={8} step={0.5} color="#10b981"/>
          <Sl label="Population seed" value={seed} onChange={setSeed} min={1} max={100} step={1}/>
          <div style={{fontSize:9,color:"#64748b",marginTop:2}}>DRR severity engine: the concave-increasing quantum schedule (β steepness, wMin floor) runs over the 24-h load to produce the measured severity-vs-position profile; the published contract steepness <b style={{color:sim.shapeValid?"#047857":"#b91c1c"}}>δ = {sim.dqDelta.toFixed(2)}</b> is <b>fitted</b> to it{sim.shapeValid?"":" ⚠ shape invalid (profile not decreasing — lower β or wMin)"}. wMin reserves a minimum share to every position (no starvation; caps tail severity). k drives the Infrastructure Cost Sensitivity tab. Price exponent α: convexity of p(q)=e^(α·q); α+δ set the self-selection spread.</div>
        </div>
        <div style={{background:"#f8fafc",borderRadius:6,padding:8,border:"1px solid #e2e8f0"}}>
          <div style={{fontSize:9,fontWeight:700,letterSpacing:1,marginBottom:3,color:"#64748b"}}>SCENARIOS</div>
          <div style={{fontSize:10,lineHeight:1.7,color:"#475569"}}>
            <span style={{color:CL.A}}>■ A:</span> Separated @ {capABpct}% (self-select on d(q))<br/>
            <span style={{color:CL.B}}>■ B:</span> Pooled @ {capABpct}% (same capacity)<br/>
            <span style={{color:CL.C}}>■ C:</span> Pooled @ {capCpct}% (underdeployed)<br/>
            <span style={{color:CL.D}}>■ D:</span> Honest {sla} (≈ peak)
          </div>
        </div>
      </div>

      <div style={{flex:1,minWidth:0}}>
        <div style={{display:"flex",gap:3,marginBottom:5,flexWrap:"wrap"}}>
          <St label="W reduction A→B" value={`${wRed}%`} color={CL.A} sub="Theorem 1 · k-indep."/>
          <St label="W_A (welfare loss)" value={sim.dmgA.toFixed(0)} color={CL.A} sub="A: separated @ deployed cap"/>
          <St label="W_B (welfare loss)" value={sim.dmgB.toFixed(0)} color={CL.B} sub="B: pooled, same cap"/>
          <St label="H_A vs H_B" value={`${pAB}%`} color={CL.B} sub="total burden"/>
          <St label="H_A vs H_C" value={`${pAC}%`} color={CL.C} sub="vs underdeployed"/>
          <St label="H_A vs H_D" value={`${pAD}%`} color={CL.D} sub="vs honest (k-dep.)"/>
        </div>

        <div style={{display:"flex",gap:3,marginBottom:6,flexWrap:"wrap",alignItems:"center"}}>
          <Tb active={tab==="load"} onClick={()=>setTab("load")}>Load Profile</Tb>
          <Tb active={tab==="burden"} onClick={()=>setTab("burden")}>H = C·k + W</Tb>
          <Tb active={tab==="ab"} onClick={()=>setTab("ab")}>W_S vs W_P (Theorem 1)</Tb>
          <Tb active={tab==="curves"} onClick={()=>setTab("curves")}>d(q) and p(q) Curves</Tb>
          <Tb active={tab==="infra"} onClick={()=>setTab("infra")}>Infrastructure Cost Sensitivity</Tb>
          <Tb active={tab==="types"} onClick={()=>setTab("types")}>Per-Type h(θ,q)</Tb>
          <label style={{fontSize:9,color:"#94a3b8",cursor:"pointer",marginLeft:6,display:"flex",alignItems:"center",gap:3}}>
            <input type="checkbox" checked={showNotes} onChange={e=>setShowNotes(e.target.checked)} style={{accentColor:"#6366f1"}}/>Notes
          </label>
        </div>

        {tab==="load"&&(<div style={{background:"#f8fafc",borderRadius:6,padding:11}}>
          <div style={{fontSize:11,fontWeight:700,color:"#0f172a",marginBottom:2}}>Aggregate Load Profile and Capacity Levels</div>
          {showNotes&&<div style={{fontSize:10,color:"#475569",marginBottom:7,lineHeight:1.5}}>
            Stacked areas show total demand by client type over 24 hours. Dashed lines mark each scenario's capacity. When demand exceeds capacity, clients experience severity d(q), which drives welfare loss W.
          </div>}
          <ResponsiveContainer width="100%" height={300}><ComposedChart data={sim.loadData} margin={{top:8,right:60,left:8,bottom:4}}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/>
            <XAxis dataKey="hour" tick={{fill:"#64748b",fontSize:9}} tickFormatter={v=>`${Math.floor(v)}h`}/>
            <YAxis tick={{fill:"#64748b",fontSize:9}}/>
            <Tooltip contentStyle={{background:"#ffffff",border:"1px solid #e2e8f0",borderRadius:5,fontSize:10}} labelFormatter={v=>fH(v)}/>
            <Area type="monotone" dataKey="batch" stackId="1" fill="#334155" fillOpacity={0.3} stroke="#334155" strokeWidth={1.5} name="Batch"/>
            <Area type="monotone" dataKey="office" stackId="1" fill="#0369a1" fillOpacity={0.3} stroke="#0369a1" strokeWidth={1.5} name="Office"/>
            <Area type="monotone" dataKey="webshop" stackId="1" fill="#b45309" fillOpacity={0.25} stroke="#b45309" strokeWidth={1.5} name="Webshop"/>
            <Area type="monotone" dataKey="gaming" stackId="1" fill="#be185d" fillOpacity={0.3} stroke="#be185d" strokeWidth={1.5} name="Gaming"/>
            <ReferenceLine y={sim.capA} stroke={CL.A} strokeWidth={2.5} strokeDasharray="8 4" label={{value:"A/B",position:"right",fill:CL.A,fontSize:10}}/>
            <ReferenceLine y={sim.capC} stroke={CL.C} strokeWidth={2} strokeDasharray="6 3" label={{value:`C:${capCpct}%`,position:"right",fill:CL.C,fontSize:9}}/>
            <ReferenceLine y={sim.capD} stroke={CL.D} strokeWidth={2} strokeDasharray="6 3" label={{value:"D:honest",position:"right",fill:CL.D,fontSize:9}}/>
          </ComposedChart></ResponsiveContainer>
          {showNotes&&<div style={{marginTop:8,padding:"6px 8px",background:"#fff",borderRadius:4,border:"1px solid #e2e8f0",fontSize:10,color:"#475569",lineHeight:1.6}}>
            <strong>A</strong> (green) — Separated menu at the deployed capacity {sim.capA.toFixed(0)} ({(sim.capA/sim.peak*100).toFixed(0)}% of peak): clients self-select on the convex d(q), so high-θ work lands at low-severity positions.{" "}
            <strong>B</strong> — Same capacity, pooled (everyone at ε). Same C·k, higher W.{" "}
            <strong>C</strong> (red) — Underdeployed at {capCpct}%. Low C·k, high W.{" "}
            <strong>D</strong> (blue) — Worst-case provisioned for {sla} per window. High C·k, near-zero W.
          </div>}
        </div>)}

        {tab==="burden"&&(<div style={{background:"#f8fafc",borderRadius:6,padding:11}}>
          <div style={{fontSize:11,fontWeight:700,color:"#0f172a",marginBottom:2}}>Total Social Cost H = C·k + W (lower is better)</div>
          {showNotes&&<div style={{fontSize:10,color:"#475569",marginBottom:7,lineHeight:1.5}}>
            Grey = infrastructure cost C·k. Red = welfare loss W = Σ nᵢ·θᵢ·d(q*ᵢ) (aggregate damage). At a fixed deployed capacity, A lets clients self-select on the convex d(q), steering severity onto low-θ clients; B pools the same capacity (everyone at ε). A and B share C·k, so the gap is pure allocation (Theorem 1).
          </div>}
          <ResponsiveContainer width="100%" height={280}><BarChart data={[
            {name:"A: Separated (self-select)",infra:sim.infraA,dmg:sim.dmgA},
            {name:"B: Pooled, A's cap",infra:sim.infraB,dmg:sim.dmgB},
            {name:`C: Pooled, ${capCpct}% cap`,infra:sim.infraC,dmg:sim.dmgC},
            {name:`D: Pooled, honest ${sla}`,infra:sim.infraD,dmg:sim.dmgD},
          ]} margin={{...cm,bottom:40}}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/>
            <XAxis dataKey="name" tick={{fill:"#475569",fontSize:9}} angle={-12} textAnchor="end"/>
            <YAxis tick={{fill:"#475569",fontSize:9}}/>
            <Tooltip contentStyle={{background:"#fff",border:"1px solid #e2e8f0",borderRadius:5,fontSize:10}} formatter={(v,n)=>[v.toFixed(0),n==="infra"?"C·k (Infrastructure cost)":"W (Welfare loss)"]}/>
            <Bar dataKey="infra" stackId="s" name="C·k (Infrastructure cost)" fill="#64748b"/>
            <Bar dataKey="dmg" stackId="s" name="W (Welfare loss)" fill="#b91c1c"/>
            <Legend formatter={v=><span style={{color:"#1e293b",fontSize:9}}>{v}</span>} verticalAlign="bottom"/>
          </BarChart></ResponsiveContainer>
          {showNotes&&<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:5,marginTop:6,fontSize:10}}>
            <div style={{padding:"5px 7px",background:"#fff",borderRadius:4,borderLeft:`3px solid ${CL.A}`}}>
              <span style={{color:CL.A,fontWeight:700}}>H_A = {sim.burdenA.toFixed(0)}</span>
              <span style={{color:"#64748b"}}> = C·k {sim.infraA.toFixed(0)} + W {sim.dmgA.toFixed(0)}. Optimal.</span>
            </div>
            <div style={{padding:"5px 7px",background:"#fff",borderRadius:4,borderLeft:`3px solid ${CL.B}`}}>
              <span style={{color:CL.B,fontWeight:700}}>H_B = {sim.burdenB.toFixed(0)}</span>
              <span style={{color:"#64748b"}}> = C·k {sim.infraB.toFixed(0)} + W {sim.dmgB.toFixed(0)}. Pooled. W_B − W_A = {(sim.dmgB-sim.dmgA).toFixed(0)}.</span>
            </div>
            <div style={{padding:"5px 7px",background:"#fff",borderRadius:4,borderLeft:`3px solid ${CL.C}`}}>
              <span style={{color:CL.C,fontWeight:700}}>H_C = {sim.burdenC.toFixed(0)}</span>
              <span style={{color:"#64748b"}}> = C·k {sim.infraC.toFixed(0)} + W {sim.dmgC.toFixed(0)}. Underdeployed ({capCpct}%).</span>
            </div>
            <div style={{padding:"5px 7px",background:"#fff",borderRadius:4,borderLeft:`3px solid ${CL.D}`}}>
              <span style={{color:CL.D,fontWeight:700}}>H_D = {sim.burdenD.toFixed(0)}</span>
              <span style={{color:"#64748b"}}> = C·k {sim.infraD.toFixed(0)} + W {sim.dmgD.toFixed(0)}. Worst-case ({sla}).</span>
            </div>
          </div>}
        </div>)}

        {tab==="ab"&&(()=>{
          const eps=sim.epsAB;
          const rows=[...sim.typeRows].sort((a,b)=>a.theta-b.theta); // ascending θ: batch … gaming
          return(<div style={{background:"#f8fafc",borderRadius:6,padding:11}}>
          <div style={{fontSize:11,fontWeight:700,color:"#0f172a",marginBottom:2}}>Theorem 1: W_S {"<"} W_P — self-selection minimizes welfare loss</div>
          {showNotes&&<div style={{fontSize:10,color:"#475569",marginBottom:7,lineHeight:1.5}}>
            Pure reallocation: A and B deploy the SAME capacity, so the same total severity ε is shared out — separation only moves it across positions. Each client self-selects q*, receiving per-unit severity d(q*) (bars); pooling gives everyone ε (dashed line). High-θ types self-select to low-d(q*) positions, low-θ types to high — a negative pairing — so the θ-weighted sum W_S = Σ n·θ·d(q*) falls below W_P = ε·Σ n·θ. That gap is the rearrangement inequality.
          </div>}
          <ResponsiveContainer width="100%" height={250}><BarChart data={rows} margin={{top:10,right:64,left:8,bottom:24}}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/>
            <XAxis dataKey="type" tick={{fill:"#475569",fontSize:9}} label={{value:"client type  (low θ → high θ)",position:"insideBottom",offset:-12,style:{fill:"#64748b",fontSize:9}}}/>
            <YAxis tick={{fill:"#475569",fontSize:9}} label={{value:"per-unit severity",angle:-90,position:"insideLeft",style:{fill:"#64748b",fontSize:9}}}/>
            <Tooltip contentStyle={{background:"#fff",border:"1px solid #e2e8f0",borderRadius:5,fontSize:10}} formatter={(v)=>[v.toFixed(4),"d(q*)"]} labelFormatter={(t)=>{const r=rows.find(x=>x.type===t);return `${t}  (θ=${r?r.theta.toFixed(1):""}, q*=${r?r.q.toFixed(2):""})`;}}/>
            <Bar dataKey="d" name="d(q*) — self-selected severity">{rows.map(r=><Cell key={r.type} fill={tC[r.type]}/>)}</Bar>
            <ReferenceLine y={eps} stroke="#b91c1c" strokeWidth={1.5} strokeDasharray="6 3" label={{value:`pooled ε=${eps.toFixed(3)}`,position:"right",fill:"#b91c1c",fontSize:9}}/>
          </BarChart></ResponsiveContainer>
          <div style={{marginTop:6,padding:"6px 8px",background:"#fff",borderRadius:4,border:"1px solid #e2e8f0"}}>
            <div style={{fontSize:12,fontWeight:700,color:"#d97706",textAlign:"center"}}>W_S = {sim.dmgA.toFixed(0)} vs W_P = {sim.dmgB.toFixed(0)} — welfare-loss reduction {wRed}%</div>
            {showNotes&&<div style={{fontSize:10,color:"#475569",marginTop:5,lineHeight:1.6}}>
              Bars below the dashed ε line are the types that come out ahead under separation (high θ, low d(q*)); bars above absorb more severity but have low θ, so it costs little. A and B share capacity and infrastructure cost, so the {wRed}% reduction is pure allocation — and self-selection achieves the optimal pairing with no provider knowledge of θ.
            </div>}
          </div>
          </div>);})()}

        {tab==="curves"&&(()=>{
          const delta=sim.dqDelta;
          const thetaRef=sim.thetaRef; // population geometric-mean sensitivity (same θ_ref the engine solves with)
          const optQ=(th)=>{const v=0.5+Math.log(th/thetaRef)/(pExp+delta);return Math.max(0,Math.min(1,v));};
          const optPts=["gaming","webshop","office","batch"].map(t=>{const q=optQ(thetas[t]);return{type:t,q:Math.round(q*1000)/1000,price:Math.exp(pExp*q),theta:thetas[t]};});
          const clientPqPts={gaming:[],webshop:[],office:[],batch:[]};
          const step=Math.max(1,Math.floor(clients.length/200));
          for(let i=0;i<clients.length;i+=step){const c=clients[i];const q=optQ(c.theta);clientPqPts[c.type].push({q:Math.round(q*1000)/1000,price:Math.exp(pExp*q)});}
          return(<div style={{background:"#f8fafc",borderRadius:6,padding:11}}>
          <div style={{fontSize:11,fontWeight:700,color:"#0f172a",marginBottom:2}}>d(q) and p(q) — The Curves That Drive Self-Selection</div>
          {showNotes&&<div style={{fontSize:10,color:"#475569",marginBottom:10,lineHeight:1.5}}>
            d(q) is the provider's published <strong>convex contract</strong> — decreasing (front of queue = low severity) and convex by the diminishing returns of priority scheduling (Kleinrock). p(q) is increasing-convex (front = expensive). Each client minimizes h(θ,q) = p(q) + θ·d(q) by choosing q, so high-θ clients self-select to the front (low severity, high price) and low-θ to the back. The dots on the d(q) chart are the clients sitting on the curve at their solved positions d(q*); the same self-selection shows on p(q). q* = 0.5 + ln(θ/θ_ref)/(α+δ), calibrated so the median type sits at q=0.5. (The exponential is one convex form — any convex d(q) gives the same separation.)
          </div>}
          <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
            <div style={{flex:1,minWidth:280}}>
              <div style={{fontSize:10,fontWeight:600,color:"#0f172a",marginBottom:4}}>d(q) — Measured Severity &amp; Published Contract</div>
              <div style={{fontSize:9,color:"#64748b",marginBottom:4,lineHeight:1.45,minHeight:42}}>d(q) = E[v|q] is the expected violation severity, a fraction in [0,1] (0 = perfect, 1 = complete failure). Grey dots: the work-conserving DRR-measured severity at each queue position — the cloud the contract is fitted to (exponential fit δ = {sim.dqDelta.toFixed(2)}, <b>R² = {sim.r2!=null?sim.r2.toFixed(3):"—"}</b>). Red curve: the published contract d(q) = γ·e^(−δq) — the SLA <b>ceiling</b> — with δ measured from the scheduler and level mean-matched to ε. Coloured dots: clients at their self-selected q*, by type.</div>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart margin={{top:8,right:12,left:8,bottom:20}}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/>
                  <XAxis dataKey="q" type="number" domain={[0,1]} tick={{fill:"#475569",fontSize:9}} label={{value:"q (queue position)",position:"insideBottom",offset:-12,style:{fill:"#64748b",fontSize:9}}} allowDuplicatedCategory={false}/>
                  <YAxis domain={[0,1]} tick={{fill:"#475569",fontSize:9}} label={{value:"d(q) — severity (0–1)",angle:-90,position:"insideLeft",style:{fill:"#64748b",fontSize:9}}}/>
                  <Tooltip contentStyle={{background:"#fff",border:"1px solid #e2e8f0",borderRadius:5,fontSize:10}}/>
                  <ReferenceLine y={1} stroke="#b91c1c" strokeWidth={1} strokeDasharray="2 3" label={{value:"1 = complete failure",position:"insideTopRight",fill:"#b91c1c",fontSize:8}}/>
                  <Line data={sim.dqMeasured} dataKey="d" stroke="transparent" strokeWidth={0} isAnimationActive={false} name="DRR measured" dot={{r:2,fill:"#0f172a",fillOpacity:0.28}}/>
                  <Line data={sim.dqCurve} dataKey="d" stroke="#b91c1c" strokeWidth={2.5} dot={false} name="Published d(q) ceiling" type="monotone"/>
                  <Line data={sim.dqScatter} dataKey="d" stroke="transparent" strokeWidth={0} isAnimationActive={false} name="Clients (self-selected)" dot={(p)=>{const t=p.payload&&p.payload.type;return <circle key={p.index} cx={p.cx} cy={p.cy} r={2.6} fill={t?tC[t]:"#94a3b8"} fillOpacity={0.5}/>;}}/>
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div style={{flex:1,minWidth:280}}>
              <div style={{fontSize:10,fontWeight:600,color:"#0f172a",marginBottom:4}}>p(q) — Price Schedule &amp; Self-Selection</div>
              <div style={{fontSize:9,color:"#64748b",marginBottom:4,lineHeight:1.45,minHeight:42}}>Green line: the published price schedule p(q) = e^({pExp}·q). Coloured dots: where each client type self-selects — the solved optimal position q* for its sensitivity θ — with one faint dot per client and the large labelled dot at the type mean.</div>
              <ResponsiveContainer width="100%" height={250}>
                <ComposedChart data={pqCurveData} margin={{top:16,right:12,left:8,bottom:20}}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/>
                  <XAxis dataKey="q" type="number" domain={[0,1]} tick={{fill:"#475569",fontSize:9}} label={{value:"q (queue position)",position:"insideBottom",offset:-12,style:{fill:"#64748b",fontSize:9}}}/>
                  <YAxis tick={{fill:"#475569",fontSize:9}} label={{value:"p(q) relative",angle:-90,position:"insideLeft",style:{fill:"#64748b",fontSize:9}}}/>
                  <Tooltip contentStyle={{background:"#fff",border:"1px solid #e2e8f0",borderRadius:5,fontSize:10}}/>
                  <Line dataKey="price" stroke="#10b981" strokeWidth={2.5} dot={false} name={`e^(${pExp}·q)`} type="monotone"/>
                  <Line data={clientPqPts.batch} dataKey="price" stroke="transparent" strokeWidth={0} dot={{r:2,fill:"#64748b",fillOpacity:0.3}} isAnimationActive={false} name="Batch clients"/>
                  <Line data={clientPqPts.office} dataKey="price" stroke="transparent" strokeWidth={0} dot={{r:2,fill:"#0369a1",fillOpacity:0.3}} isAnimationActive={false} name="Office clients"/>
                  <Line data={clientPqPts.webshop} dataKey="price" stroke="transparent" strokeWidth={0} dot={{r:2,fill:"#b45309",fillOpacity:0.3}} isAnimationActive={false} name="Webshop clients"/>
                  <Line data={clientPqPts.gaming} dataKey="price" stroke="transparent" strokeWidth={0} dot={{r:2,fill:"#be185d",fillOpacity:0.3}} isAnimationActive={false} name="Gaming clients"/>
                  {optPts.map(p=><ReferenceLine key={`line-${p.type}`} segment={[{x:p.q,y:0},{x:p.q,y:p.price}]} stroke={tC[p.type]} strokeWidth={1.5} strokeDasharray="4 3" opacity={0.3}/>)}
                  {optPts.map(p=><ReferenceDot key={`dot-${p.type}`} x={p.q} y={p.price} r={6} fill={tC[p.type]} stroke="#fff" strokeWidth={2} label={{value:`${p.type.charAt(0).toUpperCase()}`,position:"top",fill:tC[p.type],fontSize:9,fontWeight:700,offset:8}}/>)}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
          {showNotes&&<div style={{marginTop:8,padding:"6px 8px",background:"#fff",borderRadius:4,border:"1px solid #e2e8f0",fontSize:10,color:"#475569",lineHeight:1.6}}>
            <div style={{marginBottom:4}}><strong>Self-selection positions:</strong> q* = 0.5 + ln(θ/θ_ref) / (α + δ), where α={pExp} (price exponent), δ={delta.toFixed(2)} (DRR-measured d(q) steepness), θ_ref={thetaRef.toFixed(2)} (geometric mean). Higher α or δ compresses the spread. Each type:</div>
            <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
              {optPts.map(p=><span key={p.type} style={{color:tC[p.type],fontWeight:600}}>{p.type} (θ={p.theta}): q*={p.q.toFixed(3)}, p(q*)={p.price.toFixed(2)}</span>)}
            </div>
            <div style={{marginTop:4}}>Small transparent dots show individual clients (θ varies ±30% within each type). The large dot is the type mean. Where type clusters overlap, clients are nearly indifferent between tiers. Move the price exponent slider to see how p(q) convexity compresses or spreads the positions.</div>
          </div>}
        </div>);})()}

        {tab==="infra"&&(<div style={{background:"#f8fafc",borderRadius:6,padding:11}}>
          <div style={{fontSize:11,fontWeight:700,color:"#0f172a",marginBottom:2}}>Infrastructure Cost Sensitivity — the Provider's Hardware ↔ Damage Tradeoff</div>
          {showNotes&&<div style={{fontSize:10,color:"#475569",marginBottom:10,lineHeight:1.5}}>
            The provider invests in capacity up to the point where one more unit of hardware cost (k) equals the customer damage that unit prevents (−dW/dC). Under the contractible menu this is also the <em>profit-maximizing</em> choice: publishing d(q) lets the provider charge for protection, so its marginal incentive matches the marginal customer damage ([1], §5.4). Capacity is only the instrument — the margin is the point. <strong>Left:</strong> the marginal balance; the provider sits where the damage curve meets k. <strong>Right:</strong> the resulting welfare loss W*(k) — as hardware cheapens (k→0) the provider provisions to peak and welfare loss vanishes.
          </div>}
          <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
            <div style={{flex:1,minWidth:280}}>
              <div style={{fontSize:10,fontWeight:600,color:"#0f172a",marginBottom:4}}>Marginal balance: hardware cost meets damage</div>
              <div style={{fontSize:9,color:"#64748b",marginBottom:4,lineHeight:1.45,minHeight:42}}>Each curve shows the marginal customer damage prevented by one more unit of capacity (−dW/dC), under the separated menu (green) and pooled (purple). The dashed line is the marginal hardware cost, k = {costK}. The provider buys capacity up to where a curve meets the line.</div>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={sim.margData} margin={{top:22,right:44,left:8,bottom:20}}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/>
                  <XAxis dataKey="pct" type="number" domain={[55,100]} tick={{fill:"#475569",fontSize:9}} label={{value:"reliability investment (capacity % of peak)",position:"insideBottom",offset:-12,style:{fill:"#64748b",fontSize:9}}}/>
                  <YAxis tick={{fill:"#475569",fontSize:9}} label={{value:"$ per unit capacity",angle:-90,position:"insideLeft",style:{fill:"#64748b",fontSize:9}}}/>
                  <Tooltip contentStyle={{background:"#fff",border:"1px solid #e2e8f0",borderRadius:5,fontSize:10}} labelFormatter={v=>`capacity ${v}%`}/>
                  <Line dataKey="mSep" stroke={CL.A} strokeWidth={2.5} dot={false} name="−dW/dC (separated menu)" type="monotone"/>
                  <Line dataKey="mPool" stroke={CL.B} strokeWidth={2} dot={false} name="−dW/dC (pooled)" type="monotone"/>
                  <ReferenceLine y={costK} stroke="#0f172a" strokeWidth={1.5} strokeDasharray="6 3" label={{value:`k=${costK}`,position:"right",fill:"#0f172a",fontSize:9}}/>
                  <ReferenceLine x={sim.optWfq.pct} stroke={CL.A} strokeWidth={1.5} strokeDasharray="4 3" opacity={0.5} label={{value:`C*=${sim.optWfq.pct}%`,position:"top",fill:CL.A,fontSize:9}}/>
                  <Legend formatter={v=><span style={{color:"#1e293b",fontSize:9}}>{v}</span>}/>
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div style={{flex:1,minWidth:280}}>
              <div style={{fontSize:10,fontWeight:600,color:"#0f172a",marginBottom:4}}>Consequence: welfare loss vs hardware cost</div>
              <div style={{fontSize:9,color:"#64748b",marginBottom:4,lineHeight:1.45,minHeight:42}}>Welfare loss W*(k) at the provider's profit-maximizing capacity, as the hardware cost k sweeps from cheap to dear. When hardware is cheap (k→0) it provisions to peak and W*→0; as hardware gets expensive it economizes, accepting more low-θ damage, so W* rises.</div>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={sim.kSweep} margin={{top:22,right:18,left:8,bottom:20}}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/>
                  <XAxis dataKey="k" type="number" domain={[0,50]} tick={{fill:"#475569",fontSize:9}} label={{value:"infrastructure cost k",position:"insideBottom",offset:-12,style:{fill:"#64748b",fontSize:9}}}/>
                  <YAxis tick={{fill:"#475569",fontSize:9}} label={{value:"welfare loss W*",angle:-90,position:"insideLeft",style:{fill:"#64748b",fontSize:9}}}/>
                  <Tooltip contentStyle={{background:"#fff",border:"1px solid #e2e8f0",borderRadius:5,fontSize:10}} labelFormatter={v=>`k = ${v}`}/>
                  <Line dataKey="Wsep" stroke={CL.A} strokeWidth={2.5} dot={false} name="W* (welfare loss at optimal capacity)" type="monotone"/>
                  <ReferenceLine x={costK} stroke="#0f172a" strokeWidth={1.5} strokeDasharray="6 3" label={{value:`k=${costK}`,position:"top",fill:"#0f172a",fontSize:9}}/>
                  <Legend formatter={v=><span style={{color:"#1e293b",fontSize:9}}>{v}</span>}/>
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
          {showNotes&&<div style={{marginTop:8,padding:"6px 8px",background:"#fff",borderRadius:4,border:"1px solid #e2e8f0",fontSize:10,color:"#475569",lineHeight:1.6}}>
            At k = {costK}, the provider's welfare-optimal capacity is {sim.optWfq.pct}% of peak with the separated menu vs {sim.optPool.pct}% under pooling — the separated menu runs leaner because the damage it accepts falls on low-θ clients. The contractible d(q) is what makes "marginal hardware cost = marginal customer damage" the profit-maximizing margin; full competitive equilibrium and the formal k–curvature relationship are left open ([1], §7.5, §7.8).
          </div>}
        </div>)}

        {tab==="types"&&(<div style={{background:"#f8fafc",borderRadius:6,padding:11}}>
          <div style={{fontSize:11,fontWeight:700,color:"#0f172a",marginBottom:2}}>Per-Type Client Burden h(θ,q) Breakdown</div>
          {showNotes&&<div style={{fontSize:10,color:"#475569",marginBottom:7,lineHeight:1.5}}>
            Each card decomposes burden into price (dark bar, share of C·k) and damage (coloured bar, θ·d·work). Under A, high-θ types pay more but suffer less damage. "A vs B" at each card's bottom shows the separation gain — all types should benefit, confirming incentive compatibility.
          </div>}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:6}}>
            {["gaming","webshop","office","batch"].map(t=>{
              const rows=[["A",sim.tbA,CL.A],["B",sim.tbB,CL.B],["C",sim.tbC,CL.C],["D",sim.tbD,CL.D]];
              return(<div key={t} style={{background:"#ffffff",borderRadius:5,padding:8,borderTop:`3px solid ${tC[t]}`}}>
                <div style={{fontSize:11,fontWeight:700,color:tC[t],marginBottom:6,textTransform:"capitalize"}}>{t} (θ={thetas[t]})</div>
                {rows.map(([sc,tb,col])=>{
                  const total=tb[t].price+tb[t].dmg;
                  return(<div key={sc} style={{marginBottom:3}}>
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:10}}>
                      <span style={{color:col,fontWeight:600}}>{sc}</span>
                      <span style={{color:"#1e293b",fontFamily:"monospace",fontSize:10}}>{total.toFixed(0)}</span>
                    </div>
                    <div style={{display:"flex",gap:2,height:4,borderRadius:2,overflow:"hidden",background:"#f8fafc"}}>
                      <div style={{width:`${total>0?tb[t].price/total*100:50}%`,background:"#475569"}}/>
                      <div style={{flex:1,background:col,opacity:0.6}}/>
                    </div>
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:8,color:"#94a3b8"}}>
                      <span>p(q)·work: {tb[t].price.toFixed(0)}</span><span>θ·d(q)·work: {tb[t].dmg.toFixed(0)}</span>
                    </div>
                  </div>);
                })}
                <div style={{borderTop:"1px solid #e2e8f0",marginTop:4,paddingTop:3,fontSize:10}}>
                  {(()=>{const bA=sim.tbA[t].price+sim.tbA[t].dmg,bB=sim.tbB[t].price+sim.tbB[t].dmg;
                    const diff=bB-bA,pct=bB>0?(diff/bB*100).toFixed(1):"0";
                    return<span style={{color:diff>0?"#10b981":"#ef4444",fontWeight:600}}>A vs B: {diff>0?"+":""}{pct}%</span>})()}
                </div>
              </div>);
            })}
          </div>
        </div>)}
      </div>
    </div>
  </div></div>);
}
