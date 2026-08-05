import { useState, useMemo, useCallback } from "react";
import { Area, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ComposedChart, ReferenceLine, ReferenceDot, Cell, Scatter, ScatterChart, ZAxis } from "recharts";

// The model itself lives in ./engine.js — pure functions with no React or DOM dependency, shared
// verbatim with the invariant tests (test/engine.test.mjs) and the parameter sweep
// (scripts/sweep.mjs). This file is presentation only: sliders in, charts out.
import { gen, runSim, DEFAULTS } from "./engine.js";

const fH=h=>{const hh=((Math.floor(h)%24)+24)%24,mm=Math.round((h%1)*60);return`${hh}:${mm.toString().padStart(2,'0')}`};

const Sl=({label,value,onChange,min,max,step,color})=>(<div style={{marginBottom:3}}><div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:color||"#94a3b8"}}><span>{label}</span><span style={{color:"#1e293b",fontFamily:"monospace",fontSize:10}}>{typeof value==="number"&&value%1!==0?value.toFixed(1):value}</span></div><input type="range" min={min} max={max} step={step} value={value} onChange={e=>onChange(Number(e.target.value))} style={{width:"100%",accentColor:color||"#6366f1",height:3}}/></div>);
const St=({label,value,color="#e2e8f0",sub})=>(<div style={{background:"#f8fafc",borderRadius:5,padding:"4px 6px",flex:1,minWidth:75}}><div style={{fontSize:7,color:"#94a3b8",textTransform:"uppercase",letterSpacing:0.6}}>{label}</div><div style={{fontSize:12,fontWeight:700,color,fontFamily:"monospace"}}>{value}</div>{sub&&<div style={{fontSize:7,color:"#94a3b8"}}>{sub}</div>}</div>);
const Tb=({active,onClick,children})=>(<button onClick={onClick} style={{padding:"4px 9px",fontSize:10,cursor:"pointer",fontWeight:active?700:400,background:active?"#6366f1":"transparent",color:active?"#fff":"#94a3b8",border:`1px solid ${active?"#6366f1":"#cbd5e1"}`,borderRadius:4}}>{children}</button>);
const CL={A:"#047857",B:"#6d28d9",C:"#b91c1c",D:"#1d4ed8"};
const tC={gaming:"#be185d",webshop:"#b45309",office:"#0369a1",batch:"#334155"};

