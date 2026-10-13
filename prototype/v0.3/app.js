(() => {
  'use strict';
  window.__demoErrors = [];
  window.addEventListener('error', e => window.__demoErrors.push({ message:e.message, line:e.lineno }));

  const calls = [
    {id:22,at:'2026-10-07T00:43:31+08:00',seconds:8249,type:'video',status:'connected',direction:'outgoing',result:'正常结束'},
    {id:21,at:'2026-10-06T23:14:20+08:00',seconds:4800,type:'video',status:'connected',direction:'incoming',result:'通话中断'},
    {id:20,at:'2026-10-06T20:08:42+08:00',seconds:3985,type:'voice',status:'connected',direction:'outgoing',result:'正常结束'},
    {id:19,at:'2026-10-06T18:25:08+08:00',seconds:0,type:'video',status:'missed',direction:'incoming',result:'对方已取消'},
    {id:18,at:'2026-10-05T22:40:10+08:00',seconds:881,type:'video',status:'connected',direction:'outgoing',result:'正常结束'},
    {id:17,at:'2026-10-05T19:13:02+08:00',seconds:0,type:'voice',status:'missed',direction:'outgoing',result:'已取消'},
    {id:16,at:'2026-09-29T23:08:12+08:00',seconds:3500,type:'video',status:'connected',direction:'incoming',result:'正常结束'},
    {id:15,at:'2026-09-29T21:25:34+08:00',seconds:2228,type:'voice',status:'connected',direction:'outgoing',result:'通话中断'},
    {id:14,at:'2026-09-29T18:03:44+08:00',seconds:0,type:'video',status:'missed',direction:'incoming',result:'未接听'},
    {id:13,at:'2026-09-24T22:31:06+08:00',seconds:2800,type:'video',status:'connected',direction:'outgoing',result:'正常结束'},
    {id:12,at:'2026-09-24T20:20:40+08:00',seconds:1860,type:'video',status:'connected',direction:'incoming',result:'正常结束'},
    {id:11,at:'2026-09-24T18:41:00+08:00',seconds:0,type:'voice',status:'missed',direction:'outgoing',result:'已取消'},
    {id:10,at:'2026-09-23T23:02:11+08:00',seconds:4200,type:'video',status:'connected',direction:'incoming',result:'正常结束'},
    {id:9,at:'2026-09-23T21:10:29+08:00',seconds:2640,type:'video',status:'connected',direction:'outgoing',result:'正常结束'},
    {id:8,at:'2026-09-23T19:05:48+08:00',seconds:32,type:'voice',status:'connected',direction:'incoming',result:'通话中断'},
    {id:7,at:'2026-09-23T16:11:09+08:00',seconds:0,type:'video',status:'missed',direction:'incoming',result:'未接听'},
    {id:6,at:'2026-09-22T23:12:50+08:00',seconds:2600,type:'video',status:'connected',direction:'outgoing',result:'正常结束'},
    {id:5,at:'2026-09-22T21:38:27+08:00',seconds:2200,type:'video',status:'connected',direction:'incoming',result:'正常结束'},
    {id:4,at:'2026-09-22T20:02:03+08:00',seconds:1600,type:'voice',status:'connected',direction:'outgoing',result:'正常结束'},
    {id:3,at:'2026-09-22T19:42:35+08:00',seconds:1400,type:'video',status:'connected',direction:'incoming',result:'通话中断'},
    {id:2,at:'2026-09-22T19:22:09+08:00',seconds:1377,type:'voice',status:'connected',direction:'outgoing',result:'正常结束'},
    {id:1,at:'2026-09-22T19:11:20+08:00',seconds:0,type:'video',status:'missed',direction:'outgoing',result:'已取消'}
  ];

  const state = {
    view:'home', chart:'duration', filter:'all', privacy:false,
    wallMode:'year', wallYear:2026, wallMonth:'2026-10',
    wallStart:'2026-09-22', wallEnd:'2026-10-10'
  };
  const DEMO_TODAY = '2026-10-10';
  const $ = (s,r=document) => r.querySelector(s);
  const queryAll = (s,r=document) => [...r.querySelectorAll(s)];
  const pad = n => String(n).padStart(2,'0');
  const dateKey = s => s.slice(0,10);
  const dateCN = s => `${Number(s.slice(5,7))} 月 ${Number(s.slice(8,10))} 日`;
  const time = s => s.slice(11,16);
  const duration = sec => {
    if(!sec) return '未接通';
    const h=Math.floor(sec/3600),m=Math.floor(sec%3600/60),s=sec%60;
    return h?`${h}小时 ${m}分${s?` ${s}秒`:''}`:`${m}分 ${pad(s)}秒`;
  };

  function dailyData(){
    const map={};
    calls.forEach(c=>{const k=dateKey(c.at);map[k]??={date:k,seconds:0,count:0};map[k].count++;if(c.seconds)map[k].seconds+=c.seconds});
    return Object.values(map).sort((a,b)=>a.date.localeCompare(b.date));
  }

  const actualDayMap = Object.fromEntries(dailyData().map(day=>[day.date,{...day,actual:true}]));
  const iso = date => `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
  const parseDate = value => new Date(`${value}T12:00:00`);
  const addDays = (value, days) => { const date=parseDate(value); date.setDate(date.getDate()+days); return iso(date); };
  const daysBetween = (start,end) => Math.round((parseDate(end)-parseDate(start))/86400000);
  const monthName = month => `${month}月`;

  function demoDay(date){
    if(actualDayMap[date]) return actualDayMap[date];
    if(date>DEMO_TODAY) return {date,seconds:0,count:0,future:true,actual:false};
    let hash=2166136261;
    for(const char of date){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619)}
    hash >>>= 0;
    const active=hash%6===0 || hash%17===0;
    const count=active?1+(hash%3):0;
    const seconds=active?420+((hash>>>3)%6900):0;
    return {date,seconds,count,actual:false,future:false};
  }

  function wallLevel(seconds){
    if(!seconds)return 0;
    if(seconds<900)return 1;
    if(seconds<2400)return 2;
    if(seconds<4800)return 3;
    return 4;
  }

  function wallRange(){
    if(state.wallMode==='year') return {start:`${state.wallYear}-01-01`,end:`${state.wallYear}-12-31`,title:`${state.wallYear} 年`};
    if(state.wallMode==='month'){
      const [year,month]=state.wallMonth.split('-').map(Number);
      const end=iso(new Date(year,month,0));
      return {start:`${state.wallMonth}-01`,end,title:`${year} 年 ${month} 月`};
    }
    return {start:state.wallStart,end:state.wallEnd,title:`${dateCN(state.wallStart)} — ${dateCN(state.wallEnd)}`};
  }

  function navigate(view){
    state.view=view;
    queryAll('.view').forEach(v=>v.classList.toggle('active',v.id===`view-${view}`));
    queryAll('[data-nav]').forEach(b=>b.classList.toggle('active',b.dataset.nav===view));
    scrollTo({top:0,behavior:'smooth'});
    if(view==='calls') renderCalls();
    if(view==='wall') renderWall();
  }

  function renderChart(){
    const root=$('#softChart'), data=dailyData();
    const max=Math.max(...data.map(d=>state.chart==='duration'?d.seconds:d.count));
    root.innerHTML=data.map(d=>{
      const value=state.chart==='duration'?d.seconds:d.count;
      const height=Math.max(7,Math.round(value/max*100));
      return `<button class="soft-column" data-date="${d.date}" data-seconds="${d.seconds}" data-count="${d.count}" aria-label="${dateCN(d.date)}"><span class="bar-wrap"><i class="bar" style="height:${height}%"></i></span><small>${Number(d.date.slice(8))}日</small></button>`;
    }).join('');
    queryAll('.soft-column',root).forEach(col=>col.addEventListener('click',()=>{
      queryAll('.soft-column',root).forEach(x=>x.classList.remove('active'));col.classList.add('active');
      $('#chartPop').innerHTML=`<strong>${dateCN(col.dataset.date)}</strong> · ${col.dataset.count} 次 · ${duration(Number(col.dataset.seconds))}`;
    }));
  }

  function renderCalendar(){
    const active=new Set(calls.map(c=>dateKey(c.at)));
    const dates=[];const start=new Date('2026-09-22T12:00:00+08:00');
    for(let i=0;i<16;i++){const d=new Date(start.getTime()+i*86400000);const k=`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;dates.push(k)}
    $('#tinyCalendar').innerHTML=dates.slice(-9).map(k=>`<div class="tiny-day ${active.has(k)?'active':''}"><span>${Number(k.slice(8))}</span><small>${['日','一','二','三','四','五','六'][new Date(`${k}T12:00:00+08:00`).getDay()]}</small></div>`).join('');
  }

  function renderWall(){
    const range=wallRange();
    const totalDays=daysBetween(range.start,range.end)+1;
    const dates=Array.from({length:totalDays},(_,i)=>addDays(range.start,i));
    const data=dates.map(demoDay);
    const first=parseDate(range.start);
    const lead=(first.getDay()+6)%7;
    const weeks=Math.ceil((lead+dates.length)/7);
    const board=$('.contribution-card');
    board.classList.toggle('mode-month',state.wallMode==='month');
    board.classList.toggle('mode-custom',state.wallMode==='custom');
    board.style.setProperty('--wall-weeks',weeks);

    $('#wallPeriodTitle').textContent=range.title;
    $('#wallPeriodSubtitle').textContent=state.wallMode==='year'?'从一整年里，看见有声音的日子':'颜色越深，这一天聊得越久';

    const active=data.filter(d=>d.count>0);
    const totalSeconds=active.reduce((sum,d)=>sum+d.seconds,0);
    const totalCalls=active.reduce((sum,d)=>sum+d.count,0);
    const best=active.reduce((winner,d)=>!winner||d.seconds>winner.seconds?d:winner,null);
    $('#wallSummary').innerHTML=`
      <article class="wall-stat"><b>☀</b><small>有声音的日子</small><strong>${active.length} 天</strong><span>这段时间内</span></article>
      <article class="wall-stat"><b>◷</b><small>留下的通话</small><strong>${totalCalls} 次</strong><span>包含未接记录</span></article>
      <article class="wall-stat"><b>〰</b><small>通话总时光</small><strong>${compactWallDuration(totalSeconds)}</strong><span>按接通时长累计</span></article>
      <article class="wall-stat"><b>✦</b><small>最亮的一天</small><strong>${best?dateCN(best.date):'还没有'}</strong><span>${best?duration(best.seconds):'暂无通话记录'}</span></article>`;

    const blanks=Array.from({length:lead},()=>'<span class="wall-cell blank"></span>').join('');
    $('#contributionGrid').innerHTML=blanks+data.map(day=>{
      const level=wallLevel(day.seconds);
      const label=`${dateCN(day.date)}，${day.count?`${day.count} 次通话，${duration(day.seconds)}`:'没有通话记录'}`;
      return `<button class="wall-cell${day.actual?' actual':''}${day.future?' future':''}" data-date="${day.date}" data-level="${level}" aria-label="${label}" ${day.future?'disabled':''}></button>`;
    }).join('');

    const monthStarts=[];
    let lastMonth='';
    dates.forEach((date,index)=>{
      const month=date.slice(0,7);
      if(month!==lastMonth){monthStarts.push({month:Number(date.slice(5,7)),column:Math.floor((lead+index)/7)+1});lastMonth=month}
    });
    const months=$('#wallMonths');
    months.style.gridTemplateColumns=`repeat(${weeks}, var(--wall-cell, 14px))`;
    months.innerHTML=monthStarts.map(item=>`<span class="wall-month-label" style="grid-column:${item.column}/span 3">${monthName(item.month)}</span>`).join('');

    queryAll('.wall-cell:not(.blank):not(.future)').forEach(cell=>{
      cell.addEventListener('mouseenter',event=>showWallTooltip(event,cell.dataset.date));
      cell.addEventListener('mousemove',moveWallTooltip);
      cell.addEventListener('mouseleave',hideWallTooltip);
      cell.addEventListener('focus',event=>showWallTooltip(event,cell.dataset.date));
      cell.addEventListener('blur',hideWallTooltip);
      cell.addEventListener('click',()=>openWallDay(cell.dataset.date));
    });
    updateWallArrows();
  }

  function compactWallDuration(seconds){
    const hours=Math.floor(seconds/3600), minutes=Math.floor(seconds%3600/60);
    return hours?`${hours} 小时 ${minutes} 分`:`${minutes} 分钟`;
  }

  function showWallTooltip(event,date){
    const day=demoDay(date),tip=$('#wallTooltip');
    tip.innerHTML=`<strong>${dateCN(date)}</strong><span>${day.count?`${day.count} 次通话 · ${duration(day.seconds)}`:'没有通话记录'}${day.actual?' · 真实示例记录':' · Demo 聚合'}</span>`;
    tip.hidden=false;moveWallTooltip(event);
  }
  function moveWallTooltip(event){
    const tip=$('#wallTooltip');
    if(tip.hidden)return;
    const x=Math.min(innerWidth-tip.offsetWidth-12,(event.clientX||event.target.getBoundingClientRect().left)+14);
    const y=Math.max(10,(event.clientY||event.target.getBoundingClientRect().top)-tip.offsetHeight-10);
    tip.style.left=`${x}px`;tip.style.top=`${y}px`;
  }
  function hideWallTooltip(){ $('#wallTooltip').hidden=true; }

  function openWallDay(date){
    const day=demoDay(date),items=calls.filter(c=>dateKey(c.at)===date);
    $('#sheetContent').innerHTML=`<div class="sheet-hero"><div class="sheet-avatar">${Number(date.slice(8))}</div><h2>${dateCN(date)}</h2><p>${day.count?'这一天留下了声音':'安静的一天'}</p></div><div class="sheet-duration"><small>当天通话时光</small><strong>${day.seconds?duration(day.seconds):'没有记录'}</strong></div>${items.length?`<div class="wall-day-list">${items.map(c=>`<div class="wall-day-call"><span>${c.type==='video'?'▻':'◖'}</span><div><strong>${c.type==='video'?'视频通话':'语音通话'}</strong><small>${time(c.at)} · ${c.result}</small></div><b>${c.seconds?duration(c.seconds):c.result}</b></div>`).join('')}</div>`:`<div class="sheet-note">${day.count?'这一天使用的是 Demo 聚合数据，因此没有逐条通话详情。正式版中可以继续下钻到每次通话。':'浅色格子只表示当天没有发现通话记录，不代表关系状态。'}</div>`}`;
    openSheet('detail');
  }

  function setWallMode(mode){
    state.wallMode=mode;
    queryAll('#wallRangeSwitch button').forEach(btn=>btn.classList.toggle('active',btn.dataset.wallMode===mode));
    queryAll('.wall-control').forEach(control=>control.classList.remove('active'));
    $(`#${mode}Control`).classList.add('active');
    renderWall();
  }

  function changeYear(delta){
    state.wallYear=Math.max(2025,Math.min(2026,state.wallYear+delta));
    $('#wallYear').value=state.wallYear;renderWall();
  }
  function changeMonth(delta){
    const [year,month]=state.wallMonth.split('-').map(Number);
    const changed=new Date(year,month-1+delta,1);
    let value=`${changed.getFullYear()}-${pad(changed.getMonth()+1)}`;
    if(value<'2025-01')value='2025-01';if(value>'2026-10')value='2026-10';
    state.wallMonth=value;$('#wallMonth').value=value;renderWall();
  }
  function updateWallArrows(){
    $('#prevYear').disabled=state.wallYear<=2025;$('#nextYear').disabled=state.wallYear>=2026;
    $('#prevMonth').disabled=state.wallMonth<='2025-01';$('#nextMonth').disabled=state.wallMonth>='2026-10';
  }

  function renderWeekdays(){
    const values=[3,8,4,6,5,2,1], names=['一','二','三','四','五','六','日'];
    $('#weekdayBubbles').innerHTML=values.map((v,i)=>`<div class="weekday ${i===1?'active':''}"><i style="height:${v*9+15}px"></i><small>${names[i]}</small></div>`).join('');
  }

  function filteredCalls(){
    const q=($('#callSearch')?.value||'').trim();
    return calls.filter(c=>state.filter==='all'||(state.filter==='missed'?c.status==='missed':c.type===state.filter)).filter(c=>!q||dateCN(dateKey(c.at)).includes(q)||c.result.includes(q));
  }

  function renderCalls(){
    const list=filteredCalls();const groups={};
    list.forEach(c=>(groups[dateKey(c.at)]??=[]).push(c));
    $('#callFeed').innerHTML=Object.entries(groups).map(([date,items])=>`<section class="feed-day"><h3>${dateCN(date)} · ${items.length} 次</h3>${items.map(callCard).join('')}</section>`).join('')||`<article class="gentle-note"><span>☁</span><div><strong>没有找到记录</strong><p>换一个筛选条件试试看。</p></div></article>`;
    queryAll('.feed-card').forEach(card=>card.addEventListener('click',()=>openCall(Number(card.dataset.id))));
  }

  function callCard(c){
    const cls=c.status==='missed'?'missed':c.type;
    const icon=c.status==='missed'?'×':c.type==='video'?'▻':'◖';
    const label=c.type==='video'?'视频通话':'语音通话';
    return `<button class="feed-card" data-id="${c.id}"><span class="feed-icon ${cls}">${icon}</span><span class="feed-main"><strong data-private>和音的${label}</strong><small>${c.direction==='outgoing'?'我呼出':'对方呼入'} · ${c.result}</small></span><span class="feed-time"><strong>${c.seconds?duration(c.seconds):c.result}</strong><small>${time(c.at)}</small></span></button>`;
  }

  function openCall(id){
    const c=calls.find(x=>x.id===id);if(!c)return;
    $('#sheetContent').innerHTML=`<div class="sheet-hero"><div class="sheet-avatar">音</div><h2 data-private>和音的${c.type==='video'?'视频':'语音'}通话</h2><p>${dateCN(dateKey(c.at))} · ${time(c.at)}</p></div><div class="sheet-duration"><small>${c.seconds?'这一次聊了':'这次没有接通'}</small><strong>${c.seconds?duration(c.seconds):c.result}</strong></div><div class="detail-rows"><div class="detail-row"><span>谁先发起</span><strong>${c.direction==='outgoing'?'我呼出':'对方呼入'}</strong></div><div class="detail-row"><span>通话类型</span><strong>${c.type==='video'?'视频':'语音'}</strong></div><div class="detail-row"><span>结束状态</span><strong>${c.result}</strong></div></div><div class="sheet-note">这是本地模拟记录。正式版中，点开每一次通话都能核对来源，但不会展示或保存数据库密钥。</div>`;
    openSheet('detail');
  }

  function openSheet(which){
    $('#sheetBackdrop').hidden=false;
    const el=which==='settings'?$('#settingsSheet'):$('#detailSheet');
    el.classList.add('open');el.setAttribute('aria-hidden','false');
  }
  function closeSheets(){
    $('#sheetBackdrop').hidden=true;
    queryAll('.detail-sheet,.settings-sheet').forEach(x=>{x.classList.remove('open');x.setAttribute('aria-hidden','true')});
  }

  function togglePrivacy(){
    state.privacy=!state.privacy;document.body.classList.toggle('privacy',state.privacy);
    $('#settingPrivacy i').textContent=state.privacy?'开启':'关闭';
    toast(state.privacy?'名字已经藏起来了':'名字已经恢复');
  }

  function toast(text){
    const el=document.createElement('div');el.className='toast';el.innerHTML=`<span>✦</span>${text}`;$('#toastZone').appendChild(el);setTimeout(()=>el.remove(),2500);
  }

  function openContactMenu(){
    const trigger=$('#contactSwitch'),menu=$('#contactMenu'),r=trigger.getBoundingClientRect();
    menu.innerHTML=`<button class="contact-option"><span class="mini-avatar">音</span><span><strong data-private>音</strong><small>22 条通话</small></span><b>✓</b></button><button class="contact-option" data-other><span class="mini-avatar">＋</span><span><strong>选择其他人</strong><small>Demo 暂未导入</small></span></button>`;
    menu.style.left=`${Math.min(r.left,innerWidth-240)}px`;menu.style.top=`${r.bottom+8}px`;menu.hidden=false;
    $('[data-other]',menu).addEventListener('click',()=>{menu.hidden=true;toast('下一版可以在这里切换联系人')});
  }

  function fakeScan(){
    closeSheets();toast('正在轻轻刷新记录…');setTimeout(()=>toast('已经是最新的啦 ✓'),1300);
  }

  function bind(){
    queryAll('[data-nav]').forEach(btn=>btn.addEventListener('click',()=>navigate(btn.dataset.nav)));
    queryAll('#wallRangeSwitch button').forEach(btn=>btn.addEventListener('click',()=>setWallMode(btn.dataset.wallMode)));
    $('#wallYear').addEventListener('change',event=>{state.wallYear=Number(event.target.value);renderWall()});
    $('#prevYear').addEventListener('click',()=>changeYear(-1));$('#nextYear').addEventListener('click',()=>changeYear(1));
    $('#wallMonth').addEventListener('change',event=>{state.wallMonth=event.target.value;renderWall()});
    $('#prevMonth').addEventListener('click',()=>changeMonth(-1));$('#nextMonth').addEventListener('click',()=>changeMonth(1));
    $('#applyCustom').addEventListener('click',()=>{
      const start=$('#wallStart').value,end=$('#wallEnd').value;
      if(!start||!end||start>end){toast('请选择正确的开始和结束日期');return}
      if(daysBetween(start,end)>366){toast('一次最多查看 366 天');return}
      state.wallStart=start;state.wallEnd=end;renderWall();
    });
    queryAll('#chartTabs button').forEach(btn=>btn.addEventListener('click',()=>{queryAll('#chartTabs button').forEach(x=>x.classList.remove('active'));btn.classList.add('active');state.chart=btn.dataset.chart;renderChart()}));
    queryAll('#callFilters button').forEach(btn=>btn.addEventListener('click',()=>{queryAll('#callFilters button').forEach(x=>x.classList.remove('active'));btn.classList.add('active');state.filter=btn.dataset.filter;renderCalls()}));
    queryAll('.story-card[data-action]').forEach(card=>card.addEventListener('click',()=>{
      navigate('calls');state.filter=card.dataset.action==='connected'?'all':'all';renderCalls();
      if(card.dataset.action==='longest')setTimeout(()=>openCall(22),180);
    }));
    $('.latest-call').addEventListener('click',()=>openCall(22));
    $('#contactSwitch').addEventListener('click',openContactMenu);
    $('#privacyBtn').addEventListener('click',togglePrivacy);
    $('#settingsBtn').addEventListener('click',()=>openSheet('settings'));
    $('#settingPrivacy').addEventListener('click',togglePrivacy);
    $('#settingScan').addEventListener('click',fakeScan);
    $('#settingAbout').addEventListener('click',()=>toast('这是通话足迹时光墙 UI Demo · v0.3'));
    $('#sheetClose').addEventListener('click',closeSheets);$('#settingsClose').addEventListener('click',closeSheets);$('#sheetBackdrop').addEventListener('click',closeSheets);
    $('#searchToggle').addEventListener('click',()=>{$('#searchReveal').hidden=false;$('#callSearch').focus()});
    $('#closeSearch').addEventListener('click',()=>{$('#searchReveal').hidden=true;$('#callSearch').value='';renderCalls()});
    $('#callSearch').addEventListener('input',renderCalls);
    document.addEventListener('click',e=>{if(!$('#contactMenu').hidden&&!e.target.closest('#contactMenu')&&!e.target.closest('#contactSwitch'))$('#contactMenu').hidden=true});
    document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeSheets();$('#contactMenu').hidden=true}if((e.ctrlKey||e.metaKey)&&['1','2','3','4'].includes(e.key)){e.preventDefault();navigate(['home','wall','discover','calls'][Number(e.key)-1])}});
  }

  function init(){renderChart();renderCalendar();renderWeekdays();renderCalls();renderWall();bind()}
  try{init()}catch(error){window.__demoErrors.push({message:error.message,stack:error.stack});console.error(error)}
})();
