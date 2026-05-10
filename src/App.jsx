import { useState, useMemo, useCallback } from "react";
import { Area, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ComposedChart, ReferenceLine, ReferenceDot } from "recharts";

function mulberry32(a){return function(){let t=a+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296}}
const SLOTS=96,slotToHour=s=>s/4,hourToSlot=h=>{let s=Math.round(h*4);if(s<0)s+=SLOTS;if(s>=SLOTS)s-=SLOTS;return s};
const fH=h=>{const hh=((Math.floor(h)%24)+24)%24,mm=Math.round((h%1)*60);return`${hh}:${mm.toString().padStart(2,'0')}`};

// Default visual p(q) curve exponent — now a slider. INDEPENDENT of the
// scheduling β slider. Used only for the displayed price curve, NOT for
// the simulation's burden math (non-profit pass-through model).
const P_VISUAL_EXPONENT_DEFAULT = 3;

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

function runPriority(clients,totalLoad,clientQ,cap,beta){
  // Weighted fair queuing: capacity allocated proportional to e^(beta*q)
  const sev=clients.map(()=>new Float64Array(SLOTS));
  const n=clients.length;
  const weights=clientQ.map(q=>Math.exp(beta*q));
  for(let s=0;s<SLOTS;s++){
    if(totalLoad[s]<=cap)continue;
    const demand=new Float64Array(n);
    for(let i=0;i<n;i++)demand[i]=clients[i].workload[s];
    const alloc=new Float64Array(n);
    const active=new Uint8Array(n).fill(1);
    let remaining=cap;
    for(let round=0;round<5&&remaining>0.001;round++){
      let totalW=0;
      for(let i=0;i<n;i++)if(active[i]&&demand[i]>alloc[i])totalW+=weights[i];
      if(totalW<=0)break;
      let leftover=0;
      for(let i=0;i<n;i++){
        if(!active[i]||demand[i]<=alloc[i])continue;
        const share=remaining*weights[i]/totalW;
        const needed=demand[i]-alloc[i];
        if(share>=needed){alloc[i]=demand[i];leftover+=share-needed;active[i]=0;}
        else{alloc[i]+=share;}
      }
      remaining=leftover;
    }
    for(let i=0;i<n;i++){if(demand[i]>0)sev[i][s]=Math.max(0,(demand[i]-alloc[i])/demand[i]);}
  }
  return sev;
}

function runEqual(clients,totalLoad,cap){
  const sev=clients.map(()=>new Float64Array(SLOTS));
  for(let s=0;s<SLOTS;s++){if(totalLoad[s]<=cap)continue;const fr=Math.min(1,(totalLoad[s]-cap)/totalLoad[s]);for(let i=0;i<clients.length;i++)sev[i][s]=fr;}
  return sev;
}

function totalDamage(clients,sev){
  let dmg=0;
  clients.forEach((c,i)=>{let ss=0;for(let s=0;s<SLOTS;s++)ss+=sev[i][s]*c.workload[s];dmg+=c.theta*ss;});
  return dmg;
}

// Average severity across all work (for SLA compliance check)
function avgSeverity(clients,sev,totalLoad,cap){
  let totalSev=0,totalW=0;
  for(let s=0;s<SLOTS;s++){
    const fr=totalLoad[s]>cap?Math.min(1,(totalLoad[s]-cap)/totalLoad[s]):0;
    for(const c of clients){totalSev+=fr*c.workload[s];totalW+=c.workload[s];}
  }
  return totalW>0?totalSev/totalW:0;
}

function maxSlotSeverity(totalLoad,cap){
  let mx=0;
  for(let s=0;s<SLOTS;s++){if(totalLoad[s]>cap){const fr=Math.min(1,(totalLoad[s]-cap)/totalLoad[s]);if(fr>mx)mx=fr;}}
  return mx;
}

function typeSeverity(clients,sev,tLoad){
  const ts={batch:new Float64Array(SLOTS),gaming:new Float64Array(SLOTS),webshop:new Float64Array(SLOTS),office:new Float64Array(SLOTS)};
  for(let s=0;s<SLOTS;s++){clients.forEach((c,i)=>{ts[c.type][s]+=sev[i][s]*c.workload[s];});for(const t of["batch","gaming","webshop","office"]){if(tLoad[t][s]>0)ts[t][s]/=tLoad[t][s];}}
  return ts;
}

function typeBreakdown(clients,sev,unitPrice){
  const tw={batch:{price:0,dmg:0},gaming:{price:0,dmg:0},webshop:{price:0,dmg:0},office:{price:0,dmg:0}};
  clients.forEach((c,i)=>{let ss=0;for(let s=0;s<SLOTS;s++)ss+=sev[i][s]*c.workload[s];tw[c.type].price+=c.totalWork*unitPrice;tw[c.type].dmg+=c.theta*ss;});
  return tw;
}

function fitExp(qs,sevs){const pts=[];for(let i=0;i<qs.length;i++)if(sevs[i]>1e-10)pts.push({x:qs[i],y:sevs[i]});if(pts.length<2)return{gamma:0.5,delta:2};let sx=0,sy=0,sxx=0,sxy=0,n=pts.length;for(const p of pts){const ly=Math.log(p.y);sx+=p.x;sy+=ly;sxx+=p.x*p.x;sxy+=p.x*ly;}const den=n*sxx-sx*sx;if(Math.abs(den)<1e-12)return{gamma:0.5,delta:2};const slope=(n*sxy-sx*sy)/den,intercept=(sy-slope*sx)/n;const delta=-slope;return{gamma:Math.exp(intercept),delta:delta>0?delta:2};}

