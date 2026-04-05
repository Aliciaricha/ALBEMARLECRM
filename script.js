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
const CC = {Seasonal:'p-amb', Mandate:'p-gold', Event:'p-blu', Ongoing:'p-grn', Triggered:'p-gh'};

// ── STATE ─────────────────────────────────────────────────────────
let CLIENTS=[], PARTNERS=[], DEALS=[], CAMPAIGNS=[], RECS=[];
let doneTasks = new Set(); // task_key set from DB
let tF='All', cF='All', curTab='home';
let selSegVal='All', editSegVal='All';
let editClientId=null, editPartnerId=null, editCampaignId=null;
let editingDealId=null;
let homeTab='deals', homeDealTasks=null;

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
  };
}

// ── SEGMENT & TASK LOGIC ──────────────────────────────────────────
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

function getCampaignClients(cam){
  let filtered = CLIENTS;
  if(cam.occ && cam.occ!==''){
    const occs = cam.occ.split('/').map(o=>o.trim().toLowerCase());
    filtered = filtered.filter(c => {
      const relL = (c.rel||'').toLowerCase();
      return occs.some(o=>relL.includes(o)||o.includes(relL));
    });
  }
  if(cam.seg && cam.seg!=='All') filtered = filtered.filter(c=>clientMatchesSeg(c,cam.seg));
  return filtered;
}

function mkTasks(){
  const t=[];
  const activeCams = CAMPAIGNS.filter(c=>{
    if(c.date==='Ongoing') return true;
    if(c.date==='TBC') return false;
    try{ const d=new Date(c.date); const diff=Math.floor((d-TODAY)/86400000); if(c.type==='Triggered') return diff>=0&&diff<=3; return diff>=-3&&diff<=30; }catch(e){ return false; }
  });

  const camCovered = new Map();
  activeCams.forEach(cam=>{ getCampaignClients(cam).forEach(c=>{ if(!camCovered.has(c.id)) camCovered.set(c.id,cam); }); });

  CLIENTS.forEach(c=>{
    const tr=TIERS[c.tier]; if(!tr||c.tier==='Archive') return;
    const wa=daysSince(c.wa), cl=daysSince(c.call);
    const waDue=tr.waD&&wa>=tr.waD, clDue=tr.cD&&cl>=tr.cD;
    if(!waDue&&!clDue) return;

    if(camCovered.has(c.id)){
      const cam=camCovered.get(c.id);
      let camWhy='Campaign · '+cam.type+(cam.date!=='Ongoing'?' · '+cam.date:'');
      if(cam.type==='Triggered'&&cam.date){
        const du=Math.floor((new Date(cam.date)-TODAY)/86400000);
        camWhy=du===0?'Today!':du===1?'Tomorrow':`In ${du} days`;
      }
      t.push({id:'cam-'+cam.id+'-'+c.id, nm:c.name, act:cam.name+' — '+c.name,
        why:camWhy,
        urg:'soon', pri:(tr.p*10)+2, isCam:true, camId:cam.id, clientObj:c});
      return;
    }
    if(clDue){
      const ov=cl-tr.cD;
      t.push({id:'cl-'+c.id, nm:c.name, act:'Call '+c.name,
        why:cl===9999?'Never called · '+c.tier+' client':`${cl}d since last call · due every ${tr.cD}d`,
        urg:ov>14?'urgent':ov>=0?'soon':'normal', pri:tr.p*10+1+(c.deal?0:5)});
      return;
    }
    if(waDue){
      const ov=wa-tr.waD;
      t.push({id:'wa-'+c.id, nm:c.name, act:'WhatsApp '+c.name,
        why:wa===9999?'Never contacted · '+c.tier+' client':`${wa}d since last message · due every ${tr.waD}d`,
        urg:ov>7?'urgent':ov>=0?'soon':'normal', pri:tr.p*10+(c.deal?0:5)});
    }
  });

  activeCams.forEach(cam=>{
    const alreadyIn=t.some(x=>x.camId===cam.id);
    if(!alreadyIn){
      const cnt=getCampaignClients(cam).length;
      let standaloneWhy=cnt+' clients · '+cam.type+(cam.date!=='Ongoing'?' · '+cam.date:'');
      if(cam.type==='Triggered'&&cam.date){
        const du=Math.floor((new Date(cam.date)-TODAY)/86400000);
        standaloneWhy=cnt+' clients · '+(du===0?'Today!':du===1?'Tomorrow':`In ${du} days`);
      }
      t.push({id:'cam-'+cam.id, nm:'Campaign', act:cam.name,
        why:standaloneWhy,
        urg:'soon', pri:25, isCam:true, camId:cam.id, clientObj:null});
    }
  });

  return t.sort((a,b)=>({urgent:0,soon:1,normal:2}[a.urg]||2)-({urgent:0,soon:1,normal:2}[b.urg]||2)||a.pri-b.pri);
}

