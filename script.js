// ── SUPABASE ──────────────────────────────────────────────────────
const { createClient } = supabase;
const SB = createClient(
  'https://qaxufnvmvbkgpgxnhpyg.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFheHVmbnZtdmJrZ3BneG5ocHlnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzNjI0MTcsImV4cCI6MjA5MDkzODQxN30.P81hS7TAxuJPMsKVbKQICHbW12cAYcQ6w63UVgA77M8'
);

// ── CONSTANTS ─────────────────────────────────────────────────────
const TODAY = new Date();
const TIERS = {
  Top:     {waD:7,   cD:30,  p:1},
  Active:  {waD:14,  cD:60,  p:2},
  Warm:    {waD:30,  cD:90,  p:3},
  Sleeper: {waD:180, cD:180, p:4},
  Archive: {waD:null,cD:null,p:5},
};
const TC = {Top:'#8a6d3e', Active:'#2a5fa8', Warm:'#b87020', Sleeper:'#8a93a2'};
const SC = {Confirmed:'p-grn', Negotiation:'p-gold', Tentative:'p-amb', Waiting:'p-gh'};
const CC = {'Follow-Up':'p-blu', WhatsApp:'p-grn', Calling:'p-blu', Personal:'p-amb', Seasonal:'p-amb', Mandate:'p-gold', Event:'p-blu', Ongoing:'p-grn', Triggered:'p-gh'};

// ── RELATIONSHIP CADENCES ─────────────────────────────────────────
const DEFAULT_REL_CADENCES = {
  Personal: {waD:14, cD:30,  label:'Personal', p:1},
  General:  {waD:30, cD:60,  label:'General',  p:2},
  Proxy:    {waD:30, cD:60,  label:'Proxy',    p:3},
  Archive:  {waD:90, cD:null,label:'Archive',  p:4},
};
let REL_CADENCES = {};
const CADENCE_VERSION = 3;
function loadRelCadences(){
  const storedV=parseInt(localStorage.getItem('rel_cadences_v')||'0');
  if(storedV<CADENCE_VERSION){ localStorage.removeItem('rel_cadences'); localStorage.setItem('rel_cadences_v',CADENCE_VERSION); }
  try{ const saved=JSON.parse(localStorage.getItem('rel_cadences')||'null'); REL_CADENCES=saved||{}; }
  catch(e){ REL_CADENCES={}; }
  Object.keys(DEFAULT_REL_CADENCES).forEach(k=>{ if(!REL_CADENCES[k]) REL_CADENCES[k]={...DEFAULT_REL_CADENCES[k]}; });
}
function saveRelCadences(){ localStorage.setItem('rel_cadences',JSON.stringify(REL_CADENCES)); }

// ── STATE ─────────────────────────────────────────────────────────
let CLIENTS=[], PARTNERS=[], DEALS=[], CAMPAIGNS=[], RECS=[], MEETINGS=[];
let doneTasks = new Set(); // task_key set from DB
let cF='All', curTab='home';
let relF='All'; // KEEP for backward compat but no longer used in UI
let clientFilters={relationship:null, nw:null, interest:null, tag:null}; // active filter state
let recCat='All';
let selSegVal='All', editSegVal='All';
let editClientId=null, editPartnerId=null, editCampaignId=null;
let editingDealId=null;
let editRecId=null;
let homeTab='deals', homeDealTasks=null;
let doneDealTasksToday = 0;
let homeMode='focus'; // 'focus' = due/overdue only; 'all' = everything + completed
let doneHomeDealTasks=[]; // deal tasks completed this session, for immediate undo in ALL mode
let homeDoneDealTasks=null; // DB-loaded completed deal tasks for ALL mode
function switchHomeMode(mode){
  homeMode=mode;
  if(mode==='all') homeDoneDealTasks=null; // force reload when entering ALL
  rHome();
}
let addingCampaignId=null;
let ncam_imageData=null, ecam_imageData=null;
let camCompletions = new Set(); // 'type:id' keys
let openCampaignId = null;
let addCamTab='clients';
let CLIENT_ACTIVITIES=[];
let ALL_ACTIVITIES=[]; // global activity log — single source of truth for contact timers
let currentActivityClientId=null;
let CLIENT_DEAL_TASKS={}; // keyed by clientId → array of due/overdue deal tasks

// ── HELPERS ───────────────────────────────────────────────────────
const ini = n => n.split(' ').slice(0,2).map(w=>w[0]||'').join('').toUpperCase();
const daysSince = d => d ? Math.floor((TODAY - new Date(d))/86400000) : 9999;

// ── ACTIVITY SOURCE OF TRUTH ──────────────────────────────────────
// Computes last contact dates live from ALL_ACTIVITIES.
// meetings count as calls. Call this after any activity change.
function computeClientDates(clientId){
  const acts=ALL_ACTIVITIES.filter(a=>a.client_id==clientId);
  const waDate=acts.filter(a=>a.type==='whatsapp').map(a=>a.occurred_at).sort().reverse()[0]||null;
  const callDate=acts.filter(a=>a.type==='call'||a.type==='meeting').map(a=>a.occurred_at).sort().reverse()[0]||null;
  return {
    wa: waDate?waDate.split('T')[0]:null,
    call: callDate?callDate.split('T')[0]:null,
  };
}
// Push a new activity into ALL_ACTIVITIES and patch the client object in memory.
function applyActivity(clientId, type, isoStr){
  ALL_ACTIVITIES.push({client_id:clientId, type, occurred_at:isoStr});
  const c=CLIENTS.find(x=>x.id==clientId); if(!c) return;
  const dates=computeClientDates(clientId);
  if(type==='whatsapp') c.wa=dates.wa;
  if(type==='call'||type==='meeting') c.call=dates.call;
}
const fm = v => v>=1e6?'$'+(v/1e6).toFixed(1)+'m':v>=1e3?'$'+(v/1e3).toFixed(0)+'k':'$'+v.toLocaleString();
const CURRENCY_SYM={GBP:'£',USD:'$',EUR:'€',AED:'AED '};
function fmCur(v,cur){const s=CURRENCY_SYM[cur||'GBP']||((cur||'GBP')+' ');return v>=1e6?s+(v/1e6).toFixed(1)+'m':v>=1e3?s+(v/1e3).toFixed(1).replace(/\.0$/,'')+'k':s+v.toLocaleString();}
function fmUSD(v){return fm(Math.round(v/10)*10);}

// FX rates (base USD) — cached per day
let FX_RATES=null, FX_FETCHED=null;
async function getFxRates(){
  const today=new Date().toISOString().split('T')[0];
  if(FX_RATES&&FX_FETCHED===today) return FX_RATES;
  const apis=[
    'https://open.er-api.com/v6/latest/USD',
    'https://api.frankfurter.app/latest?base=USD',
  ];
  for(const url of apis){
    try{
      const r=await fetch(url);
      if(!r.ok) continue;
      const data=await r.json();
      if(data.rates?.EUR){ FX_RATES=data.rates; FX_FETCHED=today; return FX_RATES; }
    }catch(e){ continue; }
  }
  if(!FX_RATES) FX_RATES={GBP:0.79,EUR:0.86,AED:3.67}; // last-resort fallback
  return FX_RATES;
}
function toUSD(v,cur){
  if(!cur||cur==='USD') return v;
  const rate=FX_RATES?.[cur]; return rate?v/rate:v;
}
const abbr = n => n.replace(/[()]/g,'').split(/[\s/&,]+/).slice(0,2).map(w=>w[0]||'').join('').toUpperCase();

function showToast(msg){ const t=document.getElementById('toast'); t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2200); }

// ── LOAD DATA ─────────────────────────────────────────────────────
async function loadAll(){
  const today = new Date().toISOString().split('T')[0];

  const [cR, pR, dR, camR, recR, taskR, mtgR, actR] = await Promise.all([
    SB.from('clients').select('*').order('sort_order'),
    SB.from('partners').select('*').order('sort_order'),
    SB.from('deals').select('*').order('created_at'),
    SB.from('campaigns').select('*').order('sort_order'),
    SB.from('recommendations').select('*').order('category').order('sort_order'),
    SB.from('task_completions').select('task_key,reset_date'),
    SB.from('client_meetings').select('*').eq('done',false).order('due_date'),
    SB.from('client_activities').select('client_id,type,occurred_at'),
  ]);

  // Build global activity log — single source of truth for contact timers
  ALL_ACTIVITIES = actR.data||[];

  CLIENTS   = (cR.data||[]).map(normaliseClient);
  PARTNERS  = (pR.data||[]).map(normalisePartner);
  DEALS     = (dR.data||[]).map(normaliseDeal);
  CAMPAIGNS = (camR.data||[]).map(normaliseCampaign);
  RECS      = recR.data||[];
  MEETINGS  = (mtgR.data||[]);

  // Override last_wa / last_call on every client from the activity log.
  // This means editing client_activities in Supabase instantly reflects here.
  CLIENTS.forEach(c=>{
    const dates=computeClientDates(c.id);
    if(dates.wa) c.wa=dates.wa;
    if(dates.call) c.call=dates.call;
  });

  // Task done state — only keep if reset_date is today
  doneTasks = new Set(
    (taskR.data||[]).filter(t => t.reset_date === today).map(t=>t.task_key)
  );

  // Clean up stale task completions from other days
  const stale = (taskR.data||[]).filter(t=>t.reset_date!==today).map(t=>t.task_key);
  if(stale.length) await SB.from('task_completions').delete().in('task_key', stale);
}

function normaliseClient(r){
  const interests=r.interests||[];
  return {
    id: r.id, name: r.name, role: r.position||'', nat: r.nationality||'',
    city: r.city||'', tier: r.tier||'Active', nw: r.net_worth||'HNWI',
    rel: r.religion||'Unknown', int: interests, notes: r.notes||'',
    wa: r.last_wa||null, call: r.last_call||null,
    followUp: r.follow_up_date||null, deal: r.has_deal||false,
    relationship: r.relationship||'',
    proxyContact: r.proxy_contact||'',
    vip: interests.includes('VIP'),
    dnd: interests.includes('DND'),
    prospect: interests.includes('Prospect'),
    dob: r.dob||null,
  };
}
function normalisePartner(r){
  return {
    id: r.id, name: r.company, cat: r.category||'', tier: r.crm_tier||'Partner',
    contact: r.contact||'', role: r.position||'', country: r.country||'',
    fee: r.introduction_fee||'', bizFee: r.business_fees||'',
    spend: r.client_spend||0, notes: r.notes||'', isC: r.is_client||false,
    wa: r.last_wa||null, call: r.last_call||null,
  };
}
function parsePct(str){
  if(!str) return null;
  const m=String(str).match(/(\d+(?:\.\d+)?)/);
  return m?parseFloat(m[1]):null;
}
function calcDealPct(partnerName){
  const p=PARTNERS.find(x=>x.name===partnerName);
  if(!p) return 0;
  const ref=parsePct(p.fee), biz=parsePct(p.bizFee);
  if(ref&&biz) return (ref*biz)/100;
  if(ref) return ref;
  return 0;
}
function normaliseDeal(r){
  const pct=calcDealPct(r.partner)||Number(r.commission_rate)||0;
  return {
    id: r.id, clientId: r.client_id, pt: r.partner||'',
    cat: r.category||'Real Estate', v: Number(r.spend)||0,
    pct, s: r.status||'Waiting', n: r.notes||'',
    cur: r.currency||'GBP',
  };
}
function normaliseCampaign(r){
  return {
    id: r.id, name: r.name, type: r.type||'Ongoing', seg: r.segment||'All',
    occ: r.occasion||'', date: r.date||'TBC', notes: r.notes||'',
    template: r.template||null,
    waImage: r.wa_image||null,
    manualClientIds: r.manual_client_ids||[],
    manualExcludedIds: r.manual_excluded_ids||[],
    manualPartnerIds: r.manual_partner_ids||[],
    manualRecIds: r.manual_rec_ids||[],
    includeAllPartners: r.include_all_partners||false,
    includeAllRolodex: r.include_all_rolodex||false,
  };
}