function runSim(clients,slaKey,costK,capCpct,beta){
  const slaViolBudget={"99.9%":0.001,"99.99%":0.0001,"99.999%":0.00001}[slaKey]||0.0001;

  const totalLoad=new Float64Array(SLOTS);
  const tLoad={batch:new Float64Array(SLOTS),gaming:new Float64Array(SLOTS),webshop:new Float64Array(SLOTS),office:new Float64Array(SLOTS)};
  clients.forEach(c=>{for(let s=0;s<SLOTS;s++){totalLoad[s]+=c.workload[s];tLoad[c.type][s]+=c.workload[s]}});
  const peak=Math.max(...totalLoad);
  
  const totalWorkAll=clients.reduce((s,c)=>s+c.totalWork,0);

  const thetaMax=Math.max(...clients.map(c=>c.theta)),thetaMin=Math.min(...clients.map(c=>c.theta));
  const clientQ=clients.map(c=>thetaMax>thetaMin?(c.theta-thetaMin)/(thetaMax-thetaMin):0.5);

  // === SCENARIO A: Optimize capacity for min burden with priority ===
  let bestCapA=peak,bestBurdenA=Infinity;
  for(let pct=5;pct<=100;pct++){
    const testCap=peak*pct/100;
    const sev=runPriority(clients,totalLoad,clientQ,testCap,beta);
    const dmg=totalDamage(clients,sev);
    const burden=testCap*costK+dmg;
    if(burden<bestBurdenA){bestBurdenA=burden;bestCapA=testCap;}
  }
  // Fine search
  const lo2=Math.max(peak*0.01,bestCapA-peak*0.02),hi2=Math.min(peak*1.01,bestCapA+peak*0.02);
  for(let i=0;i<=30;i++){
    const testCap=lo2+(hi2-lo2)*i/30;
    const sev=runPriority(clients,totalLoad,clientQ,testCap,beta);
    const dmg=totalDamage(clients,sev);
    const burden=testCap*costK+dmg;
    if(burden<bestBurdenA){bestBurdenA=burden;bestCapA=testCap;}
  }
  const capA=bestCapA;
  const sevA=runPriority(clients,totalLoad,clientQ,capA,beta);
  const dmgA=totalDamage(clients,sevA);
  const infraA=capA*costK;

  // === SCENARIO B: Same capacity as A, equal treatment ===
  const capB=capA;
  const sevB=runEqual(clients,totalLoad,capB);
  const dmgB=totalDamage(clients,sevB);
  const infraB=capB*costK;

  // === SCENARIO C: Slider — capacity at X% of peak, equal treatment ===
  const capC=peak*capCpct/100;
  const sevC=runEqual(clients,totalLoad,capC);
  const dmgC=totalDamage(clients,sevC);
  const infraC=capC*costK;

  // === SCENARIO D: Honest per-window SLA, equal treatment — expensive reference ===
  let dLo=peak*0.5,dHi=peak*1.01;
  for(let iter=0;iter<40;iter++){
    const mid=(dLo+dHi)/2;
    if(maxSlotSeverity(totalLoad,mid)<=slaViolBudget)dHi=mid; else dLo=mid;
  }
  const capD=dHi;
  const sevD=runEqual(clients,totalLoad,capD);
  const dmgD=totalDamage(clients,sevD);
  const infraD=capD*costK;

  // Unit prices
  const upA=infraA/totalWorkAll;
  const upB=infraB/totalWorkAll;
  const upC=infraC/totalWorkAll;
  const upD=infraD/totalWorkAll;

  // Type severities
  const tsA=typeSeverity(clients,sevA,tLoad);
  const tsB=typeSeverity(clients,sevB,tLoad);
  const tsC=typeSeverity(clients,sevC,tLoad);
  const tsD=typeSeverity(clients,sevD,tLoad);

  // Type breakdowns
  const tbA=typeBreakdown(clients,sevA,upA);
  const tbB=typeBreakdown(clients,sevB,upB);
  const tbC=typeBreakdown(clients,sevC,upC);
  const tbD=typeBreakdown(clients,sevD,upD);

  // Actual average severity for SLA display
  const avgSevC=avgSeverity(clients,sevC,totalLoad,capC);const maxSevC=maxSlotSeverity(totalLoad,capC);
  const avgSevD=avgSeverity(clients,sevD,totalLoad,capD);const maxSevD=maxSlotSeverity(totalLoad,capD);

  // Client queue positions and empirical d(q)
  const clientAvgSevA=clients.map((c,i)=>{
    let ss=0,tw=0;for(let s=0;s<SLOTS;s++){ss+=sevA[i][s]*c.workload[s];tw+=c.workload[s];}return tw>0?ss/tw:0;
  });
  const dqFit=fitExp(clientQ,clientAvgSevA);
  const dqCurveData=[];for(let qi=0;qi<=100;qi++){const q=qi/100;dqCurveData.push({q,fitted:dqFit.gamma*Math.exp(-dqFit.delta*q)});}
  const dqScatter=[];const dqStep=Math.max(1,Math.floor(clients.length/200));
  for(let i=0;i<clients.length;i+=dqStep)dqScatter.push({q:Math.round(clientQ[i]*1000)/1000,severity:Math.round(clientAvgSevA[i]*10000)/10000,type:clients[i].type});
  // Chart data
  const loadData=[],sevData=[];
  for(let s=0;s<SLOTS;s++){
    const h=slotToHour(s);
    loadData.push({hour:h,batch:tLoad.batch[s],office:tLoad.office[s],webshop:tLoad.webshop[s],gaming:tLoad.gaming[s],capA,capC,capD});
    sevData.push({hour:h,
      gaming_A:tsA.gaming[s],gaming_B:tsB.gaming[s],gaming_C:tsC.gaming[s],gaming_D:tsD.gaming[s],
      webshop_A:tsA.webshop[s],webshop_B:tsB.webshop[s],
      batch_A:tsA.batch[s],batch_B:tsB.batch[s],batch_D:tsD.batch[s],
      office_A:tsA.office[s],office_B:tsB.office[s],
    });
  }
  const tc={batch:0,gaming:0,webshop:0,office:0};
  clients.forEach(c=>tc[c.type]++);

  return{loadData,sevData,dqScatter,dqCurveData,dqFit,capA,capB,capC,capD,peak,
    infraA,infraB,infraC,infraD,dmgA,dmgB,dmgC,dmgD,
    burdenA:infraA+dmgA,burdenB:infraB+dmgB,burdenC:infraC+dmgC,burdenD:infraD+dmgD,
    upA,upB,upC,upD,
    tbA,tbB,tbC,tbD,
    tsA,tsB,tsC,tsD,
    actualSlaD:(1-avgSevD)*100,maxSevD,maxSevC,avgSevC,
    tc,totalWorkAll};
}