// ── HOME ──────────────────────────────────────────────────────────
function rHome(){
  const tasks=mkTasks(), tot=tasks.length, nd=doneTasks.size;
  const pct=tot?Math.round(nd/tot*100):0;
  const urg=tasks.filter(t=>t.urg==='urgent'&&!doneTasks.has(t.id)).length;
  setTimeout(()=>{
    const el=document.getElementById('ring-el');
    if(el) el.style.strokeDashoffset=226.2-(pct/100)*226.2;
    document.getElementById('ring-pct').textContent=pct+'%';
  },80);
  document.getElementById('ps-done').textContent=nd;
  document.getElementById('ps-tot').textContent=tot;
  document.getElementById('ps-urg').textContent=urg;
  document.getElementById('prog-desc').textContent=
    nd===tot&&tot>0?'All done — exceptional work.':`${tot-nd} task${tot-nd===1?'':'s'} remaining today`;

  const tc=DEALS.reduce((s,d)=>s+(d.v*(d.pct/100)),0);
  document.getElementById('qs-pipe').textContent=fm(tc);
  document.getElementById('qs-cli').textContent=CLIENTS.length;
  document.getElementById('qs-cam').textContent=CAMPAIGNS.length;
  document.getElementById('qs-par').textContent=PARTNERS.length;

  const list=document.getElementById('task-list'); list.innerHTML='';
  if(homeTab==='deals'){ renderHomeDealTasks(); return; }

  // ── Bucket tasks into display groups ────────────────────────────
  const holidayRx=/easter|birthday|christmas|eid|diwali|wish|ramadan|hanukkah|new year/i;
  const mandateRx=/mandate|real estate|property|offerin/i;
  const luxuryRx =/dior|luxury|tea|event|private|dinner|gala|experience|jewel|art|auction|aviation/i;
  const BUCKETS=[
    {key:'holiday',  label:'Holiday & Wishes', tasks:[]},
    {key:'mandates', label:'Mandates',          tasks:[]},
    {key:'luxury',   label:'Luxury',            tasks:[]},
    {key:'followups',label:'Follow-Ups',        tasks:[]},
  ];
  tasks.forEach(t=>{
    const cam=t.camId?CAMPAIGNS.find(c=>c.id===t.camId):null;
    let b;
    if(cam){
      if(cam.type==='Seasonal'||holidayRx.test(cam.name))      b=BUCKETS[0];
      else if(cam.type==='Mandate'||mandateRx.test(cam.name))  b=BUCKETS[1];
      else if(cam.type==='Event'  ||luxuryRx.test(cam.name))   b=BUCKETS[2];
      else                                                       b=BUCKETS[3];
    } else { b=BUCKETS[3]; }
    b.tasks.push(t);
  });

  // ── Render each bucket with a subheading ────────────────────────
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
    const {data}=await SB.from('deal_tasks').select('*').eq('done',false).order('due_date',{ascending:true,nullsFirst:false});
    homeDealTasks=data||[];
  }
  list.innerHTML='';
  if(!homeDealTasks.length){
    list.innerHTML='<div style="padding:24px 0;text-align:center;font-size:13px;color:var(--t3);font-style:italic">No outstanding deal tasks.</div>';
    return;
  }

  // ── Group by deal category ──────────────────────────────────────
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
        <div class="tc-body"><div class="tc-act">${act}</div><div class="tc-why">${dealTaskTimer(t.due_date)}</div></div>
        <button class="dt-edit-btn" onclick="editDealTask('${t.id}',event)">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <div class="chk" onclick="tickDealTask('${t.id}',this,event)">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke-width="3.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
        </div>`;
      if(deal) el.onclick=(e)=>{if(e.target.closest('.chk')||e.target.closest('.dt-edit-btn')) return; openDealModal(deal.clientId,deal.id);};
      list.appendChild(el);
    });
  });
}

function editDealTask(id,e){
  e.stopPropagation();
  const t=homeDealTasks.find(x=>x.id===id); if(!t) return;
  const card=e.target.closest('.tc');
  card.innerHTML=`<div class="dt-edit-form">
    <input class="dt-edit-input" id="dte-title-${id}" value="${t.title.replace(/"/g,'&quot;')}" placeholder="Task title…">
    <input type="date" class="dt-edit-date" id="dte-date-${id}" value="${t.due_date||''}">
    <div class="dt-edit-actions">
      <button class="dt-save-btn" onclick="saveDealTaskEdit('${id}')">Save</button>
      <span class="dt-cancel-btn" onclick="renderHomeDealTasks()">Cancel</span>
    </div>
  </div>`;
  document.getElementById('dte-title-'+id).focus();
}

async function saveDealTaskEdit(id){
  const titleEl=document.getElementById('dte-title-'+id);
  const dateEl=document.getElementById('dte-date-'+id);
  const title=titleEl?.value.trim(); if(!title) return;
  const due=dateEl?.value||null;
  const btn=document.querySelector('.dt-save-btn'); if(btn){btn.textContent='…';btn.disabled=true;}
  const {error}=await SB.from('deal_tasks').update({title,due_date:due}).eq('id',id);
  if(error){ showToast('Could not update task'); renderHomeDealTasks(); return; }
  const t=homeDealTasks.find(x=>x.id===id);
  if(t){ t.title=title; t.due_date=due; }
  renderHomeDealTasks(); showToast('Task updated ✓');
}

async function tickDealTask(id,el,e){
  e.stopPropagation();
  el.classList.add('on'); el.parentElement.classList.add('done');
  await SB.from('deal_tasks').update({done:true}).eq('id',id);
  homeDealTasks=(homeDealTasks||[]).filter(t=>t.id!==id);
  setTimeout(()=>renderHomeDealTasks(),500);
}

async function tick(id, el, e){
  e.stopPropagation();
  const today=new Date().toISOString().split('T')[0];
  if(doneTasks.has(id)){
    doneTasks.delete(id);
    el.classList.remove('on');
    el.parentElement.className=el.parentElement.className.replace('done','').trim();
    await SB.from('task_completions').delete().eq('task_key',id);
  } else {
    doneTasks.add(id);
    el.classList.add('on');
    el.parentElement.classList.add('done');
    await SB.from('task_completions').upsert({task_key:id, reset_date:today},{onConflict:'task_key'});
  }
  rHome();
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
  CAMPAIGNS.forEach((cam,i)=>{
    const cnt=getCampaignClients(cam).length;
    const el=document.createElement('div');
    el.className='camc gc a'; el.style.animationDelay=(i*0.05)+'s';
    el.onclick=()=>openCampaign(cam);
    el.innerHTML=`<div class="camc-top">
      <div class="camc-name">${cam.name}</div>
      <span class="pill ${CC[cam.type]||'p-gh'}">${cam.type}</span>
    </div>
    <div class="camc-body">${cam.notes||''}</div>
    <div class="camc-foot">
      ${cam.date?`<span class="pill p-gh">${cam.date}</span>`:''}
      ${cam.seg?`<span class="pill p-gold">Seg: ${cam.seg}</span>`:''}
      <span class="pill p-grn">${cnt} clients</span>
    </div>`;
    list.appendChild(el);
  });
}

function openCampaign(cam){
  const clients=getCampaignClients(cam);
  const rosterHtml=clients.length
    ? clients.map(c=>`<div class="cam-roster-item a">
        <div class="cri-av">${ini(c.name)}</div>
        <div><div class="cri-name">${c.name}</div><div class="cri-sub">${c.role||c.city||''} · ${c.tier}</div></div>
        <div style="margin-left:auto"><span class="pill" style="background:${TC[c.tier]||'#888'}18;color:${TC[c.tier]||'#888'};border-color:${TC[c.tier]||'#888'}40;font-size:9px">${c.tier}</span></div>
      </div>`).join('')
    : '<div style="padding:16px;font-size:13px;color:var(--t3);font-style:italic">No clients match this segment.</div>';

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
        <span class="pill p-grn">${clients.length} enrolled</span>
      </div>
    </div>
    ${cam.notes?`<div class="prof-sec"><div class="sec-lbl">Campaign Brief</div><div class="sec-notes">${cam.notes}</div></div>`:''}
    <div class="prof-sec"><div class="sec-lbl">Enrolled Clients · ${clients.length}</div>${rosterHtml}</div>
    <div style="height:36px"></div>`;
  pushProf('ps-campaign');
}