function fmtCamDate(date){
  if(!date||date==='Ongoing') return 'Ongoing';
  if(date==='TBC') return 'TBC';
  try{ return new Date(date+'T12:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}); }
  catch(e){ return date; }
}

// ── SEGMENT & TASK LOGIC ──────────────────────────────────────────
function campaignTiming(cam){
  if(!cam.date||cam.date==='Ongoing') return 'Ongoing';
  if(cam.date==='TBC') return 'TBC';
  try{
    const today=new Date(); today.setHours(0,0,0,0);
    const d=new Date(cam.date); d.setHours(0,0,0,0);
    const diff=Math.floor((d-today)/86400000);
    if(diff>1) return `Due in ${diff} days`;
    if(diff===1) return 'Due tomorrow';
    if(diff===0) return 'Due today';
    const over=Math.abs(diff);
    if(over<7) return `${over} day${over===1?'':'s'} overdue`;
    const weeks=Math.round(over/7);
    return `${weeks} week${weeks===1?'':'s'} overdue`;
  }catch(e){ return cam.date; }
}

function clientMatchesSeg(c, seg){
  if(!seg||seg==='All') return true;
  if(seg==='Billionaire') return c.nw==='Billionaire';
  if(seg==='Centimillionaire') return c.nw==='Centimillionaire';
  if(seg==='Sleeper') return c.tier==='Sleeper';
  if(seg==='Top') return c.tier==='Top';
  if(seg==='Muslim') return c.rel==='Muslim';
  if(seg==='Christian') return c.rel==='Christian';
  if(seg==='Hindu') return c.rel==='Hindu';
  return c.int && c.int.some(i=>i.toLowerCase().includes(seg.toLowerCase()));
}

function daysUntilBirthday(dob){
  if(!dob) return null;
  const today=new Date(); today.setHours(0,0,0,0);
  const [,m,d]=dob.split('-').map(Number);
  let bday=new Date(today.getFullYear(),m-1,d); bday.setHours(0,0,0,0);
  if(bday<today) bday=new Date(today.getFullYear()+1,m-1,d);
  return Math.floor((bday-today)/86400000);
}

function getSegmentMatchedClients(cam){
  let filtered=CLIENTS;
  // Birthday campaigns: check name OR occasion field for 'birthday'
  const isBirthday=(cam.occ&&cam.occ.toLowerCase().includes('birthday'))||(cam.name&&cam.name.toLowerCase().includes('birthday'));
  if(isBirthday){ filtered=filtered.filter(c=>!!c.dob&&daysUntilBirthday(c.dob)<=60); }
  else if(cam.occ && cam.occ!==''){
    const occs=cam.occ.split('/').map(o=>o.trim().toLowerCase());
    filtered=filtered.filter(c=>{
      const relL=(c.rel||'').toLowerCase();
      return occs.some(o=>relL.includes(o)||o.includes(relL));
    });
  }
  if(cam.seg && cam.seg!=='All') filtered=filtered.filter(c=>clientMatchesSeg(c,cam.seg));
  return filtered.map(c=>c.id);
}

function getCampaignClients(cam){
  const segIds=getSegmentMatchedClients(cam);
  const excludedIds=new Set(cam.manualExcludedIds||[]);
  // Segment matches minus excluded
  let filtered=CLIENTS.filter(c=>segIds.includes(c.id)&&!excludedIds.has(c.id));
  // Add manual clients (always included, unless birthday campaign and client has no DOB)
  if(cam.manualClientIds && cam.manualClientIds.length){
    const isBirthdayCam=(cam.occ&&cam.occ.toLowerCase().includes('birthday'))||(cam.name&&cam.name.toLowerCase().includes('birthday'));
    const existing=new Set(filtered.map(c=>c.id));
    CLIENTS.filter(c=>cam.manualClientIds.includes(c.id)&&!existing.has(c.id)&&(!isBirthdayCam||(!!c.dob&&daysUntilBirthday(c.dob)<=60))).forEach(c=>filtered.push(c));
  }
  return filtered;
}

function getCampaignContacts(cam){
  // Returns all enrolled contacts across clients, partners, recs
  const contacts=[];
  getCampaignClients(cam).forEach(c=>
    contacts.push({type:'client',id:c.id,name:c.name,sub:(c.role||c.city||''),av:ini(c.name),avStyle:'',obj:c})
  );
  const pList=cam.includeAllPartners?PARTNERS:PARTNERS.filter(p=>(cam.manualPartnerIds||[]).includes(p.id));
  pList.forEach(p=>
    contacts.push({type:'partner',id:p.id,name:p.contact||p.name,sub:p.name,av:p.contact?ini(p.contact):abbr(p.name),avStyle:'border-radius:10px;background:rgba(46,125,82,0.09);border-color:rgba(46,125,82,0.22);color:var(--green)',obj:p})
  );
  const rList=cam.includeAllRolodex?RECS:RECS.filter(r=>(cam.manualRecIds||[]).includes(r.id));
  rList.forEach(r=>
    contacts.push({type:'rec',id:r.id,name:r.company,sub:r.contact||r.category||'',av:(r.company||'?')[0],avStyle:'border-radius:10px;background:rgba(42,95,168,0.09);border-color:rgba(42,95,168,0.22);color:var(--blue)',obj:r})
  );
  return contacts;
}

function mkTasks(){
  const t=[];
  const activeCams = CAMPAIGNS.filter(c=>{
    if(c.date==='Ongoing') return true;
    if(c.date==='TBC') return false;
    try{ const d=new Date(c.date); const diff=Math.floor((d-TODAY)/86400000); if(c.type==='Triggered') return diff>=0&&diff<=3; return diff>=-3&&diff<=30; }catch(e){ return false; }
  });

  // Campaign pass: one task per client per active campaign, regardless of cadence
  const camCoveredIds = new Set();
  activeCams.forEach(cam=>{
    const camWhy=campaignTiming(cam);
    const clients=getCampaignClients(cam);
    if(!clients.length){
      const isBdayCam=/birthday/i.test(cam.name)||/birthday/i.test(cam.occ||'');
      if(isBdayCam) return; // no upcoming birthdays — hide entirely
      const standaloneWhy=`0 clients · ${camWhy}`;
      t.push({id:'cam-'+cam.id, nm:'Campaign', act:cam.name,
        why:standaloneWhy, urg:'soon', pri:25, isCam:true, camId:cam.id, clientObj:null});
      return;
    }
    clients.forEach(c=>{
      // Only follow-up type campaigns suppress cadence WhatsApp/Call tasks
      if(['Follow-Up','WhatsApp','Calling','Personal'].includes(cam.type)) camCoveredIds.add(c.id);
      const rel=REL_CADENCES[c.relationship];
      t.push({id:'cam-'+cam.id+'-'+c.id, nm:c.name, act:cam.name+' — '+c.name,
        why:camWhy, urg:'soon', pri:(rel?rel.p*10:20)+2, isCam:true, camId:cam.id, clientObj:c});
    });
  });

  // Clients with a scheduled meeting within 14 days — meeting supersedes call & WhatsApp
  const todayMidnight=new Date(); todayMidnight.setHours(0,0,0,0);
  const mtgCoveredIds = new Set(
    MEETINGS.filter(m=>{ const d=new Date(m.due_date); d.setHours(0,0,0,0); const diff=Math.floor((d-todayMidnight)/86400000); return diff>=-1&&diff<=14; })
            .map(m=>m.client_id)
  );

  // Cadence pass: clients NOT covered by any active campaign or upcoming meeting
  CLIENTS.forEach(c=>{
    if(camCoveredIds.has(c.id)) return;
    if(mtgCoveredIds.has(c.id)) return; // meeting within 14d supersedes call/wa
    if(c.dnd) return; // Do Not Disturb — suppress all WhatsApp/call tasks
    const rel=REL_CADENCES[c.relationship];
    if(!rel||c.relationship==='Archive'||!c.relationship) return;
    const wa=daysSince(c.wa), cl=daysSince(c.call);
    const lastAny=Math.min(wa,cl); // most recent contact of any type — a call resets WA timer
    const waDue=rel.waD&&lastAny>=rel.waD, clDue=rel.cD&&cl>=rel.cD;
    if(!waDue&&!clDue) return;
    if(clDue){
      const ov=cl-rel.cD;
      t.push({id:'cl-'+c.id, nm:c.name, act:'Call '+c.name,
        why:cl===9999?'Never called · '+c.relationship+' relationship':`${cl}d since last call · due every ${rel.cD}d`,
        urg:ov>=7?'urgent':'due', pri:rel.p*10+1+(c.deal?0:5)});
      return; // call due — WhatsApp suppressed
    }
    if(waDue){
      const ov=lastAny-rel.waD;
      const lastAnySrc=cl<=wa?`${cl}d since last call`:`${wa}d since last message`;
      t.push({id:'wa-'+c.id, nm:c.name, act:'WhatsApp '+c.name,
        why:lastAny===9999?'Never contacted · '+c.relationship+' relationship':`${lastAnySrc} · due every ${rel.waD}d`,
        urg:ov>=7?'urgent':'due', pri:rel.p*10+(c.deal?0:5)});
    }
  });

  // Meeting pass: scheduled meetings within 14 days
  MEETINGS.forEach(m=>{
    const c=CLIENTS.find(x=>x.id===m.client_id);
    const d=new Date(m.due_date); d.setHours(0,0,0,0);
    const daysUntil=Math.floor((d-todayMidnight)/86400000);
    if(daysUntil>14) return;
    const label=daysUntil<0?`${Math.abs(daysUntil)}d overdue`:daysUntil===0?'Today':daysUntil===1?'Tomorrow':`In ${daysUntil} days`;
    const clientName=c?c.name:'Unknown';
    t.push({id:'mtg-'+m.id, nm:clientName, act:`Personal meeting with ${clientName}`,
      why:m.title?`${m.title} · ${label}`:label, urg:daysUntil<-7?'urgent':daysUntil<=1?'due':'waiting',
      pri:3, isMtg:true, clientObj:c||null, mtgId:m.id});
  });

  return t.sort((a,b)=>({urgent:0,soon:1,normal:2}[a.urg]||2)-({urgent:0,soon:1,normal:2}[b.urg]||2)||a.pri-b.pri);
}

// ── HOME ──────────────────────────────────────────────────────────
function updateProgressRing(tot, nd, urg, desc){
  const pct = tot ? Math.round(nd/tot*100) : 0;
  setTimeout(()=>{
    const el=document.getElementById('ring-el');
    if(el) el.style.strokeDashoffset=226.2-(pct/100)*226.2;
    document.getElementById('ring-pct').textContent=pct+'%';
  },80);
  document.getElementById('ps-done').textContent=nd;
  document.getElementById('ps-tot').textContent=tot;
  document.getElementById('ps-urg').textContent=urg;
  document.getElementById('prog-desc').textContent=desc;
}

async function rHome(){
  await getFxRates();
  // Quick stats row (always)
  const tc=DEALS.reduce((s,d)=>s+toUSD(d.v*(d.pct/100),d.cur),0);
  document.getElementById('qs-pipe').textContent=fm(tc);
  document.getElementById('qs-cli').textContent=CLIENTS.length;
  document.getElementById('qs-cam').textContent=CAMPAIGNS.length;
  document.getElementById('qs-par').textContent=PARTNERS.length;

  const list=document.getElementById('task-list');

  // Update mode toggle visual
  document.querySelectorAll('#home-mode-toggle .home-toggle-btn').forEach(b=>b.classList.toggle('on',b.dataset.mode===homeMode));

  // Load deal tasks if not cached
  if(homeDealTasks===null){
    list.innerHTML='<div style="padding:20px 0;text-align:center;font-size:12px;color:var(--t3)">Loading…</div>';
    const {data}=await SB.from('deal_tasks').select('*').eq('done',false).order('due_date',{ascending:true,nullsFirst:false}).limit(5000);
    homeDealTasks=(data||[]).filter(t=>!!t.due_date);
  }
  list.innerHTML='';

  const todayD=new Date(); todayD.setHours(0,0,0,0);
  function dealUrg(due){
    const d=new Date(due); d.setHours(0,0,0,0);
    const ov=Math.floor((todayD-d)/86400000);
    return ov>=7?'urgent':ov>=0?'due':'waiting';
  }

  const netTasks=mkTasks();
  const BUCKETS=[
    {key:'deals',    label:'Deals',              items:[]},
    {key:'followups',label:'Follow-Ups',         items:[]},
    {key:'mandates', label:'Mandates',           items:[]},
    {key:'luxury',   label:'Luxury',             items:[]},
    {key:'seasonal', label:'Seasonal Campaigns', items:[]},
  ];

  homeDealTasks
    .filter(t=>homeMode==='focus'?dealUrg(t.due_date)!=='waiting':true)
    .forEach(t=>BUCKETS[0].items.push({isDeal:true, t, urg:dealUrg(t.due_date)}));
  netTasks.forEach(t=>{
    const cam=t.camId?CAMPAIGNS.find(c=>c.id===t.camId):null;
    let b;
    if(cam){
      if(cam.type==='Mandate') b=BUCKETS[2];
      else if(cam.type==='Seasonal'||cam.type==='Triggered') b=BUCKETS[4];
      else if(['Follow-Up','WhatsApp','Calling','Personal'].includes(cam.type)) b=BUCKETS[1];
      else b=BUCKETS[3];
    } else b=BUCKETS[1]; // cadence + meetings
    b.items.push({isDeal:false, t, urg:t.urg});
  });

  const allItems=BUCKETS.flatMap(b=>b.items);
  const tot=allItems.length+doneDealTasksToday;
  const nd=doneTasks.size+doneDealTasksToday;
  const urg=allItems.filter(x=>x.urg==='urgent').length;
  updateProgressRing(tot,nd,urg,
    nd===tot&&tot>0?'All done — exceptional work.':`${tot-nd} task${tot-nd===1?'':'s'} remaining`);

  let gi=0;
  BUCKETS.forEach(bucket=>{
    if(!bucket.items.length) return;
    const hdr=document.createElement('div');
    hdr.className='task-group-hdr'; hdr.textContent=bucket.label;
    list.appendChild(hdr);
    bucket.items.forEach(({isDeal, t, urg})=>{
      const el=document.createElement('div');
      el.style.animationDelay=(gi++*0.04)+'s';
      if(isDeal){
        el.className=`tc ${urg} a`;
        const deal=DEALS.find(d=>d.id===t.deal_id);
        const client=deal?CLIENTS.find(c=>c.id===deal.clientId):null;
        const act=client?`${t.title} \u2014 ${client.name}`:t.title;
        el.innerHTML=`<div class="tc-av deal-tc-av"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></div>
          <div class="tc-body" style="cursor:pointer"><div class="tc-act">${act}</div><div class="tc-why">${dealTaskTimer(t.due_date)}</div></div>
          <div class="chk"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke-width="3.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg></div>`;
        el.querySelector('.chk').onclick=(ev)=>tickDealTask(t.id,el.querySelector('.chk'),ev);
        el.querySelector('.tc-body').onclick=(ev)=>{ev.stopPropagation();openRescheduleTask(t.id,t.title,t.due_date);};
        if(deal) el.onclick=(ev)=>{if(ev.target.closest('.chk')||ev.target.closest('.tc-body')) return; openDealModal(deal.clientId,deal.id);};
      } else {
        const avClass=t.isCam?'cam-av':'';
        const avContent=t.isCam?'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 4l16 8-16 8V4z"/></svg>':ini(t.nm);
        el.className=`tc ${t.isCam?'campaign':urg} a`;
        const isDone=doneTasks.has(t.id);
        if(isDone && homeMode==='focus'){ el.style.display='none'; }
        if(isDone && homeMode==='all'){ el.style.opacity='0.45'; }
        el.innerHTML=`<div class="tc-av ${avClass}">${avContent}</div>
          <div class="tc-body"><div class="tc-act">${t.act}</div><div class="tc-why">${t.why}</div></div>
          <div class="chk ${isDone?'on':''}" onclick="tick('${t.id}',this,event)"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke-width="3.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg></div>`;
        if(t.isCam){
          el.onclick=(e)=>{ if(e.target.closest('.chk')) return;
            const cam=CAMPAIGNS.find(c=>c.id===t.camId);
            if(t.clientObj) openWaSheet(t.clientObj,cam); else openCampaign(cam);
          };
        } else if(t.isMtg){
          el.onclick=(e)=>{ if(e.target.closest('.chk')) return; openEditMeeting(t.mtgId); };
        } else {
          const isCall=t.id.startsWith('cl-');
          const client=CLIENTS.find(c=>'wa-'+c.id===t.id||'cl-'+c.id===t.id);
          if(client) el.onclick=(e)=>{ if(e.target.closest('.chk')) return; openSnoozeCadence(client.id,isCall?'call':'wa'); };
        }
      }
      list.appendChild(el);
    });
  });

  // ALL mode: show completed deal tasks (session + DB) with undo
  if(homeMode==='all'){
    if(homeDoneDealTasks===null){
      const {data}=await SB.from('deal_tasks').select('*').eq('done',true).order('due_date',{ascending:false}).limit(100);
      homeDoneDealTasks=data||[];
    }
    // Merge session completions + DB completions, deduplicate
    const seenIds=new Set(doneHomeDealTasks.map(t=>t.id));
    const allDone=[...doneHomeDealTasks, ...(homeDoneDealTasks).filter(t=>!seenIds.has(t.id))];
    if(allDone.length){
      const doneHdr=document.createElement('div');
      doneHdr.className='task-group-hdr'; doneHdr.textContent='Completed';
      list.appendChild(doneHdr);
      const CHK_SVG='<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke-width="3.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>';
      const DEAL_ICON='<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>';
      allDone.forEach((t,i)=>{
        const deal=DEALS.find(d=>d.id===t.deal_id);
        const client=deal?CLIENTS.find(c=>c.id===deal.clientId):null;
        const act=client?`${t.title} \u2014 ${client.name}`:t.title;
        const el=document.createElement('div');
        el.className='tc done a'; el.style.animationDelay=(i*0.04)+'s'; el.style.opacity='0.45';
        el.innerHTML=`<div class="tc-av deal-tc-av">${DEAL_ICON}</div>
          <div class="tc-body"><div class="tc-act">${act}</div><div class="tc-why">${dealTaskTimer(t.due_date)}</div></div>
          <div class="chk on">${CHK_SVG}</div>`;
        el.querySelector('.chk').onclick=(ev)=>{ev.stopPropagation(); unTickDealTask(t.id);};
        list.appendChild(el);
      });
    }
  }
}

function switchHomeTab(tab){ homeDealTasks=null; rHome(); }

function dealTaskTimer(dueDate){
  if(!dueDate) return '';
  const today=new Date(); today.setHours(0,0,0,0);
  const due=new Date(dueDate); due.setHours(0,0,0,0);
  const diff=Math.floor((due-today)/86400000);
  if(diff>1)   return `<span class="dt-timer">Due in ${diff}d</span>`;
  if(diff===1)  return `<span class="dt-timer dt-tomorrow">Due tomorrow</span>`;
  if(diff===0)  return `<span class="dt-timer dt-today">Due today</span>`;
  const over=Math.abs(diff);
  if(over<=3)   return `<span class="dt-timer dt-grace">${over}d overdue</span>`;
  return `<span class="dt-timer dt-late">${over} days overdue</span>`;
}

async function renderHomeDealTasks(){
  const list=document.getElementById('task-list');
  if(homeDealTasks===null){
    list.innerHTML='<div style="padding:20px 0;text-align:center;font-size:12px;color:var(--t3)">Loading…</div>';
    const {data}=await SB.from('deal_tasks').select('*').eq('done',false).order('due_date',{ascending:true,nullsFirst:false}).limit(5000);
    // Filter: only show tasks due today or overdue (no future tasks)
    const todayD=new Date(); todayD.setHours(0,0,0,0);
    homeDealTasks=(data||[]).filter(t=>{
      if(!t.due_date) return false;
      const d=new Date(t.due_date); d.setHours(0,0,0,0);
      return d<=todayD;
    });
  }

  // Update progress ring for deals tab
  const tot=homeDealTasks.length+doneDealTasksToday;
  const nd=doneDealTasksToday;
  const urg=homeDealTasks.filter(t=>{
    const d=new Date(t.due_date); d.setHours(0,0,0,0);
    const now=new Date(); now.setHours(0,0,0,0);
    return Math.floor((now-d)/86400000)>3;
  }).length;
  updateProgressRing(tot,nd,urg,
    tot===0?'No deal tasks due today.':nd===tot&&tot>0?'All done — great progress.':`${tot-nd} deal task${tot-nd===1?'':'s'} remaining today`);

  list.innerHTML='';
  if(!homeDealTasks.length){
    list.innerHTML='<div style="padding:24px 0;text-align:center;font-size:13px;color:var(--t3);font-style:italic">No deal tasks due today.</div>';
    return;
  }

  const catMap=new Map();
  homeDealTasks.forEach(t=>{
    const deal=DEALS.find(d=>d.id===t.deal_id);
    const cat=deal?deal.cat:'Other';
    if(!catMap.has(cat)) catMap.set(cat,[]);
    catMap.get(cat).push({t,deal});
  });

  let gi=0;
  catMap.forEach((items,cat)=>{
    const hdr=document.createElement('div');
    hdr.className='task-group-hdr'; hdr.textContent=cat;
    list.appendChild(hdr);
    items.forEach(({t,deal})=>{
      const client=deal?CLIENTS.find(c=>c.id===deal.clientId):null;
      const cname=client?client.name:'';
      const act=cname?`${t.title} \u2014 ${cname}`:t.title;
      const el=document.createElement('div');
      el.className='tc normal a'; el.style.animationDelay=(gi++*0.04)+'s';
      el.innerHTML=`<div class="tc-av deal-tc-av">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
        </div>
        <div class="tc-body" style="cursor:pointer"><div class="tc-act">${act}</div><div class="tc-why">${dealTaskTimer(t.due_date)}</div></div>
        <div class="chk">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke-width="3.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
        </div>`;
      // Tick
      el.querySelector('.chk').onclick=(ev)=>tickDealTask(t.id,el.querySelector('.chk'),ev);
      el.querySelector('.tc-body').onclick=(ev)=>{ev.stopPropagation();openRescheduleTask(t.id,t.title,t.due_date);};
      if(deal) el.onclick=(ev)=>{if(ev.target.closest('.chk')||ev.target.closest('.tc-body')) return; openDealModal(deal.clientId,deal.id);};
      list.appendChild(el);
    });
  });
}


let rescheduleTaskId=null;
function openRescheduleTask(id, title, currentDate){
  rescheduleTaskId=id;
  document.getElementById('reschedule-task-name').textContent=title||'Task';
  document.getElementById('reschedule-date').value=currentDate||'';
  openModal('modal-reschedule-task');
}
async function saveRescheduleTask(){
  const newDate=document.getElementById('reschedule-date').value;
  if(!newDate||!rescheduleTaskId) return;
  const {error}=await SB.from('deal_tasks').update({due_date:newDate}).eq('id',rescheduleTaskId);
  if(error){ showToast('Could not reschedule'); return; }
  const t=homeDealTasks?.find(x=>x.id===rescheduleTaskId);
  if(t) t.due_date=newDate;
  // Keep CLIENT_DEAL_TASKS in sync so profile follow-ups show the updated date
  Object.values(CLIENT_DEAL_TASKS).forEach(tasks=>{
    const ct=tasks.find(x=>x.id===rescheduleTaskId);
    if(ct) ct.due_date=newDate;
  });
  closeModal('modal-reschedule-task');
  homeDealTasks=null; // force reload
  renderHomeDealTasks();
  // Refresh follow-ups if a client profile is currently open
  const profBody=document.getElementById('ps-client-body');
  if(profBody?.dataset.clientId) _refreshMeetingFollowUps(profBody.dataset.clientId);
  showToast('Task rescheduled ✓');
}



let _snoozeCadence=null; // {clientId, type:'wa'|'call'}
function openSnoozeCadence(clientId, type){
  const c=CLIENTS.find(x=>x.id===clientId); if(!c) return;
  _snoozeCadence={clientId,type};
  document.getElementById('snooze-cadence-name').textContent=(type==='call'?'Call':'WhatsApp')+' · '+c.name;
  // Pre-fill with tomorrow as a sensible default
  const tomorrow=new Date(); tomorrow.setDate(tomorrow.getDate()+1);
  document.getElementById('snooze-cadence-date').value=tomorrow.toISOString().split('T')[0];
  openModal('modal-snooze-cadence');
}
async function saveSnoozeCadence(){
  if(!_snoozeCadence) return;
  const {clientId,type}=_snoozeCadence;
  const chosenDate=document.getElementById('snooze-cadence-date').value;
  if(!chosenDate){ showToast('Please pick a date'); return; }
  const c=CLIENTS.find(x=>x.id===clientId); if(!c) return;
  const rel=REL_CADENCES[c.relationship];
  if(!rel){ showToast('No cadence found'); return; }
  // Compute last-contact date that makes this task next due on chosenDate
  const cadenceDays=type==='call'?rel.cD:rel.waD;
  const dueMs=new Date(chosenDate).getTime();
  const newLastMs=dueMs-(cadenceDays*86400000);
  const newLastDate=new Date(newLastMs).toISOString().split('T')[0];
  // Insert a backdated activity so the source of truth (client_activities) is correct
  const actType=type==='call'?'call':'whatsapp';
  const {error}=await SB.from('client_activities').insert({client_id:clientId,type:actType,occurred_at:new Date(newLastMs).toISOString()});
  if(error){ showToast('Could not reschedule'); return; }
  applyActivity(clientId,actType,new Date(newLastMs).toISOString());
  closeModal('modal-snooze-cadence');
  _snoozeCadence=null;
  rHome();
  if(curTab==='clients') rClients();
  showToast('Rescheduled ✓');
}

async function unTickDealTask(id){
  const task=doneHomeDealTasks.find(t=>t.id===id)||(homeDoneDealTasks||[]).find(t=>t.id===id);
  if(!task) return;
  const {error}=await SB.from('deal_tasks').update({done:false}).eq('id',id);
  if(error){ showToast('Could not undo'); return; }
  doneHomeDealTasks=doneHomeDealTasks.filter(t=>t.id!==id);
  if(homeDoneDealTasks) homeDoneDealTasks=homeDoneDealTasks.filter(t=>t.id!==id);
  if(task.due_date){
    homeDealTasks=[...(homeDealTasks||[]),task].sort((a,b)=>new Date(a.due_date)-new Date(b.due_date));
    doneDealTasksToday=Math.max(0,doneDealTasksToday-1);
  }
  rHome();
}

async function tickDealTask(id,el,e){
  e.stopPropagation();
  el.classList.add('on');
  const card=el.closest('.tc');
  card.classList.add('done');
  // Store for undo in ALL mode
  const taskObj=(homeDealTasks||[]).find(t=>t.id===id);
  if(taskObj && !doneHomeDealTasks.find(t=>t.id===id)) doneHomeDealTasks.push(taskObj);
  await SB.from('deal_tasks').update({done:true}).eq('id',id);
  homeDealTasks=(homeDealTasks||[]).filter(t=>t.id!==id);
  doneDealTasksToday++;
  // Update ring
  const tot=homeDealTasks.length+doneDealTasksToday;
  const nd=doneDealTasksToday;
  const urg=homeDealTasks.filter(t=>{
    const d=new Date(t.due_date); d.setHours(0,0,0,0);
    const now=new Date(); now.setHours(0,0,0,0);
    return Math.floor((now-d)/86400000)>3;
  }).length;
  updateProgressRing(tot,nd,urg,
    tot===0?'No deal tasks due today.':nd===tot?'All done — great progress.':`${tot-nd} deal task${tot-nd===1?'':'s'} remaining today`);
  // Fade out card
  setTimeout(()=>{
    card.style.transition='opacity 0.45s, max-height 0.45s, margin-bottom 0.45s, padding 0.45s';
    card.style.opacity='0';
    card.style.maxHeight='0';
    card.style.overflow='hidden';
    card.style.padding='0';
    card.style.marginBottom='0';
    setTimeout(()=>card.remove(),450);
  },2000);
}

async function tick(id, el, e){
  e.stopPropagation();
  const today=new Date().toISOString().split('T')[0];
  if(doneTasks.has(id)){
    // Un-tick: restore and re-render
    doneTasks.delete(id);
    await SB.from('task_completions').delete().eq('task_key',id);
    rHome();
  } else {
    doneTasks.add(id);
    el.classList.add('on');
    const card=el.parentElement;
    await SB.from('task_completions').upsert({task_key:id,reset_date:today},{onConflict:'task_key'});
    // Log contact activity — client_activities is the source of truth; applyActivity patches c.wa/c.call
    const now=new Date().toISOString();
    if(id.startsWith('wa-')){
      const cid=id.slice(3);
      await SB.from('client_activities').insert({client_id:cid,type:'whatsapp',occurred_at:now});
      applyActivity(cid,'whatsapp',now);
    } else if(id.startsWith('cl-')){
      const cid=id.slice(3);
      await SB.from('client_activities').insert({client_id:cid,type:'call',occurred_at:now});
      applyActivity(cid,'call',now);
    } else if(id.startsWith('mtg-')){
      const mid=id.slice(4);
      const m=MEETINGS.find(x=>x.id===mid)||null;
      await SB.from('client_meetings').update({done:true}).eq('id',mid);
      MEETINGS=MEETINGS.filter(x=>x.id!==mid);
      if(m?.client_id){
        await SB.from('client_activities').insert({client_id:m.client_id,type:'meeting',occurred_at:now});
        applyActivity(m.client_id,'meeting',now);
      }
    }
    // Update ring counts without re-rendering list
    const tasks=mkTasks(), tot=tasks.length+(homeDealTasks?.length||0)+doneDealTasksToday, nd=doneTasks.size+doneDealTasksToday;
    const urg=tasks.filter(t=>t.urg==='urgent'&&!doneTasks.has(t.id)).length;
    updateProgressRing(tot,nd,urg,
      nd===tot&&tot>0?'All done — exceptional work.':`${tot-nd} task${tot-nd===1?'':'s'} remaining`);
    // Fade out after 2 s
    setTimeout(()=>{
      card.style.transition='opacity 0.45s, max-height 0.45s, margin-bottom 0.45s, padding 0.45s';
      card.style.opacity='0';
      card.style.maxHeight='0';
      card.style.overflow='hidden';
      card.style.padding='0';
      card.style.marginBottom='0';
      setTimeout(()=>card.remove(),450);
    },2000);
  }
}

// ── DEALS ─────────────────────────────────────────────────────────
async function rDeals(){
  // Restore toggle state (switchHomeTab scoped to #s-home may have cleared these)
  document.querySelectorAll('#s-deals .home-toggle-btn').forEach(b=>b.classList.toggle('on',b.dataset.tab===dealTab));

  await getFxRates();

  // Totals always in USD
  const tc=DEALS.reduce((s,d)=>s+toUSD(d.v*(d.pct/100),d.cur),0);
  document.getElementById('d-tp').textContent=fmUSD(tc);
  document.getElementById('d-tc').textContent=DEALS.length;

  // Stage summary bubbles — USD
  const STAGE_IDS={Confirmed:'conf',Negotiation:'neg',Tentative:'tent',Waiting:'wait'};
  Object.entries(STAGE_IDS).forEach(([stage,key])=>{
    const sd=DEALS.filter(d=>d.s===stage);
    const sv=sd.reduce((s,d)=>s+toUSD(d.v*(d.pct/100),d.cur),0);
    document.getElementById('d-sg-'+key+'-v').textContent=fmUSD(sv);
    document.getElementById('d-sg-'+key+'-n').textContent=sd.length+(sd.length===1?' deal':' deals');
  });

  // Grouped deal list: Confirmed → Negotiation → Tentative → Waiting
  const list=document.getElementById('deal-list'); list.innerHTML='';
  const STAGE_ORDER=['Confirmed','Negotiation','Tentative','Waiting'];
  let cardIdx=0;
  STAGE_ORDER.forEach(stage=>{
    const staged=DEALS.filter(d=>d.s===stage).sort((a,b)=>(b.v*b.pct/100)-(a.v*a.pct/100));
    if(!staged.length) return;
    const hdr=document.createElement('div');
    hdr.className='rec-cat-header';
    hdr.textContent=stage;
    list.appendChild(hdr);
    staged.forEach(d=>{
      const client=CLIENTS.find(c=>c.id===d.clientId);
      const cname=client?client.name:d.clientId;
      const com=d.v*(d.pct/100);
      const el=document.createElement('div');
      el.className='dc gc-s a'; el.style.animationDelay=(cardIdx++*0.05)+'s';
      el.onclick=()=>openDealModal(d.clientId,d.id);
      el.innerHTML=`<div class="dc-top">
        <div><div class="dc-cli">${cname}</div><div class="dc-par">${d.pt} · ${d.cat}</div></div>
        <span class="pill ${STAGE_PILL_CLS[stage]||'p-gh'}" style="font-size:9px;flex-shrink:0">${d.s}</span>
      </div>
      <div class="dc-bot">
        <div><div class="dc-val">${fmUSD(toUSD(com,d.cur))}</div><div class="dc-spend">${fmUSD(toUSD(d.v,d.cur))} client spend</div></div>
      </div>`;
      list.appendChild(el);
    });
  });
}

let dealTab='deals';
function switchDealTab(tab){
  dealTab=tab;
  document.querySelectorAll('#s-deals .home-toggle-btn').forEach(b=>b.classList.toggle('on',b.dataset.tab===tab));
  document.getElementById('deal-list-wrap').style.display=tab==='deals'?'':'none';
  document.getElementById('deal-tasks-timeline').style.display=tab==='tasks'?'':'none';
  if(tab==='tasks') renderDealTasksTimeline();
}

async function renderDealTasksTimeline(){
  const wrap=document.getElementById('deal-tasks-timeline');
  wrap.innerHTML='<div style="padding:20px 0;text-align:center;font-size:12px;color:var(--t3)">Loading…</div>';
  const [{data:undoneData},{data:doneData}]=await Promise.all([
    SB.from('deal_tasks').select('*').eq('done',false).order('due_date',{ascending:true,nullsFirst:false}),
    SB.from('deal_tasks').select('*').eq('done',true).order('due_date',{ascending:false}).limit(100),
  ]);
  const tasks=undoneData||[];
  const doneTasks2=doneData||[];
  wrap.innerHTML='';
  if(!tasks.length && !doneTasks2.length){ wrap.innerHTML='<div style="padding:24px 0;text-align:center;font-size:13px;color:var(--t3);font-style:italic">No tasks.</div>'; return; }
  if(!tasks.length && doneTasks2.length){
    // skip to completed section below
  }
  const today=new Date(); today.setHours(0,0,0,0);
  const buckets=new Map();
  tasks.forEach(t=>{
    if(!t.due_date){ const k='No Date'; if(!buckets.has(k)) buckets.set(k,{label:'No Date',color:'',items:[]}); buckets.get(k).items.push(t); return; }
    const d=new Date(t.due_date); d.setHours(0,0,0,0);
    const diff=Math.round((d-today)/86400000);
    let label,color='';
    if(diff<0){label='Overdue';color='var(--red)';}
    else if(diff===0){label='Today';color='var(--gold)';}
    else if(diff===1){label='Tomorrow';}
    else label=d.toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'});
    if(!buckets.has(label)) buckets.set(label,{label,color,items:[]});
    buckets.get(label).items.push(t);
  });
  if(!buckets.size){ wrap.innerHTML='<div style="padding:24px 0;text-align:center;font-size:13px;color:var(--t3);font-style:italic">No outstanding tasks.</div>'; return; }
  buckets.forEach(({label,color,items})=>{
    const hdr=document.createElement('div');
    hdr.className='rec-cat-header';
    if(color) hdr.style.color=color;
    hdr.textContent=label;
    wrap.appendChild(hdr);
    const card=document.createElement('div');
    card.className='acts';
    items.forEach(t=>{
      const deal=DEALS.find(d=>d.id===t.deal_id);
      const client=deal?CLIENTS.find(c=>c.id===deal.clientId):null;
      const sub=[client?.name,deal?.pt].filter(Boolean).join(' · ');
      const row=document.createElement('div');
      row.className='act';
      row.style.cssText='padding:10px 14px;gap:12px;';
      row.innerHTML=`
        <div style="width:6px;height:6px;border-radius:50%;background:var(--gold);opacity:0.5;flex-shrink:0;margin-top:2px"></div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${t.title}</div>
          ${sub?`<div style="font-size:11px;color:var(--t3);margin-top:2px">${sub}</div>`:''}
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
          <div class="atl-edit" style="margin-top:0" onclick="event.stopPropagation();openEditDealTask('${t.id}','${(t.title||'').replace(/'/g,"\\'")}','${t.due_date||''}',true)"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></div>
          <div class="chk" onclick="event.stopPropagation();tickDealTaskTimeline('${t.id}',this.closest('.act'))"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke-width="3.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg></div>
        </div>`;
      card.appendChild(row);
    });
    wrap.appendChild(card);
  });

  // Completed section
  if(doneTasks2.length){
    const doneHdr=document.createElement('div');
    doneHdr.className='rec-cat-header'; doneHdr.style.cssText='opacity:0.5;margin-top:8px';
    doneHdr.textContent='Completed';
    wrap.appendChild(doneHdr);
    const doneCard=document.createElement('div');
    doneCard.className='acts';
    doneTasks2.forEach(t=>{
      const deal=DEALS.find(d=>d.id===t.deal_id);
      const client=deal?CLIENTS.find(c=>c.id===deal.clientId):null;
      const sub=[client?.name,deal?.pt].filter(Boolean).join(' · ');
      const row=document.createElement('div');
      row.className='act'; row.style.cssText='padding:10px 14px;gap:12px;opacity:0.45;';
      row.innerHTML=`
        <div style="width:6px;height:6px;border-radius:50%;background:var(--gold);opacity:0.5;flex-shrink:0;margin-top:2px"></div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-decoration:line-through">${t.title}</div>
          ${sub?`<div style="font-size:11px;color:var(--t3);margin-top:2px">${sub}</div>`:''}
        </div>
        <div class="chk on" onclick="event.stopPropagation();unTickDealTaskTimeline('${t.id}',this.closest('.act'))"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke-width="3.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg></div>`;
      doneCard.appendChild(row);
    });
    wrap.appendChild(doneCard);
  }
}

async function unTickDealTaskTimeline(id, row){
  row.style.transition='opacity 0.25s'; row.style.opacity='0';
  const {error}=await SB.from('deal_tasks').update({done:false}).eq('id',id);
  if(error){ showToast('Could not undo'); row.style.opacity='0.45'; return; }
  setTimeout(()=>renderDealTasksTimeline(), 260);
}

async function tickDealTaskTimeline(id,card){
  // Immediate visual: check on, strikethrough, dim
  const chkEl=card.querySelector('.chk');
  const titleEl=card.querySelector('[style*="font-weight:600"]');
  if(chkEl) chkEl.classList.add('on');
  if(titleEl){ titleEl.style.textDecoration='line-through'; titleEl.style.color='var(--t3)'; }
  card.style.opacity='0.38';

  // FLIP: record position before move, append to bottom, animate from old position
  const wrap=document.getElementById('deal-tasks-timeline');
  const first=card.getBoundingClientRect();
  wrap.appendChild(card);
  const last=card.getBoundingClientRect();
  const dy=first.top-last.top;
  card.style.transition='none';
  card.style.transform=`translateY(${dy}px)`;
  card.getBoundingClientRect(); // force reflow
  card.style.transition='transform 0.42s cubic-bezier(0.4,0,0.2,1)';
  card.style.transform='translateY(0)';

  // DB update — non-blocking, disappears on next render when tab is revisited
  SB.from('deal_tasks').update({done:true}).eq('id',id);
}

// ── CAMPAIGNS ─────────────────────────────────────────────────────
function rCampaigns(){
  const list=document.getElementById('cam-list'); list.innerHTML='';

  // Compute virtual follow-up counts first so stats can include them
  const _waDue=CLIENTS.filter(c=>{
    const rel=REL_CADENCES[c.relationship];
    if(!rel||c.relationship==='Archive'||!c.relationship) return false;
    if(rel.cD&&daysSince(c.call)>=rel.cD) return false;
    const lastAny=Math.min(daysSince(c.wa),daysSince(c.call));
    return rel.waD&&lastAny>=rel.waD;
  });
  const _callDue=CLIENTS.filter(c=>{
    const rel=REL_CADENCES[c.relationship];
    if(!rel||c.relationship==='Archive'||!c.relationship) return false;
    return rel.cD&&daysSince(c.call)>=rel.cD;
  });
  const _mtgDue=MEETINGS.filter(m=>Math.floor((new Date(m.due_date)-TODAY)/86400000)<=7);

  // Stats
  const total=CAMPAIGNS.length;
  const followUps=_waDue.length+_callDue.length+_mtgDue.length;
  const mandates=CAMPAIGNS.filter(c=>c.type==='Mandate').length;
  const luxury=CAMPAIGNS.filter(c=>['Event','Ongoing','Triggered','Seasonal'].includes(c.type)).length;
  const statsEl=document.getElementById('cam-stats');
  if(statsEl) statsEl.innerHTML=`
    <div class="cli-stat"><div class="cli-stat-n">${total}</div><div class="cli-stat-l">Total</div></div>
    <div class="cli-stat"><div class="cli-stat-n g">${followUps}</div><div class="cli-stat-l">Follow-Ups</div></div>
    <div class="cli-stat"><div class="cli-stat-n">${mandates}</div><div class="cli-stat-l">Mandates</div></div>
    <div class="cli-stat"><div class="cli-stat-n">${luxury}</div><div class="cli-stat-l">Luxury</div></div>
  `;

  const GROUPS=[
    {key:'mandates',  label:'Mandates',             cams:[]},
    {key:'luxury',    label:'Luxury',               cams:[]},
    {key:'holiday',   label:'Holidays & Birthdays', cams:[]},
    {key:'followups', label:'Follow-Ups',           cams:[]},
  ];

  const camSortKey=d=>{
    if(!d||d==='Ongoing'||d==='TBC') return 99999999999;
    try{ return new Date(d).getTime(); }catch(e){ return 99999999999; }
  };

  CAMPAIGNS.forEach(cam=>{
    let g;
    if(cam.type==='Follow-Up'||cam.type==='WhatsApp'||cam.type==='Calling'||cam.type==='Personal') g=GROUPS[3];
    else if(cam.type==='Mandate')                        g=GROUPS[0];
    else if(cam.type==='Seasonal'||cam.type==='Triggered') g=GROUPS[2];
    else if(cam.type==='Event'||cam.type==='Ongoing')    g=GROUPS[1];
    else                                                  g=GROUPS[1];
    g.cams.push(cam);
  });

  // Sort each group soonest first; Ongoing/TBC and birthday campaigns fall to the bottom
  const isBdayCam=c=>/birthday/i.test(c.name)||/birthday/i.test(c.occ||'');
  GROUPS.forEach(g=>g.cams.sort((a,b)=>{
    const ak=isBdayCam(a)?99999999999*2:camSortKey(a.date);
    const bk=isBdayCam(b)?99999999999*2:camSortKey(b.date);
    return ak-bk;
  }));

  let gi=0;
  GROUPS.forEach(group=>{
    if(!group.cams.length) return;
    const hdr=document.createElement('div');
    hdr.className='cam-group-hdr'; hdr.textContent=group.label;
    list.appendChild(hdr);
    group.cams.forEach(cam=>{
      const cnt=getCampaignContacts(cam).length;
      const el=document.createElement('div');
      el.className='camc gc a'; el.style.animationDelay=(gi++*0.05)+'s';
      el.onclick=()=>openCampaign(cam);
      el.innerHTML=`<div class="camc-top">
        <div class="camc-name">${cam.name}</div>
        <span class="pill ${CC[cam.type]||'p-gh'}">${cam.type}</span>
      </div>
      <div class="camc-body">${cam.notes||''}</div>
      <div class="camc-foot">
        ${cam.date?`<span class="pill p-gh">${fmtCamDate(cam.date)}</span>`:''}
        ${cam.seg?`<span class="pill p-gold">${cam.seg}</span>`:''}
        <span class="pill p-grn">${cnt} contacts</span>
      </div>`;
      list.appendChild(el);
    });
  });

  // ── Virtual Follow-Up cards (auto-generated from cadence + meetings) ──
  const waDue=_waDue, callDue=_callDue, mtgDue=_mtgDue;

  const virtualCams=[
    {label:'WhatsApp', type:'WhatsApp', color:'p-grn', count:waDue.length, desc:'Clients due a WhatsApp based on relationship cadence'},
    {label:'Calling',  type:'Calling',  color:'p-blu', count:callDue.length, desc:'Clients due a call — supersedes WhatsApp'},
    {label:'Personal', type:'Personal', color:'p-amb', count:mtgDue.length,  desc:'Scheduled meetings within the next 7 days'},
  ];
  const virtualData={WhatsApp:waDue, Calling:callDue, Personal:mtgDue.map(m=>({...m,_isMtg:true}))};
  if(virtualCams.some(v=>v.count>0)){
    const vhdr=document.createElement('div');
    vhdr.className='cam-group-hdr'; vhdr.textContent='Follow-Ups';
    list.appendChild(vhdr);
    virtualCams.forEach(v=>{
      if(!v.count) return;
      const el=document.createElement('div');
      el.className='camc gc a'; el.style.animationDelay=(gi++*0.05)+'s';
      el.onclick=()=>openVirtualCampaign(v.type, v.label, v.color, virtualData[v.type]);
      el.innerHTML=`<div class="camc-top">
        <div class="camc-name">${v.label}</div>
        <span class="pill ${v.color}">${v.type}</span>
      </div>
      <div class="camc-body">${v.desc}</div>
      <div class="camc-foot">
        <span class="pill p-grn">${v.count} client${v.count===1?'':'s'}</span>
        <span class="pill p-gh">Auto-generated</span>
      </div>`;
      list.appendChild(el);
    });
  }
}

let _vcItems=[],_vcType='',_vcLabel='',_vcColor='';
function openVirtualCampaign(type, label, colorClass, items){
  _vcItems=[...items]; _vcType=type; _vcLabel=label; _vcColor=colorClass;
  renderVirtualCampaignProfile(type, label, colorClass, items);
  pushProf('ps-campaign');
}

function renderVirtualCampaignProfile(type, label, colorClass, items){
  const iconSvg={
    WhatsApp:'<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    Calling:'<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13.6a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 3h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 10.91a16 16 0 0 0 5.61 5.61l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
    Personal:'<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  }[type]||'';

  const desc={
    WhatsApp:'Clients due a WhatsApp based on their relationship cadence. Ticking completes their daily task and resets the cadence clock.',
    Calling:'Clients due a call. Supersedes WhatsApp — ticking logs the call and resets the clock.',
    Personal:'Scheduled meetings within the next 7 days.',
  }[type]||'';

  let rosterHtml='';
  let pendingCount=0;

  if(type==='Personal'){
    pendingCount=items.length;
    rosterHtml=items.length?items.map(item=>{
      const client=CLIENTS.find(x=>x.id===item.client_id);
      const name=client?client.name:'Unknown';
      const daysUntil=Math.floor((new Date(item.due_date)-TODAY)/86400000);
      const whenLabel=daysUntil<0?`${Math.abs(daysUntil)}d overdue`:daysUntil===0?'Today':daysUntil===1?'Tomorrow':`In ${daysUntil} days`;
      return `<div class="cam-roster-item vcam-row a" id="vcam-mtg-${item.id}">
        <div class="cri-av">${ini(name)}</div>
        <div style="flex:1;min-width:0"><div class="cri-name">${name}</div><div class="cri-sub">${item.title||'Meeting'} · ${whenLabel}</div></div>
        <div class="cri-check" onclick="tickVirtualMtg('${item.id}','${type}','${label}','${colorClass}',this)">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke-width="3.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
      </div>`;
    }).join('')
    :'<div style="padding:16px;font-size:13px;color:var(--t3);font-style:italic">All done — nothing pending.</div>';
  } else {
    const taskPrefix=type==='Calling'?'cl-':'wa-';
    const pending=items.filter(item=>!doneTasks.has(taskPrefix+item.id));
    const done=items.filter(item=>doneTasks.has(taskPrefix+item.id));
    pendingCount=pending.length;
    const makeRow=(item,isDone)=>`<div class="cam-roster-item vcam-row a${isDone?' done':''}">
        <div class="cri-av">${ini(item.name)}</div>
        <div style="flex:1;min-width:0"><div class="cri-name">${item.name}</div><div class="cri-sub">${item.role||item.city||''}</div></div>
        <div class="cri-check${isDone?' on':''}"${isDone?'':` onclick="tickVirtualClient('${item.id}','${type}','${label}','${colorClass}',this)"`}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke-width="3.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
      </div>`;
    rosterHtml=pending.map(item=>makeRow(item,false)).join('');
    if(!pending.length) rosterHtml='<div style="padding:16px;font-size:13px;color:var(--t3);font-style:italic">All done — great work!</div>';
    if(done.length) rosterHtml+=`<div class="cam-done-divider" style="padding-left:0">Completed · ${done.length}</div>${done.map(item=>makeRow(item,true)).join('')}`;
  }

  document.getElementById('ps-campaign-body').innerHTML=`
    <div class="prof-back-row">
      <div class="prof-back" onclick="closeProf('ps-campaign')">
        <svg width="8" height="14" viewBox="0 0 8 14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M7 1L1 7l6 6"/></svg><span>Campaigns</span>
      </div>
    </div>
    <div class="prof-hero">
      <div class="prof-av-row">
        <div class="prof-av sq" style="background:rgba(138,109,62,0.09);border-color:var(--gold-border);color:var(--gold)">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">${iconSvg}</svg>
        </div>
        <div><div class="prof-name">${label}</div><div class="prof-role-l">Auto-generated · Follow-Up</div></div>
      </div>
      <div class="prof-pills">
        <span class="pill ${colorClass}">${type}</span>
        <span class="pill p-grn">${pendingCount} pending</span>
      </div>
    </div>
    <div class="prof-sec"><div class="sec-notes" style="font-size:12px">${desc}</div></div>
    <div class="prof-sec">
      <div class="sec-lbl">Pending · ${pendingCount}</div>
      ${rosterHtml}
    </div>
    <div style="height:36px"></div>`;
}

async function tickVirtualClient(clientId, type, label, colorClass, el){
  const c=CLIENTS.find(x=>x.id===clientId); if(!c) return;
  const taskKey=(type==='Calling'?'cl-':'wa-')+clientId;
  const today=new Date().toISOString().split('T')[0];
  doneTasks.add(taskKey);
  el.classList.add('on');
  el.closest('.cam-roster-item').classList.add('done');
  await SB.from('task_completions').upsert({task_key:taskKey,reset_date:today},{onConflict:'task_key'});
  if(type==='Calling'){
    await logCall(c);
  } else {
    await logWa(c);
  }
  // Re-render with full stored list so completed clients remain visible
  setTimeout(()=>renderVirtualCampaignProfile(_vcType,_vcLabel,_vcColor,_vcItems),500);
}

async function tickVirtualMtg(mtgId, type, label, colorClass, el){
  el.classList.add('on');
  el.closest('.cam-roster-item').classList.add('done');
  const m=MEETINGS.find(x=>x.id===mtgId);
  await SB.from('client_meetings').update({done:true}).eq('id',mtgId);
  MEETINGS=MEETINGS.filter(x=>x.id!==mtgId);
  if(m?.client_id){
    const now=new Date().toISOString();
    await SB.from('client_activities').insert({client_id:m.client_id,type:'meeting',occurred_at:now});
    applyActivity(m.client_id,'meeting',now);
  }
  rHome();
  const mtgDue=MEETINGS.filter(x=>Math.floor((new Date(x.due_date)-TODAY)/86400000)<=7);
  setTimeout(()=>renderVirtualCampaignProfile(type,label,colorClass,mtgDue),500);
}

async function openCampaign(cam){
  openCampaignId=cam.id;
  camCompletions=new Set();
  document.getElementById('ps-campaign-body').innerHTML=`
    <div class="prof-back-row">
      <div class="prof-back" onclick="closeProf('ps-campaign')">
        <svg width="8" height="14" viewBox="0 0 8 14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M7 1L1 7l6 6"/></svg><span>Campaigns</span>
      </div>
      <button class="prof-edit-btn" onclick="openEditCampaign('${cam.id}')">Edit</button>
    </div>
    <div style="padding:40px 20px;text-align:center;font-size:12px;color:var(--t3)">Loading…</div>`;
  pushProf('ps-campaign');
  const {data}=await SB.from('campaign_completions').select('contact_type,contact_id').eq('campaign_id',cam.id);
  camCompletions=new Set((data||[]).map(r=>r.contact_type+':'+r.contact_id));
  renderCampaignProfile(cam);
}

function renderCampaignProfile(cam){
  const allContacts=getCampaignContacts(cam);
  const total=allContacts.length;
  const doneCount=allContacts.filter(c=>camCompletions.has(c.type+':'+c.id)).length;

  allContacts.sort((a,b)=>{
    const aD=camCompletions.has(a.type+':'+a.id);
    const bD=camCompletions.has(b.type+':'+b.id);
    return aD===bD?0:aD?1:-1;
  });

  document.getElementById('ps-campaign-body').innerHTML=`
    <div class="prof-back-row">
      <div class="prof-back" onclick="closeProf('ps-campaign')">
        <svg width="8" height="14" viewBox="0 0 8 14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M7 1L1 7l6 6"/></svg><span>Campaigns</span>
      </div>
      <button class="prof-edit-btn" onclick="openEditCampaign('${cam.id}')">Edit</button>
    </div>
    <div class="prof-hero">
      <div class="prof-av-row">
        <div class="prof-av sq" style="background:rgba(42,95,168,0.09);border-color:rgba(42,95,168,0.22);color:var(--blue)">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 4l16 8-16 8V4z"/></svg>
        </div>
        <div><div class="prof-name">${cam.name}</div><div class="prof-role-l">${cam.type} · ${fmtCamDate(cam.date)}</div></div>
      </div>
      <div class="prof-pills">
        <span class="pill ${CC[cam.type]||'p-gh'}">${cam.type}</span>
        ${cam.seg?`<span class="pill p-gold">${cam.seg}</span>`:''}
        ${cam.occ?`<span class="pill p-amb">${cam.occ}</span>`:''}
        <span class="pill p-grn">${total} enrolled</span>
        ${doneCount?`<span class="pill p-gold">${doneCount} done</span>`:''}
      </div>
    </div>
    ${cam.notes?`<div class="prof-sec"><div class="sec-lbl">Campaign Brief</div><div class="sec-notes">${cam.notes}</div></div>`:''}
    <div class="prof-sec">
      <div class="sec-lbl" style="display:flex;justify-content:space-between;align-items:center">
        <span>Contacts · ${total}</span>
        <span style="font-size:11px;color:var(--gold);font-weight:600;cursor:pointer" onclick="openAddCamClient('${cam.id}')">+ Add</span>
      </div>
      <div id="cam-roster-list"></div>
    </div>
    <div style="height:36px"></div>`;

  const rosterEl=document.getElementById('cam-roster-list');
  if(!allContacts.length){
    rosterEl.innerHTML='<div style="padding:16px;font-size:13px;color:var(--t3);font-style:italic">No contacts enrolled yet.</div>';
    return;
  }

  allContacts.forEach((c,i)=>{
    const done=camCompletions.has(c.type+':'+c.id);

    if(done&&(i===0||!camCompletions.has(allContacts[i-1]?.type+':'+allContacts[i-1]?.id))){
      const divider=document.createElement('div');
      divider.className='cam-done-divider';
      divider.textContent=`Completed · ${doneCount}`;
      rosterEl.appendChild(divider);
    }

    const row=document.createElement('div');
    row.className='cam-roster-item'+(done?' done':'')+' a';
    row.style.cssText='position:relative;overflow:hidden;padding:0';

    // Red remove panel revealed on swipe
    const removeBtn=document.createElement('div');
    removeBtn.className='cri-remove-action';
    removeBtn.innerHTML=`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg><span>Remove</span>`;
    removeBtn.onclick=(e)=>{ e.stopPropagation(); removeCamContact(cam,c); };
    row.appendChild(removeBtn);

    // Sliding inner content
    const inner=document.createElement('div');
    inner.className='cri-inner';
    inner.innerHTML=`<div class="cri-av" style="${c.avStyle}">${c.av}</div>
      <div style="flex:1;min-width:0"><div class="cri-name">${c.name}</div><div class="cri-sub">${c.sub}</div></div>
      <div class="cri-check${done?' on':''}">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke-width="3.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
      </div>`;
    inner.querySelector('.cri-check').onclick=(e)=>{ e.stopPropagation(); toggleCamCompletion(cam.id,c.type,c.id); };
    row.appendChild(inner);

    addCamSwipe(row,inner);
    rosterEl.appendChild(row);
  });
}

let _openSwipeInner=null;
function _closeCamSwipe(){
  if(_openSwipeInner){
    _openSwipeInner.style.transition='transform 0.22s ease';
    _openSwipeInner.style.transform='translateX(0)';
    _openSwipeInner=null;
  }
}

function addCamSwipe(rowEl,innerEl){
  const SNAP=80, THRESH=44;
  let startX=0,startY=0,dx=0,swiped=false,scrolling=null;

  rowEl.addEventListener('touchstart',e=>{
    _closeCamSwipe();
    startX=e.touches[0].clientX; startY=e.touches[0].clientY;
    dx=0; scrolling=null;
    innerEl.style.transition='none';
  },{passive:true});

  rowEl.addEventListener('touchmove',e=>{
    const mx=e.touches[0].clientX-startX, my=e.touches[0].clientY-startY;
    if(scrolling===null) scrolling=Math.abs(my)>Math.abs(mx);
    if(scrolling) return;
    dx=mx;
    const base=swiped?-SNAP:0;
    innerEl.style.transform=`translateX(${Math.max(-SNAP,Math.min(0,base+dx))}px)`;
  },{passive:true});

  rowEl.addEventListener('touchend',()=>{
    if(scrolling) return;
    innerEl.style.transition='transform 0.22s ease';
    const base=swiped?-SNAP:0, final=base+dx;
    if(!swiped&&final<-THRESH){ innerEl.style.transform=`translateX(-${SNAP}px)`; swiped=true; _openSwipeInner=innerEl; }
    else if(swiped&&final>-THRESH){ innerEl.style.transform='translateX(0)'; swiped=false; _openSwipeInner=null; }
    else if(swiped){ innerEl.style.transform=`translateX(-${SNAP}px)`; _openSwipeInner=innerEl; }
    else{ innerEl.style.transform='translateX(0)'; }
  });
}

async function removeCamContact(cam,contact){
  if(contact.type==='client'){
    await toggleCamContact('client',contact.id,cam.id);
  } else if(contact.type==='partner'){
    const ids=(cam.manualPartnerIds||[]).filter(id=>id!==contact.id);
    const{error}=await SB.from('campaigns').update({manual_partner_ids:ids}).eq('id',cam.id);
    if(!error){ cam.manualPartnerIds=ids; renderCampaignProfile(cam); showToast('Removed'); }
  } else if(contact.type==='rec'){
    const ids=(cam.manualRecIds||[]).filter(id=>id!==contact.id);
    const{error}=await SB.from('campaigns').update({manual_rec_ids:ids}).eq('id',cam.id);
    if(!error){ cam.manualRecIds=ids; renderCampaignProfile(cam); showToast('Removed'); }
  }
}

async function toggleCamCompletion(camId, ctype, cid){
  const key=ctype+':'+cid;
  if(camCompletions.has(key)){
    await SB.from('campaign_completions').delete()
      .eq('campaign_id',camId).eq('contact_type',ctype).eq('contact_id',cid);
    camCompletions.delete(key);
  } else {
    await SB.from('campaign_completions').upsert(
      {campaign_id:camId,contact_type:ctype,contact_id:cid},
      {onConflict:'campaign_id,contact_type,contact_id'}
    );
    camCompletions.add(key);
  }
  const cam=CAMPAIGNS.find(c=>c.id===camId);
  if(cam) renderCampaignProfile(cam);
}

// ── ADD CONTACTS TO CAMPAIGN ──────────────────────────────────────
function openAddCamClient(camId){
  addingCampaignId=camId; addCamTab='clients';
  document.querySelectorAll('.add-cam-tab').forEach((t,i)=>t.classList.toggle('on',i===0));
  renderAddCamList();
  openModal('modal-add-cam-client');
}

function renderAddCamList(){
  const cam=CAMPAIGNS.find(c=>c.id===addingCampaignId); if(!cam) return;
  const list=document.getElementById('add-cam-client-list');
  if(addCamTab==='clients'){
    const segIds=getSegmentMatchedClients(cam);
    const excludedIds=new Set(cam.manualExcludedIds||[]);
    const manualIds=new Set(cam.manualClientIds||[]);
    // Sort: Auto first, then Manually Added, then Not enrolled, then Excluded last
    const sorted=[...CLIENTS].sort((a,b)=>{
      const ord=c=>{ if(segIds.includes(c.id)&&!excludedIds.has(c.id)) return 0; if(manualIds.has(c.id)) return 1; if(excludedIds.has(c.id)) return 3; return 2; };
      return ord(a)-ord(b);
    });
    list.innerHTML=sorted.map(c=>{
      const isAuto=segIds.includes(c.id)&&!excludedIds.has(c.id)&&!manualIds.has(c.id);
      const isAdded=manualIds.has(c.id);
      const isExcluded=excludedIds.has(c.id);
      let pillClass,pillLabel;
      if(isAdded){pillClass='p-gold';pillLabel='Added';}
      else if(isAuto){pillClass='p-grn';pillLabel='Auto';}
      else if(isExcluded){pillClass='p-red';pillLabel='Excluded';}
      else{pillClass='p-gh';pillLabel='Add';}
      return `<div class="cam-roster-item" onclick="toggleCamContact('client','${c.id}','${cam.id}')">
        <div class="cri-av">${ini(c.name)}</div>
        <div style="flex:1;min-width:0"><div class="cri-name">${c.name}</div><div class="cri-sub">${c.role||c.city||''}</div></div>
        <span class="pill ${pillClass}" style="font-size:9px">${pillLabel}</span>
      </div>`;
    }).join('');
  } else if(addCamTab==='partners'){
    list.innerHTML=`<div class="cam-roster-item" style="background:rgba(138,109,62,0.05)" onclick="toggleCamGroup('partners','${cam.id}')">
      <div class="cri-av" style="border-radius:10px;font-size:12px">All</div>
      <div style="flex:1;min-width:0"><div class="cri-name">All Partners</div><div class="cri-sub">${PARTNERS.length} partners</div></div>
      <span class="pill ${cam.includeAllPartners?'p-grn':'p-gh'}" style="font-size:9px">${cam.includeAllPartners?'Enrolled':'Add Group'}</span>
    </div>`+PARTNERS.map(p=>{
      const enrolled=(cam.manualPartnerIds||[]).includes(p.id)||cam.includeAllPartners;
      const pDisplayName=p.contact||p.name;
      const pAv=p.contact?ini(p.contact):abbr(p.name);
      return `<div class="cam-roster-item" onclick="toggleCamContact('partner','${p.id}','${cam.id}')">
        <div class="cri-av" style="border-radius:10px;background:rgba(46,125,82,0.09);border-color:rgba(46,125,82,0.22);color:var(--green)">${pAv}</div>
        <div style="flex:1;min-width:0"><div class="cri-name">${pDisplayName}</div><div class="cri-sub">${p.name}</div></div>
        <span class="pill ${enrolled?'p-grn':'p-gh'}" style="font-size:9px">${enrolled?'Enrolled':'Add'}</span>
      </div>`;
    }).join('');
  } else if(addCamTab==='rolodex'){
    list.innerHTML=`<div class="cam-roster-item" style="background:rgba(42,95,168,0.04)" onclick="toggleCamGroup('rolodex','${cam.id}')">
      <div class="cri-av" style="border-radius:10px;background:rgba(42,95,168,0.09);color:var(--blue);font-size:12px">All</div>
      <div style="flex:1;min-width:0"><div class="cri-name">All Rolodex</div><div class="cri-sub">${RECS.length} entries</div></div>
      <span class="pill ${cam.includeAllRolodex?'p-grn':'p-gh'}" style="font-size:9px">${cam.includeAllRolodex?'Enrolled':'Add Group'}</span>
    </div>`+RECS.map(r=>{
      const enrolled=(cam.manualRecIds||[]).includes(r.id)||cam.includeAllRolodex;
      return `<div class="cam-roster-item" onclick="toggleCamContact('rec','${r.id}','${cam.id}')">
        <div class="cri-av" style="border-radius:10px;background:rgba(42,95,168,0.09);color:var(--blue)">${(r.company||'?')[0]}</div>
        <div style="flex:1;min-width:0"><div class="cri-name">${r.company}</div><div class="cri-sub">${r.contact||r.category||''}</div></div>
        <span class="pill ${enrolled?'p-grn':'p-gh'}" style="font-size:9px">${enrolled?'Enrolled':'Add'}</span>
      </div>`;
    }).join('');
  }
}

function switchAddCamTab(el,tab){
  addCamTab=tab;
  document.querySelectorAll('.add-cam-tab').forEach(t=>t.classList.toggle('on',t===el));
  renderAddCamList();
}

async function toggleCamContact(type, contactId, camId){
  const cam=CAMPAIGNS.find(c=>c.id===camId); if(!cam) return;

  if(type==='client'){
    // 4-state logic: Auto → Exclude | Excluded → Restore | Added → Remove | Not enrolled → Add
    const segIds=getSegmentMatchedClients(cam);
    const isSegMatch=segIds.includes(contactId);
    const isExcluded=(cam.manualExcludedIds||[]).includes(contactId);
    const isManuallyAdded=(cam.manualClientIds||[]).includes(contactId);
    let newManualIds=[...(cam.manualClientIds||[])];
    let newExcludedIds=[...(cam.manualExcludedIds||[])];
    let toastMsg='';
    if(isManuallyAdded){
      newManualIds=newManualIds.filter(id=>id!==contactId);
      toastMsg='Removed';
    } else if(isExcluded){
      newExcludedIds=newExcludedIds.filter(id=>id!==contactId);
      toastMsg='Restored ✓';
    } else if(isSegMatch){
      newExcludedIds.push(contactId);
      toastMsg='Excluded';
    } else {
      newManualIds.push(contactId);
      toastMsg='Added ✓';
    }
    const {error}=await SB.from('campaigns').update({manual_client_ids:newManualIds,manual_excluded_ids:newExcludedIds}).eq('id',camId);
    if(error){ showToast('Error updating'); return; }
    cam.manualClientIds=newManualIds;
    cam.manualExcludedIds=newExcludedIds;
    renderAddCamList();
    if(openCampaignId===camId) renderCampaignProfile(cam);
    showToast(toastMsg);
    return;
  }

  // Partners and Rolodex — simple toggle
  let field, ids;
  if(type==='partner'){ field='manual_partner_ids'; ids=[...(cam.manualPartnerIds||[])]; }
  else { field='manual_rec_ids'; ids=[...(cam.manualRecIds||[])]; }
  const idx=ids.indexOf(contactId);
  if(idx>-1) ids.splice(idx,1); else ids.push(contactId);
  const {error}=await SB.from('campaigns').update({[field]:ids}).eq('id',camId);
  if(error){ showToast('Error updating'); return; }
  if(type==='partner') cam.manualPartnerIds=ids;
  else cam.manualRecIds=ids;
  renderAddCamList();
  if(openCampaignId===camId) renderCampaignProfile(cam);
  showToast(idx>-1?'Removed':'Added ✓');
}

async function toggleCamGroup(groupType, camId){
  const cam=CAMPAIGNS.find(c=>c.id===camId); if(!cam) return;
  const field=groupType==='partners'?'include_all_partners':'include_all_rolodex';
  const current=groupType==='partners'?cam.includeAllPartners:cam.includeAllRolodex;
  const {error}=await SB.from('campaigns').update({[field]:!current}).eq('id',camId);
  if(error){ showToast('Error'); return; }
  if(groupType==='partners') cam.includeAllPartners=!current;
  else cam.includeAllRolodex=!current;
  renderAddCamList();
  if(openCampaignId===camId) renderCampaignProfile(cam);
  showToast(!current?'Group added ✓':'Group removed');
}

async function resetCampaignContacts(){
  const cam=CAMPAIGNS.find(c=>c.id===addingCampaignId); if(!cam) return;
  if(!confirm('Reset this campaign to its original segment selection? All manual adds, removals and exclusions will be cleared.')) return;
  const {error}=await SB.from('campaigns').update({
    manual_client_ids:[],
    manual_excluded_ids:[],
    manual_partner_ids:[],
    manual_rec_ids:[],
    include_all_partners:false,
    include_all_rolodex:false,
  }).eq('id',cam.id);
  if(error){ showToast('Error resetting'); return; }
  cam.manualClientIds=[];
  cam.manualExcludedIds=[];
  cam.manualPartnerIds=[];
  cam.manualRecIds=[];
  cam.includeAllPartners=false;
  cam.includeAllRolodex=false;
  renderAddCamList();
  // Also re-render campaign profile if open
  if(openCampaignId===cam.id) renderCampaignProfile(cam);
  showToast('Reset to default ✓');
}

// ── CLIENTS ───────────────────────────────────────────────────────
function rClients(){
  const q=(document.getElementById('cli-q')||{}).value||'';
  let list=[...CLIENTS];

  // Active filters
  if(clientFilters.relationship) list=list.filter(c=>c.relationship===clientFilters.relationship);
  if(clientFilters.nw) list=list.filter(c=>c.nw===clientFilters.nw);
  if(clientFilters.interest) list=list.filter(c=>(c.int||[]).some(i=>i.toLowerCase()===clientFilters.interest.toLowerCase()));
  if(clientFilters.tag) list=list.filter(c=>(c.int||[]).includes(clientFilters.tag));
  if(clientFilters._nat) list=list.filter(c=>matchesNatCity(c.nat,clientFilters._nat));
  if(clientFilters._city) list=list.filter(c=>matchesNatCity(c.city,clientFilters._city));

  // Smart search: name, role, nationality (partial word), city, interests
  if(q){
    const ql=q.toLowerCase();
    list=list.filter(c=>{
      if((c.name||'').toLowerCase().includes(ql)) return true;
      if((c.role||'').toLowerCase().includes(ql)) return true;
      if(matchesNatCity(c.nat,q)) return true;
      if(matchesNatCity(c.city,q)) return true;
      if((c.int||[]).some(i=>i.toLowerCase().includes(ql))) return true;
      return false;
    });
  }

  // Stats
  const total=CLIENTS.length;
  const vips=CLIENTS.filter(c=>c.vip).length;
  const billionaires=CLIENTS.filter(c=>c.nw==='Billionaire').length;
  const centimillionaires=CLIENTS.filter(c=>c.nw==='Centimillionaire').length;
  const statsEl=document.getElementById('cli-stats');
  if(statsEl) statsEl.innerHTML=`
    <div class="cli-stat" onclick="filterByStat('total')" style="cursor:pointer"><div class="cli-stat-n">${total}</div><div class="cli-stat-l">Total</div></div>
    <div class="cli-stat" onclick="filterByStat('vip')" style="cursor:pointer"><div class="cli-stat-n g">${vips}</div><div class="cli-stat-l">VIPs</div></div>
    <div class="cli-stat" onclick="filterByStat('billionaire')" style="cursor:pointer"><div class="cli-stat-n">${billionaires}</div><div class="cli-stat-l">Billionaires</div></div>
    <div class="cli-stat" onclick="filterByStat('centimillionaire')" style="cursor:pointer"><div class="cli-stat-n">${centimillionaires}</div><div class="cli-stat-l">Centimilli.</div></div>
  `;

  // Active filter pills
  const activeBar=document.getElementById('cli-active-filters');
  if(activeBar){
    const pills=[];
    if(clientFilters.relationship) pills.push({label:clientFilters.relationship,key:'relationship'});
    if(clientFilters.nw) pills.push({label:clientFilters.nw,key:'nw'});
    if(clientFilters.interest) pills.push({label:clientFilters.interest,key:'interest'});
    if(clientFilters.tag) pills.push({label:clientFilters.tag,key:'tag'});
    if(clientFilters._nat) pills.push({label:'Nationality: '+clientFilters._nat,key:'_nat'});
    if(clientFilters._city) pills.push({label:'City: '+clientFilters._city,key:'_city'});
    activeBar.innerHTML=pills.map(p=>`<div class="active-fpill" onclick="removeFilter('${p.key}')">${p.label} ✕</div>`).join('');
    // Update filter button label
    const lbl=document.getElementById('cli-filter-lbl');
    if(lbl) lbl.textContent=pills.length?`Filter (${pills.length})`:'Filter';
  }

  const NW_ORDER=['Billionaire','Centimillionaire','HNWI'];
  list.sort((a,b)=>{
    // VIPs first, then by NW, then A-Z
    if(a.vip!==b.vip) return a.vip?-1:1;
    const ai=NW_ORDER.includes(a.nw)?NW_ORDER.indexOf(a.nw):99;
    const bi=NW_ORDER.includes(b.nw)?NW_ORDER.indexOf(b.nw):99;
    if(ai!==bi) return ai-bi;
    return (a.name||'').localeCompare(b.name||'');
  });

  const el=document.getElementById('cli-list'); el.innerHTML='';
  const showNwHeaders=!q&&!clientFilters.nw&&!clientFilters.tag;
  let lastGroup=null; // 'VIP' or NW value
  let idx=0;
  list.forEach(c=>{
    if(showNwHeaders){
      const group=c.vip?'VIP':c.nw;
      if(group!==lastGroup){
        lastGroup=group;
        const h=document.createElement('div');
        h.className='rec-cat-header'; h.textContent=group;
        el.appendChild(h);
      }
    }
    const rel=REL_CADENCES[c.relationship];
    const wa=daysSince(c.wa), cl=daysSince(c.call);
    const clOv=rel?.cD&&cl>=rel.cD, waOv=rel?.waD&&wa>=rel.waD;
    const div=document.createElement('div');
    div.className='pc gc a'; div.style.animationDelay=(idx++*0.04)+'s';
    div.onclick=()=>openC(c);
    const hasDeal=DEALS.some(d=>d.clientId===c.id);
    const _int=c.int||[];
    const cardTag=hasDeal?'<span class="pill p-gold pc-pill">Deal</span>':c.prospect?'<span class="pill p-blu pc-pill">Prospect</span>':_int.includes('High Potential')?'<span class="pill pc-pill" style="background:rgba(138,109,62,0.1);color:var(--gold);border-color:rgba(138,109,62,0.25)">High Potential</span>':'';
    const vipStar=c.vip?`<div class="pc-vip-star"><svg width="11" height="11" viewBox="0 0 24 24" fill="var(--gold)" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></div>`:'';
    div.innerHTML=`${vipStar}<div class="pc-av">${ini(c.name)}</div>
  <div class="pc-info">
    <div class="pc-name">${c.name}</div>
    <div class="pc-sub">${c.role||c.city||''}</div>
  </div>
  <div class="pc-r">${cardTag}</div>`;
    el.appendChild(div);
  });
}

function removeFilter(key){
  delete clientFilters[key];
  clientFilters[key]=null;
  rClients();
}

function matchesNatCity(val, query){
  if(!val||!query) return false;
  const v=val.toLowerCase(), q=query.toLowerCase();
  // Direct include
  if(v.includes(q)) return true;
  // Split compound values (e.g. "British Indian", "British/Palestinian")
  const parts=v.split(/[\s/,&-]+/).map(p=>p.trim()).filter(Boolean);
  return parts.some(p=>p.startsWith(q)||q.startsWith(p));
}

function openClientFilters(){
  // Populate interests dynamically from client data
  const interestSet=new Set();
  CLIENTS.forEach(c=>(c.int||[]).forEach(i=>interestSet.add(i.trim())));
  const interestChips=document.getElementById('filter-interests-chips');
  interestChips.innerHTML=[...interestSet].sort().map(i=>
    `<div class="fchip${clientFilters.interest===i?' on':''}" data-group="interest" data-val="${i}" onclick="toggleFChip(this)">${i}</div>`
  ).join('');
  // Restore current filter state in chips
  document.querySelectorAll('.fchip[data-group="relationship"]').forEach(c=>c.classList.toggle('on',c.dataset.val===clientFilters.relationship));
  document.querySelectorAll('.fchip[data-group="nw"]').forEach(c=>c.classList.toggle('on',c.dataset.val===clientFilters.nw));
  document.querySelectorAll('.fchip[data-group="tag"]').forEach(c=>c.classList.toggle('on',c.dataset.val===clientFilters.tag));
  openModal('modal-client-filters');
}

function toggleFChip(el){
  const group=el.dataset.group;
  // Single select per group — toggle off if already on
  const wasOn=el.classList.contains('on');
  document.querySelectorAll(`.fchip[data-group="${group}"]`).forEach(c=>c.classList.remove('on'));
  if(!wasOn) el.classList.add('on');
}

function applyClientFilters(){
  clientFilters.relationship=document.querySelector('.fchip[data-group="relationship"].on')?.dataset.val||null;
  clientFilters.nw=document.querySelector('.fchip[data-group="nw"].on')?.dataset.val||null;
  clientFilters.interest=document.querySelector('.fchip[data-group="interest"].on')?.dataset.val||null;
  clientFilters.tag=document.querySelector('.fchip[data-group="tag"].on')?.dataset.val||null;
  closeModal('modal-client-filters');
  rClients();
}

function clearClientFilters(){
  clientFilters={relationship:null,nw:null,interest:null,tag:null};
  document.querySelectorAll('.fchip').forEach(c=>c.classList.remove('on'));
  closeModal('modal-client-filters');
  rClients();
}

function filterByNat(val){
  // Called when tapping nationality in a client profile
  clientFilters={relationship:null,nw:null,interest:null,tag:null,_nat:val};
  if(curTab!=='clients') go('clients'); else rClients();
}
function filterByCity(val){
  clientFilters={relationship:null,nw:null,interest:null,tag:null,_city:val};
  if(curTab!=='clients') go('clients'); else rClients();
}
function filterByStat(key){
  clientFilters={relationship:null,nw:null,interest:null,tag:null};
  if(key==='vip') clientFilters.tag='VIP';
  else if(key==='billionaire') clientFilters.nw='Billionaire';
  else if(key==='centimillionaire') clientFilters.nw='Centimillionaire';
  // 'total' clears all — already done above
  rClients();
}

// ── ACTIVITY TIMELINE ─────────────────────────────────────────────
async function loadClientActivities(clientId, client){
  const {data,error}=await SB.from('client_activities').select('*').eq('client_id',clientId).order('occurred_at',{ascending:false});
  CLIENT_ACTIVITIES=error?[]:(data||[]);

  // Backfill: if no call/wa activities exist yet, seed from last_call/last_wa
  // (handles history logged before the timeline existed)
  if(client){
    const hasCall=CLIENT_ACTIVITIES.some(a=>a.type==='call'||a.type==='meeting');
    const hasWa=CLIENT_ACTIVITIES.some(a=>a.type==='whatsapp');
    if(!hasCall && client.call){
      const {data:bf}=await SB.from('client_activities').insert({client_id:clientId,type:'call',occurred_at:new Date(client.call+'T12:00:00').toISOString()}).select().single();
      if(bf) CLIENT_ACTIVITIES.push(bf);
    }
    if(!hasWa && client.wa){
      const {data:bf}=await SB.from('client_activities').insert({client_id:clientId,type:'whatsapp',occurred_at:new Date(client.wa+'T12:00:00').toISOString()}).select().single();
      if(bf) CLIENT_ACTIVITIES.push(bf);
    }
  }

  // Merge campaign completions as synthetic entries
  const {data:camComps}=await SB.from('campaign_completions').select('campaign_id,contact_id,created_at').eq('contact_type','client').eq('contact_id',clientId);
  (camComps||[]).forEach(cc=>{
    const cam=CAMPAIGNS.find(x=>x.id===cc.campaign_id); if(!cam) return;
    const oat=cc.created_at||(cam.date&&cam.date!=='TBC'?new Date(cam.date+'T12:00:00').toISOString():new Date().toISOString());
    CLIENT_ACTIVITIES.push({id:'cam-'+cc.campaign_id,client_id:clientId,type:'campaign',occurred_at:oat,notes:cam.name,_synthetic:true,_camId:cc.campaign_id});
  });

  CLIENT_ACTIVITIES.sort((a,b)=>new Date(b.occurred_at)-new Date(a.occurred_at));

  // Reconcile last_wa/last_call to match the most recent real activity of each type
  if(client){
    const rWa=CLIENT_ACTIVITIES.filter(a=>a.type==='whatsapp'&&!a._synthetic)[0];
    if(rWa){ const d=new Date(rWa.occurred_at).toISOString().split('T')[0]; if(d!==client.wa){ await SB.from('clients').update({last_wa:d}).eq('id',clientId); client.wa=d; } }
    const rCall=CLIENT_ACTIVITIES.filter(a=>(a.type==='call'||a.type==='meeting')&&!a._synthetic)[0];
    if(rCall){ const d=new Date(rCall.occurred_at).toISOString().split('T')[0]; if(d!==client.call){ await SB.from('clients').update({last_call:d}).eq('id',clientId); client.call=d; } }
  }
}

function fmtActivityDate(iso){
  const d=new Date(iso);
  const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function toLocalDateStr(iso){
  const d=new Date(iso);
  const pad=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

function activityIcon(type){
  if(type==='whatsapp') return `<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
  if(type==='call')     return `<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13.6a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 3h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 10.91a16 16 0 0 0 5.61 5.61l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`;
  if(type==='campaign') return `<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;
  return `<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`;
}

function renderClientFollowUps(c){
  const items=[];
  const todayM=new Date(); todayM.setHours(0,0,0,0);
  const daysLabel=d=>d<0?`${Math.abs(d)}d overdue`:d===0?'Today':d===1?'Tomorrow':`In ${d} days`;
  const urgOf=d=>d<0?'urgent':d<=1?'soon':'normal';

  // ── 1. Scheduled meetings (always show regardless of distance) ──
  const clientMtgs=MEETINGS.filter(m=>m.client_id===c.id).sort((a,b)=>new Date(a.due_date)-new Date(b.due_date));
  const mtgDaysArr=clientMtgs.map(m=>{ const md=new Date(m.due_date); md.setHours(0,0,0,0); return Math.floor((md-todayM)/86400000); });
  const nextMtgDays=mtgDaysArr.length?mtgDaysArr[0]:999;
  const hasMtgWithin7=nextMtgDays<=7;
  clientMtgs.forEach((m,i)=>{
    const du=mtgDaysArr[i];
    items.push({
      label:`Personal Meeting${m.title?' for '+m.title:''}`, sub:daysLabel(du),
      urg:urgOf(du), sortKey:du,
      clickFn:`openEditMeeting('${m.id}')`,
      checkFn:`tickFollowUpMeeting('${c.id}','${m.id}',this.closest('.act'))`
    });
  });

  // ── 2. Cadence (WhatsApp / Call) ──
  // If meeting within 7 days: cadence suppressed entirely
  // If meeting > 7 days (or none): show call or WA based on most recent contact
  if(!hasMtgWithin7){
    const rel=REL_CADENCES[c.relationship];
    if(rel&&c.relationship!=='Archive'){
      const cl=daysSince(c.call), wa=daysSince(c.wa);
      // Most recent contact of any type — if within WA window, WA is not overdue
      const lastAny=Math.min(cl,wa);
      if(rel.cD&&cl>=rel.cD){
        const ov=cl-rel.cD;
        items.push({
          label:'Phone Call due', sub:cl===9999?'Never called':`${cl}d since last call`,
          urg:ov>14?'urgent':'soon', sortKey:-ov,
          done:doneTasks.has('cl-'+c.id),
          clickFn:null, checkFn:`tickFollowUpCall('${c.id}',this.closest('.act'))`
        });
      }
      // WA only due if the most recent contact of ANY type (call or WA) exceeds the WA window
      if(rel.waD&&lastAny>=rel.waD&&!(rel.cD&&cl>=rel.cD)){
        const ov=lastAny-rel.waD;
        const waSub=lastAny===9999?'Never contacted':cl<=wa?`${cl}d since last call`:`${wa}d since last message`;
        items.push({
          label:'WhatsApp due', sub:waSub,
          urg:ov>7?'urgent':'soon', sortKey:-ov,
          done:doneTasks.has('wa-'+c.id),
          clickFn:null, checkFn:`tickFollowUpWa('${c.id}',this.closest('.act'))`
        });
      }
    }
  }

  // ── 3. Deal tasks (due/overdue, ≤30 days) ──
  const dealTasks=CLIENT_DEAL_TASKS[c.id]||[];
  const todayD=new Date(); todayD.setHours(0,0,0,0);
  dealTasks.forEach(t=>{
    const safeTitle=(t.title||'Deal task').replace(/'/g,"\\'");
    if(!t.due_date){
      items.push({
        label:t.title||'Deal task', sub:'No due date', urg:'normal', sortKey:999,
        clickFn:null,
        checkFn:`tickFollowUpDealTask('${c.id}','${t.id}',this.closest('.act'))`
      });
      return;
    }
    const td=new Date(t.due_date); td.setHours(0,0,0,0);
    const du=Math.floor((td-todayD)/86400000);
    if(du>30) return;
    const deal=DEALS.find(d=>d.id===t.deal_id);
    items.push({
      label:t.title||'Deal task', sub:`${deal?deal.pt+' · ':''}${daysLabel(du)}`,
      urg:urgOf(du), sortKey:du,
      clickFn:`openRescheduleTask('${t.id}','${safeTitle}','${t.due_date}')`,
      checkFn:`tickFollowUpDealTask('${c.id}','${t.id}',this.closest('.act'))`
    });
  });

  // ── 4. Active campaign tasks for this client (≤30 days, not personal meetings) ──
  CAMPAIGNS.forEach(cam=>{
    if(cam.type==='Personal') return; // personal meetings handled above
    if(cam.date!=='Ongoing'){
      if(cam.date==='TBC') return;
      try{
        const cd=new Date(cam.date); cd.setHours(0,0,0,0);
        const diff=Math.floor((cd-todayM)/86400000);
        if(diff>30||diff<-3) return; // outside window
      }catch(e){ return; }
    }
    // Birthday campaign: only show if client has dob
    const isBday=/birthday/i.test(cam.name)||/birthday/i.test(cam.occ||'');
    if(isBday&&(!c.dob||daysUntilBirthday(c.dob)>60)) return;
    const inCam=getCampaignClients(cam).some(cl=>cl.id===c.id);
    if(!inCam) return;
    const cd2=cam.date==='Ongoing'?null:new Date(cam.date);
    const du2=cd2?Math.floor((cd2-todayM)/86400000):0;
    const camTaskKey=`cam-${cam.id}-${c.id}`;
    items.push({
      label:cam.name, sub:cam.date==='Ongoing'?'Ongoing campaign':daysLabel(du2),
      urg:cam.date==='Ongoing'||isBday?'normal':urgOf(du2),
      sortKey:isBday?9999:(cam.date==='Ongoing'?999:du2),
      done:doneTasks.has(camTaskKey),
      clickFn:`openCampaign(CAMPAIGNS.find(x=>x.id==='${cam.id}'))`,
      checkFn:`tickFollowUpCam('${cam.id}','${c.id}',this.closest('.act'))`
    });
  });

  if(!items.length) return '';
  // Sort chronologically — soonest (smallest sortKey) first
  items.sort((a,b)=>a.sortKey-b.sortKey);
  const dotOpacity=urg=>urg==='urgent'?'0.9':urg==='soon'?'0.6':'0.35';
  const lblColor=urg=>urg==='urgent'?'#c0392b':urg==='soon'?'var(--gold)':'var(--t1)';
  const CHK='<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke-width="3.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>';
  const rows=items.map(item=>`
    <div class="act" style="padding:10px 14px;gap:12px;cursor:${item.clickFn?'pointer':'default'}"${item.clickFn?` onclick="event.stopPropagation();${item.clickFn}"`:''}>
      <div style="width:6px;height:6px;border-radius:50%;background:var(--gold);opacity:${dotOpacity(item.urg)};flex-shrink:0;margin-top:2px"></div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600;color:${lblColor(item.urg)};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${item.label}</div>
        <div style="font-size:11px;color:var(--t3);margin-top:2px">${item.sub}</div>
      </div>
      <div class="chk${item.done?' on':''}" onclick="event.stopPropagation();${item.checkFn||''}">${CHK}</div>
    </div>`).join('');
  return `<div class="prof-sec prof-fu"><div class="sec-lbl">Outstanding Follow-Ups</div><div class="acts">${rows}</div></div>`;
}

function activityLabel(type){
  if(type==='whatsapp') return 'WhatsApp';
  if(type==='call')     return 'Call';
  if(type==='campaign') return 'Campaign';
  return 'Meeting';
}

function renderActivityTimeline(clientId){
  const acts=CLIENT_ACTIVITIES.filter(a=>a.client_id===clientId);
  if(!acts.length) return `<div class="atl-empty">No activity logged yet.</div>`;
  const dotClass=t=>t==='whatsapp'?'wa':t==='call'?'call':t==='campaign'?'cam':'meet';
  return `<div class="atl-wrap">${acts.map(a=>`
    <div class="atl-entry" id="atl-${a.id}">
      <div class="atl-rail">
        <div class="atl-dot ${dotClass(a.type)}">${activityIcon(a.type)}</div>
        <div class="atl-tail"></div>
      </div>
      <div class="atl-body">
        <div class="atl-type">${activityLabel(a.type)}${a.type==='campaign'&&a.notes?` — ${a.notes}`:''}</div>
        <div class="atl-date">${fmtActivityDate(a.occurred_at)}</div>
        ${a.notes&&a.type!=='campaign'?`<div class="atl-notes">${a.notes}</div>`:''}
      </div>
      <div class="atl-edit" onclick="openEditActivity('${a.id}','${clientId}')">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      </div>
    </div>`).join('')}
  </div>`;
}

let editActivityId=null, editActivityClientId=null;
function openEditActivity(actId, clientId){
  const act=CLIENT_ACTIVITIES.find(a=>a.id===actId); if(!act) return;
  editActivityId=actId; editActivityClientId=clientId;
  document.getElementById('edit-act-type').textContent=activityLabel(act.type);
  // Pre-fill date from occurred_at
  const d=new Date(act.occurred_at);
  const dateStr=d.toISOString().split('T')[0];
  document.getElementById('edit-act-date').value=dateStr;
  document.getElementById('edit-act-notes').value=act.notes||'';
  openModal('modal-edit-activity');
}
async function saveEditActivity(){
  const act=CLIENT_ACTIVITIES.find(a=>a.id===editActivityId); if(!act) return;
  const dateVal=document.getElementById('edit-act-date').value;
  const notes=document.getElementById('edit-act-notes').value.trim();
  if(!dateVal){ showToast('Please set a date'); return; }
  const newOccurred=new Date(dateVal+'T12:00:00').toISOString();
  // Synthetic campaign entries live in campaign_completions, not client_activities
  if(act._synthetic && act._camId){
    const {error}=await SB.from('campaign_completions').update({created_at:newOccurred}).eq('campaign_id',act._camId).eq('contact_id',editActivityClientId).eq('contact_type','client');
    if(error){ showToast('Could not save: '+error.message); return; }
    act.occurred_at=newOccurred;
    CLIENT_ACTIVITIES.sort((a,b)=>new Date(b.occurred_at)-new Date(a.occurred_at));
    closeModal('modal-edit-activity');
    const tlInner=document.getElementById('atl-inner');
    if(tlInner) tlInner.innerHTML=renderActivityTimeline(editActivityClientId);
    showToast('Activity updated ✓');
    return;
  }
  const {error}=await SB.from('client_activities').update({occurred_at:newOccurred, notes:notes||null}).eq('id',editActivityId);
  if(error){ showToast('Could not save: '+error.message); return; }
  // Update in-memory
  act.occurred_at=newOccurred; act.notes=notes||null;
  CLIENT_ACTIVITIES.sort((a,b)=>new Date(b.occurred_at)-new Date(a.occurred_at));
  // Update client's last_wa / last_call if this is the most recent of its type
  const c=CLIENTS.find(x=>x.id===editActivityClientId);
  if(c){
    const sameType=CLIENT_ACTIVITIES.filter(a=>a.client_id===editActivityClientId&&a.type===act.type);
    const mostRecent=sameType[0];
    if(mostRecent?.id===editActivityId){
      const dateOnly=dateVal;
      if(act.type==='whatsapp'){ await SB.from('clients').update({last_wa:dateOnly}).eq('id',c.id); c.wa=dateOnly; }
      if(act.type==='call'){     await SB.from('clients').update({last_call:dateOnly}).eq('id',c.id); c.call=dateOnly; }
    }
  }
  closeModal('modal-edit-activity');
  const tlInner=document.getElementById('atl-inner');
  if(tlInner) tlInner.innerHTML=renderActivityTimeline(editActivityClientId);
  rHome();
  showToast('Activity updated ✓');
}

async function deleteActivity(){
  if(!editActivityId) return;
  const act=CLIENT_ACTIVITIES.find(a=>a.id===editActivityId);
  // Synthetic campaign entries live in campaign_completions, not client_activities
  if(act?._synthetic && act?._camId){
    const {error}=await SB.from('campaign_completions').delete().eq('campaign_id',act._camId).eq('contact_id',editActivityClientId).eq('contact_type','client');
    if(error){ showToast('Could not delete: '+error.message); return; }
    CLIENT_ACTIVITIES=CLIENT_ACTIVITIES.filter(a=>a.id!==editActivityId);
    closeModal('modal-edit-activity');
    const tlInner=document.getElementById('atl-inner');
    if(tlInner) tlInner.innerHTML=renderActivityTimeline(editActivityClientId);
    rHome();
    showToast('Activity deleted');
    return;
  }
  const {error}=await SB.from('client_activities').delete().eq('id',editActivityId);
  if(error){ showToast('Could not delete: '+error.message); return; }
  CLIENT_ACTIVITIES=CLIENT_ACTIVITIES.filter(a=>a.id!==editActivityId);
  // Sync last_wa / last_call so the backfill code doesn't re-create this entry on next open
  const c=CLIENTS.find(x=>x.id===editActivityClientId);
  if(c && act && (act.type==='call'||act.type==='whatsapp')){
    const remaining=CLIENT_ACTIVITIES.filter(a=>a.client_id===editActivityClientId&&a.type===act.type&&!a._synthetic);
    const field=act.type==='call'?'last_call':'last_wa';
    if(remaining.length){
      const newDate=new Date(remaining[0].occurred_at).toISOString().split('T')[0];
      await SB.from('clients').update({[field]:newDate}).eq('id',editActivityClientId);
      if(act.type==='call') c.call=newDate; else c.wa=newDate;
    } else {
      await SB.from('clients').update({[field]:null}).eq('id',editActivityClientId);
      if(act.type==='call') c.call=null; else c.wa=null;
    }
  }
  closeModal('modal-edit-activity');
  const tlInner=document.getElementById('atl-inner');
  if(tlInner) tlInner.innerHTML=renderActivityTimeline(editActivityClientId);
  const profBody=document.getElementById('ps-client-body');
  if(c&&profBody?.dataset.clientId===editActivityClientId) openC(c);
  rHome();
  showToast('Activity deleted');
}







async function openLogMeetingPrompt(clientId){
  // replaced by logMeeting — kept for safety
}

function cancelLogMeeting(){}

async function saveLogMeeting(clientId){
  // replaced by logMeeting
}

async function openC(c, _skipActivityLoad=false){
  currentActivityClientId=c.id;
  const rel=REL_CADENCES[c.relationship];
  const wa=daysSince(c.wa), cl=daysSince(c.call);

  // ── Last Contact: most recent of WA or Call/Meeting ──────────────
  let lastContactType='', lastContactDays=9999;
  if(wa!==9999||cl!==9999){
    if(wa<=cl){ lastContactType='WhatsApp'; lastContactDays=wa; }
    else {
      // Distinguish between a logged call and a meeting
      const lastCallAct=ALL_ACTIVITIES.filter(a=>a.client_id===c.id&&(a.type==='call'||a.type==='meeting')).sort((a,b)=>new Date(b.occurred_at)-new Date(a.occurred_at))[0];
      lastContactType=lastCallAct?.type==='meeting'?'Meeting':'Call';
      lastContactDays=cl;
    }
  }
  const lastContactStr = lastContactDays===9999 ? 'Never contacted' :
    lastContactDays===0 ? `${lastContactType} · Today` :
    lastContactDays===1 ? `${lastContactType} · Yesterday` :
    `${lastContactType} · ${lastContactDays} days ago`;

  // ── Next Follow-Up: scheduled meeting takes priority, then cadence ─
  let nextFollowUpStr='', nextFollowUpOv=false;
  const _tdm=new Date(); _tdm.setHours(0,0,0,0);
  const upcomingMtg=MEETINGS.filter(m=>m.client_id===c.id).sort((a,b)=>new Date(a.due_date)-new Date(b.due_date))[0];
  if(upcomingMtg){
    const dm=Math.floor((new Date(upcomingMtg.due_date).setHours(0,0,0,0)-_tdm.getTime())/86400000);
    nextFollowUpStr=dm<0?`Meeting · ${Math.abs(dm)}d overdue`:dm===0?'Meeting · Today':dm===1?'Meeting · Tomorrow':`Meeting · In ${dm}d`;
    nextFollowUpOv=dm<=0;
  } else if(rel&&c.relationship&&c.relationship!=='Archive'){
    if(lastContactType==='Call'&&cl<9999&&rel.cD){
      // Call was most recent — next due is the next call
      const d=rel.cD-cl;
      nextFollowUpStr=d<0?`Call · ${Math.abs(d)}d overdue`:d===0?'Call · Due today':`Call · In ${d}d`;
      nextFollowUpOv=d<=0;
    } else if(lastContactType==='WhatsApp'&&wa<9999){
      // WA was most recent — escalate to call if overdue
      if(rel.cD&&cl<9999&&cl>=rel.cD){
        const ov=cl-rel.cD;
        nextFollowUpStr=ov===0?'Call · Due today':`Call · ${ov}d overdue`;
        nextFollowUpOv=true;
      } else if(rel.waD){
        const d=rel.waD-wa;
        nextFollowUpStr=d<0?`WhatsApp · ${Math.abs(d)}d overdue`:d===0?'WhatsApp · Due today':`WhatsApp · In ${d}d`;
        nextFollowUpOv=d<=0;
      }
    } else if(rel.waD){
      nextFollowUpStr='WhatsApp · Never contacted'; nextFollowUpOv=true;
    }
  }

  const cDeals=DEALS.filter(d=>d.clientId===c.id);
  const dHtml=cDeals.length?cDeals.map(d=>`<div class="deal-row">
    <div><div class="dr-l">${d.pt}</div><div class="dr-s">${d.cat} · ${d.s}</div></div>
    <div style="text-align:right"><div class="dr-v">${fm(d.v)}</div><div class="dr-c">~${fm(d.v*(d.pct/100))}</div></div>
  </div>`).join(''):'<div style="padding:13px 16px;font-size:12px;color:var(--t3);font-style:italic">No active deals</div>';

  const cCams=CAMPAIGNS.filter(cam=>getCampaignClients(cam).some(cl2=>cl2.id===c.id));
  const camHtml=cCams.length?cCams.map(cam=>`<span class="pill p-cam" onclick="openCampaign(CAMPAIGNS.find(x=>x.id==='${cam.id}'))">${cam.name}</span>`).join(''):'';
  // NOTE: activities are loaded AFTER panel opens (see below) to avoid blocking

  const psBody=document.getElementById('ps-client-body');
  psBody.dataset.clientId=c.id;
  psBody.innerHTML=`
    <div class="prof-back-row">
      <div class="prof-back" onclick="closeProf('ps-client')">
        <svg width="8" height="14" viewBox="0 0 8 14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M7 1L1 7l6 6"/></svg><span>Clients</span>
      </div>
      <button class="prof-edit-btn" onclick="openEditClient('${c.id}')">Edit</button>
    </div>
    <div class="prof-hero">
      <div class="prof-av-row">
        <div class="prof-av">${ini(c.name)}</div>
        <div><div class="prof-name">${c.name}</div><div class="prof-role-l">${c.role||''}${c.role&&c.city?' · ':''}<span${c.city?` style="cursor:pointer;color:var(--gold)" onclick="filterByCity('${c.city.replace(/'/g,"\\'")}');closeProf('ps-client')"`:''} >${c.city}</span></div></div>
      </div>
      <div class="prof-pills">
        <span class="pill p-gh">${c.nw}</span>
        ${c.nat?`<span class="pill p-gh" style="cursor:pointer" onclick="filterByNat('${c.nat.replace(/'/g,"\\'")}');closeProf('ps-client')">${c.nat}</span>`:''}
        ${c.deal?'<span class="pill p-gold">Active Deal</span>':''}
        <span class="pill p-gh">${c.rel}</span>
        ${c.relationship?`<span class="pill p-gh">${c.relationship}</span>`:''}
      </div>
    </div>
    ${c.relationship==='Proxy'&&c.proxyContact?`<div class="prof-sec" style="padding:12px 18px;margin-bottom:10px;display:flex;align-items:center;gap:10px;background:rgba(138,109,62,0.06);border-color:var(--gold-border)"><div style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--t3);flex-shrink:0">Via Proxy</div><div style="font-size:13px;font-weight:600;color:var(--t1)">${c.proxyContact}</div></div>`:''}
    <div class="prof-sec">
      <div class="sec-lbl">Contact Status</div>
      ${c.relationship?`<div class="sec-row"><div class="sec-k">Relationship</div><div class="sec-v">${c.relationship}</div></div>`:''}
      <div class="sec-row"><div class="sec-k">Last Contact</div><div class="sec-v ${lastContactDays<9999?'ok':''}">${lastContactStr}</div></div>
      ${nextFollowUpStr?`<div class="sec-row"><div class="sec-k">Next Follow-Up</div><div class="sec-v ${nextFollowUpOv?'ov':''}">${nextFollowUpStr}</div></div>`:''}
      ${c.dob?`<div class="sec-row"><div class="sec-k">Birthday</div><div class="sec-v">${new Date(c.dob+'T12:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'long'})}</div></div>`:''}
    </div>
    ${(()=>{const di=c.int.filter(x=>!['VIP','DND','High Potential','Prospect'].includes(x));return di.length?`<div class="prof-sec"><div class="sec-lbl">Interests & Segments</div><div class="itags">${di.map(x=>`<span class="pill p-gh">${x}</span>`).join('')}</div></div>`:''})()}
    ${camHtml?`<div class="prof-sec"><div class="sec-lbl">Active Campaigns</div><div class="itags" style="margin-top:4px">${camHtml}</div></div>`:''}
    <div class="prof-sec"><div class="sec-lbl">Deals & Commission</div>${dHtml}</div>
    ${c.notes?`<div class="prof-sec"><div class="sec-lbl">Notes</div><div class="sec-notes">${c.notes}</div></div>`:''}
    ${renderClientFollowUps(c)}
    <div class="prof-sec">
      <div class="sec-lbl">Activity Timeline</div>
      <div id="atl-inner"><div class="atl-loading">Loading history…</div></div>
    </div>
    <div class="acts">
      <div class="act" onclick="openWaSheet(CLIENTS.find(x=>x.id==='${c.id}'),null)">
        <div class="act-ic"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div>
        <div><div class="act-t">Draft WhatsApp</div><div class="act-s">Generate personalised message</div></div>
      </div>
      <div class="act" onclick="logCall(CLIENTS.find(x=>x.id==='${c.id}'))">
        <div class="act-ic"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13.6a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 3h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 10.91a16 16 0 0 0 5.61 5.61l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg></div>
        <div><div class="act-t">Log Call</div><div class="act-s">Mark call done — resets cadence clock</div></div>
      </div>
      <div class="act" onclick="logWa(CLIENTS.find(x=>x.id==='${c.id}'))">
        <div class="act-ic"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></div>
        <div><div class="act-t">Log WhatsApp</div><div class="act-s">Mark message sent — resets clock</div></div>
      </div>
      <div class="act" onclick="logMeeting(CLIENTS.find(x=>x.id==='${c.id}'))">
        <div class="act-ic"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></div>
        <div><div class="act-t">Log Meeting</div><div class="act-s">Record an in-person meeting</div></div>
      </div>
      <div class="act" onclick="openScheduleMeeting('${c.id}','${c.name.replace(/'/g,"\\'")}')">
        <div class="act-ic"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="12" y1="14" x2="12" y2="18"/><line x1="10" y1="16" x2="14" y2="16"/></svg></div>
        <div><div class="act-t">Schedule Meeting</div><div class="act-s">Add to Personal follow-up campaign</div></div>
      </div>
      <div class="act" onclick="openDealModal('${c.id}',null)">
        <div class="act-ic"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg></div>
        <div><div class="act-t">Add Deal</div><div class="act-s">Log a new deal for this client</div></div>
      </div>
      <div class="act" onclick="toggleVip('${c.id}')">
        <div class="act-ic"><svg width="15" height="15" viewBox="0 0 24 24" fill="${c.vip?'var(--gold)':'none'}" stroke="var(--gold)" stroke-width="2" stroke-linecap="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></div>
        <div><div class="act-t" style="${c.vip?'color:var(--gold)':''}">${c.vip?'Remove VIP':'Mark as VIP'}</div><div class="act-s">${c.vip?'Remove VIP status from this client':'Pin to top of client list with star'}</div></div>
      </div>
      <div class="act" onclick="toggleDnd('${c.id}')">
        <div class="act-ic"><svg width="15" height="15" viewBox="0 0 24 24" fill="${c.dnd?'var(--p-ind,#6c7fc4)':'none'}" stroke="${c.dnd?'var(--p-ind,#6c7fc4)':'var(--fg2)'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/></svg></div>
        <div><div class="act-t" style="${c.dnd?'color:var(--p-ind,#6c7fc4)':''}">${c.dnd?'Remove Do Not Disturb':'Do Not Disturb'}</div><div class="act-s">${c.dnd?'Resume WhatsApp updates for this client':'Pause all WhatsApp updates for this client'}</div></div>
      </div>
    </div>
    <div style="height:36px"></div>`;
  pushProf('ps-client');
  if(_skipActivityLoad) return;
  // Load activities + deal tasks in background
  const waSnap=c.wa, callSnap=c.call;
  await Promise.all([
    loadClientActivities(c.id, c),
    loadClientDealTasks(c.id)
  ]);
  const profBody2=document.getElementById('ps-client-body');
  if(profBody2&&profBody2.dataset.clientId===c.id){
    const tlInner=document.getElementById('atl-inner');
    if(c.wa!==waSnap||c.call!==callSnap){
      // Reconciliation updated last_wa/last_call — re-render with correct values, no second load
      const scrollTop=profBody2.scrollTop;
      await openC(c, true);
      const profBody3=document.getElementById('ps-client-body');
      if(profBody3&&profBody3.dataset.clientId===c.id){
        const tl=document.getElementById('atl-inner');
        if(tl) tl.innerHTML=renderActivityTimeline(c.id);
        _refreshMeetingFollowUps(c.id);
        profBody3.scrollTop=scrollTop;
      }
    } else {
      if(tlInner) tlInner.innerHTML=renderActivityTimeline(c.id);
      _refreshMeetingFollowUps(c.id);
    }
  }
}

async function loadClientDealTasks(clientId){
  const clientDeals=DEALS.filter(d=>d.clientId===clientId);
  if(!clientDeals.length){ CLIENT_DEAL_TASKS[clientId]=[]; return; }
  const todayD=new Date(); todayD.setHours(0,0,0,0);
  const cutoff=new Date(todayD); cutoff.setDate(cutoff.getDate()+30);
  const dealIds=clientDeals.map(d=>d.id);
  const {data}=await SB.from('deal_tasks').select('*').in('deal_id',dealIds).eq('done',false).order('due_date',{ascending:true});
  CLIENT_DEAL_TASKS[clientId]=(data||[]).filter(t=>{
    if(!t.due_date) return true; // no date = show
    const d=new Date(t.due_date); d.setHours(0,0,0,0);
    return d<=cutoff;
  });
}

// ── LOG CALL / WA / MEETING ───────────────────────────────────────
// client_activities is the single source of truth. applyActivity keeps
// the in-memory CLIENTS array in sync. No direct last_call/last_wa writes.
async function _logActivity(c, type, toast){
  if(!c) return;
  const now=new Date().toISOString();
  const {data:actData,error:actErr}=await SB.from('client_activities').insert({client_id:c.id,type,occurred_at:now}).select().single();
  if(actErr){ console.error('client_activities insert error:',actErr); return; }
  applyActivity(c.id,type,now);
  if(actData){ CLIENT_ACTIVITIES=[actData,...CLIENT_ACTIVITIES].sort((a,b)=>new Date(b.occurred_at)-new Date(a.occurred_at)); }
  const tlInner=document.getElementById('atl-inner');
  if(tlInner) tlInner.innerHTML=renderActivityTimeline(c.id);
  return actData;
}
async function logCall(c){
  await _logActivity(c,'call','Call logged ✓');
  const profBody=document.getElementById('ps-client-body');
  if(profBody?.dataset.clientId==c.id) openC(c);
  rHome(); if(curTab==='clients') rClients(); showToast('Call logged ✓');
}
async function logWa(c){
  await _logActivity(c,'whatsapp','WhatsApp logged ✓');
  const profBody=document.getElementById('ps-client-body');
  if(profBody?.dataset.clientId==c.id) openC(c);
  rHome(); if(curTab==='clients') rClients(); showToast('WhatsApp logged ✓');
}
async function logMeeting(c){
  await _logActivity(c,'meeting','Meeting logged ✓');
  showToast('Meeting logged ✓');
}

async function toggleVip(clientId){
  const c=CLIENTS.find(x=>x.id===clientId); if(!c) return;
  if(c.vip){
    c.int=c.int.filter(i=>i!=='VIP');
    c.vip=false;
  } else {
    c.int=[...c.int,'VIP'];
    c.vip=true;
  }
  const {error:vipErr}=await SB.from('clients').update({interests:c.int}).eq('id',clientId);
  if(vipErr){ console.error('VIP save error:',vipErr); showToast('Save failed: '+vipErr.message); return; }
  rClients();
  openC(c);
  showToast(c.vip?'VIP status added ✓':'VIP status removed');
}
async function toggleDnd(clientId){
  const c=CLIENTS.find(x=>x.id===clientId); if(!c) return;
  if(c.dnd){
    c.int=c.int.filter(i=>i!=='DND');
    c.dnd=false;
  } else {
    c.int=[...c.int,'DND'];
    c.dnd=true;
  }
  const {error:dndErr}=await SB.from('clients').update({interests:c.int}).eq('id',clientId);
  if(dndErr){ console.error('DND save error:',dndErr); showToast('Save failed: '+dndErr.message); return; }
  rClients();
  openC(c);
  showToast(c.dnd?'Do Not Disturb enabled 🌙':'Do Not Disturb removed');
}

let scheduleMeetingClientId=null, editingMeetingId=null;
function openScheduleMeeting(clientId, clientName){
  scheduleMeetingClientId=clientId;
  document.getElementById('schedule-meeting-client').textContent=clientName;
  document.getElementById('schedule-meeting-title').value='';
  document.getElementById('schedule-meeting-date').value='';
  openModal('modal-schedule-meeting');
}
async function saveScheduleMeeting(){
  if(!scheduleMeetingClientId) return;
  const title=document.getElementById('schedule-meeting-title').value.trim();
  const date=document.getElementById('schedule-meeting-date').value;
  if(!date){ showToast('Please set a date'); return; }
  const {data,error}=await SB.from('client_meetings').insert({client_id:scheduleMeetingClientId,title:title||null,due_date:date,done:false}).select().single();
  if(error){ console.error('client_meetings error:',error); showToast(error.message||error.code||'DB error'); return; }
  MEETINGS.push(data);
  closeModal('modal-schedule-meeting');
  // Switch to network tab so meeting task is visible immediately
  homeTab='network';
  document.querySelectorAll('.home-toggle-btn').forEach(b=>b.classList.toggle('on',b.dataset.tab==='network'));
  rHome();
  // If client profile is open, refresh the follow-ups section
  _refreshMeetingFollowUps(scheduleMeetingClientId);
  showToast('Meeting scheduled ✓');
}

function openEditMeeting(mtgId){
  const m=MEETINGS.find(x=>x.id===mtgId);
  if(!m) return;
  editingMeetingId=mtgId;
  document.getElementById('edit-meeting-title').value=m.title||'';
  document.getElementById('edit-meeting-date').value=m.due_date||'';
  openModal('modal-edit-meeting');
}
async function saveEditMeeting(){
  if(!editingMeetingId) return;
  const title=document.getElementById('edit-meeting-title').value.trim();
  const date=document.getElementById('edit-meeting-date').value;
  if(!date){ showToast('Please set a date'); return; }
  const {error}=await SB.from('client_meetings').update({title:title||null,due_date:date}).eq('id',editingMeetingId);
  if(error){ showToast('Could not save'); return; }
  const m=MEETINGS.find(x=>x.id===editingMeetingId);
  if(m){ m.title=title||null; m.due_date=date; }
  closeModal('modal-edit-meeting');
  _refreshMeetingFollowUps(m?.client_id);
  rHome();
  showToast('Meeting updated ✓');
}
async function deleteScheduledMeeting(){
  if(!editingMeetingId) return;
  const m=MEETINGS.find(x=>x.id===editingMeetingId);
  const {error}=await SB.from('client_meetings').delete().eq('id',editingMeetingId);
  if(error){ showToast('Could not delete'); return; }
  MEETINGS=MEETINGS.filter(x=>x.id!==editingMeetingId);
  closeModal('modal-edit-meeting');
  _refreshMeetingFollowUps(m?.client_id);
  rHome();
  showToast('Meeting deleted');
}
function _refreshMeetingFollowUps(clientId){
  if(!clientId) return;
  const profBody=document.getElementById('ps-client-body');
  if(!profBody||profBody.dataset.clientId!==clientId) return;
  const c=CLIENTS.find(x=>x.id===clientId);
  if(!c) return;
  const fuHtml=renderClientFollowUps(c);
  const existing=profBody.querySelector('.prof-fu');
  if(existing){
    if(fuHtml) existing.outerHTML=fuHtml;
    else existing.remove();
  } else if(fuHtml){
    const atlSec=profBody.querySelector('#atl-inner')?.closest('.prof-sec');
    if(atlSec) atlSec.insertAdjacentHTML('beforebegin',fuHtml);
  }
}

async function tickFollowUpDealTask(clientId, taskId, rowEl){
  rowEl.style.transition='opacity 0.3s'; rowEl.style.opacity='0';
  await SB.from('deal_tasks').update({done:true}).eq('id',taskId);
  if(CLIENT_DEAL_TASKS[clientId]){
    CLIENT_DEAL_TASKS[clientId]=CLIENT_DEAL_TASKS[clientId].filter(t=>t.id!==taskId);
  }
  rHome();
  setTimeout(()=>{ rowEl.remove(); _refreshMeetingFollowUps(clientId); },310);
}

async function tickFollowUpMeeting(clientId, mtgId, rowEl){
  rowEl.style.transition='opacity 0.3s'; rowEl.style.opacity='0';
  await SB.from('client_meetings').update({done:true}).eq('id',mtgId);
  MEETINGS=MEETINGS.filter(x=>x.id!==mtgId);
  const now=new Date().toISOString();
  const {data:actData}=await SB.from('client_activities').insert({client_id:clientId,type:'meeting',occurred_at:now}).select().single();
  applyActivity(clientId,'meeting',now);
  if(actData){ CLIENT_ACTIVITIES=[actData,...CLIENT_ACTIVITIES].sort((a,b)=>new Date(b.occurred_at)-new Date(a.occurred_at)); }
  const tlInner=document.getElementById('atl-inner');
  if(tlInner) tlInner.innerHTML=renderActivityTimeline(clientId);
  rHome();
  showToast('Meeting done ✓');
  setTimeout(()=>{ rowEl.remove(); _refreshMeetingFollowUps(clientId); },310);
}

async function tickFollowUpWa(clientId, rowEl){
  const c=CLIENTS.find(x=>x.id===clientId); if(!c) return;
  const taskKey='wa-'+clientId;
  const today=new Date().toISOString().split('T')[0];
  doneTasks.add(taskKey);
  rowEl.style.transition='opacity 0.3s'; rowEl.style.opacity='0';
  await SB.from('task_completions').upsert({task_key:taskKey,reset_date:today},{onConflict:'task_key'});
  await logWa(c);
  setTimeout(()=>{ rowEl.remove(); _refreshMeetingFollowUps(clientId); },310);
}

async function tickFollowUpCall(clientId, rowEl){
  const c=CLIENTS.find(x=>x.id===clientId); if(!c) return;
  const taskKey='cl-'+clientId;
  const today=new Date().toISOString().split('T')[0];
  doneTasks.add(taskKey);
  rowEl.style.transition='opacity 0.3s'; rowEl.style.opacity='0';
  await SB.from('task_completions').upsert({task_key:taskKey,reset_date:today},{onConflict:'task_key'});
  await logCall(c);
  setTimeout(()=>{ rowEl.remove(); _refreshMeetingFollowUps(clientId); },310);
}

async function tickFollowUpCam(camId, clientId, rowEl){
  const taskKey=`cam-${camId}-${clientId}`;
  const today=new Date().toISOString().split('T')[0];
  if(doneTasks.has(taskKey)){
    doneTasks.delete(taskKey);
    await SB.from('task_completions').delete().eq('task_key',taskKey);
  } else {
    doneTasks.add(taskKey);
    await SB.from('task_completions').upsert({task_key:taskKey,reset_date:today},{onConflict:'task_key'});
  }
  rHome();
  _refreshMeetingFollowUps(clientId);
}

// ── PARTNERS ──────────────────────────────────────────────────────
function rPartners(){
  const financeMatch=cF==='Investment Bank';
  let list=cF==='All'?[...PARTNERS]:[...PARTNERS.filter(p=>financeMatch?(p.cat==='Investment Bank'||p.cat==='Foreign Exchange'||p.cat==='Family Office'):p.cat===cF)];
  list.sort((a,b)=>{
    if((a.cat||'').toLowerCase()!==(b.cat||'').toLowerCase()) return (a.cat||'').localeCompare(b.cat||'');
    return (a.name||'').localeCompare(b.name||'');
  });

  // Group by category → company (case-insensitive)
  const byCategory=[]; const catIdx={};
  list.forEach(p=>{
    const catRaw=(p.cat||'Other').trim();
    const catKey=catRaw.toLowerCase();
    const coKey=(p.name||'').trim().toLowerCase();
    const coDisplay=(p.name||'').trim();
    if(catIdx[catKey]===undefined){ catIdx[catKey]=byCategory.length; byCategory.push({cat:catRaw,companies:[]}); }
    const grp=byCategory[catIdx[catKey]];
    const existing=grp.companies.find(c=>c.key===coKey);
    if(existing) existing.contacts.push(p);
    else grp.companies.push({name:coDisplay, key:coKey, contacts:[p]});
  });

  const el=document.getElementById('par-list'); el.innerHTML='';
  const showCatHeaders=cF==='All';
  let idx=0;

  byCategory.forEach(({cat,companies})=>{
    if(showCatHeaders){
      const h=document.createElement('div');
      h.className='rec-cat-header'; h.textContent=cat;
      el.appendChild(h);
    }
    companies.forEach(({name,contacts})=>{
      const multi=contacts.length>1;
      const rep=contacts[0]; // representative for avatar/fee/country
      const country=contacts.map(c=>c.country).find(Boolean)||'';
      const fee=contacts.map(c=>c.fee).find(Boolean)||'';
      const div=document.createElement('div');
      div.className='pc gc a'; div.style.animationDelay=(idx++*0.04)+'s';
      if(!multi) div.onclick=()=>openP(rep);

      div.innerHTML=`<div class="pc-av" style="border-radius:14px;font-size:13px">${abbr(name)}</div>
        <div class="pc-info" style="align-items:flex-start">
          <div class="pc-name">${name}</div>
          <div class="pc-contacts"></div>
        </div>
        <div class="pc-r" style="align-self:flex-start;margin-top:2px">
          ${fee?`<span style="font-family:'Cormorant Garamond',serif;font-size:18px;color:var(--gold);font-weight:300">${fee}</span>`:''}
          ${country?`<span class="pill p-gh" style="font-size:9px">${country}</span>`:''}
        </div>`;
      const contactsEl=div.querySelector('.pc-contacts');
      contacts.forEach((p,i)=>{
        const row=document.createElement('div');
        row.className='pc-sub'+(multi?' rec-contact-clickable':'')+(i>0?' rec-contact-divider':'');
        row.textContent=[p.contact,p.role].filter(Boolean).join(' · ')||'';
        if(multi) row.addEventListener('click',e=>{e.stopPropagation();openP(p);});
        contactsEl.appendChild(row);
      });
      el.appendChild(div);
    });
  });
}

function openP(p){
  const wa=daysSince(p.wa), cl=daysSince(p.call);
  document.getElementById('ps-partner-body').innerHTML=`
    <div class="prof-back-row">
      <div class="prof-back" onclick="closeProf('ps-partner')">
        <svg width="8" height="14" viewBox="0 0 8 14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M7 1L1 7l6 6"/></svg><span>Partners</span>
      </div>
      <button class="prof-edit-btn" onclick="openEditPartner('${p.id}')">Edit</button>
    </div>
    <div class="prof-hero">
      <div class="prof-av-row">
        <div class="prof-av sq" style="font-size:18px">${abbr(p.name)}</div>
        <div><div class="prof-name">${p.name}</div><div class="prof-role-l">${p.cat} · ${p.country}</div></div>
      </div>
      <div class="prof-pills">
        <span class="pill p-gh">${p.tier}</span>
        ${p.fee?`<span class="pill p-gold">${p.fee} ref. fee</span>`:''}
        ${p.bizFee?`<span class="pill p-gh">${p.bizFee} bus. fee</span>`:''}
        ${p.isC?'<span class="pill p-blu">Also a Client</span>':''}
      </div>
    </div>
    <div class="prof-sec">
      <div class="sec-lbl">Contact</div>
      <div class="sec-row"><div class="sec-k">Name</div><div class="sec-v">${p.contact}</div></div>
      <div class="sec-row"><div class="sec-k">Role</div><div class="sec-v">${p.role}</div></div>
      <div class="sec-row"><div class="sec-k">Country</div><div class="sec-v">${p.country}</div></div>
      <div class="sec-row"><div class="sec-k">Last WhatsApp</div><div class="sec-v">${wa===9999?'Never':wa+'d ago'}</div></div>
      <div class="sec-row"><div class="sec-k">Last Call</div><div class="sec-v">${cl===9999?'Never':cl+'d ago'}</div></div>
    </div>
    <div class="prof-sec">
      <div class="sec-lbl">Partnership Terms</div>
      ${p.fee?`<div class="sec-row"><div class="sec-k">Referral Fee</div><div class="sec-v">${p.fee}</div></div>`:''}
      ${p.bizFee?`<div class="sec-row"><div class="sec-k">Business Fee</div><div class="sec-v">${p.bizFee}</div></div>`:''}
      ${(()=>{const r=parsePct(p.fee);if(!r||!p.bizFee) return '';const raw=100000/(r/100);const threshold=Math.floor(raw/100000)*100000||Math.floor(raw/10000)*10000;return `<div class="sec-row"><div class="sec-k">Client Spend Threshold</div><div class="sec-v" style="font-weight:600">${fm(threshold)}</div></div>`;})()}
      ${(()=>{const pDeals=DEALS.filter(d=>d.pt===p.name);if(!pDeals.length||!parsePct(p.fee)) return '';const totalComm=pDeals.reduce((s,d)=>s+(d.v*(d.pct/100)),0);const effComm=totalComm*(parsePct(p.fee)/100);return `<div class="sec-row"><div class="sec-k">Effective Commission</div><div class="sec-v" style="color:var(--gold);font-weight:700">${fm(effComm)}</div></div><div class="sec-row"><div class="sec-k">From Deals</div><div class="sec-v">${pDeals.length} deal${pDeals.length!==1?'s':''} · ${fm(totalComm)} total comm.</div></div>`;})()}
    </div>
    ${p.notes?`<div class="prof-sec"><div class="sec-lbl">Notes</div><div class="sec-notes">${p.notes}</div></div>`:''}
    <div style="height:36px"></div>`;
  pushProf('ps-partner');
}

// ── RECOMMENDATIONS ───────────────────────────────────────────────
function setRecCat(el,val){
  recCat=val;
  document.querySelectorAll('#rec-chips .chip').forEach(c=>c.classList.toggle('on',c===el));
  rRecs();
}

function openPartnerById(id){
  const p=PARTNERS.find(x=>x.id==id);
  if(p) openP(p);
}
function openRolodexEntry(id,isPartner){
  if(isPartner){ const p=PARTNERS.find(x=>x.id===id); if(p) openP(p); }
  else openEditRec(id);
}

function rRecs(){
  const list=document.getElementById('rec-list'); list.innerHTML='';

  // Combine RECS + PARTNERS into one unified list
  const all=[
    ...RECS.map(r=>({...r, isPartner:false})),
    ...PARTNERS.map(p=>({id:p.id, company:p.name, contact:p.contact, position:p.role, category:p.cat, country:p.country, notes:p.notes, isPartner:true})),
  ];

  // Build category chips from all entries
  const chipsEl=document.getElementById('rec-chips');
  if(chipsEl){
    const cats=['All',...[...new Set(all.map(r=>r.category).filter(Boolean))].sort()];
    chipsEl.innerHTML=cats.map(c=>`<div class="chip${recCat===c?' on':''}" onclick="setRecCat(this,'${c.replace(/'/g,"&#39;")}')">${c}</div>`).join('');
  }

  // Filter (case-insensitive category match)
  const recCatLower=recCat.toLowerCase();
  const filtered=recCat==='All'?all:all.filter(r=>(r.category||'').toLowerCase()===recCatLower);

  // Group by category → company (case-insensitive, trimmed key)
  const byCategory=[]; const catIdx={};
  filtered.forEach(r=>{
    const catRaw=(r.category||'Other').trim();
    const catKey=catRaw.toLowerCase();
    const cat=catRaw;
    const coKey=(r.company||'').trim().toLowerCase();
    const coDisplay=(r.company||'').trim();
    if(catIdx[catKey]===undefined){ catIdx[catKey]=byCategory.length; byCategory.push({cat,companies:[]}); }
    const grp=byCategory[catIdx[catKey]];
    const existing=grp.companies.find(c=>c.key===coKey);
    if(existing) existing.contacts.push(r);
    else grp.companies.push({name:coDisplay, key:coKey, contacts:[r]});
  });

  byCategory.forEach(({cat,companies})=>{
    if(recCat==='All'){
      const h=document.createElement('div');
      h.className='rec-cat-header'; h.textContent=cat; list.appendChild(h);
    }
    companies.forEach(({name,contacts})=>{
      const el=document.createElement('div');
      el.className='rec-item a'; el.style.alignItems='flex-start';
      const country=contacts.map(c=>c.country).find(Boolean)||'';
      const multi=contacts.length>1;
      const anyPartner=contacts.some(c=>c.isPartner);
      const avStyle=anyPartner?'background:rgba(138,109,62,0.10);border-color:var(--gold-border);color:var(--gold)':'';
      const contactsHTML=contacts.map((r,i)=>`
        <div class="rec-contact-row${multi?' rec-contact-clickable':''}${i>0?' rec-contact-divider':''}" ${multi?`onclick="event.stopPropagation();openRolodexEntry(${JSON.stringify(r.id)},${r.isPartner})"`:''}>
          ${r.contact||r.position?`<div class="rec-ct">${[r.contact,r.position].filter(Boolean).join(' · ')}</div>`:''}
          ${r.notes?`<div class="rec-notes">${r.notes}</div>`:''}
        </div>`).join('');
      el.innerHTML=`<div class="rec-av" style="margin-top:2px;${avStyle}">${(name||'?')[0]}</div>
        <div style="flex:1;min-width:0"><div class="rec-co">${name}</div>${contactsHTML}</div>
        ${country?`<div class="rec-ctry" style="margin-top:2px">${country}</div>`:''}`;
      if(!multi){ const s=contacts[0]; el.onclick=()=>openRolodexEntry(s.id,s.isPartner); }
      list.appendChild(el);
    });
  });
}

async function saveRec(){
  const company=document.getElementById('nrec-company').value.trim();
  if(!company){ alert('Please enter a company name.'); return; }
  const row={
    company, category:document.getElementById('nrec-category').value.trim()||'Other',
    contact:document.getElementById('nrec-contact').value.trim(),
    position:document.getElementById('nrec-position').value.trim(),
    country:document.getElementById('nrec-country').value.trim(),
    notes:document.getElementById('nrec-notes').value.trim(),
    sort_order:RECS.length
  };
  const {data,error}=await SB.from('recommendations').insert(row).select().single();
  if(error){ alert('Error: '+error.message); return; }
  RECS.push(data); RECS.sort((a,b)=>(a.category||'').localeCompare(b.category||''));
  closeModal('modal-rec');
  ['nrec-company','nrec-category','nrec-contact','nrec-position','nrec-country','nrec-notes'].forEach(id=>document.getElementById(id).value='');
  rRecs(); showToast('Recommendation added ✓');
}

function openEditRec(id){
  const r=RECS.find(x=>x.id===id); if(!r) return;
  editRecId=id;
  document.getElementById('erec-company').value=r.company||'';
  document.getElementById('erec-category').value=r.category||'';
  document.getElementById('erec-contact').value=r.contact||'';
  document.getElementById('erec-position').value=r.position||'';
  document.getElementById('erec-country').value=r.country||'';
  document.getElementById('erec-notes').value=r.notes||'';
  openModal('modal-edit-rec');
}

async function saveEditRec(){
  const r=RECS.find(x=>x.id===editRecId); if(!r) return;
  const updates={
    company:document.getElementById('erec-company').value.trim()||r.company,
    category:document.getElementById('erec-category').value.trim()||r.category,
    contact:document.getElementById('erec-contact').value.trim(),
    position:document.getElementById('erec-position').value.trim(),
    country:document.getElementById('erec-country').value.trim(),
    notes:document.getElementById('erec-notes').value.trim(),
  };
  const {error}=await SB.from('recommendations').update(updates).eq('id',editRecId);
  if(error){ alert('Error: '+error.message); return; }
  Object.assign(r,updates);
  closeModal('modal-edit-rec');
  rRecs(); showToast('Updated ✓');
}

async function deleteRec(){
  if(!editRecId||!confirm('Delete this rolodex entry?')) return;
  const {error}=await SB.from('recommendations').delete().eq('id',editRecId);
  if(error){ showToast('Could not delete'); return; }
  RECS=RECS.filter(x=>x.id!==editRecId);
  closeModal('modal-edit-rec'); rRecs(); showToast('Deleted');
}

// ── FILTER & NAV ─────────────────────────────────────────────────
function setF(el,type,val){
  cF=val;document.querySelectorAll('#c-chips .chip').forEach(c=>c.classList.toggle('on',c===el));rPartners();
}

const TABS=['home','deals','campaigns','clients','partners','recs'];
function go(tab){
  if(tab===curTab) return;
  // Close any open profiles
  ['ps-client','ps-partner','ps-campaign'].forEach(id=>{
    const el=document.getElementById(id);
    if(el && el.classList.contains('open')){
      el.classList.remove('open');
      setTimeout(()=>{ if(!el.classList.contains('open')) el.style.display='none'; },380);
    }
  });
  document.querySelector('.screen.pushed')?.classList.remove('pushed');

  curTab=tab;
  TABS.forEach(t=>{
    document.getElementById('s-'+t).classList.toggle('hidden',t!==tab);
    const btn=document.getElementById('tab-'+t);
    if(btn) btn.classList.toggle('active',t===tab);
  });
  if(tab==='home'){ homeDealTasks=null; doneDealTasksToday=0; doneHomeDealTasks=[]; homeDoneDealTasks=null; rHome(); }
  else if(tab==='deals') rDeals();
  else if(tab==='campaigns') rCampaigns();
  else if(tab==='clients') rClients();
  else if(tab==='partners') rPartners();
  else if(tab==='recs') rRecs();
  document.getElementById('s-'+tab).scrollTop=0;
}

// ── SETTINGS ─────────────────────────────────────────────────────
function rSettings(){
  const el=document.getElementById('settings-cadences'); if(!el) return;
  el.innerHTML=Object.entries(REL_CADENCES).map(([key,r])=>`
    <div class="settings-rel-row">
      <div class="settings-rel-label">${key}</div>
      <div class="settings-rel-inputs">
        <div class="settings-rel-field">
          <label>WhatsApp (days)</label>
          <input type="number" class="settings-input" id="set-${key}-wa" value="${r.waD||''}" min="1" placeholder="days">
        </div>
        <div class="settings-rel-field">
          <label>Call (days)</label>
          <input type="number" class="settings-input" id="set-${key}-call" value="${r.cD||''}" min="1" placeholder="none">
        </div>
      </div>
    </div>`).join('');
}

function saveSettings(){
  Object.keys(REL_CADENCES).forEach(key=>{
    const waEl=document.getElementById('set-'+key+'-wa');
    const callEl=document.getElementById('set-'+key+'-call');
    if(waEl) REL_CADENCES[key].waD=waEl.value?parseInt(waEl.value):null;
    if(callEl) REL_CADENCES[key].cD=callEl.value?parseInt(callEl.value):null;
  });
  saveRelCadences(); showToast('Settings saved ✓'); rHome();
}

function resetSettings(){
  REL_CADENCES={...DEFAULT_REL_CADENCES};
  Object.keys(REL_CADENCES).forEach(k=>REL_CADENCES[k]={...DEFAULT_REL_CADENCES[k]});
  saveRelCadences(); rSettings(); showToast('Reset to defaults ✓');
}

// ── PROFILE NAV ───────────────────────────────────────────────────
function pushProf(id){
  const el=document.getElementById(id);
  el.style.display='block'; el.scrollTop=0;
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    el.classList.add('open');
    document.querySelector('.screen:not(.hidden)')?.classList.add('pushed');
  }));
}
function closeProf(id){
  document.getElementById(id).classList.remove('open');
  document.querySelector('.screen.pushed')?.classList.remove('pushed');
  setTimeout(()=>document.getElementById(id).style.display='none',380);
}