export default function App(){
  // Every slider starts from DEFAULTS in engine.js, the same base case the tests and sweeps use.
  const[ratios,setRatios]=useState(DEFAULTS.ratios);
  const[thetas,setThetas]=useState(DEFAULTS.thetas);
  const[peakMins,setPeakMins]=useState(DEFAULTS.peakMins);
  const[peakMaxs,setPeakMaxs]=useState(DEFAULTS.peakMaxs);
  const[sigmas,setSigmas]=useState(DEFAULTS.sigmas);
  const[sla,setSla]=useState(DEFAULTS.sla);
  const[costK,setCostK]=useState(DEFAULTS.costK);
  const[capABpct,setCapABpct]=useState(DEFAULTS.capABpct);
  const[capCpct,setCapCpct]=useState(DEFAULTS.capCpct);
  const[beta,setBeta]=useState(DEFAULTS.beta);
  const[wMin,setWMin]=useState(DEFAULTS.wMin);
  const[seed,setSeed]=useState(DEFAULTS.seed);
  const[pExp,setPExp]=useState(DEFAULTS.pExp);
  const[showNotes,setShowNotes]=useState(true);
  const[tab,setTab]=useState("load");
  const sR=useCallback((k,v)=>setRatios(p=>({...p,[k]:v})),[]);
  const sT=useCallback((k,v)=>setThetas(p=>({...p,[k]:v})),[]);
  const sPn=useCallback((k,v)=>setPeakMins(p=>({...p,[k]:v})),[]);
  const sPx=useCallback((k,v)=>setPeakMaxs(p=>({...p,[k]:v})),[]);
  const sS=useCallback((k,v)=>setSigmas(p=>({...p,[k]:v})),[]);

  const clients=useMemo(()=>gen(DEFAULTS.n,ratios,thetas,peakMins,peakMaxs,sigmas,seed),[ratios,thetas,peakMins,peakMaxs,sigmas,seed]);
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
          {/* Chart headings describe what is plotted; the interpretation belongs to the reader (and
              to the paper), not to the axis furniture. */}
          <div style={{fontSize:11,fontWeight:700,color:"#0f172a",marginBottom:2}}>Per-unit severity d(q*) at self-selected positions, against the pooled level ε</div>
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
          <div style={{fontSize:11,fontWeight:700,color:"#0f172a",marginBottom:2}}>d(q) and p(q): measured severity, published contract, and self-selected positions</div>
          {showNotes&&<div style={{fontSize:10,color:"#475569",marginBottom:10,lineHeight:1.5}}>
            d(q) is the provider's published <strong>convex contract</strong> — decreasing (front of queue = low severity) and convex by the diminishing returns of priority scheduling (Kleinrock). p(q) is increasing-convex (front = expensive). Each client minimizes h(θ,q) = p(q) + θ·d(q) by choosing q, so high-θ clients self-select to the front (low severity, high price) and low-θ to the back. The dots on the d(q) chart are the clients sitting on the curve at their solved positions d(q*); the same self-selection shows on p(q). q* = 0.5 + ln(θ/θ_ref)/(α+δ), calibrated so the median type sits at q=0.5. (The exponential is one convex form — any convex d(q) gives the same separation.)
          </div>}
          <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
            <div style={{flex:1,minWidth:280}}>
              <div style={{fontSize:10,fontWeight:600,color:"#0f172a",marginBottom:4}}>d(q) — Measured Severity &amp; Published Contract</div>
              {showNotes&&<div style={{fontSize:9,color:"#64748b",marginBottom:4,lineHeight:1.45,minHeight:42}}>d(q) = E[v|q] is the expected violation severity, a fraction in [0,1] (0 = perfect, 1 = complete failure). Grey dots: the work-conserving DRR-measured severity at each queue position — the cloud the contract is fitted to (exponential fit δ = {sim.dqDelta.toFixed(2)}, <b>R² = {sim.r2!=null?sim.r2.toFixed(3):"—"}</b>). Red curve: the published contract d(q) = γ·e^(−δq) — the SLA <b>ceiling</b> — with δ measured from the scheduler and level mean-matched to ε. Coloured dots: clients at their self-selected q*, by type.</div>}
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
              {showNotes&&<div style={{fontSize:9,color:"#64748b",marginBottom:4,lineHeight:1.45,minHeight:42}}>Green line: the published price schedule p(q) = e^({pExp}·q). Coloured dots: where each client type self-selects — the solved optimal position q* for its sensitivity θ — with one faint dot per client and the large labelled dot at the type mean.</div>}
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
          <div style={{fontSize:11,fontWeight:700,color:"#0f172a",marginBottom:2}}>Infrastructure cost sensitivity: marginal damage prevented against marginal capacity cost</div>
          {showNotes&&<div style={{fontSize:10,color:"#475569",marginBottom:10,lineHeight:1.5}}>
            The provider invests in capacity up to the point where one more unit of hardware cost (k) equals the customer damage that unit prevents (−dW/dC). Under the contractible menu this is also the <em>profit-maximizing</em> choice: publishing d(q) lets the provider charge for protection, so its marginal incentive matches the marginal customer damage ([1], §5.4). Capacity is only the instrument — the margin is the point. <strong>Left:</strong> the marginal balance; the provider sits where the damage curve meets k. <strong>Right:</strong> the resulting welfare loss W*(k) — as hardware cheapens (k→0) the provider provisions to peak and welfare loss vanishes.
          </div>}
          <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
            <div style={{flex:1,minWidth:280}}>
              <div style={{fontSize:10,fontWeight:600,color:"#0f172a",marginBottom:4}}>Marginal damage prevented per unit of capacity (−dW/dC) and the unit cost k</div>
              {showNotes&&<div style={{fontSize:9,color:"#64748b",marginBottom:4,lineHeight:1.45,minHeight:42}}>Each curve shows the marginal customer damage prevented by one more unit of capacity (−dW/dC), under the separated menu (green) and pooled (purple). The dashed line is the marginal hardware cost, k = {costK}. The provider buys capacity up to where a curve meets the line.</div>}
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
              <div style={{fontSize:10,fontWeight:600,color:"#0f172a",marginBottom:4}}>Welfare loss at the provider&apos;s chosen capacity, W*(k)</div>
              {showNotes&&<div style={{fontSize:9,color:"#64748b",marginBottom:4,lineHeight:1.45,minHeight:42}}>Welfare loss W*(k) at the provider's profit-maximizing capacity, as the hardware cost k sweeps from cheap to dear. When hardware is cheap (k→0) it provisions to peak and W*→0; as hardware gets expensive it economizes, accepting more low-θ damage, so W* rises.</div>}
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