// ── CLIENTS ───────────────────────────────────────────────────────
function rClients(){
  const q=(document.getElementById('cli-q')||{}).value||'';
  let list=CLIENTS;
  if(tF!=='All') list=list.filter(c=>c.tier===tF);
  if(q) list=list.filter(c=>c.name.toLowerCase().includes(q.toLowerCase())||(c.role||'').toLowerCase().includes(q.toLowerCase()));
  const el=document.getElementById('cli-list'); el.innerHTML='';
  list.forEach((c,i)=>{
    const tr=TIERS[c.tier], wa=daysSince(c.wa), cl=daysSince(c.call);
    const clOv=tr?.cD&&cl>=tr.cD, waOv=tr?.waD&&wa>=tr.waD;
    const div=document.createElement('div');
    div.className='pc gc a'; div.style.animationDelay=(i*0.04)+'s';
    div.onclick=()=>openC(c);
    div.innerHTML=`<div class="pc-av">${ini(c.name)}${c.deal?'<div class="dot"></div>':''}</div>
      <div class="pc-info"><div class="pc-name">${c.name}</div><div class="pc-sub">${c.role||c.city}</div></div>
      <div class="pc-r">
        <span class="pill" style="background:${TC[c.tier]||'#888'}18;color:${TC[c.tier]||'#888'};border-color:${TC[c.tier]||'#888'}40">${c.tier}</span>
        ${clOv?'<span class="pill p-red" style="font-size:9px">Call due</span>':waOv?'<span class="pill p-amb" style="font-size:9px">Follow up</span>':''}
      </div>`;
    el.appendChild(div);
  });
}