// ── MODALS ────────────────────────────────────────────────────────
function openModal(id){
  const el=document.getElementById(id);
  if(!el){ console.error('openModal: element not found:',id); return; }
  el.classList.add('open');
  const sheet=el.querySelector('.modal-sheet');
  if(sheet) sheet.scrollTop=0;
}
function closeModal(id){ const el=document.getElementById(id); if(el) el.classList.remove('open'); }
function closeModalOut(e,id){ if(e.target===document.getElementById(id)) closeModal(id); }
function selSeg(el,val){ selSegVal=val; document.querySelectorAll('#seg-chips .seg-chip').forEach(c=>c.classList.toggle('on',c===el)); }
function selEditSeg(el,val){ editSegVal=val; document.querySelectorAll('#edit-seg-chips .seg-chip').forEach(c=>c.classList.toggle('on',c===el)); }

// ── SAVE CLIENT ───────────────────────────────────────────────────
async function saveClient(){
  const name=document.getElementById('nc-name').value.trim();
  if(!name){ alert('Please enter a full name.'); return; }
  const ints=[...document.querySelectorAll('#nc-int-chips .int-chip.on, #nc-tag-chips .int-chip.on')].map(el=>el.textContent);
  const row={
    name, position:document.getElementById('nc-role').value.trim(),
    city:document.getElementById('nc-city').value.trim(),
    tier:'Active',
    net_worth:document.getElementById('nc-nw').value,
    nationality:document.getElementById('nc-nat').value.trim(),
    religion:document.getElementById('nc-rel').value,
    relationship:document.getElementById('nc-rel2').value,
    proxy_contact: document.getElementById('nc-proxy').value.trim()||null,
    interests:ints,
    notes:document.getElementById('nc-notes').value.trim(),
    sort_order: CLIENTS.length
  };
  const ncDob=document.getElementById('nc-dob')?.value||null;
  const {data,error}=await SB.from('clients').insert(row).select().single();
  if(error){ alert('Error saving: '+error.message); return; }
  if(ncDob){ await SB.from('clients').update({dob:ncDob}).eq('id',data.id); data.dob=ncDob; }
  CLIENTS.push(normaliseClient(data));
  closeModal('modal-client');
  ['nc-name','nc-role','nc-city','nc-nat','nc-notes','nc-dob'].forEach(id=>document.getElementById(id).value='');
  document.querySelectorAll('#nc-int-chips .int-chip, #nc-tag-chips .int-chip').forEach(el=>el.classList.remove('on'));
  rClients(); updateHomeStats(); showToast('Client added ✓');
}

