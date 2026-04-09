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
const CC = {'Follow-Up':'p-blu', Seasonal:'p-amb', Mandate:'p-gold', Event:'p-blu', Ongoing:'p-grn', Triggered:'p-gh'};

// ── RELATIONSHIP CADENCES ─────────────────────────────────────────
const DEFAULT_REL_CADENCES = {
  Personal: {waD:14, cD:30,  label:'Personal', p:1},
  Close:    {waD:28, cD:null,label:'Close',    p:2},
  General:  {waD:28, cD:null,label:'General',  p:3},
  Proxy:    {waD:56, cD:null,label:'Proxy',    p:4},
  Archive:  {waD:84, cD:null,label:'Archive',  p:5},
};
let REL_CADENCES = {};
function loadRelCadences(){
  try{ const saved=JSON.parse(localStorage.getItem('rel_cadences')||'null'); REL_CADENCES=saved||{}; }
  catch(e){ REL_CADENCES={}; }
  Object.keys(DEFAULT_REL_CADENCES).forEach(k=>{ if(!REL_CADENCES[k]) REL_CADENCES[k]={...DEFAULT_REL_CADENCES[k]}; });
}
function saveRelCadences(){ localStorage.setItem('rel_cadences',JSON.stringify(REL_CADENCES)); }

// ── STATE ─────────────────────────────────────────────────────────
let CLIENTS=[], PARTNERS=[], DEALS=[], CAMPAIGNS=[], RECS=[];
let doneTasks = new Set(); // task_key set from DB
let cF='All', curTab='home';
let relF='All'; // KEEP for backward compat but no longer used in UI
let clientFilters={relationship:null, nw:null, interest:null, tag:null}; // active filter state
let selSegVal='All', editSegVal='All';
let editClientId=null, editPartnerId=null, editCampaignId=null;
let editingDealId=null;
let editRecId=null;
let homeTab='deals', homeDealTasks=null;
let doneDealTasksToday = 0;
let addingCampaignId=null;
let ncam_imageData=null, ecam_imageData=null;
let camCompletions = new Set(); // 'type:id' keys
let openCampaignId = null;
let addCamTab='clients';
let CLIENT_ACTIVITIES=[];
let currentActivityClientId=null;

// ── HELPERS ───────────────────────────────────────────────────────
const ini = n => n.split(' ').slice(0,2).map(w=>w[0]||'').join('').toUpperCase();
const daysSince = d => d ? Math.floor((TODAY - new Date(d))/86400000) : 9999;
const fm = v => v>=1e6?'$'+(v/1e6).toFixed(1)+'m':v>=1e3?'$'+(v/1e3).toFixed(0)+'k':'$'+v.toLocaleString();
const abbr = n => n.replace(/[()]/g,'').split(/[\s/&,]+/).slice(0,2).map(w=>w[0]||'').join('').toUpperCase();

function showToast(msg){ const t=document.getElementById('toast'); t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2200); }

// ── LOAD DATA ─────────────────────────────────────────────────────
async function loadAll(){
  const today = new Date().toISOString().split('T')[0];

  const [cR, pR, dR, camR, recR, taskR] = await Promise.all([
    SB.from('clients').select('*').order('sort_order'),
    SB.from('partners').select('*').order('sort_order'),
    SB.from('deals').select('*').order('created_at'),
    SB.from('campaigns').select('*').order('sort_order'),
    SB.from('recommendations').select('*').order('category').order('sort_order'),
    SB.from('task_completions').select('task_key,reset_date'),
  ]);

  CLIENTS   = (cR.data||[]).map(normaliseClient);
  PARTNERS  = (pR.data||[]).map(normalisePartner);
  DEALS     = (dR.data||[]).map(normaliseDeal);
  CAMPAIGNS = (camR.data||[]).map(normaliseCampaign);
  RECS      = recR.data||[];

  // Task done state — only keep if reset_date is today
  doneTasks = new Set(
    (taskR.data||[]).filter(t => t.reset_date === today).map(t=>t.task_key)
  );

  // Clean up stale task completions from other days
  const stale = (taskR.data||[]).filter(t=>t.reset_date!==today).map(t=>t.task_key);
  if(stale.length) await SB.from('task_completions').delete().in('task_key', stale);
}