function openC(c){
  const tr=TIERS[c.tier], wa=daysSince(c.wa), cl=daysSince(c.call);
  const waOv=tr?.waD&&wa>=tr.waD, clOv=tr?.cD&&cl>=tr.cD;
  const waStr=wa===9999?'Never contacted':`${wa} days ago`;
  const clStr=cl===9999?'Never called':`${cl} days ago`;
  const cDeals=DEALS.filter(d=>d.clientId===c.id);
  const dHtml=cDeals.length?cDeals.map(d=>`<div class="deal-row">
    <div><div class="dr-l">${d.pt}</div><div class="dr-s">${d.cat} · ${d.s}</div></div>
    <div style="text-align:right"><div class="dr-v">${fm(d.v)}</div><div class="dr-c">~${fm(d.v*(d.pct/100))}</div></div>
  </div>`).join(''):'<div style="padding:13px 16px;font-size:12px;color:var(--t3);font-style:italic">No active deals</div>';

  const cCams=CAMPAIGNS.filter(cam=>getCampaignClients(cam).some(cl2=>cl2.id===c.id));
  const camHtml=cCams.length?cCams.map(cam=>`<span class="pill p-cam" onclick="openCampaign(CAMPAIGNS.find(x=>x.id==='${cam.id}'))">${cam.name}</span>`).join(''):'';

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
        <div><div class="prof-name">${c.name}</div><div class="prof-role-l">${c.role||''}${c.role&&c.city?' · ':''}${c.city}</div></div>
      </div>
      <div class="prof-pills">
        <span class="pill" style="background:${TC[c.tier]||'#888'}15;color:${TC[c.tier]||'#888'};border-color:${TC[c.tier]||'#888'}40">${c.tier}</span>
        <span class="pill p-gh">${c.nw}</span>
        ${c.nat?`<span class="pill p-gh">${c.nat}</span>`:''}
        ${c.deal?'<span class="pill p-gold">Active Deal</span>':''}
        <span class="pill p-gh">${c.rel}</span>
        ${c.relationship?`<span class="pill p-gh">${c.relationship}</span>`:''}
      </div>
    </div>
    <div class="prof-sec">
      <div class="sec-lbl">Contact Status</div>
      <div class="sec-row"><div class="sec-k">Last WhatsApp</div><div class="sec-v ${waOv?'ov':wa!==9999?'ok':''}">${waStr}${waOv?' — Overdue':''}</div></div>
      <div class="sec-row"><div class="sec-k">Last Phone Call</div><div class="sec-v ${clOv?'ov':cl!==9999?'ok':''}">${clStr}${clOv?' — Overdue':''}</div></div>
      <div class="sec-row"><div class="sec-k">WA cadence</div><div class="sec-v">${tr?.waD?`Every ${tr.waD} days`:'N/A'}</div></div>
      <div class="sec-row"><div class="sec-k">Call cadence</div><div class="sec-v">${tr?.cD?`Every ${tr.cD} days`:'N/A'}</div></div>
      ${c.followUp?`<div class="sec-row"><div class="sec-k">Follow-up date</div><div class="sec-v">${c.followUp}</div></div>`:''}
    </div>
    ${c.int.length?`<div class="prof-sec"><div class="sec-lbl">Interests & Segments</div><div class="itags">${c.int.map(x=>`<span class="pill p-gh">${x}</span>`).join('')}</div></div>`:''}
    ${camHtml?`<div class="prof-sec"><div class="sec-lbl">Active Campaigns</div><div class="itags" style="margin-top:4px">${camHtml}</div></div>`:''}
    <div class="prof-sec"><div class="sec-lbl">Deals & Commission</div>${dHtml}</div>
    ${c.notes?`<div class="prof-sec"><div class="sec-lbl">Notes</div><div class="sec-notes">${c.notes}</div></div>`:''}
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
      <div class="act" onclick="openDealModal('${c.id}',null)">
        <div class="act-ic"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></div>
        <div><div class="act-t">Add Deal</div><div class="act-s">Log a new deal for this client</div></div>
      </div>
    </div>
    <div style="height:36px"></div>`;
  pushProf('ps-client');
}

// ── LOG CALL / WA ─────────────────────────────────────────────────
async function logCall(c){
  if(!c) return;
  const today=new Date().toISOString().split('T')[0];
  const {error}=await SB.from('clients').update({last_call:today}).eq('id',c.id);
  if(!error){ c.call=today; rHome(); if(curTab==='clients') rClients(); showToast('Call logged ✓'); }
}
async function logWa(c){
  if(!c) return;
  const today=new Date().toISOString().split('T')[0];
  const {error}=await SB.from('clients').update({last_wa:today}).eq('id',c.id);
  if(!error){ c.wa=today; rHome(); if(curTab==='clients') rClients(); showToast('WhatsApp logged ✓'); }
}

// ── PARTNERS ──────────────────────────────────────────────────────
function rPartners(){
  let list=cF==='All'?PARTNERS:PARTNERS.filter(p=>p.cat===cF);
  const el=document.getElementById('par-list'); el.innerHTML='';
  list.forEach((p,i)=>{
    const div=document.createElement('div');
    div.className='pc gc a'; div.style.animationDelay=(i*0.04)+'s';
    div.onclick=()=>openP(p);
    div.innerHTML=`<div class="pc-av" style="border-radius:14px;font-size:13px">${abbr(p.name)}</div>
      <div class="pc-info"><div class="pc-name">${p.name}</div><div class="pc-sub">${p.contact}${p.role?' · '+p.role:''}</div></div>
      <div class="pc-r">
        ${p.fee?`<span style="font-family:'Cormorant Garamond',serif;font-size:18px;color:var(--gold);font-weight:300">${p.fee}</span>`:''}
        <span class="pill p-gh" style="font-size:9px">${p.cat}</span>
        ${p.isC?'<span class="pill p-blu" style="font-size:9px">Client</span>':''}
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
        ${p.fee?`<span class="pill p-gold">${p.fee} intro fee</span>`:''}
        ${p.bizFee?`<span class="pill p-gh">${p.bizFee} biz fee</span>`:''}
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
      ${p.fee?`<div class="sec-row"><div class="sec-k">Intro Fee</div><div class="sec-v">${p.fee}</div></div>`:''}
      ${p.bizFee?`<div class="sec-row"><div class="sec-k">Business Fee</div><div class="sec-v">${p.bizFee}</div></div>`:''}
      ${p.spend?`<div class="sec-row"><div class="sec-k">Client Spend Threshold</div><div class="sec-v">${fm(p.spend)}</div></div>`:''}
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
    el.innerHTML=`<div class="rec-av">${(r.company||'?')[0]}</div>
      <div style="flex:1;min-width:0">
        <div class="rec-co">${r.company}</div>
        ${r.contact||r.position?`<div class="rec-ct">${[r.contact,r.position].filter(Boolean).join(' · ')}</div>`:''}
      </div>
      ${r.country?`<div class="rec-ctry">${r.country}</div>`:''}`;
    list.appendChild(el);
  });
}