function openEditClient(id){
  try{
    const c=CLIENTS.find(x=>x.id===id); if(!c) return;
    editClientId=id;
    const _v=(elId,val)=>{const el=document.getElementById(elId);if(el)el.value=val;};
    _v('ec-name',c.name);
    _v('ec-role',c.role||'');
    _v('ec-city',c.city||'');
    _v('ec-tier',c.tier);
    _v('ec-nw',c.nw);
    _v('ec-nat',c.nat||'');
    _v('ec-rel',c.rel||'Unknown');
    _v('ec-rel2',c.relationship||'General');
    const clientInts=(c.int||[]).map(i=>i.toLowerCase());
    document.querySelectorAll('#ec-int-chips .int-chip, #ec-tag-chips .int-chip').forEach(el=>el.classList.toggle('on',clientInts.includes(el.textContent.toLowerCase())));
    _v('ec-notes',c.notes||'');
    _v('ec-dob',c.dob||'');
    _v('ec-proxy',c.proxyContact||'');
    const proxyRow=document.getElementById('ec-proxy-row');
    if(proxyRow) proxyRow.style.display=c.relationship==='Proxy'?'':'none';
    openModal('modal-edit-client');
  }catch(e){
    console.error('openEditClient error:',e);
    openModal('modal-edit-client');
  }
}