function normaliseClient(r){
  return {
    id: r.id, name: r.name, role: r.position||'', nat: r.nationality||'',
    city: r.city||'', tier: r.tier||'Active', nw: r.net_worth||'HNWI',
    rel: r.religion||'Unknown', int: r.interests||[], notes: r.notes||'',
    wa: r.last_wa||null, call: r.last_call||null,
    followUp: r.follow_up_date||null, deal: r.has_deal||false,
    relationship: r.relationship||'',
    proxyContact: r.proxy_contact||'',
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
function normaliseDeal(r){
  return {
    id: r.id, clientId: r.client_id, pt: r.partner||'',
    cat: r.category||'Real Estate', v: Number(r.spend)||0,
    pct: Number(r.commission_rate)||0, s: r.status||'Waiting', n: r.notes||'',
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

function getSegmentMatchedClients(cam){
  let filtered=CLIENTS;
  if(cam.occ && cam.occ!==''){
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
  // Add manual clients (always included, even if they'd otherwise be excluded)
  if(cam.manualClientIds && cam.manualClientIds.length){
    const existing=new Set(filtered.map(c=>c.id));
    CLIENTS.filter(c=>cam.manualClientIds.includes(c.id)&&!existing.has(c.id)).forEach(c=>filtered.push(c));
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
      const standaloneWhy=`0 clients · ${camWhy}`;
      t.push({id:'cam-'+cam.id, nm:'Campaign', act:cam.name,
        why:standaloneWhy, urg:'soon', pri:25, isCam:true, camId:cam.id, clientObj:null});
      return;
    }
    clients.forEach(c=>{
      camCoveredIds.add(c.id);
      const rel=REL_CADENCES[c.relationship];
      t.push({id:'cam-'+cam.id+'-'+c.id, nm:c.name, act:cam.name+' — '+c.name,
        why:camWhy, urg:'soon', pri:(rel?rel.p*10:20)+2, isCam:true, camId:cam.id, clientObj:c});
    });
  });

  // Cadence pass: clients NOT covered by any active campaign
  CLIENTS.forEach(c=>{
    if(camCoveredIds.has(c.id)) return;
    const rel=REL_CADENCES[c.relationship];
    if(!rel||c.relationship==='Archive'||!c.relationship) return;
    const wa=daysSince(c.wa), cl=daysSince(c.call);
    const waDue=rel.waD&&wa>=rel.waD, clDue=rel.cD&&cl>=rel.cD;
    if(!waDue&&!clDue) return;
    if(clDue){
      const ov=cl-rel.cD;
      t.push({id:'cl-'+c.id, nm:c.name, act:'Call '+c.name,
        why:cl===9999?'Never called · '+c.relationship+' relationship':`${cl}d since last call · due every ${rel.cD}d`,
        urg:ov>14?'urgent':ov>=0?'soon':'normal', pri:rel.p*10+1+(c.deal?0:5)});
      return;
    }
    if(waDue){
      const ov=wa-rel.waD;
      t.push({id:'wa-'+c.id, nm:c.name, act:'WhatsApp '+c.name,
        why:wa===9999?'Never contacted · '+c.relationship+' relationship':`${wa}d since last message · due every ${rel.waD}d`,
        urg:ov>7?'urgent':ov>=0?'soon':'normal', pri:rel.p*10+(c.deal?0:5)});
    }
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

function rHome(){
  // Quick stats row (always)
  const tc=DEALS.reduce((s,d)=>s+(d.v*(d.pct/100)),0);
  document.getElementById('qs-pipe').textContent=fm(tc);
  document.getElementById('qs-cli').textContent=CLIENTS.length;
  document.getElementById('qs-cam').textContent=CAMPAIGNS.length;
  document.getElementById('qs-par').textContent=PARTNERS.length;

  const list=document.getElementById('task-list'); list.innerHTML='';

  if(homeTab==='deals'){
    updateProgressRing(0,0,0,'Loading deal tasks…');
    renderHomeDealTasks();
    return;
  }

  // ── Network tab ────────────────────────────────────────────────
  const tasks=mkTasks(), tot=tasks.length, nd=doneTasks.size;
  const urg=tasks.filter(t=>t.urg==='urgent'&&!doneTasks.has(t.id)).length;
  updateProgressRing(tot,nd,urg,
    nd===tot&&tot>0?'All done — exceptional work.':`${tot-nd} task${tot-nd===1?'':'s'} remaining today`);

  const BUCKETS=[
    {key:'followups',  label:'Follow-Ups',          tasks:[]},
    {key:'mandates',   label:'Mandates',             tasks:[]},
    {key:'luxury',     label:'Luxury',               tasks:[]},
    {key:'holiday',    label:'Holidays & Birthdays', tasks:[]},
  ];
  tasks.forEach(t=>{
    const cam=t.camId?CAMPAIGNS.find(c=>c.id===t.camId):null;
    let b;
    if(cam){
      if(cam.type==='Mandate')                                    b=BUCKETS[1];
      else if(cam.type==='Seasonal'||cam.type==='Triggered')     b=BUCKETS[3];
      else if(cam.type==='Follow-Up')                             b=BUCKETS[0];
      else                                                         b=BUCKETS[2];
    } else { b=BUCKETS[0]; }
    b.tasks.push(t);
  });

  let gi=0;
  BUCKETS.forEach(bucket=>{
    if(!bucket.tasks.length) return;
    const hdr=document.createElement('div');
    hdr.className='task-group-hdr'; hdr.textContent=bucket.label;
    list.appendChild(hdr);
    bucket.tasks.forEach(t=>{
      const isDone=doneTasks.has(t.id);
      const el=document.createElement('div');
      el.className=`tc ${isDone?'done':t.isCam?'campaign':t.urg} a`;
      el.style.animationDelay=(gi++*0.04)+'s';
      if(isDone) el.style.display='none'; // completed tasks hidden from start on re-render
      const avClass=t.isCam?'cam-av':'';
      const avContent=t.isCam?'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 4l16 8-16 8V4z"/></svg>':ini(t.nm);
      el.innerHTML=`<div class="tc-av ${avClass}">${avContent}</div>
        <div class="tc-body"><div class="tc-act">${t.act}</div><div class="tc-why">${t.why}</div></div>
        <div class="chk ${isDone?'on':''}" onclick="tick('${t.id}',this,event)">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke-width="3.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
        </div>`;
      if(t.isCam){
        el.onclick=(e)=>{ if(e.target.closest('.chk')) return;
          const cam=CAMPAIGNS.find(c=>c.id===t.camId);
          if(t.clientObj) openWaSheet(t.clientObj,cam);
          else openCampaign(cam);
        };
      } else {
        const isCall=t.id.startsWith('cl-');
        const client=CLIENTS.find(c=>'wa-'+c.id===t.id||'cl-'+c.id===t.id);
        if(client){
          el.onclick=(e)=>{ if(e.target.closest('.chk')) return;
            if(isCall) logCall(client);
            else openWaSheet(client,null);
          };
        }
      }
      list.appendChild(el);
    });
  });
}

function switchHomeTab(tab){
  if(tab===homeTab) return;
  doneDealTasksToday=0;
  homeTab=tab; homeDealTasks=null;
  document.querySelectorAll('.home-toggle-btn').forEach(b=>b.classList.toggle('on',b.dataset.tab===tab));
  rHome();
}

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
  closeModal('modal-reschedule-task');
  homeDealTasks=null; // force reload
  renderHomeDealTasks();
  showToast('Task rescheduled ✓');
}

async function deleteDealTask(id, source){
  const {error}=await SB.from('deal_tasks').delete().eq('id',id);
  if(error){ showToast('Could not delete task'); return; }
  if(source==='modal'){
    dealTasks=dealTasks.filter(t=>t.id!==id);
    renderDealTasks(); showToast('Task deleted');
  } else {
    homeDealTasks=(homeDealTasks||[]).filter(t=>t.id!==id);
    renderHomeDealTasks(); showToast('Task deleted');
  }
}

async function tickDealTask(id,el,e){
  e.stopPropagation();
  el.classList.add('on');
  const card=el.closest('.tc');
  card.classList.add('done');
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
    card.classList.add('done');
    await SB.from('task_completions').upsert({task_key:id,reset_date:today},{onConflict:'task_key'});
    // Update ring counts without re-rendering list
    const tasks=mkTasks(), tot=tasks.length, nd=doneTasks.size;
    const urg=tasks.filter(t=>t.urg==='urgent'&&!doneTasks.has(t.id)).length;
    updateProgressRing(tot,nd,urg,
      nd===tot&&tot>0?'All done — exceptional work.':`${tot-nd} task${tot-nd===1?'':'s'} remaining today`);
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
function rDeals(){
  const tc=DEALS.reduce((s,d)=>s+(d.v*(d.pct/100)),0);
  document.getElementById('d-tp').textContent=fm(tc);
  document.getElementById('d-tc').textContent=DEALS.length;

  // Stage summary bubbles
  const STAGE_IDS={Confirmed:'conf',Negotiation:'neg',Tentative:'tent',Waiting:'wait'};
  Object.entries(STAGE_IDS).forEach(([stage,key])=>{
    const sd=DEALS.filter(d=>d.s===stage);
    const sv=sd.reduce((s,d)=>s+(d.v*(d.pct/100)),0);
    document.getElementById('d-sg-'+key+'-v').textContent=fm(sv);
    document.getElementById('d-sg-'+key+'-n').textContent=sd.length+(sd.length===1?' deal':' deals');
  });

  // Grouped deal cards by stage
  const list=document.getElementById('deal-list'); list.innerHTML='';
  const STAGES=['Confirmed','Negotiation','Tentative','Waiting'];
  let gi=0;
  STAGES.forEach(stage=>{
    const sd=DEALS.filter(d=>d.s===stage);
    if(!sd.length) return;
    const hdr=document.createElement('div');
    hdr.className='deal-group-hdr'; hdr.textContent=stage;
    list.appendChild(hdr);
    sd.forEach(d=>{
      const client=CLIENTS.find(c=>c.id===d.clientId);
      const cname=client?client.name:d.clientId;
      const com=d.v*(d.pct/100);
      const el=document.createElement('div');
      el.className='dc gc-s a'; el.style.animationDelay=(gi++*0.05)+'s';
      el.onclick=()=>openDealModal(d.clientId,d.id);
      el.innerHTML=`<div class="dc-top">
        <div><div class="dc-cli">${cname}</div><div class="dc-par">${d.pt} · ${d.cat}</div></div>
      </div>
      <div class="dc-bot">
        <div><div class="dc-val">${fm(com)}</div><div class="dc-spend">${fm(d.v)} client spend</div></div>
      </div>`;
      list.appendChild(el);
    });
  });
}

// ── CAMPAIGNS ─────────────────────────────────────────────────────
function rCampaigns(){
  const list=document.getElementById('cam-list'); list.innerHTML='';

  const GROUPS=[
    {key:'followups', label:'Follow-Ups',          cams:[]},
    {key:'mandates',  label:'Mandates',             cams:[]},
    {key:'luxury',    label:'Luxury',               cams:[]},
    {key:'holiday',   label:'Holidays & Birthdays', cams:[]},
  ];

  CAMPAIGNS.forEach(cam=>{
    let g;
    if(cam.type==='Follow-Up')                          g=GROUPS[0];
    else if(cam.type==='Mandate')                        g=GROUPS[1];
    else if(cam.type==='Seasonal'||cam.type==='Triggered') g=GROUPS[3];
    else if(cam.type==='Event'||cam.type==='Ongoing')    g=GROUPS[2];
    else                                                  g=GROUPS[2];
    g.cams.push(cam);
  });

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
        ${cam.date?`<span class="pill p-gh">${cam.date}</span>`:''}
        ${cam.seg?`<span class="pill p-gold">Seg: ${cam.seg}</span>`:''}
        <span class="pill p-grn">${cnt} contacts</span>
      </div>`;
      list.appendChild(el);
    });
  });
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

  // Sort: pending first, done last
  allContacts.sort((a,b)=>{
    const aD=camCompletions.has(a.type+':'+a.id);
    const bD=camCompletions.has(b.type+':'+b.id);
    return aD===bD?0:aD?1:-1;
  });

  const rosterHtml=allContacts.length?allContacts.map((c,i)=>{
    const done=camCompletions.has(c.type+':'+c.id);
    // Add a "Done" divider before first completed item
    const prefix=(done&&(i===0||!camCompletions.has(allContacts[i-1]?.type+':'+allContacts[i-1]?.id)))
      ?`<div class="cam-done-divider">Completed · ${doneCount}</div>`:'';
    return `${prefix}<div class="cam-roster-item${done?' done':''} a">
      <div class="cri-av" style="${c.avStyle}">${c.av}</div>
      <div style="flex:1;min-width:0"><div class="cri-name">${c.name}</div><div class="cri-sub">${c.sub}</div></div>
      <div class="cri-check${done?' on':''}" onclick="toggleCamCompletion('${cam.id}','${c.type}','${c.id}')">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke-width="3.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
      </div>
    </div>`;
  }).join('')
  :'<div style="padding:16px;font-size:13px;color:var(--t3);font-style:italic">No contacts enrolled yet.</div>';

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
        <div><div class="prof-name">${cam.name}</div><div class="prof-role-l">${cam.type} · ${cam.date}</div></div>
      </div>
      <div class="prof-pills">
        <span class="pill ${CC[cam.type]||'p-gh'}">${cam.type}</span>
        ${cam.seg?`<span class="pill p-gold">Segment: ${cam.seg}</span>`:''}
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
      ${rosterHtml}
    </div>
    <div style="height:36px"></div>`;
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
  const billionaires=CLIENTS.filter(c=>c.nw==='Billionaire').length;
  const centimillionaires=CLIENTS.filter(c=>c.nw==='Centimillionaire').length;
  const activeRels=CLIENTS.filter(c=>c.relationship&&c.relationship!=='Archive').length;
  const statsEl=document.getElementById('cli-stats');
  if(statsEl) statsEl.innerHTML=`
    <div class="cli-stat"><div class="cli-stat-n">${total}</div><div class="cli-stat-l">Total</div></div>
    <div class="cli-stat"><div class="cli-stat-n g">${billionaires}</div><div class="cli-stat-l">Billionaires</div></div>
    <div class="cli-stat"><div class="cli-stat-n">${centimillionaires}</div><div class="cli-stat-l">Centimilli.</div></div>
    <div class="cli-stat"><div class="cli-stat-n">${activeRels}</div><div class="cli-stat-l">Active</div></div>
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
    const ai=NW_ORDER.includes(a.nw)?NW_ORDER.indexOf(a.nw):99;
    const bi=NW_ORDER.includes(b.nw)?NW_ORDER.indexOf(b.nw):99;
    if(ai!==bi) return ai-bi;
    return (a.name||'').localeCompare(b.name||'');
  });

  const el=document.getElementById('cli-list'); el.innerHTML='';
  const showNwHeaders=!q&&!clientFilters.nw;
  let lastNw=null;
  let idx=0;
  list.forEach(c=>{
    if(showNwHeaders&&c.nw!==lastNw){
      lastNw=c.nw;
      const h=document.createElement('div');
      h.className='rec-cat-header'; h.textContent=c.nw;
      el.appendChild(h);
    }
    const rel=REL_CADENCES[c.relationship];
    const wa=daysSince(c.wa), cl=daysSince(c.call);
    const clOv=rel?.cD&&cl>=rel.cD, waOv=rel?.waD&&wa>=rel.waD;
    const div=document.createElement('div');
    div.className='pc gc a'; div.style.animationDelay=(idx++*0.04)+'s';
    div.onclick=()=>openC(c);
    const cardTag=c.deal?'<span class="pill p-gold" style="font-size:9px;margin-top:4px;align-self:flex-start">Deal</span>':(c.int||[]).includes('High Potential')?'<span class="pill" style="font-size:9px;margin-top:4px;align-self:flex-start;background:rgba(138,109,62,0.1);color:var(--gold);border-color:rgba(138,109,62,0.25)">High Potential</span>':'';
    div.innerHTML=`<div class="pc-av">${ini(c.name)}</div>
  <div class="pc-info">
    <div class="pc-name">${c.name}</div>
    <div class="pc-sub">${c.role||c.city||''}</div>
    ${cardTag}
    ${c.relationship==='Proxy'&&c.proxyContact?`<div class="pc-proxy">via ${c.proxyContact}</div>`:''}
  </div>`;
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

// ── ACTIVITY TIMELINE ─────────────────────────────────────────────
async function loadClientActivities(clientId, client){
  const {data,error}=await SB.from('client_activities').select('*').eq('client_id',clientId).order('occurred_at',{ascending:false});
  CLIENT_ACTIVITIES=error?[]:(data||[]);

  // Backfill: if no call/wa activities exist yet, seed from last_call/last_wa
  // (handles history logged before the timeline existed)
  if(client){
    const hasCall=CLIENT_ACTIVITIES.some(a=>a.type==='call');
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
    const rCall=CLIENT_ACTIVITIES.filter(a=>a.type==='call'&&!a._synthetic)[0];
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
    </div>`).join('')}
  </div>`;
}







async function openLogMeetingPrompt(clientId){
  // replaced by logMeeting — kept for safety
}

function cancelLogMeeting(){}

async function saveLogMeeting(clientId){
  // replaced by logMeeting
}

async function openC(c){
  currentActivityClientId=c.id;
  const rel=REL_CADENCES[c.relationship];
  const wa=daysSince(c.wa), cl=daysSince(c.call);
  const waOv=rel?.waD&&wa>=rel.waD, clOv=rel?.cD&&cl>=rel.cD;
  const waStr=wa===9999?'Never contacted':`${wa} days ago`;
  const clStr=cl===9999?'Never called':`${cl} days ago`;
  const cDeals=DEALS.filter(d=>d.clientId===c.id);
  const dHtml=cDeals.length?cDeals.map(d=>`<div class="deal-row">
    <div><div class="dr-l">${d.pt}</div><div class="dr-s">${d.cat} · ${d.s}</div></div>
    <div style="text-align:right"><div class="dr-v">${fm(d.v)}</div><div class="dr-c">~${fm(d.v*(d.pct/100))}</div></div>
  </div>`).join(''):'<div style="padding:13px 16px;font-size:12px;color:var(--t3);font-style:italic">No active deals</div>';

  const cCams=CAMPAIGNS.filter(cam=>getCampaignClients(cam).some(cl2=>cl2.id===c.id));
  const camHtml=cCams.length?cCams.map(cam=>`<span class="pill p-cam" onclick="openCampaign(CAMPAIGNS.find(x=>x.id==='${cam.id}'))">${cam.name}</span>`).join(''):'';

  // Load activities (async, then update)
  await loadClientActivities(c.id, c);

  document.getElementById('ps-client-body').innerHTML=`
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
        <span class="pill" style="background:${TC[c.tier]||'#888'}15;color:${TC[c.tier]||'#888'};border-color:${TC[c.tier]||'#888'}40">${c.tier}</span>
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
      <div class="sec-row"><div class="sec-k">Last WhatsApp</div><div class="sec-v ${waOv?'ov':wa!==9999?'ok':''}">${waStr}${waOv?' — Overdue':''}</div></div>
      <div class="sec-row"><div class="sec-k">Last Phone Call</div><div class="sec-v ${clOv?'ov':cl!==9999?'ok':''}">${clStr}${clOv?' — Overdue':''}</div></div>
      ${c.followUp?`<div class="sec-row"><div class="sec-k">Follow-up date</div><div class="sec-v">${c.followUp}</div></div>`:''}
    </div>
    ${c.int.length?`<div class="prof-sec"><div class="sec-lbl">Interests & Segments</div><div class="itags">${c.int.map(x=>`<span class="pill p-gh">${x}</span>`).join('')}</div></div>`:''}
    ${camHtml?`<div class="prof-sec"><div class="sec-lbl">Active Campaigns</div><div class="itags" style="margin-top:4px">${camHtml}</div></div>`:''}
    <div class="prof-sec"><div class="sec-lbl">Deals & Commission</div>${dHtml}</div>
    ${c.notes?`<div class="prof-sec"><div class="sec-lbl">Notes</div><div class="sec-notes">${c.notes}</div></div>`:''}
    <div class="prof-sec">
      <div class="sec-lbl">Activity Timeline</div>
      <div id="atl-inner">${renderActivityTimeline(c.id)}</div>
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
      <div class="act" onclick="openDealModal('${c.id}',null)">
        <div class="act-ic"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></div>
        <div><div class="act-t">Add Deal</div><div class="act-s">Log a new deal for this client</div></div>
      </div>
    </div>
    <div style="height:36px"></div>`;
  pushProf('ps-client');
}

// ── LOG CALL / WA / MEETING ───────────────────────────────────────
async function logCall(c){
  if(!c) return;
  const now=new Date();
  const today=now.toISOString().split('T')[0];
  const {error}=await SB.from('clients').update({last_call:today}).eq('id',c.id);
  if(error) return;
  c.call=today;
  const {data:actData,error:actErr}=await SB.from('client_activities').insert({client_id:c.id,type:'call',occurred_at:now.toISOString()}).select().single();
  if(actErr){ console.error('client_activities insert error:',actErr); }
  if(actData){ CLIENT_ACTIVITIES=[actData,...CLIENT_ACTIVITIES].sort((a,b)=>new Date(b.occurred_at)-new Date(a.occurred_at)); }
  const tlInner=document.getElementById('atl-inner');
  if(tlInner) tlInner.innerHTML=renderActivityTimeline(c.id);
  rHome(); if(curTab==='clients') rClients(); showToast('Call logged ✓');
}
async function logWa(c){
  if(!c) return;
  const now=new Date();
  const today=now.toISOString().split('T')[0];
  const {error}=await SB.from('clients').update({last_wa:today}).eq('id',c.id);
  if(error) return;
  c.wa=today;
  const {data:actData,error:actErr}=await SB.from('client_activities').insert({client_id:c.id,type:'whatsapp',occurred_at:now.toISOString()}).select().single();
  if(actErr){ console.error('client_activities insert error:',actErr); }
  if(actData){ CLIENT_ACTIVITIES=[actData,...CLIENT_ACTIVITIES].sort((a,b)=>new Date(b.occurred_at)-new Date(a.occurred_at)); }
  const tlInner=document.getElementById('atl-inner');
  if(tlInner) tlInner.innerHTML=renderActivityTimeline(c.id);
  rHome(); if(curTab==='clients') rClients(); showToast('WhatsApp logged ✓');
}
async function logMeeting(c){
  if(!c) return;
  const now=new Date();
  const {data:actData,error:actErr}=await SB.from('client_activities').insert({client_id:c.id,type:'meeting',occurred_at:now.toISOString()}).select().single();
  if(actErr){ console.error('client_activities insert error:',actErr); return; }
  if(actData){ CLIENT_ACTIVITIES=[actData,...CLIENT_ACTIVITIES].sort((a,b)=>new Date(b.occurred_at)-new Date(a.occurred_at)); }
  const tlInner=document.getElementById('atl-inner');
  if(tlInner) tlInner.innerHTML=renderActivityTimeline(c.id);
  showToast('Meeting logged ✓');
}

// ── PARTNERS ──────────────────────────────────────────────────────
function rPartners(){
  let list=cF==='All'?[...PARTNERS]:[...PARTNERS.filter(p=>p.cat===cF)];
  list.sort((a,b)=>{
    if(a.cat!==b.cat) return (a.cat||'').localeCompare(b.cat||'');
    return (a.name||'').localeCompare(b.name||'');
  });
  const el=document.getElementById('par-list'); el.innerHTML='';
  const showCatHeaders=cF==='All';
  let lastCat=null;
  let idx=0;
  list.forEach(p=>{
    if(showCatHeaders&&p.cat!==lastCat){
      lastCat=p.cat;
      const h=document.createElement('div');
      h.className='rec-cat-header'; h.textContent=p.cat;
      el.appendChild(h);
    }
    const div=document.createElement('div');
    div.className='pc gc a'; div.style.animationDelay=(idx++*0.04)+'s';
    div.onclick=()=>openP(p);
    div.innerHTML=`<div class="pc-av" style="border-radius:14px;font-size:13px">${abbr(p.name)}</div>
      <div class="pc-info"><div class="pc-name">${p.name}</div><div class="pc-sub">${p.contact}${p.role?' · '+p.role:''}</div></div>
      <div class="pc-r">
        ${p.fee?`<span style="font-family:'Cormorant Garamond',serif;font-size:18px;color:var(--gold);font-weight:300">${p.fee}</span>`:''}
        <span class="pill p-gh" style="font-size:9px">${p.cat}</span>
      </div>`;
    el.appendChild(div);
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
function rRecs(){
  const list=document.getElementById('rec-list'); list.innerHTML='';
  let lastCat='';
  RECS.forEach(r=>{
    if(r.category!==lastCat){
      const h=document.createElement('div');
      h.className='rec-cat-header'; h.textContent=r.category;
      list.appendChild(h); lastCat=r.category;
    }
    const el=document.createElement('div');
    el.className='rec-item a';
    el.onclick=()=>openEditRec(r.id);
    el.innerHTML=`<div class="rec-av">${(r.company||'?')[0]}</div>
      <div style="flex:1;min-width:0">
        <div class="rec-co">${r.company}</div>
        ${r.contact||r.position?`<div class="rec-ct">${[r.contact,r.position].filter(Boolean).join(' · ')}</div>`:''}
        ${r.notes?`<div class="rec-notes">${r.notes}</div>`:''}
      </div>
      ${r.country?`<div class="rec-ctry">${r.country}</div>`:''}`;
    list.appendChild(el);
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
  if(tab==='home'){ homeDealTasks=null; doneDealTasksToday=0; rHome(); }
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
function openModal(id){ document.getElementById(id).classList.add('open'); }
function closeModal(id){ document.getElementById(id).classList.remove('open'); }
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
    tier:document.getElementById('nc-tier').value,
    net_worth:document.getElementById('nc-nw').value,
    nationality:document.getElementById('nc-nat').value.trim(),
    religion:document.getElementById('nc-rel').value,
    relationship:document.getElementById('nc-rel2').value,
    proxy_contact: document.getElementById('nc-proxy').value.trim()||null,
    interests:ints,
    notes:document.getElementById('nc-notes').value.trim(),
    sort_order: CLIENTS.length
  };
  const {data,error}=await SB.from('clients').insert(row).select().single();
  if(error){ alert('Error saving: '+error.message); return; }
  CLIENTS.push(normaliseClient(data));
  closeModal('modal-client');
  ['nc-name','nc-role','nc-city','nc-nat','nc-notes'].forEach(id=>document.getElementById(id).value='');
  document.querySelectorAll('#nc-int-chips .int-chip, #nc-tag-chips .int-chip').forEach(el=>el.classList.remove('on'));
  rClients(); updateHomeStats(); showToast('Client added ✓');
}

function openEditClient(id){
  const c=CLIENTS.find(x=>x.id===id); if(!c) return;
  editClientId=id;
  document.getElementById('ec-name').value=c.name;
  document.getElementById('ec-role').value=c.role||'';
  document.getElementById('ec-city').value=c.city||'';
  document.getElementById('ec-tier').value=c.tier;
  document.getElementById('ec-nw').value=c.nw;
  document.getElementById('ec-nat').value=c.nat||'';
  document.getElementById('ec-rel').value=c.rel||'Unknown';
  document.getElementById('ec-rel2').value=c.relationship||'General';
  const clientInts=(c.int||[]).map(i=>i.toLowerCase());
  document.querySelectorAll('#ec-int-chips .int-chip, #ec-tag-chips .int-chip').forEach(el=>el.classList.toggle('on',clientInts.includes(el.textContent.toLowerCase())));
  document.getElementById('ec-notes').value=c.notes||'';
  document.getElementById('ec-proxy').value=c.proxyContact||'';
  document.getElementById('ec-proxy-row').style.display=c.relationship==='Proxy'?'':'none';
  openModal('modal-edit-client');
}

async function saveEditClient(){
  const c=CLIENTS.find(x=>x.id===editClientId); if(!c) return;
  const ints=[...document.querySelectorAll('#ec-int-chips .int-chip.on, #ec-tag-chips .int-chip.on')].map(el=>el.textContent);
  const updates={
    name:document.getElementById('ec-name').value.trim()||c.name,
    position:document.getElementById('ec-role').value.trim(),
    city:document.getElementById('ec-city').value.trim(),
    tier:document.getElementById('ec-tier').value,
    net_worth:document.getElementById('ec-nw').value,
    nationality:document.getElementById('ec-nat').value.trim(),
    religion:document.getElementById('ec-rel').value,
    relationship:document.getElementById('ec-rel2').value,
    proxy_contact: document.getElementById('ec-proxy').value.trim()||null,
    interests:ints,
    notes:document.getElementById('ec-notes').value.trim(),
  };
  const {error}=await SB.from('clients').update(updates).eq('id',editClientId);
  if(error){ alert('Error: '+error.message); return; }
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

// ── DEAL MODAL ────────────────────────────────────────────────────
let dealTasks=[];

function openDealModal(presetClientId, editDealId){
  editingDealId=editDealId||null;
  const cs=document.getElementById('nd-client');
  cs.innerHTML=CLIENTS.map(c=>`<option value="${c.id}">${c.name}</option>`).join('');
  if(presetClientId) cs.value=presetClientId;
  const ps=document.getElementById('nd-partner');
  ps.innerHTML=PARTNERS.map(p=>`<option value="${p.name}">${p.name}</option>`).join('');

  const tasksSection=document.getElementById('nd-tasks-section');
  const taskForm=document.getElementById('nd-task-form');

  if(editDealId){
    const d=DEALS.find(x=>x.id===editDealId);
    if(d){
      cs.value=d.clientId;
      ps.value=d.pt;
      document.getElementById('nd-cat').value=d.cat;
      document.getElementById('nd-status').value=d.s;
      document.getElementById('nd-value').value=d.v;
      document.getElementById('nd-pct').value=d.pct;
      document.getElementById('nd-notes').value=d.n;
      document.getElementById('deal-modal-title').textContent='Edit Deal';
      document.getElementById('deal-submit-btn').textContent='Save Changes';
    }
    tasksSection.style.display='block';
    taskForm.style.display='none';
    loadDealTasks(editDealId);
  } else {
    document.getElementById('deal-modal-title').textContent='New Deal';
    document.getElementById('deal-submit-btn').textContent='Add Deal';
    ['nd-value','nd-pct','nd-notes'].forEach(id=>document.getElementById(id).value='');
    tasksSection.style.display='none';
    taskForm.style.display='none';
    dealTasks=[];
  }
  openModal('modal-deal');
}

// ── DEAL TASKS ────────────────────────────────────────────────────
async function loadDealTasks(dealId){
  dealTasks=[];
  renderDealTasks();
  const {data}=await SB.from('deal_tasks').select('*').eq('deal_id',dealId).order('due_date',{ascending:true});
  dealTasks=data||[];
  renderDealTasks();
}

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
    info.innerHTML=`<div class="deal-task-title-txt">${t.title}</div>${t.due_date?`<div class="deal-task-due">${t.due_date}</div>`:''}`;

    item.appendChild(chk);
    item.appendChild(info);
    list.appendChild(item);
  });
}



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
  const pct=parseFloat(document.getElementById('nd-pct').value);
  if(!v||isNaN(v)){ alert('Please enter a deal value.'); return; }
  const clientId=document.getElementById('nd-client').value;
  const row={
    client_id:clientId,
    partner:document.getElementById('nd-partner').value,
    category:document.getElementById('nd-cat').value,
    status:document.getElementById('nd-status').value,
    spend:v, commission_rate:isNaN(pct)?0.6:pct,
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
  const tc=DEALS.reduce((s,d)=>s+(d.v*(d.pct/100)),0);
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