// ── FILTER & NAV ─────────────────────────────────────────────────
function setF(el,type,val){
  if(type==='t'){tF=val;document.querySelectorAll('#t-chips .chip').forEach(c=>c.classList.toggle('on',c===el));rClients();}
  else{cF=val;document.querySelectorAll('#c-chips .chip').forEach(c=>c.classList.toggle('on',c===el));rPartners();}
}

const TABS=['home','deals','campaigns','clients','partners','recs'];
function go(tab){
  if(tab===curTab) return;
  curTab=tab;
  TABS.forEach(t=>{
    document.getElementById('s-'+t).classList.toggle('hidden',t!==tab);
    const btn=document.getElementById('tab-'+t);
    if(btn) btn.classList.toggle('active',t===tab);
  });
  if(tab==='home') rHome();
  else if(tab==='deals') rDeals();
  else if(tab==='campaigns') rCampaigns();
  else if(tab==='clients') rClients();
  else if(tab==='partners') rPartners();
  else if(tab==='recs') rRecs();
  document.getElementById('s-'+tab).scrollTop=0;
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
  const ints=document.getElementById('nc-int').value.split(',').map(s=>s.trim()).filter(Boolean);
  const row={
    name, position:document.getElementById('nc-role').value.trim(),
    city:document.getElementById('nc-city').value.trim(),
    tier:document.getElementById('nc-tier').value,
    net_worth:document.getElementById('nc-nw').value,
    nationality:document.getElementById('nc-nat').value.trim(),
    religion:document.getElementById('nc-rel').value,
    relationship:document.getElementById('nc-rel2').value,
    interests:ints.length?ints:['Real Estate'],
    notes:document.getElementById('nc-notes').value.trim(),
    sort_order: CLIENTS.length
  };
  const {data,error}=await SB.from('clients').insert(row).select().single();
  if(error){ alert('Error saving: '+error.message); return; }
  CLIENTS.push(normaliseClient(data));
  closeModal('modal-client');
  ['nc-name','nc-role','nc-city','nc-nat','nc-int','nc-notes'].forEach(id=>document.getElementById(id).value='');
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
  document.getElementById('ec-rel2').value=c.relationship||'Meeting';
  document.getElementById('ec-int').value=(c.int||[]).join(', ');
  document.getElementById('ec-notes').value=c.notes||'';
  openModal('modal-edit-client');
}