async function deleteClient(){
  if(!editClientId||!confirm('Delete this client? This cannot be undone.')) return;
  const {error}=await SB.from('clients').delete().eq('id',editClientId);
  if(error){ showToast('Could not delete'); return; }
  CLIENTS=CLIENTS.filter(x=>x.id!==editClientId);
  closeModal('modal-edit-client');
  // Close profile if open
  const ps=document.getElementById('ps-client');
  if(ps&&!ps.classList.contains('hidden')) ps.classList.add('hidden');
  if(curTab==='clients') rClients();
  if(curTab==='home') rHome();
  showToast('Client deleted');
}

async function saveEditClient(){
  const c=CLIENTS.find(x=>x.id===editClientId); if(!c) return;
  const ints=[...document.querySelectorAll('#ec-int-chips .int-chip.on, #ec-tag-chips .int-chip.on')].map(el=>el.textContent);
  // VIP is toggled via the star button only — preserve it from the form
  if(c.vip && !ints.includes('VIP')) ints.push('VIP');
  const dobVal=document.getElementById('ec-dob')?.value||null;
  const updates={
    name:document.getElementById('ec-name').value.trim()||c.name,
    position:document.getElementById('ec-role').value.trim(),
    city:document.getElementById('ec-city').value.trim(),
    tier:c.tier||'Active',
    net_worth:document.getElementById('ec-nw').value,
    nationality:document.getElementById('ec-nat').value.trim(),
    religion:document.getElementById('ec-rel').value,
    relationship:document.getElementById('ec-rel2').value,
    proxy_contact: document.getElementById('ec-proxy').value.trim()||null,
    interests:ints,
    notes:document.getElementById('ec-notes').value.trim(),
  };
  const {error}=await SB.from('clients').update(updates).eq('id',editClientId);
  if(error){ console.error('saveEditClient error:',error); alert('Error: '+error.message); return; }
  // Save dob separately — silently skip if column doesn't exist yet
  if(dobVal!==undefined){ const {error:dobErr}=await SB.from('clients').update({dob:dobVal}).eq('id',editClientId); if(!dobErr) updates.dob=dobVal; }
  Object.assign(c, normaliseClient({...updates, id:editClientId, last_wa:c.wa, last_call:c.call, follow_up_date:c.followUp, has_deal:c.deal, proxy_contact:updates.proxy_contact}));
  closeModal('modal-edit-client');
  openC(c);
  if(curTab==='clients') rClients();
  if(curTab==='home') rHome();
  showToast('Client updated ✓');
}