const Sl=({label,value,onChange,min,max,step,color})=>(<div style={{marginBottom:3}}><div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:color||"#94a3b8"}}><span>{label}</span><span style={{color:"#1e293b",fontFamily:"monospace",fontSize:10}}>{typeof value==="number"&&value%1!==0?value.toFixed(1):value}</span></div><input type="range" min={min} max={max} step={step} value={value} onChange={e=>onChange(Number(e.target.value))} style={{width:"100%",accentColor:color||"#6366f1",height:3}}/></div>);
const St=({label,value,color="#e2e8f0",sub})=>(<div style={{background:"#f8fafc",borderRadius:5,padding:"4px 6px",flex:1,minWidth:75}}><div style={{fontSize:7,color:"#94a3b8",textTransform:"uppercase",letterSpacing:0.6}}>{label}</div><div style={{fontSize:12,fontWeight:700,color,fontFamily:"monospace"}}>{value}</div>{sub&&<div style={{fontSize:7,color:"#94a3b8"}}>{sub}</div>}</div>);
const Tb=({active,onClick,children})=>(<button onClick={onClick} style={{padding:"4px 9px",fontSize:10,cursor:"pointer",fontWeight:active?700:400,background:active?"#6366f1":"transparent",color:active?"#fff":"#94a3b8",border:`1px solid ${active?"#6366f1":"#cbd5e1"}`,borderRadius:4}}>{children}</button>);
const CL={A:"#10b981",B:"#a78bfa",C:"#ef4444",D:"#3b82f6"};
const tC={gaming:"#f472b6",webshop:"#f59e0b",office:"#38bdf8",batch:"#64748b"};