async function saveEditClient(){
  const c=CLIENTS.find(x=>x.id===editClientId); if(!c) return;
  const ints=document.getElementById('ec-int').value.split(',').map(s=>s.trim()).filter(Boolean);
  const updates={
    name:document.getElementById('ec-name').value.trim()||c.name,
    position:document.getElementById('ec-role').value.trim(),
    city:document.getElementById('ec-city').value.trim(),
    tier:document.getElementById('ec-tier').value,
    net_worth:document.getElementById('ec-nw').value,
    nationality:document.getElementById('ec-nat').value.trim(),
    religion:document.getElementById('ec-rel').value,
    relationship:document.getElementById('ec-rel2').value,
    interests:ints,
    notes:document.getElementById('ec-notes').value.trim(),
  };
  const {error}=await SB.from('clients').update(updates).eq('id',editClientId);
  if(error){ alert('Error: '+error.message); return; }
  Object.assign(c, normaliseClient({...updates, id:editClientId, last_wa:c.wa, last_call:c.call, follow_up_date:c.followUp, has_deal:c.deal}));
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
    notes:document.getElementById('np-notes').value.trim(),
    sort_order:PARTNERS.length
  };
  const {data,error}=await SB.from('partners').insert(row).select().single();
  if(error){ alert('Error: '+error.message); return; }
  PARTNERS.push(normalisePartner(data));
  closeModal('modal-partner');
  ['np-name','np-contact','np-role','np-fee','np-country','np-notes'].forEach(id=>document.getElementById(id).value='');
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
    notes:document.getElementById('ep-notes').value.trim(),
  };
  const {error}=await SB.from('partners').update(updates).eq('id',editPartnerId);
  if(error){ alert('Error: '+error.message); return; }
  Object.assign(p, normalisePartner({...updates, id:editPartnerId, last_wa:p.wa, last_call:p.call, business_fees:p.bizFee, client_spend:p.spend, is_client:p.isC}));
  closeModal('modal-edit-partner');
  openP(p); if(curTab==='partners') rPartners();
  showToast('Partner updated ✓');
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
    sort_order:CAMPAIGNS.length
  };
  const {data,error}=await SB.from('campaigns').insert(row).select().single();
  if(error){ alert('Error: '+error.message); return; }
  CAMPAIGNS.push(normaliseCampaign(data));
  closeModal('modal-campaign');
  ['ncam-name','ncam-occ','ncam-date','ncam-notes','ncam-template'].forEach(id=>document.getElementById(id).value='');
  rCampaigns(); updateHomeStats(); showToast('Campaign added ✓');
}