// ── SAVE PARTNER ──────────────────────────────────────────────────
async function savePartner(){
  const name=document.getElementById('np-name').value.trim();
  if(!name){ alert('Please enter a partner name.'); return; }
  const row={
    company:name, category:document.getElementById('np-cat').value,
    crm_tier:document.getElementById('np-tier').value,
    contact:document.getElementById('np-contact').value.trim(),
    position:document.getElementById('np-role').value.trim(),
    country:document.getElementById('np-country').value.trim(),
    introduction_fee:document.getElementById('np-fee').value.trim(),
    business_fees:document.getElementById('np-bizfee').value.trim(),
    notes:document.getElementById('np-notes').value.trim(),
    sort_order:PARTNERS.length
  };
  const {data,error}=await SB.from('partners').insert(row).select().single();
  if(error){ alert('Error: '+error.message); return; }
  PARTNERS.push(normalisePartner(data));
  closeModal('modal-partner');
  ['np-name','np-contact','np-role','np-fee','np-bizfee','np-country','np-notes'].forEach(id=>document.getElementById(id).value='');
  rPartners(); updateHomeStats(); showToast('Partner added ✓');
}

function openEditPartner(id){
  const p=PARTNERS.find(x=>x.id===id); if(!p) return;
  editPartnerId=id;
  document.getElementById('ep-name').value=p.name;
  document.getElementById('ep-contact').value=p.contact||'';
  document.getElementById('ep-role').value=p.role||'';
  document.getElementById('ep-cat').value=p.cat;
  document.getElementById('ep-tier').value=p.tier;
  document.getElementById('ep-country').value=p.country||'';
  document.getElementById('ep-fee').value=p.fee||'';
  document.getElementById('ep-bizfee').value=p.bizFee||'';
  document.getElementById('ep-notes').value=p.notes||'';
  openModal('modal-edit-partner');
}