export default function App(){
  const[ratios,setRatios]=useState({batch:25,gaming:25,webshop:30,office:20});
  const[thetas,setThetas]=useState({batch:1,gaming:12,webshop:7,office:3});
  const[peakMins,setPeakMins]=useState({batch:22,gaming:20,webshop:14,office:9});
  const[peakMaxs,setPeakMaxs]=useState({batch:6,gaming:22,webshop:21,office:17});
  const[sigmas,setSigmas]=useState({batch:3.5,gaming:1.5,webshop:1,office:4});
  const[sla,setSla]=useState("99.99%");
  const[costK,setCostK]=useState(12);
  const[capCpct,setCapCpct]=useState(85);
  const[beta,setBeta]=useState(3);
  const[seed,setSeed]=useState(42);
  const[pExp,setPExp]=useState(P_VISUAL_EXPONENT_DEFAULT);
  const[showNotes,setShowNotes]=useState(true);
  const[tab,setTab]=useState("load");
  const sR=useCallback((k,v)=>setRatios(p=>({...p,[k]:v})),[]);
  const sT=useCallback((k,v)=>setThetas(p=>({...p,[k]:v})),[]);
  const sPn=useCallback((k,v)=>setPeakMins(p=>({...p,[k]:v})),[]);
  const sPx=useCallback((k,v)=>setPeakMaxs(p=>({...p,[k]:v})),[]);
  const sS=useCallback((k,v)=>setSigmas(p=>({...p,[k]:v})),[]);

  const clients=useMemo(()=>gen(1000,ratios,thetas,peakMins,peakMaxs,sigmas,seed),[ratios,thetas,peakMins,peakMaxs,sigmas,seed]);
  const sim=useMemo(()=>runSim(clients,sla,costK,capCpct,beta),[clients,sla,costK,capCpct,beta]);
  const pqCurveData=useMemo(()=>{const d=[];for(let qi=0;qi<=100;qi++){const q=qi/100;d.push({q,price:Math.exp(pExp*q)});}return d;},[pExp]);

  const pAB=sim.burdenB>0?((sim.burdenB-sim.burdenA)/sim.burdenB*100).toFixed(1):"0";
  const pAC=sim.burdenC>0?((sim.burdenC-sim.burdenA)/sim.burdenC*100).toFixed(1):"0";
  const pAD=sim.burdenD>0?((sim.burdenD-sim.burdenA)/sim.burdenD*100).toFixed(1):"0";
  const cm={top:8,right:16,left:8,bottom:4};

  return(<div style={{background:"#ffffff",color:"#1e293b",minHeight:"100vh",fontFamily:"'IBM Plex Sans',system-ui,sans-serif",padding:14}}>
  <div style={{maxWidth:1280,margin:"0 auto"}}>
    <div style={{marginBottom:10,borderBottom:"1px solid #e2e8f0",paddingBottom:8}}>
      <h1 style={{fontSize:18,fontWeight:800,margin:0,color:"#0f172a"}}>Queue-Position SLA Simulator</h1>
      <p style={{fontSize:11,color:"#94a3b8",margin:"2px 0 0"}}>1000 clients · Non-profit provider · Scenario A minimizes total social cost H = C·k + W, where W = Σ θᵢ·d(qᵢ) is the welfare loss (aggregate damage) and C·k is infrastructure cost</p>
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
          <div style={{fontSize:9,color:CL.C,fontWeight:700,textTransform:"uppercase",letterSpacing:1,marginBottom:4}}>C: Cut Infrastructure</div>
          <Sl label={`Capacity: ${capCpct}% of peak`} value={capCpct} onChange={setCapCpct} min={50} max={100} step={1} color={CL.C}/>
          <div style={{fontSize:9,color:"#64748b",marginTop:2}}>Slide left to see what happens when the provider cuts corners. Peak severity: {sim.maxSevC?sim.maxSevC.toFixed(3):"0"}</div>
        </div>
        <div style={{background:"#f8fafc",borderRadius:6,padding:8,marginBottom:5,border:"1px solid #e2e8f0"}}>
          <div style={{fontSize:9,color:CL.D,fontWeight:700,textTransform:"uppercase",letterSpacing:1,marginBottom:4}}>D: Honest SLA Target</div>
          {["99.9%","99.99%","99.999%"].map(k=>(<button key={k} onClick={()=>setSla(k)} style={{display:"block",width:"100%",textAlign:"left",padding:"3px 6px",marginBottom:2,background:sla===k?"#dbeafe":"transparent",border:sla===k?"1px solid "+CL.D:"1px solid transparent",borderRadius:4,cursor:"pointer",color:sla===k?"#1e40af":"#64748b",fontSize:11}}>{k}</button>))}
          <div style={{fontSize:9,color:"#64748b",marginTop:2}}>D provisions so every 15-min window individually meets this.</div>
        </div>
        <div style={{background:"#f8fafc",borderRadius:6,padding:8,marginBottom:5,border:"1px solid #e2e8f0"}}>
          <Sl label="Infrastructure cost (k)" value={costK} onChange={setCostK} min={1} max={50} step={1}/>
          <Sl label={`Scheduling β: ${beta} (front/back ratio ${Math.exp(beta).toFixed(0)}:1)`} value={beta} onChange={setBeta} min={1} max={8} step={0.5} color={CL.A}/>
          <Sl label={`Price exponent: ${pExp} (p(q) = e^(${pExp}·q))`} value={pExp} onChange={setPExp} min={1} max={8} step={0.5} color="#10b981"/>
          <Sl label="Population seed" value={seed} onChange={setSeed} min={1} max={100} step={1}/>
          <div style={{fontSize:9,color:"#64748b",marginTop:2}}>k: infrastructure-to-damage conversion ratio (marginal cost of one unit of capacity in the same units as θ-weighted damage). β: WFQ aggressiveness (steeper d(q)). Price exponent α: convexity of the illustrative p(q) = e^(α·q) curve.</div>
        </div>
        <div style={{background:"#f8fafc",borderRadius:6,padding:8,border:"1px solid #e2e8f0"}}>
          <div style={{fontSize:9,fontWeight:700,letterSpacing:1,marginBottom:3,color:"#64748b"}}>SCENARIOS</div>
          <div style={{fontSize:10,lineHeight:1.7,color:"#475569"}}>
            <span style={{color:CL.A}}>■ A:</span> Separated menu (WFQ β={beta})<br/>
            <span style={{color:CL.B}}>■ B:</span> Pooled, A's capacity<br/>
            <span style={{color:CL.C}}>■ C:</span> Pooled, {capCpct}% of peak<br/>
            <span style={{color:CL.D}}>■ D:</span> Pooled, honest {sla}
          </div>
        </div>
      </div>

      <div style={{flex:1,minWidth:0}}>
        <div style={{display:"flex",gap:3,marginBottom:5,flexWrap:"wrap"}}>
          <St label="H_A (total)" value={sim.burdenA.toFixed(0)} color={CL.A} sub={`C·k=${sim.infraA.toFixed(0)} + W=${sim.dmgA.toFixed(0)}`}/>
          <St label="W_A (welfare loss)" value={sim.dmgA.toFixed(0)} color={CL.A} sub="separated menu"/>
          <St label="W_B (welfare loss)" value={sim.dmgB.toFixed(0)} color={CL.B} sub="pooled, same cap"/>
          <St label="H_A vs H_B" value={`${pAB}%`} color={CL.B} sub="Theorem 1 gain"/>
          <St label="H_A vs H_C" value={`${pAC}%`} color={CL.C} sub="vs underdeployed"/>
          <St label="H_A vs H_D" value={`${pAD}%`} color={CL.D} sub="vs worst-case"/>
        </div>

        <div style={{display:"flex",gap:3,marginBottom:6,flexWrap:"wrap",alignItems:"center"}}>
          <Tb active={tab==="load"} onClick={()=>setTab("load")}>Load Profile</Tb>
          <Tb active={tab==="gaming"} onClick={()=>setTab("gaming")}>Gaming d(q)</Tb>
          <Tb active={tab==="all_sev"} onClick={()=>setTab("all_sev")}>All Types d(q)</Tb>
          <Tb active={tab==="burden"} onClick={()=>setTab("burden")}>H = C·k + W</Tb>
          <Tb active={tab==="ab"} onClick={()=>setTab("ab")}>W_S vs W_P (Theorem 1)</Tb>
          <Tb active={tab==="curves"} onClick={()=>setTab("curves")}>d(q) and p(q) Curves</Tb>
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
          <ResponsiveContainer width="100%" height={300}><ComposedChart data={sim.loadData} margin={cm}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/>
            <XAxis dataKey="hour" tick={{fill:"#64748b",fontSize:9}} tickFormatter={v=>`${Math.floor(v)}h`}/>
            <YAxis tick={{fill:"#64748b",fontSize:9}}/>
            <Tooltip contentStyle={{background:"#ffffff",border:"1px solid #e2e8f0",borderRadius:5,fontSize:10}} labelFormatter={v=>fH(v)}/>
            <Area type="monotone" dataKey="batch" stackId="1" fill="#64748b" fillOpacity={0.13} stroke="#64748b" strokeWidth={1} name="Batch"/>
            <Area type="monotone" dataKey="office" stackId="1" fill="#38bdf8" fillOpacity={0.13} stroke="#38bdf8" strokeWidth={1} name="Office"/>
            <Area type="monotone" dataKey="webshop" stackId="1" fill="#f59e0b" fillOpacity={0.08} stroke="#f59e0b" strokeWidth={1} name="Webshop"/>
            <Area type="monotone" dataKey="gaming" stackId="1" fill="#f472b6" fillOpacity={0.13} stroke="#f472b6" strokeWidth={1} name="Gaming"/>
            <ReferenceLine y={sim.capA} stroke={CL.A} strokeWidth={2.5} strokeDasharray="8 4" label={{value:"A/B",position:"right",fill:CL.A,fontSize:10}}/>
            <ReferenceLine y={sim.capC} stroke={CL.C} strokeWidth={2} strokeDasharray="6 3" label={{value:`C:${capCpct}%`,position:"right",fill:CL.C,fontSize:9}}/>
            <ReferenceLine y={sim.capD} stroke={CL.D} strokeWidth={2} strokeDasharray="6 3" label={{value:"D:honest",position:"right",fill:CL.D,fontSize:9}}/>
          </ComposedChart></ResponsiveContainer>
          {showNotes&&<div style={{marginTop:8,padding:"6px 8px",background:"#fff",borderRadius:4,border:"1px solid #e2e8f0",fontSize:10,color:"#475569",lineHeight:1.6}}>
            <strong>A</strong> (green) — Separated menu. Optimizes H = C·k + W via capacity + WFQ (β={beta}). Cap: {sim.capA.toFixed(0)} ({(sim.capA/sim.peak*100).toFixed(0)}% of peak).{" "}
            <strong>B</strong> — Same capacity, pooled (no WFQ). Same C·k, higher W.{" "}
            <strong>C</strong> (red) — Underdeployed at {capCpct}%. Low C·k, high W.{" "}
            <strong>D</strong> (blue) — Worst-case provisioned for {sla} per window. High C·k, near-zero W.
          </div>}
        </div>)}

        {tab==="gaming"&&(<div style={{background:"#f8fafc",borderRadius:6,padding:11}}>
          <div style={{fontSize:11,fontWeight:700,color:"#0f172a",marginBottom:2}}>Gaming Clients — Severity d(q) Over Time</div>
          {showNotes&&<div style={{fontSize:10,color:"#475569",marginBottom:7,lineHeight:1.5}}>
            Gaming has the highest θ ({thetas.gaming}), so its contribution to W = Σ θᵢ·d(qᵢ) dominates. Under A, WFQ places gaming at the front of the queue (low d(q)). Under pooled scenarios (B, C, D), all types share the same severity.
          </div>}
          <ResponsiveContainer width="100%" height={300}><LineChart data={sim.sevData} margin={cm}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/>
            <XAxis dataKey="hour" tick={{fill:"#64748b",fontSize:9}} tickFormatter={v=>`${Math.floor(v)}h`}/>
            <YAxis tick={{fill:"#64748b",fontSize:9}} domain={[0,"auto"]}/>
            <Tooltip contentStyle={{background:"#ffffff",border:"1px solid #e2e8f0",borderRadius:5,fontSize:10}} labelFormatter={v=>fH(v)}/>
            <Line type="monotone" dataKey="gaming_A" stroke={CL.A} strokeWidth={2.5} dot={false} name="A: separated (WFQ)"/>
            <Line type="monotone" dataKey="gaming_B" stroke={CL.B} strokeWidth={2} dot={false} name="B: pooled, A's capacity"/>
            <Line type="monotone" dataKey="gaming_C" stroke={CL.C} strokeWidth={2} dot={false} name={`C: pooled, ${capCpct}% capacity`}/>
            <Line type="monotone" dataKey="gaming_D" stroke={CL.D} strokeWidth={1.5} strokeDasharray="6 3" dot={false} name={`D: pooled, honest ${sla}`}/>
            <Legend formatter={v=><span style={{color:"#1e293b",fontSize:9}}>{v}</span>}/>
          </LineChart></ResponsiveContainer>
          {showNotes&&<div style={{marginTop:8,padding:"6px 8px",background:"#fff",borderRadius:4,border:"1px solid #e2e8f0",fontSize:10,color:"#475569",lineHeight:1.6}}>
            <strong>Self-selection:</strong> Gaming clients choose the front of the queue because h(θ,q) = p(q) + θ·d(q) is minimized there — the high price is offset by the large θ·d(q) reduction. No provider knowledge of θ is needed. Adjust β to see how WFQ aggressiveness changes the gap between A (green) and B (purple).
          </div>}
        </div>)}

        {tab==="all_sev"&&(<div style={{background:"#f8fafc",borderRadius:6,padding:11}}>
          <div style={{fontSize:11,fontWeight:700,color:"#0f172a",marginBottom:2}}>Severity Redistribution: Separated (A) vs Pooled (B)</div>
          {showNotes&&<div style={{fontSize:10,color:"#475569",marginBottom:7,lineHeight:1.5}}>
            Solid = A (WFQ), dashed = B (equal). Same capacity ({sim.capA.toFixed(0)}). WFQ redistributes severity from high-θ to low-θ clients — it does not create or destroy aggregate severity, just reallocates it to minimize W = Σ θᵢ·d(qᵢ).
          </div>}
          <ResponsiveContainer width="100%" height={300}><LineChart data={sim.sevData} margin={cm}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/>
            <XAxis dataKey="hour" tick={{fill:"#64748b",fontSize:9}} tickFormatter={v=>`${Math.floor(v)}h`}/>
            <YAxis tick={{fill:"#64748b",fontSize:9}} domain={[0,"auto"]}/>
            <Tooltip contentStyle={{background:"#ffffff",border:"1px solid #e2e8f0",borderRadius:5,fontSize:10}} labelFormatter={v=>fH(v)}/>
            <Line type="monotone" dataKey="gaming_A" stroke="#f472b6" strokeWidth={2.5} dot={false} name="Gaming (A: separated)"/>
            <Line type="monotone" dataKey="webshop_A" stroke="#f59e0b" strokeWidth={2} dot={false} name="Webshop (A: separated)"/>
            <Line type="monotone" dataKey="office_A" stroke="#38bdf8" strokeWidth={2} dot={false} name="Office (A: separated)"/>
            <Line type="monotone" dataKey="batch_A" stroke="#64748b" strokeWidth={2} dot={false} name="Batch (A: separated)"/>
            <Line type="monotone" dataKey="gaming_B" stroke="#f472b6" strokeWidth={1.5} strokeDasharray="5 3" dot={false} name="Gaming (B: pooled)"/>
            <Line type="monotone" dataKey="batch_B" stroke="#64748b" strokeWidth={1.5} strokeDasharray="5 3" dot={false} name="Batch (B: pooled)"/>
            <Legend formatter={v=><span style={{color:"#1e293b",fontSize:9}}>{v}</span>}/>
          </LineChart></ResponsiveContainer>
          {showNotes&&<div style={{marginTop:8,padding:"6px 8px",background:"#fff",borderRadius:4,border:"1px solid #e2e8f0",fontSize:10,color:"#475569",lineHeight:1.6}}>
            Gaming (pink, θ={thetas.gaming}) gets low severity under A; batch (grey, θ={thetas.batch}) absorbs more — but θ is low, so the extra severity costs little. This is the rearrangement inequality: pairing high θ with low d(q) minimizes W.
          </div>}
        </div>)}

        {tab==="burden"&&(<div style={{background:"#f8fafc",borderRadius:6,padding:11}}>
          <div style={{fontSize:11,fontWeight:700,color:"#0f172a",marginBottom:2}}>Total Social Cost H = C·k + W (lower is better)</div>
          {showNotes&&<div style={{fontSize:10,color:"#475569",marginBottom:7,lineHeight:1.5}}>
            Grey = infrastructure cost C·k. Red = welfare loss W = Σ θᵢ·d(qᵢ) (aggregate damage). A minimizes H by optimizing capacity and using WFQ to redistribute severity.
          </div>}
          <ResponsiveContainer width="100%" height={280}><BarChart data={[
            {name:"A: Separated (WFQ)",infra:sim.infraA,dmg:sim.dmgA},
            {name:"B: Pooled, A's cap",infra:sim.infraB,dmg:sim.dmgB},
            {name:`C: Pooled, ${capCpct}% cap`,infra:sim.infraC,dmg:sim.dmgC},
            {name:`D: Pooled, honest ${sla}`,infra:sim.infraD,dmg:sim.dmgD},
          ]} margin={{...cm,bottom:40}}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/>
            <XAxis dataKey="name" tick={{fill:"#475569",fontSize:9}} angle={-12} textAnchor="end"/>
            <YAxis tick={{fill:"#475569",fontSize:9}}/>
            <Tooltip contentStyle={{background:"#fff",border:"1px solid #e2e8f0",borderRadius:5,fontSize:10}} formatter={(v,n)=>[v.toFixed(0),n==="infra"?"C·k (Infrastructure cost)":"W (Welfare loss)"]}/>
            <Bar dataKey="infra" stackId="s" name="C·k (Infrastructure cost)" fill="#94a3b8"/>
            <Bar dataKey="dmg" stackId="s" name="W (Welfare loss)" fill="#ef4444"/>
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

        {tab==="ab"&&(<div style={{background:"#f8fafc",borderRadius:6,padding:11}}>
          <div style={{fontSize:11,fontWeight:700,color:"#0f172a",marginBottom:2}}>Theorem 1: W_S {"<"} W_P (Welfare-Loss-Minimizing Self-Selection)</div>
          {showNotes&&<div style={{fontSize:10,color:"#475569",marginBottom:7,lineHeight:1.5}}>
            A and B share capacity ({sim.capA.toFixed(0)}) and C·k ({sim.infraA.toFixed(0)}). A uses WFQ (separated), B uses equal treatment (pooled). Theorem 1: the separated allocation always yields W_S ≤ W_P. Solid lines redistribute severity from high-θ to low-θ clients.
          </div>}
          <ResponsiveContainer width="100%" height={260}><LineChart data={sim.sevData} margin={cm}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/>
            <XAxis dataKey="hour" tick={{fill:"#475569",fontSize:9}} tickFormatter={v=>`${Math.floor(v)}h`}/>
            <YAxis tick={{fill:"#475569",fontSize:9}} domain={[0,"auto"]}/>
            <Tooltip contentStyle={{background:"#fff",border:"1px solid #e2e8f0",borderRadius:5,fontSize:10}} labelFormatter={v=>fH(v)}/>
            <Line type="monotone" dataKey="gaming_A" stroke="#f472b6" strokeWidth={2.5} dot={false} name="Gaming (A: separated)"/>
            <Line type="monotone" dataKey="batch_A" stroke="#64748b" strokeWidth={2} dot={false} name="Batch (A: separated)"/>
            <Line type="monotone" dataKey="gaming_B" stroke="#f472b6" strokeWidth={2} strokeDasharray="6 3" dot={false} name="Gaming (B: pooled)"/>
            <Line type="monotone" dataKey="batch_B" stroke="#64748b" strokeWidth={1.5} strokeDasharray="6 3" dot={false} name="Batch (B: pooled)"/>
            <Legend formatter={v=><span style={{color:"#1e293b",fontSize:9}}>{v}</span>}/>
          </LineChart></ResponsiveContainer>
          <div style={{marginTop:6,padding:"6px 8px",background:"#fff",borderRadius:4,border:"1px solid #e2e8f0"}}>
            <div style={{fontSize:12,fontWeight:700,color:"#d97706",textAlign:"center"}}>W_S = {sim.dmgA.toFixed(0)} vs W_P = {sim.dmgB.toFixed(0)} — welfare loss reduction: {pAB}%</div>
            {showNotes&&<div style={{fontSize:10,color:"#475569",marginTop:5,lineHeight:1.6}}>
              Rearrangement inequality: pairing high θ with low d(q) minimizes Σ θᵢ·d(qᵢ). Self-selection achieves this — p(q) alone induces the optimal pairing without provider knowledge of θ. H_A = {sim.infraA.toFixed(0)} + {sim.dmgA.toFixed(0)} = {sim.burdenA.toFixed(0)} vs H_B = {sim.infraB.toFixed(0)} + {sim.dmgB.toFixed(0)} = {sim.burdenB.toFixed(0)}. The {pAB}% gain is entirely from the W component.
            </div>}
          </div>
        </div>)}

        {tab==="curves"&&(()=>{
          const batchPts=sim.dqScatter.filter(d=>d.type==="batch").map(d=>({q:d.q,v:d.severity}));
          const officePts=sim.dqScatter.filter(d=>d.type==="office").map(d=>({q:d.q,v:d.severity}));
          const webshopPts=sim.dqScatter.filter(d=>d.type==="webshop").map(d=>({q:d.q,v:d.severity}));
          const gamingPts=sim.dqScatter.filter(d=>d.type==="gaming").map(d=>({q:d.q,v:d.severity}));
          const {gamma,delta}=sim.dqFit;
          const thetaVals=["gaming","webshop","office","batch"].map(t=>thetas[t]);
          const thetaRef=Math.exp(thetaVals.reduce((s,v)=>s+Math.log(v),0)/thetaVals.length);
          const optQ=(th)=>{const v=0.5+Math.log(th/thetaRef)/(pExp+delta);return Math.max(0,Math.min(1,v));};
          const optPts=["gaming","webshop","office","batch"].map(t=>{const q=optQ(thetas[t]);return{type:t,q:Math.round(q*1000)/1000,price:Math.exp(pExp*q),theta:thetas[t]};});
          const clientPqPts={gaming:[],webshop:[],office:[],batch:[]};
          const step=Math.max(1,Math.floor(clients.length/200));
          for(let i=0;i<clients.length;i+=step){const c=clients[i];const q=optQ(c.theta);clientPqPts[c.type].push({q:Math.round(q*1000)/1000,price:Math.exp(pExp*q)});}
          return(<div style={{background:"#f8fafc",borderRadius:6,padding:11}}>
          <div style={{fontSize:11,fontWeight:700,color:"#0f172a",marginBottom:2}}>d(q) and p(q) — The Curves That Drive Self-Selection</div>
          {showNotes&&<div style={{fontSize:10,color:"#475569",marginBottom:10,lineHeight:1.5}}>
            d(q) is decreasing-convex (front of queue = low severity), p(q) is increasing-convex (front = expensive). Each client minimizes h(θ,q) = p(q) + θ·d(q) by choosing q. High θ moves right (pays more, avoids damage); low θ stays left (cheap, absorbs severity). d(q) emerges from WFQ with β={beta} (ratio {Math.exp(beta).toFixed(0)}:1) — the provider chooses β, and the shape follows. The published d(q) serves as a contractual ceiling: the provider guarantees realized severity will not exceed d(q) at any queue position, adjusting β and capacity as load evolves. The coloured dots on the p(q) chart show where each type self-selects: q* = 0.5 + ln(θ/θ_ref) / (α+δ), calibrated so the median type sits at q=0.5. Move the price exponent slider to see how p(q) convexity compresses or spreads the type positions.
          </div>}
          <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
            <div style={{flex:1,minWidth:280}}>
              <div style={{fontSize:10,fontWeight:600,color:"#0f172a",marginBottom:4}}>d(q) — Expected Violation Severity</div>
              <div style={{fontSize:9,color:"#64748b",marginBottom:4}}>Dots = per-client empirical. Red = fitted {gamma.toFixed(4)}·e^(-{delta.toFixed(2)}·q)</div>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart margin={{top:8,right:12,left:8,bottom:20}}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/>
                  <XAxis dataKey="q" type="number" domain={[0,1]} tick={{fill:"#475569",fontSize:9}} label={{value:"q (queue position)",position:"insideBottom",offset:-12,style:{fill:"#64748b",fontSize:9}}} allowDuplicatedCategory={false}/>
                  <YAxis tick={{fill:"#475569",fontSize:9}} label={{value:"E[d(q)]",angle:-90,position:"insideLeft",style:{fill:"#64748b",fontSize:9}}}/>
                  <Tooltip contentStyle={{background:"#fff",border:"1px solid #e2e8f0",borderRadius:5,fontSize:10}}/>
                  <Line data={sim.dqCurveData} dataKey="fitted" stroke="#ef4444" strokeWidth={2.5} dot={false} name="Fitted" type="monotone"/>
                  <Line data={batchPts} dataKey="v" stroke="transparent" strokeWidth={0} dot={{r:3,fill:"#64748b",fillOpacity:0.6}} name="Batch" isAnimationActive={false}/>
                  <Line data={officePts} dataKey="v" stroke="transparent" strokeWidth={0} dot={{r:3,fill:"#38bdf8",fillOpacity:0.6}} name="Office" isAnimationActive={false}/>
                  <Line data={webshopPts} dataKey="v" stroke="transparent" strokeWidth={0} dot={{r:3,fill:"#f59e0b",fillOpacity:0.6}} name="Webshop" isAnimationActive={false}/>
                  <Line data={gamingPts} dataKey="v" stroke="transparent" strokeWidth={0} dot={{r:3,fill:"#f472b6",fillOpacity:0.6}} name="Gaming" isAnimationActive={false}/>
                  <Legend formatter={v=><span style={{color:"#1e293b",fontSize:9}}>{v}</span>}/>
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div style={{flex:1,minWidth:280}}>
              <div style={{fontSize:10,fontWeight:600,color:"#0f172a",marginBottom:4}}>p(q) — Price Schedule with Self-Selection Points</div>
              <div style={{fontSize:9,color:"#64748b",marginBottom:4}}>p(q) = e^({pExp}·q) (paper §6.1 uses e^(3q)−1; same convex-increasing shape, shifted). Dots = optimal q* from FOC.</div>
              <ResponsiveContainer width="100%" height={250}>
                <ComposedChart data={pqCurveData} margin={{top:16,right:12,left:8,bottom:20}}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/>
                  <XAxis dataKey="q" type="number" domain={[0,1]} tick={{fill:"#475569",fontSize:9}} label={{value:"q (queue position)",position:"insideBottom",offset:-12,style:{fill:"#64748b",fontSize:9}}}/>
                  <YAxis tick={{fill:"#475569",fontSize:9}} label={{value:"p(q) relative",angle:-90,position:"insideLeft",style:{fill:"#64748b",fontSize:9}}}/>
                  <Tooltip contentStyle={{background:"#fff",border:"1px solid #e2e8f0",borderRadius:5,fontSize:10}}/>
                  <Line dataKey="price" stroke="#10b981" strokeWidth={2.5} dot={false} name={`e^(${pExp}·q)`} type="monotone"/>
                  <Line data={clientPqPts.batch} dataKey="price" stroke="transparent" strokeWidth={0} dot={{r:2,fill:"#64748b",fillOpacity:0.3}} isAnimationActive={false} name="Batch clients"/>
                  <Line data={clientPqPts.office} dataKey="price" stroke="transparent" strokeWidth={0} dot={{r:2,fill:"#38bdf8",fillOpacity:0.3}} isAnimationActive={false} name="Office clients"/>
                  <Line data={clientPqPts.webshop} dataKey="price" stroke="transparent" strokeWidth={0} dot={{r:2,fill:"#f59e0b",fillOpacity:0.3}} isAnimationActive={false} name="Webshop clients"/>
                  <Line data={clientPqPts.gaming} dataKey="price" stroke="transparent" strokeWidth={0} dot={{r:2,fill:"#f472b6",fillOpacity:0.3}} isAnimationActive={false} name="Gaming clients"/>
                  {optPts.map(p=><ReferenceLine key={`line-${p.type}`} segment={[{x:p.q,y:0},{x:p.q,y:p.price}]} stroke={tC[p.type]} strokeWidth={1.5} strokeDasharray="4 3" opacity={0.3}/>)}
                  {optPts.map(p=><ReferenceDot key={`dot-${p.type}`} x={p.q} y={p.price} r={6} fill={tC[p.type]} stroke="#fff" strokeWidth={2} label={{value:`${p.type.charAt(0).toUpperCase()}`,position:"top",fill:tC[p.type],fontSize:9,fontWeight:700,offset:8}}/>)}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
          {showNotes&&<div style={{marginTop:8,padding:"6px 8px",background:"#fff",borderRadius:4,border:"1px solid #e2e8f0",fontSize:10,color:"#475569",lineHeight:1.6}}>
            <div style={{marginBottom:4}}><strong>Self-selection positions:</strong> q* = 0.5 + ln(θ/θ_ref) / (α + δ), where α={pExp} (price exponent), δ={delta.toFixed(2)} (d(q) steepness), θ_ref={thetaRef.toFixed(2)} (geometric mean). Higher α or δ compresses the spread. Each type:</div>
            <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
              {optPts.map(p=><span key={p.type} style={{color:tC[p.type],fontWeight:600}}>{p.type} (θ={p.theta}): q*={p.q.toFixed(3)}, p(q*)={p.price.toFixed(2)}</span>)}
            </div>
            <div style={{marginTop:4}}>Small transparent dots show individual clients (θ varies ±30% within each type). The large dot is the type mean. Where type clusters overlap, clients are nearly indifferent between tiers. Move the price exponent slider to see how p(q) convexity compresses or spreads the positions.</div>
          </div>}
        </div>);})()}

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