function openEditCampaign(id){
  const cam=CAMPAIGNS.find(x=>x.id===id); if(!cam) return;
  editCampaignId=id; editSegVal=cam.seg||'All';
  document.getElementById('ecam-name').value=cam.name;
  document.getElementById('ecam-type').value=cam.type;
  document.getElementById('ecam-date').value=cam.date;
  document.getElementById('ecam-occ').value=cam.occ||'';
  document.getElementById('ecam-notes').value=cam.notes||'';
  document.getElementById('ecam-template').value=cam.template||'';
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
  const {error}=await SB.from('campaigns').update(updates).eq('id',editCampaignId);
  if(error){ alert('Error: '+error.message); return; }
  Object.assign(cam, normaliseCampaign({...updates, id:editCampaignId}));
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
  if(!dealTasks.length){
    list.innerHTML='<div class="deal-task-empty">No tasks yet.</div>'; return;
  }
  list.innerHTML=dealTasks.map(t=>`<div class="deal-task-item${t.done?' done':''}">
    <div class="deal-task-chk${t.done?' on':''}" onclick="toggleDealTask('${t.id}',${!t.done})">
      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke-width="3.5" stroke-linecap="round" stroke="white"><polyline points="20 6 9 17 4 12"/></svg>
    </div>
    <div class="deal-task-info">
      <div class="deal-task-title-txt">${t.title}</div>
      ${t.due_date?`<div class="deal-task-due">${t.due_date}</div>`:''}
    </div>
  </div>`).join('');
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
  if(!campaign||!campaign.attachment){ section.innerHTML=''; return; }
  const name=campaign.attachment.name||'';
  const isImg=/\.(png|jpg|jpeg|gif|webp)$/i.test(name);
  if(!isImg){ section.innerHTML=''; return; }
  section.innerHTML=`<div class="wa-attached-file">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
    <div class="wa-attached-name">${name}</div>
    <span class="wa-attached-copy" onclick="copyAttachment()">Copy Image</span>
  </div>`;
}

function copyAttachment(){
  const btn=document.querySelector('.wa-attached-copy');
  const dataUrl=waCurrentCampaign?.attachment?.dataUrl;
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

function logCall(c){
  if(!c) return;
  const today=new Date().toISOString().split('T')[0];
  SB.from('clients').update({last_call:today}).eq('id',c.id).then(({error})=>{
    if(!error){ c.call=today; rHome(); if(curTab==='clients') rClients(); showToast('Call logged ✓'); }
  });
}

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
  // Set date
  const days=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
  const now=new Date();
  document.getElementById('home-date').textContent=`${days[now.getDay()]} · ${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`;

  await loadAll();

  document.getElementById('loading-overlay').classList.add('hidden');
  rHome();
})();