async function deletePartner(){
  if(!editPartnerId||!confirm('Delete this partner?')) return;
  const {error}=await SB.from('partners').delete().eq('id',editPartnerId);
  if(error){ showToast('Could not delete'); return; }
  PARTNERS=PARTNERS.filter(x=>x.id!==editPartnerId);
  closeModal('modal-edit-partner');
  const ps=document.getElementById('ps-partner');
  if(ps&&!ps.classList.contains('hidden')) ps.classList.add('hidden');
  if(curTab==='partners') rPartners();
  showToast('Partner deleted');
}

async function saveEditPartner(){
  const p=PARTNERS.find(x=>x.id===editPartnerId); if(!p) return;
  const updates={
    company:document.getElementById('ep-name').value.trim()||p.name,
    contact:document.getElementById('ep-contact').value.trim(),
    position:document.getElementById('ep-role').value.trim(),
    category:document.getElementById('ep-cat').value,
    crm_tier:document.getElementById('ep-tier').value,
    country:document.getElementById('ep-country').value.trim(),
    introduction_fee:document.getElementById('ep-fee').value.trim(),
    business_fees:document.getElementById('ep-bizfee').value.trim(),
    notes:document.getElementById('ep-notes').value.trim(),
  };
  const {error}=await SB.from('partners').update(updates).eq('id',editPartnerId);
  if(error){ alert('Error: '+error.message); return; }
  Object.assign(p, normalisePartner({...updates, id:editPartnerId, last_wa:p.wa, last_call:p.call, client_spend:p.spend, is_client:p.isC}));
  closeModal('modal-edit-partner');
  openP(p); if(curTab==='partners') rPartners();
  showToast('Partner updated ✓');
}

// ── CAMPAIGN IMAGE UPLOAD ─────────────────────────────────────────
function previewCamImage(prefix){
  const file=document.getElementById(prefix+'-image').files[0]; if(!file) return;
  const reader=new FileReader();
  reader.onload=e=>{
    const preview=document.getElementById(prefix+'-image-preview');
    preview.innerHTML=`<img src="${e.target.result}" style="width:100%;max-height:140px;object-fit:cover;border-radius:10px;margin-top:8px">`;
    if(prefix==='ncam') ncam_imageData={name:file.name,dataUrl:e.target.result};
    else ecam_imageData={name:file.name,dataUrl:e.target.result};
  };
  reader.readAsDataURL(file);
}

// ── SAVE CAMPAIGN ─────────────────────────────────────────────────
async function saveCampaign(){
  const name=document.getElementById('ncam-name').value.trim();
  if(!name){ alert('Please enter a campaign title.'); return; }
  const row={
    name, type:document.getElementById('ncam-type').value,
    segment:selSegVal||'All', occasion:document.getElementById('ncam-occ').value.trim(),
    date:document.getElementById('ncam-date').value.trim()||'TBC',
    notes:document.getElementById('ncam-notes').value.trim(),
    template:document.getElementById('ncam-template').value.trim()||null,
    wa_image: ncam_imageData?JSON.stringify(ncam_imageData):null,
    sort_order:CAMPAIGNS.length
  };
  const {data,error}=await SB.from('campaigns').insert(row).select().single();
  if(error){ alert('Error: '+error.message); return; }
  CAMPAIGNS.push(normaliseCampaign(data));
  ncam_imageData=null;
  closeModal('modal-campaign');
  ['ncam-name','ncam-occ','ncam-date','ncam-notes','ncam-template'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('ncam-image-preview').innerHTML='';
  rCampaigns(); updateHomeStats(); showToast('Campaign added ✓');
}

function openEditCampaign(id){
  const cam=CAMPAIGNS.find(x=>x.id===id); if(!cam) return;
  editCampaignId=id; editSegVal=cam.seg||'All';
  ecam_imageData=null;
  document.getElementById('ecam-name').value=cam.name;
  document.getElementById('ecam-type').value=cam.type;
  document.getElementById('ecam-date').value=cam.date;
  document.getElementById('ecam-occ').value=cam.occ||'';
  document.getElementById('ecam-notes').value=cam.notes||'';
  document.getElementById('ecam-template').value=cam.template||'';
  // Show existing image preview
  const previewEl=document.getElementById('ecam-image-preview');
  if(cam.waImage){
    try{
      const img=typeof cam.waImage==='string'?JSON.parse(cam.waImage):cam.waImage;
      previewEl.innerHTML=`<div style="font-size:11px;color:var(--t3);margin-top:6px">Current image: ${img.name||'attached'}</div>`;
    }catch(e){ previewEl.innerHTML=''; }
  } else {
    previewEl.innerHTML='';
  }
  document.querySelectorAll('#edit-seg-chips .seg-chip').forEach(chip=>{
    const onclick=chip.getAttribute('onclick')||'';
    const m=onclick.match(/'([^']+)'\)/);
    chip.classList.toggle('on', m && m[1]===editSegVal);
  });
  openModal('modal-edit-campaign');
}

async function saveEditCampaign(){
  const cam=CAMPAIGNS.find(x=>x.id===editCampaignId); if(!cam) return;
  const updates={
    name:document.getElementById('ecam-name').value.trim()||cam.name,
    type:document.getElementById('ecam-type').value,
    date:document.getElementById('ecam-date').value.trim()||cam.date,
    segment:editSegVal,
    occasion:document.getElementById('ecam-occ').value.trim(),
    notes:document.getElementById('ecam-notes').value.trim(),
    template:document.getElementById('ecam-template').value.trim()||null,
  };
  if(ecam_imageData) updates.wa_image=JSON.stringify(ecam_imageData);
  const {error}=await SB.from('campaigns').update(updates).eq('id',editCampaignId);
  if(error){ alert('Error: '+error.message); return; }
  ecam_imageData=null;
  Object.assign(cam, normaliseCampaign({...updates, id:editCampaignId, wa_image:updates.wa_image||cam.waImage, manual_client_ids:cam.manualClientIds, manual_partner_ids:cam.manualPartnerIds, manual_rec_ids:cam.manualRecIds, include_all_partners:cam.includeAllPartners, include_all_rolodex:cam.includeAllRolodex}));
  closeModal('modal-edit-campaign');
  openCampaign(cam); if(curTab==='campaigns') rCampaigns();
  showToast('Campaign updated ✓');
}

async function genCampaignTemplate(prefix){
  const btn=document.querySelector(`#modal-${prefix==='ncam'?'campaign':'edit-campaign'} .tmpl-gen-btn`);
  const box=document.getElementById(prefix+'-template');
  const name=document.getElementById(prefix+'-name').value.trim()||'this campaign';
  const notes=document.getElementById(prefix+'-notes').value.trim();
  const type=document.getElementById(prefix+'-type').value;
  btn.disabled=true; btn.textContent='…';
  const prompt=`You are Alicia Richardson, luxury private client advisor at Albemarle Private. Write a WhatsApp message template for a campaign.
Campaign: "${name}" | Type: ${type} | Segment: ${prefix==='ncam'?selSegVal:editSegVal} | Brief: ${notes||'N/A'}
Rules: open with [Name], warm luxury tone, 3-4 sentences max, no emojis unless celebratory, no sign-off. Output only the message.`;
  try{
    const resp=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'claude-sonnet-4-20250514',max_tokens:200,messages:[{role:'user',content:prompt}]})});
    const data=await resp.json();
    box.value=data.content?.[0]?.text?.trim()||'';
  }catch(e){ box.value='[Name], I hope you are keeping well. I wanted to reach out personally — I have something I think may be of interest to you.'; }
  btn.disabled=false; btn.textContent='✦ Generate';
}

function updateDealCommDisplay(){
  const partnerName=document.getElementById('nd-partner')?.value||'';
  const v=parseFloat(document.getElementById('nd-value')?.value)||0;
  const cur=document.getElementById('nd-currency')?.value||'GBP';
  const pct=calcDealPct(partnerName);
  const el=document.getElementById('nd-comm-display'); if(!el) return;
  if(!pct){ el.textContent='—'; el.title=''; return; }
  const p=PARTNERS.find(x=>x.name===partnerName);
  const label=`${p?.fee||''}${p?.bizFee?' × '+p.bizFee:''} = ${pct.toFixed(2)}%`;
  el.textContent=v?`${fmCur(v*(pct/100),cur)} (${pct.toFixed(2)}%)`:label;
}

// ── DEAL MODAL ────────────────────────────────────────────────────
let dealTasks=[];

const STAGE_PILL_CLS={Confirmed:'p-grn',Negotiation:'p-amb',Tentative:'p-blu',Waiting:'p-gh'};

function setDealModalMode(mode){
  // mode: 'view' | 'edit' | 'new'
  const isView=mode==='view';
  document.getElementById('nd-view-section').style.display=isView?'':'none';
  document.getElementById('nd-edit-section').style.display=isView?'none':'';
  document.getElementById('deal-footer-view').style.display=isView?'':'none';
  document.getElementById('deal-footer-edit').style.display=isView?'none':'';
  const tasksSec=document.getElementById('nd-tasks-section');
  const addBtn=document.getElementById('nd-task-add-btn');
  const taskForm=document.getElementById('nd-task-form');
  if(mode==='view'){
    tasksSec.style.display='block';
    if(addBtn) addBtn.style.display='none';
    if(taskForm) taskForm.style.display='none';
    document.getElementById('deal-modal-title').textContent='Deal';
  } else if(mode==='edit'){
    tasksSec.style.display='block';
    if(addBtn) addBtn.style.display='';
    document.getElementById('deal-submit-btn').textContent='Save Changes';
    document.getElementById('deal-delete-btn').style.display='block';
    document.getElementById('deal-modal-title').textContent='Edit Deal';
  } else { // new
    tasksSec.style.display='none';
    document.getElementById('deal-submit-btn').textContent='Add Deal';
    document.getElementById('deal-delete-btn').style.display='none';
    document.getElementById('deal-modal-title').textContent='New Deal';
  }
}

function enterDealEditMode(){
  setDealModalMode('edit');
}

function cancelDealEdit(){
  if(editingDealId){ setDealModalMode('view'); }
  else { closeModal('modal-deal'); }
}

function _populateDealViewSection(d){
  const client=CLIENTS.find(c=>c.id===d.clientId);
  document.getElementById('ndv-client').textContent=client?client.name:'';
  document.getElementById('ndv-sub').textContent=[d.pt,d.cat].filter(Boolean).join(' · ');
  const pill=document.getElementById('ndv-status-pill');
  pill.className='pill '+(STAGE_PILL_CLS[d.s]||'p-gh');
  pill.textContent=d.s;
  document.getElementById('ndv-value').textContent=fmCur(d.v,d.cur);
  const com=d.v*(d.pct/100);
  document.getElementById('ndv-comm').textContent=com?fmCur(com,d.cur):'—';
  const notesRow=document.getElementById('ndv-notes-row');
  document.getElementById('ndv-notes').textContent=d.n||'';
  notesRow.style.display=d.n?'':'none';
}

function _populateDealEditSection(d){
  const cs=document.getElementById('nd-client');
  const ps=document.getElementById('nd-partner');
  cs.value=d.clientId;
  ps.value=d.pt;
  document.getElementById('nd-cat').value=d.cat;
  document.getElementById('nd-status').value=d.s;
  document.getElementById('nd-currency').value=d.cur||'GBP';
  document.getElementById('nd-value').value=d.v;
  document.getElementById('nd-notes').value=d.n;
}

function openDealModal(presetClientId, editDealId){
  editingDealId=editDealId||null;
  const cs=document.getElementById('nd-client');
  cs.innerHTML=CLIENTS.map(c=>`<option value="${c.id}">${c.name}</option>`).join('');
  if(presetClientId) cs.value=presetClientId;
  const ps=document.getElementById('nd-partner');
  ps.innerHTML=PARTNERS.map(p=>`<option value="${p.name}">${p.name}</option>`).join('');

  if(editDealId){
    const d=DEALS.find(x=>x.id===editDealId);
    if(d){
      _populateDealViewSection(d);
      _populateDealEditSection(d);
    }
    setDealModalMode('view');
    loadDealTasks(editDealId);
  } else {
    ['nd-value','nd-notes'].forEach(id=>document.getElementById(id).value='');
    document.getElementById('nd-currency').value='GBP';
    dealTasks=[];
    setDealModalMode('new');
  }
  openModal('modal-deal');
  setTimeout(updateDealCommDisplay, 50);
}

// ── DEAL TASKS ────────────────────────────────────────────────────
async function loadDealTasks(dealId){
  dealTasks=[];
  renderDealTasks();
  const {data}=await SB.from('deal_tasks').select('*').eq('deal_id',dealId).order('due_date',{ascending:true});
  dealTasks=data||[];
  renderDealTasks();
}

let editingDealTaskId=null;

function renderDealTasks(){
  const list=document.getElementById('nd-task-list'); if(!list) return;
  list.innerHTML='';
  if(!dealTasks.length){
    const empty=document.createElement('div');
    empty.className='deal-task-empty'; empty.textContent='No tasks yet.';
    list.appendChild(empty); return;
  }
  dealTasks.forEach(t=>{
    const item=document.createElement('div');
    item.className='deal-task-item'+(t.done?' done':'');
    item.id='dti-'+t.id;

    const chk=document.createElement('div');
    chk.className='deal-task-chk'+(t.done?' on':'');
    chk.innerHTML=`<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke-width="3.5" stroke-linecap="round" stroke="white"><polyline points="20 6 9 17 4 12"/></svg>`;
    chk.onclick=(e)=>{ e.stopPropagation(); toggleDealTask(t.id,!t.done); };

    const info=document.createElement('div');
    info.className='deal-task-info';
    info.innerHTML=`<div class="deal-task-title-txt">${t.title}</div>${t.due_date?`<div class="deal-task-due">${fmtDealTaskDate(t.due_date)}</div>`:''}`;

    const pencil=document.createElement('div');
    pencil.className='atl-edit';
    pencil.innerHTML=`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
    pencil.onclick=(e)=>{ e.stopPropagation(); openEditDealTask(t.id, t.title, t.due_date||'', false); };

    item.appendChild(chk);
    item.appendChild(info);
    item.appendChild(pencil);
    list.appendChild(item);
  });
}

function fmtDealTaskDate(d){
  if(!d) return '';
  const dt=new Date(d+'T12:00:00');
  const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${dt.getDate()} ${months[dt.getMonth()]} ${dt.getFullYear()}`;
}

function openEditDealTask(id, title, dueDate, fromTimeline){
  editingDealTaskId=id;
  editingDealTaskFromTimeline=!!fromTimeline;
  document.getElementById('edt-title').value=title||'';
  document.getElementById('edt-due').value=dueDate||'';
  openModal('modal-edit-deal-task');
}

async function saveEditDealTask(){
  if(!editingDealTaskId) return;
  const title=document.getElementById('edt-title').value.trim(); if(!title) return;
  const due=document.getElementById('edt-due').value||null;
  const {error}=await SB.from('deal_tasks').update({title,due_date:due}).eq('id',editingDealTaskId);
  if(error){ showToast('Could not save task'); return; }
  const t=dealTasks.find(x=>x.id===editingDealTaskId);
  if(t){ t.title=title; t.due_date=due; }
  closeModal('modal-edit-deal-task');
  renderDealTasks();
  if(editingDealTaskFromTimeline) renderDealTasksTimeline();
  showToast('Task updated ✓');
}

async function deleteDealTask(){
  if(!editingDealTaskId) return;
  const {error}=await SB.from('deal_tasks').delete().eq('id',editingDealTaskId);
  if(error){ showToast('Could not delete task'); return; }
  dealTasks=dealTasks.filter(x=>x.id!==editingDealTaskId);
  closeModal('modal-edit-deal-task');
  renderDealTasks();
  if(editingDealTaskFromTimeline) renderDealTasksTimeline();
  showToast('Task deleted');
}

let editingDealTaskFromTimeline=false;



function toggleDealTaskForm(){
  const form=document.getElementById('nd-task-form');
  const open=form.style.display==='none';
  form.style.display=open?'flex':'none';
  if(open) document.getElementById('nd-task-title').focus();
}

async function saveDealTask(){
  const title=document.getElementById('nd-task-title').value.trim(); if(!title) return;
  const due=document.getElementById('nd-task-due').value||null;
  const {data,error}=await SB.from('deal_tasks').insert({deal_id:editingDealId,title,due_date:due,done:false}).select().single();
  if(error){ showToast('Could not save task'); return; }
  dealTasks.push(data);
  renderDealTasks();
  document.getElementById('nd-task-title').value='';
  document.getElementById('nd-task-due').value='';
  document.getElementById('nd-task-form').style.display='none';
  showToast('Task added ✓');
}

async function toggleDealTask(id,done){
  await SB.from('deal_tasks').update({done}).eq('id',id);
  const t=dealTasks.find(x=>x.id===id); if(t) t.done=done;
  renderDealTasks();
}

async function saveDeal(){
  const v=parseFloat(document.getElementById('nd-value').value);
  if(!v||isNaN(v)){ alert('Please enter a deal value.'); return; }
  const partnerName=document.getElementById('nd-partner').value;
  const pct=calcDealPct(partnerName);
  const clientId=document.getElementById('nd-client').value;
  const row={
    client_id:clientId,
    partner:partnerName,
    category:document.getElementById('nd-cat').value,
    status:document.getElementById('nd-status').value,
    spend:v, commission_rate:pct,
    currency:document.getElementById('nd-currency').value||'GBP',
    notes:document.getElementById('nd-notes').value.trim(),
  };

  if(editingDealId){
    const {error}=await SB.from('deals').update(row).eq('id',editingDealId);
    if(error){ alert('Error: '+error.message); return; }
    const idx=DEALS.findIndex(x=>x.id===editingDealId);
    if(idx>-1) DEALS[idx]=normaliseDeal({...row,id:editingDealId});
    showToast('Deal updated ✓');
  } else {
    const {data,error}=await SB.from('deals').insert(row).select().single();
    if(error){ alert('Error: '+error.message); return; }
    DEALS.push(normaliseDeal(data));
    // Mark client as having a deal
    await SB.from('clients').update({has_deal:true}).eq('id',clientId);
    const c=CLIENTS.find(x=>x.id===clientId); if(c) c.deal=true;
    showToast('Deal added ✓');
  }
  closeModal('modal-deal');
  if(curTab==='deals') rDeals(); if(curTab==='home') rHome();
  updateHomeStats();
}

async function deleteDeal(){
  if(!editingDealId) return;
  // Delete all tasks for this deal, then the deal itself
  await SB.from('deal_tasks').delete().eq('deal_id',editingDealId);
  const {error}=await SB.from('deals').delete().eq('id',editingDealId);
  if(error){ showToast('Could not delete deal'); return; }
  DEALS=DEALS.filter(x=>x.id!==editingDealId);
  closeModal('modal-deal');
  showToast('Deal deleted');
  if(curTab==='deals') rDeals();
  rHome(); updateHomeStats();
}

// ── WHATSAPP ──────────────────────────────────────────────────────
let waCurrentClient=null, waCurrentCampaign=null;

function openWaSheet(client, campaign){
  waCurrentClient=client; waCurrentCampaign=campaign;
  const av=document.getElementById('wa-av');
  av.textContent=ini(client.name);
  document.getElementById('wa-header-name').textContent=client.name;
  document.getElementById('wa-header-sub').textContent=campaign?campaign.name+' · '+(client.role||client.city):(client.role||client.city);
  document.getElementById('wa-attach-section').innerHTML='';
  document.getElementById('wa-sheet-overlay').classList.add('open');

  const msg=campaign&&campaign.template?personaliseTemplate(campaign.template,client):'';
  document.getElementById('wa-msg-box').value=msg;
  if(msg) updateWaBtn(msg);
  renderAttach(campaign);
}

function personaliseTemplate(tpl, client){
  const first=client.name.split(' ')[0];
  return tpl.replace(/\[Name\]/gi,first).replace(/\[First Name\]/gi,first).replace(/\[Full Name\]/gi,client.name);
}

function renderAttach(campaign){
  const section=document.getElementById('wa-attach-section');
  if(!campaign||!campaign.waImage){ section.innerHTML=''; return; }
  let img; try{ img=typeof campaign.waImage==='string'?JSON.parse(campaign.waImage):campaign.waImage; }catch(e){ section.innerHTML=''; return; }
  if(!img||!img.dataUrl){ section.innerHTML=''; return; }
  section.innerHTML=`<div class="wa-attached-file">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
    <div class="wa-attached-name">${img.name||'Campaign image'}</div>
    <span class="wa-attached-copy" onclick="copyAttachment()">Copy Image</span>
  </div>`;
  waCurrentCampaign._imgParsed=img;
}

function copyAttachment(){
  const btn=document.querySelector('.wa-attached-copy');
  const img=waCurrentCampaign?._imgParsed||null;
  const dataUrl=img?.dataUrl;
  if(dataUrl){
    fetch(dataUrl).then(r=>r.blob()).then(blob=>{
      try{ navigator.clipboard.write([new ClipboardItem({[blob.type]:blob})]).then(()=>{ btn.textContent='✓ Copied!'; setTimeout(()=>btn.textContent='Copy Image',2000); }); }
      catch(err){ btn.textContent='⚠ Share instead'; setTimeout(()=>btn.textContent='Copy Image',2000); }
    });
  }
}

function updateWaBtn(msg){ document.getElementById('wa-open-btn').href=`https://wa.me/?text=${encodeURIComponent(msg)}`; }

function copyWaMsg(){
  const msg=document.getElementById('wa-msg-box').value;
  navigator.clipboard.writeText(msg).then(()=>{
    const btn=document.getElementById('wa-copy-btn');
    btn.innerHTML=`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg> Copied!`;
    btn.classList.add('wa-copied');
    setTimeout(()=>{ btn.innerHTML=`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy Message`; btn.classList.remove('wa-copied'); },2000);
  });
}


function closeWaSheet(e){ if(e.target===document.getElementById('wa-sheet-overlay')) document.getElementById('wa-sheet-overlay').classList.remove('open'); }

// ── UTILS ─────────────────────────────────────────────────────────
function updateHomeStats(){
  const tc=DEALS.reduce((s,d)=>s+toUSD(d.v*(d.pct/100),d.cur),0);
  document.getElementById('qs-pipe').textContent=fm(tc);
  document.getElementById('qs-cli').textContent=CLIENTS.length;
  document.getElementById('qs-cam').textContent=CAMPAIGNS.length;
  document.getElementById('qs-par').textContent=PARTNERS.length;
}

// ── INIT ──────────────────────────────────────────────────────────
(async function init(){
  loadRelCadences();

  // Set date
  const days=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
  const now=new Date();
  document.getElementById('home-date').textContent=`${days[now.getDay()]} · ${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`;

  await loadAll();

  document.getElementById('loading-overlay').classList.add('hidden');
  rHome();
})();
