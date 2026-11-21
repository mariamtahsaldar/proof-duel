
(() => {
  const $ = id => document.getElementById(id);
  const EMOJIS = ['🌸','🦋','🍓','💖','🌈','✨','🍒','🐱','🌷','🦄','🍑','🌙'];
  const COLORS = ['#e6407e','#9b6bdf','#ff8a65','#2fa57d','#3b82c4','#d4a017'];
  const CFG = window.PROOF_DUEL_CONFIG || {};
  const S = { db:null, ready:false, me:null, urls:{}, acts:[], people:[], peopleLoaded:false, logs:{},
              weekOffset:0, day:null, loaded:false, pendingAct:null, busy:null, logSubs:{} };

  // ---- dates (local time, weeks start Monday) ----
  const pad = n => String(n).padStart(2,'0');
  const key = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const parse = k => { const [y,m,d]=k.split('-').map(Number); return new Date(y,m-1,d); };
  const monday = d => { const x=new Date(d.getFullYear(),d.getMonth(),d.getDate()); x.setDate(x.getDate()-((x.getDay()+6)%7)); return x; };
  const addDays = (d,n) => { const x=new Date(d); x.setDate(x.getDate()+n); return x; };
  const todayKey = () => key(new Date());
  const daysOf = off => { const s=addDays(monday(new Date()),7*off); return [...Array(7)].map((_,i)=>key(addDays(s,i))); };
  const DOW = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const fmt = (k,o) => parse(k).toLocaleDateString(undefined,o);

  // ---- helpers ----
  function el(tag, attrs={}, ...kids){
    const e=document.createElement(tag);
    for(const [k,v] of Object.entries(attrs)){
      if(k==='class') e.className=v; else if(k==='text') e.textContent=v;
      else if(k.startsWith('on')) e.addEventListener(k.slice(2),v);
      else if(v!==false && v!=null) e.setAttribute(k, v===true?'':v);
    }
    for(const c of kids.flat()) if(c!=null) e.append(c.nodeType?c:document.createTextNode(c));
    return e;
  }
  const icon = (id,cls='icon') => { const s=document.createElementNS('http://www.w3.org/2000/svg','svg'); s.setAttribute('class',cls); const u=document.createElementNS('http://www.w3.org/2000/svg','use'); u.setAttribute('href','#'+id); s.append(u); return s; };
  let toastT; function toast(msg){ const t=$('toast'); t.textContent=msg; t.hidden=false; clearTimeout(toastT); toastT=setTimeout(()=>t.hidden=true,2600); }
  function notice(msg, err){ const n=$('notice'); n.textContent=msg||''; n.hidden=!msg; n.classList.toggle('err',!!err); }
  // photos are private: each one is shown through a short-lived signed link
  const PIXEL='data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
  const blob = path => S.urls[path]?.url || PIXEL;
  const person = id => S.people.find(p=>p.id===id) || {};
  const name = id => person(id).displayName || (id===S.me ? 'You' : 'Your friend');
  const emoji = id => EMOJIS.includes(person(id).emoji) ? person(id).emoji : '🌸';
  const color = id => COLORS.includes(person(id).color) ? person(id).color : COLORS[0];
  const av = (id, cls='av') => el('span',{class:cls,style:`background:color-mix(in srgb, ${color(id)} 20%, transparent)`,text:emoji(id),'aria-hidden':'true'});
  const hash = s => [...s].reduce((h,c)=>(h*31+c.charCodeAt(0))>>>0,7);
  const pickLine = (arr, salt='') => arr[hash(todayKey()+salt)%arr.length];

  function allLogs(){ return Object.entries(S.logs).flatMap(([uid,arr])=>arr.map(l=>({...l,uid}))); }
  const pics = l => !l ? [] : Array.isArray(l.photos) ? l.photos.filter(Boolean) : (l.photo ? [l.photo] : []);
  function allPhotos(){
    return allLogs().flatMap(l=>pics(l).map((p,i)=>({photo:p,uid:l.uid,activityName:l.activityName,date:l.date,logId:l.id,ts:(l.createdAt||0)+i})))
      .sort((a,b)=> a.date===b.date ? b.ts-a.ts : (a.date<b.date?1:-1));
  }
  function players(){
    const ids=S.people.filter(p=>p.displayName).map(p=>p.id);
    ids.sort((a,b)=> (a===S.me?-1:b===S.me?1:(person(a).joinedAt||0)-(person(b).joinedAt||0)));
    return ids;
  }
  const dayPts = (id,k) => (S.logs[id]||[]).filter(l=>l.date===k).reduce((s,l)=>s+(Number(l.points)||0),0);
  const totals = days => Object.fromEntries(players().map(id=>[id,days.reduce((s,k)=>s+dayPts(id,k),0)]));
  function didRequired(id,k){
    const req=S.acts.filter(a=>a.required), ls=(S.logs[id]||[]).filter(l=>l.date===k);
    return req.length ? req.every(a=>ls.some(l=>l.activityId===a.id)) : ls.length>0;
  }
  function streak(id){
    let d=new Date(), n=0;
    if(!didRequired(id,key(d))) d=addDays(d,-1);
    while(didRequired(id,key(d)) && n<400){ n++; d=addDays(d,-1); }
    return n;
  }

  // ---- motivational copy ----
  const LINES = {
    start:['New week, fresh start. First proof sets the pace.','Clean slate. Let’s get those points.'],
    lead:['You’re in the lead. Keep it going!','Top of the board. Stay consistent.','Look at you go. Don’t slow down now.'],
    behind:['{gap} pts behind. One {act} and you’re back in it.','Close the gap! {gap} pts is totally doable.','Small steps add up. {gap} pts to the top.'],
    tie:['Neck and neck. Whoever logs next takes the lead.','Dead even. This is getting close!'],
    alldone:['Everything done today. Proud of you!','Every box ticked today. Rest up.'],
    reqmiss:['Don’t forget {act} today.','{act} is still waiting for you.'],
    solo:['Share this page with your friend to start the race.']
  };
  const fill = (s,v) => s.replace(/\{(\w+)\}/g,(_,k)=>v[k]??'');
  function pepLine(){
    const ids=players(), me=S.me, today=todayKey(), tot=totals(daysOf(0));
    if(!me || !ids.includes(me)) return 'Snap it, log it, win the week.';
    const mine=(S.logs[me]||[]).filter(l=>l.date===today);
    const missReq=S.acts.filter(a=>a.required).find(a=>!mine.some(l=>l.activityId===a.id));
    const allDone=S.acts.length && S.acts.every(a=>mine.some(l=>l.activityId===a.id));
    const other=ids.find(id=>id!==me), a=tot[me]||0, b=other?tot[other]||0:0;
    const bigAct=[...S.acts].sort((x,y)=>y.points-x.points)[0];
    if(allDone) return pickLine(LINES.alldone);
    if(missReq && a>=b) return fill(pickLine(LINES.reqmiss),{act:missReq.name.toLowerCase()});
    if(!other) return pickLine(LINES.solo);
    if(a===0&&b===0) return pickLine(LINES.start);
    if(a===b) return pickLine(LINES.tie);
    if(a>b) return pickLine(LINES.lead);
    return fill(pickLine(LINES.behind),{gap:b-a,act:(bigAct?.name||'activity').toLowerCase()});
  }

  // ---- render ----
  function render(){ renderHeader(); renderStreaks(); renderRace(); renderDays(); renderToday(); renderFeed(); renderWeek(); renderActs(); }

  function renderStreaks(){
    const ids=players(), C=$('streaks'); C.replaceChildren(); C.hidden=!ids.length;
    C.style.gridTemplateColumns = ids.length===1 ? '1fr' : '';
    const days=daysOf(0), t=todayKey();
    for(const id of ids){
      const st=streak(id), doneToday=didRequired(id,t);
      C.append(el('div',{class:'card sk'},
        el('div',{class:'sk-top'}, av(id,'av sm'), el('span',{text: id===S.me?'Your streak':name(id)})),
        el('div',{class:'sk-num'+(st?' hot':'')}, el('span',{text:'🔥','aria-hidden':'true'}), String(st)),
        el('div',{class:'sk-sub',text: st===1?'day in a row':'days in a row'}),
        el('div',{class:'sk-week','aria-label':'This week'}, days.map((k,i)=>el('i',{class:k>t?'future':didRequired(id,k)?'on':'',title:DOW[i]}))),
        el('div',{class:'sk-hint',text: doneToday ? 'Today counts ✓' : id===S.me ? 'Finish your required activities to keep it' : 'Not done yet today'})));
    }
  }

  function renderFeed(){
    const F=$('feed'), ph=allPhotos().slice(0,15); F.replaceChildren();
    if(!ph.length){ F.append(el('div',{class:'card empty',style:'flex:1',text:'Photos from both of you show up here.'})); return; }
    ph.forEach((p,i)=>F.append(el('button',{'aria-label':`${name(p.uid)}: ${p.activityName}`,onclick:()=>openGallery(ph,i)},
      el('img',{src:blob(p.photo),alt:'',loading:'lazy'}), av(p.uid,'av sm'))));
  }

  function renderHeader(){
    const joined=S.me && person(S.me).displayName;
    $('hello').textContent = joined ? `Hi, ${name(S.me)}` : 'Proof Duel';
    $('pep').textContent = pepLine();
    const b=$('meBtn'); b.hidden=!joined; if(joined) b.replaceChildren(av(S.me));
  }

  function renderRace(){
    const days=daysOf(0), ids=players(), tot=totals(days), t=todayKey();
    const left=7-days.indexOf(t);
    $('daysLeft').textContent = left===1 ? 'Last day!' : `${left} days left`;
    const L=$('lanes'); L.replaceChildren();
    if(!ids.length){ L.append(el('div',{class:'empty',text:S.peopleLoaded?'Create your player to join the race.':'Loading the race…'})); $('status').hidden=true; return; }
    const max=Math.max(1,...ids.map(id=>tot[id]));
    const top=Math.max(...ids.map(id=>tot[id]));
    const leaders=ids.filter(id=>tot[id]===top && top>0);
    for(const id of ids){
      const st=streak(id);
      L.append(el('div',{class:'lane'},
        av(id),
        el('div',{class:'nm'}, el('b',{text:name(id)}), leaders.length===1&&leaders[0]===id?el('span',{text:'👑','aria-label':'Leading'}):null),
        el('div',{class:'pts'}, String(tot[id]), el('small',{text:' pts'})),
        el('div',{class:'bar'}, el('i',{style:`width:${Math.max(3,tot[id]/max*100)}%;background:${color(id)}`}))));
    }
    const st=$('status'); st.replaceChildren(); st.hidden=false;
    if(ids.length<2) st.append('Waiting for your friend to join.');
    else {
      const sc=ids.map(id=>[id,tot[id]]).sort((a,b)=>b[1]-a[1]);
      if(sc[0][1]===0) st.append('Nobody has scored yet. Who’s first?');
      else if(sc[0][1]===sc[1][1]) st.append('All tied at ', el('b',{text:sc[0][1]+' pts'}));
      else st.append(sc[0][0]===S.me?'You lead by ':name(sc[0][0])+' leads by ', el('b',{text:(sc[0][1]-sc[1][1])+' pts'}));
    }
  }

  function renderDays(){
    const days=daysOf(0), t=todayKey(), D=$('days'); D.replaceChildren();
    if(!S.day || !days.includes(S.day)) S.day=t;
    days.forEach((k,i)=>{
      D.append(el('button',{class:'day','aria-pressed':String(k===S.day),disabled:k>t,'aria-label':fmt(k,{weekday:'long',day:'numeric'}),
        onclick:()=>{S.day=k; renderDays(); renderToday();}},
        el('small',{text:DOW[i].slice(0,1)}), el('b',{text:String(parse(k).getDate())}), el('i',{class:S.me&&didRequired(S.me,k)?'on':''})));
    });
  }

  function renderToday(){
    const k=S.day, t=todayKey(), A=$('acts'); A.replaceChildren();
    $('dayTitle').textContent = k===t ? 'Today' : fmt(k,{weekday:'long'});
    if(!S.loaded){ A.append(el('div',{class:'empty',text:'Loading activities…'})); return; }
    if(!S.ready){ A.append(el('div',{class:'empty',text:'Can’t reach the challenge right now. Check your connection.'})); return; }
    if(!S.acts.length){ A.append(el('div',{class:'empty'},'No activities yet. Add one in ',el('a',{href:'#activities',text:'Activities'}),'.')); $('dayTotal').textContent=''; return; }
    const mine=(S.logs[S.me]||[]).filter(l=>l.date===k);
    const mate=players().find(id=>id!==S.me);
    const got=mine.reduce((s,l)=>s+(Number(l.points)||0),0), possible=S.acts.reduce((s,a)=>s+(Number(a.points)||0),0);
    $('dayTotal').textContent = `${got} of ${possible} pts`;
    const joined = S.me && person(S.me).displayName;
    for(const a of S.acts){
      const log=mine.find(l=>l.activityId===a.id), mp=pics(log);
      const fl=mate ? (S.logs[mate]||[]).find(l=>l.date===k && l.activityId===a.id) : null;
      const gal=()=>galleryFor(k,a.id);
      const thumb = mp.length
        ? el('button',{class:'thumb','aria-label':'View photos',onclick:gal}, el('img',{src:blob(mp[mp.length-1]),alt:''}), mp.length>1?el('span',{class:'count',text:String(mp.length)}):null)
        : el('div',{class:'thumb'}, icon('i-cam'));
      const meta=el('div',{class:'meta'}, log?el('span',{class:'ok',text:'✓ Done · '}):null, `${log?log.points:a.points} pts`,
        a.required&&!log?el('span',{class:'req',text:' · required'}):null, mp.length>1?` · ${mp.length} photos`:'');
      const right=el('div',{class:'right'});
      if(mate){
        const n=pics(fl).length;
        right.append(el('button',{class:'mate'+(fl?'':' off'),disabled:!fl,'aria-label':fl?`See ${name(mate)}'s photos`:`${name(mate)} hasn't done this yet`,title:fl?`${name(mate)} did it (${n} photo${n===1?'':'s'})`:`${name(mate)}: not yet`,onclick:gal},
          av(mate,'av sm'), fl?el('span',{class:'tick'}):null));
      }
      if(S.busy===a.id) right.append(el('div',{class:'round'}, el('span',{class:'spin','aria-label':'Uploading'})));
      else right.append(el('button',{class:'round '+(log?'more':'add'),'aria-label':log?`Add another photo for ${a.name}`:`Add photo proof for ${a.name}`,title:log?'Add another photo':'Add photo proof',disabled:!!S.busy||!joined,onclick:()=>pick(a)}, icon(log?'i-plus':'i-cam')));
      A.append(el('div',{class:'item'}, thumb, el('div',{class:'info'}, el('span',{class:'name',text:a.name}), meta), right));
    }
  }

  function renderWeek(){
    const days=daysOf(S.weekOffset), ids=players(), tot=totals(days);
    const s=parse(days[0]), e=parse(days[6]);
    $('weekLabel').textContent = S.weekOffset===0 ? 'This week' :
      `${s.toLocaleDateString(undefined,{month:'short',day:'numeric'})} – ${e.toLocaleDateString(undefined,{month:'short',day:'numeric'})}`;
    $('nextWeek').disabled = S.weekOffset>=0;
    // podium
    const P=$('podium'); P.replaceChildren();
    const ranked=[...ids].sort((a,b)=>tot[b]-tot[a]);
    const tie = ranked.length>1 && tot[ranked[0]]===tot[ranked[1]];
    if(!ranked.length) P.append(el('div',{class:'card empty',style:'grid-column:1/-1',text:'Create your player to appear here.'}));
    ranked.forEach((id,i)=>{
      const lead = i===0 && tot[id]>0 && !tie;
      const proofs=(S.logs[id]||[]).filter(l=>days.includes(l.date)).reduce((s,l)=>s+pics(l).length,0), st=streak(id);
      P.append(el('div',{class:'card pcard'+(lead?' lead':'')},
        el('div',{class:'rank',text: tie ? 'Tied' : lead ? (S.weekOffset<0?'👑 Winner':'👑 Leading') : `#${i+1}`}),
        av(id,'av lg'), el('b',{text:name(id)}),
        el('div',{class:'big',text:String(tot[id])}),
        el('div',{class:'sub',text:`${proofs} proof${proofs===1?'':'s'}${S.weekOffset===0&&st?` · 🔥 ${st}`:''}`})));
    });
    // wall
    const W=$('wall'); W.replaceChildren();
    const ph=allPhotos().filter(p=>days.includes(p.date));
    $('proofCount').textContent = ph.length ? String(ph.length) : '';
    if(!ph.length) W.append(el('div',{class:'card empty',style:'grid-column:1/-1',text:'Photos from this week show up here.'}));
    ph.forEach((p,i)=>W.append(el('button',{onclick:()=>openGallery(ph,i),'aria-label':`${name(p.uid)}: ${p.activityName}`},
      el('img',{src:blob(p.photo),alt:'',loading:'lazy'}), av(p.uid,'av sm'))));
    // history
    const H=$('history'); H.replaceChildren();
    const thisMon=key(monday(new Date())), weeks={};
    for(const l of allLogs()){ const w=key(monday(parse(l.date))); if(w>=thisMon) continue; (weeks[w]??={})[l.uid]=((weeks[w][l.uid])||0)+(Number(l.points)||0); }
    const wk=Object.keys(weeks).sort().reverse();
    if(!wk.length) H.append(el('div',{class:'empty',style:'padding:14px 0',text:'The first winner is crowned Sunday night.'}));
    for(const w of wk){
      const sc=ids.map(id=>[id,weeks[w][id]||0]).sort((a,b)=>b[1]-a[1]);
      const t2 = sc.length>1 && sc[0][1]===sc[1][1];
      H.append(el('div',{class:'hrow'}, el('span',{class:'muted',text:fmt(w,{month:'short',day:'numeric'})}),
        el('span',{}, t2||!sc.length?'Tie':`👑 ${name(sc[0][0])}`, el('span',{class:'muted num',text:'  '+sc.map(x=>x[1]).join(' – ')}))));
    }
  }

  function renderActs(){
    const L=$('actList'); L.replaceChildren();
    if(!S.acts.length){ L.append(el('div',{class:'empty',text: S.loaded?'No activities yet. Add one below.':'Loading…'})); return; }
    for(const a of S.acts){
      const n=el('input',{class:'field',type:'text',value:a.name,maxlength:'60','aria-label':'Activity name',id:'n-'+a.id});
      const p=el('input',{class:'field',type:'number',value:String(a.points),min:'1',max:'1000','aria-label':'Points',id:'p-'+a.id});
      const r=el('input',{type:'checkbox',id:'r-'+a.id}); r.checked=!!a.required;
      const save=()=>{ const v={name:n.value.trim()||a.name, points:Math.max(1,Math.min(1000,parseInt(p.value)||a.points)), required:r.checked};
        if(v.name!==a.name||v.points!==a.points||v.required!==!!a.required) api.updateActivity(a.id,v).then(()=>toast('Saved'),err); };
      n.addEventListener('change',save); p.addEventListener('change',save); r.addEventListener('change',save);
      L.append(el('div',{class:'edit'}, n, p, el('label',{class:'chk'}, r, 'Required'),
        el('button',{class:'btn link',type:'button',text:'Remove',onclick:()=>api.deleteActivity(a.id).then(()=>toast('Removed'),err)})));
    }
  }

  // ---- accounts / profile ----
  const J={emoji:EMOJIS[0], color:COLORS[0], mode:'signup'};
  function drawJoin(){
    $('emojiPicks').replaceChildren(...EMOJIS.map(x=>el('button',{type:'button',class:'pick','aria-pressed':String(x===J.emoji),'aria-label':'Sticker '+x,text:x,onclick:()=>{J.emoji=x;drawJoin();}})));
    $('colorPicks').replaceChildren(...COLORS.map(x=>el('button',{type:'button',class:'swatch','aria-pressed':String(x===J.color),'aria-label':'Color',style:`background:${x}`,onclick:()=>{J.color=x;drawJoin();}})));
    const a=$('joinAv'); a.textContent=J.mode==='signin'?'👋':J.emoji; a.style.background=`color-mix(in srgb, ${J.color} 20%, transparent)`;
  }
  // mode: 'signup' | 'signin' | 'finish' (signed in, profile missing) | 'edit'
  function openJoin(mode){
    J.mode=mode;
    const p=person(S.me);
    if(mode==='edit'){ $('joinName').value=p.displayName||''; J.emoji=EMOJIS.includes(p.emoji)?p.emoji:EMOJIS[0]; J.color=COLORS.includes(p.color)?p.color:COLORS[0]; }
    else if(mode!=='finish') $('joinPw').value='';
    const T={signup:['Create your account','Your name and a password, that’s it.','Create account'],
             signin:['Welcome back','Sign in with your name and password.','Sign in'],
             finish:['Finish your profile','Pick your sticker and color.','Let’s go'],
             edit:['Your profile','Change your sticker or color.','Save']}[mode];
    $('joinTitle').textContent=T[0]; $('joinSub').textContent=T[1]; $('joinBtn').textContent=T[2];
    $('joinName').readOnly = mode==='edit';
    $('pwWrap').hidden = mode==='finish' || mode==='edit';
    $('joinPw').required = !$('pwWrap').hidden;
    $('joinPw').autocomplete = mode==='signin' ? 'current-password' : 'new-password';
    $('looksWrap').hidden = mode==='signin';
    $('joinToggle').hidden = !(mode==='signup'||mode==='signin');
    $('joinToggle').textContent = mode==='signup' ? 'Already have an account? Sign in' : 'New here? Create an account';
    $('joinCancel').hidden = mode!=='edit';
    $('signOut').hidden = !(mode==='edit'||mode==='finish');
    $('joinErr').hidden=true;
    drawJoin(); if(!$('join').open) $('join').showModal();
  }
  function joinErr(msg){ $('joinErr').textContent=msg; $('joinErr').hidden=false; }
  $('joinToggle').onclick=()=>openJoin(J.mode==='signup'?'signin':'signup');
  $('joinCancel').onclick=()=>$('join').close();
  $('signOut').onclick=async()=>{ await S.db.auth.signOut().catch(()=>{}); $('join').close(); };
  $('join').addEventListener('cancel',e=>{ if(J.mode!=='edit') e.preventDefault(); });
  $('meBtn').onclick=()=>openJoin('edit');
  // Names sign you in, so each name maps to a private login address that never receives mail.
  async function loginFor(nm){
    const bytes=new TextEncoder().encode(nm.trim().toLowerCase().normalize('NFC'));
    const h=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
    return `u${[...h.slice(0,16)].map(b=>b.toString(16).padStart(2,'0')).join('')}@players.proofduel.app`;
  }
  $('joinForm').addEventListener('submit', async e=>{
    e.preventDefault();
    const nm=$('joinName').value.trim().slice(0,24), pw=$('joinPw').value; if(!nm) return;
    $('joinErr').hidden=true; $('joinBtn').disabled=true; S.joining = J.mode==='signup';
    try{
      if(J.mode==='edit'){
        await api.updatePlayer(S.me,{emoji:J.emoji, color:J.color}); await api.loadAll();
        $('join').close(); toast('Profile saved'); return;
      }
      if(J.mode==='signin'){
        const r=await S.db.auth.signInWithPassword({email:await loginFor(nm), password:pw});
        if(r.error){ joinErr(r.error.status===400 ? 'That name and password don’t match.' : 'Couldn’t sign in. Check your connection and try again.'); return; }
        $('join').close(); return;   // onAuthStateChange loads everything
      }
      if(J.mode==='signup'){
        if(pw.length<8){ joinErr('Use a password with at least 8 characters.'); return; }
        const r=await S.db.auth.signUp({email:await loginFor(nm), password:pw});
        if(r.error){
          const m=r.error.message||'', c=r.error.code||'';
          joinErr(/registered|exists/i.test(m) ? 'That name already has an account. Tap “Sign in” below.'
            : /not authorized|confirm|sending|smtp/i.test(m+' '+c) ? 'Supabase is still trying to send a confirmation email. In Supabase turn off Authentication → Email → “Confirm email”, save, then try again.'
            : /signup.*(disabled|not allowed)|signups not allowed/i.test(m+' '+c) ? 'New sign-ups are turned off in Supabase (Authentication → “Allow new users to sign up”).'
            : /rate limit/i.test(m+' '+c) ? 'Too many tries. Wait a few minutes and try again.'
            : /password/i.test(m) ? m
            : `Couldn’t create the account. Supabase said: “${m||c||'unknown error'}”`);
          return; }
        if(!r.data.session){ joinErr('Account created, but email confirmation is still turned on in Supabase. Turn off “Confirm email”, then sign in.'); return; }
        S.me=r.data.session.user.id;
      }
      // signup or finish: create the player profile
      await api.createPlayer({id:S.me, name:nm, emoji:J.emoji, color:J.color});
      await api.loadAll();
      $('join').close(); toast(`Welcome, ${nm}! ${J.emoji}`); confetti();
    }catch(x){
      console.warn(x);
      if(/two players/i.test(x?.message||'')){ joinErr('This challenge already has its two players.'); await S.db.auth.signOut().catch(()=>{}); }
      else if(x?.code==='23505') joinErr('That name is already taken.');
      else joinErr('Something went wrong. Check your connection and try again.');
    }
    finally{ $('joinBtn').disabled=false; S.joining=false; }
  });

  // ---- photo gallery ----
  const G={items:[],i:0};
  function galleryFor(k, actId){
    const items=allPhotos().filter(p=>p.date===k && S.logs[p.uid]?.find(l=>l.id===p.logId)?.activityId===actId)
      .sort((a,b)=>(a.uid===S.me?0:1)-(b.uid===S.me?0:1) || a.ts-b.ts);
    if(items.length) openGallery(items,0);
  }
  function openGallery(items,i){ G.items=items; G.i=i; drawGallery(); if(!$('lightbox').open) $('lightbox').showModal(); }
  function drawGallery(){
    const p=G.items[G.i]; if(!p){ $('lightbox').close(); return; }
    $('lbImg').src=blob(p.photo); $('lbImg').alt=`${name(p.uid)}: ${p.activityName}`;
    $('lbCap').textContent=`${name(p.uid)} · ${p.activityName} · ${fmt(p.date,{weekday:'short',day:'numeric'})}${G.items.length>1?`  (${G.i+1}/${G.items.length})`:''}`;
    $('lbPrev').disabled=G.i<=0; $('lbNext').disabled=G.i>=G.items.length-1;
    $('lbPrev').hidden=$('lbNext').hidden=G.items.length<2;
    $('lbDel').hidden=p.uid!==S.me;
  }
  $('lbPrev').onclick=()=>{ if(G.i>0){ G.i--; drawGallery(); } };
  $('lbNext').onclick=()=>{ if(G.i<G.items.length-1){ G.i++; drawGallery(); } };
  $('lbDel').onclick=async()=>{
    const p=G.items[G.i]; if(!p||p.uid!==S.me) return;
    const log=(S.logs[S.me]||[]).find(l=>l.id===p.logId); if(!log) return;
    const rest=pics(log).filter(x=>x!==p.photo);
    try{
      if(rest.length) await api.setPhotos(log.id,rest); else await api.deleteLog(log.id);
      api.removePhoto(p.photo).catch(()=>{});
      await api.loadAll();
      toast(rest.length?'Photo deleted':'Photo deleted. Activity un-logged.');
      G.items.splice(G.i,1); if(G.i>=G.items.length) G.i=G.items.length-1; drawGallery();
    }catch(x){ err(x); }
  };
  $('lbClose').onclick=()=>$('lightbox').close();
  $('lightbox').addEventListener('click',e=>{ if(e.target===$('lightbox')) $('lightbox').close(); });

  // ---- confetti ----
  function confetti(){
    if(matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const c=$('confetti'), x=c.getContext('2d'), W=c.width=innerWidth, H=c.height=innerHeight;
    const cols=['#e6407e','#9b6bdf','#ff9f7a','#ffd166','#2fa57d','#ff8fb8'];
    const ps=[...Array(90)].map(()=>({x:W/2+(Math.random()-.5)*80,y:H*.6,vx:(Math.random()-.5)*12,vy:-Math.random()*14-6,r:Math.random()*6+4,c:cols[Math.floor(Math.random()*cols.length)],a:Math.random()*6,s:Math.random()<.4}));
    let f=0; (function tick(){ x.clearRect(0,0,W,H); f++;
      for(const p of ps){ p.vy+=.4; p.x+=p.vx; p.y+=p.vy; p.a+=.2; x.save(); x.translate(p.x,p.y); x.rotate(p.a); x.fillStyle=p.c;
        if(p.s){ x.beginPath(); x.arc(0,0,p.r/1.6,0,7); x.fill(); } else x.fillRect(-p.r/2,-p.r/4,p.r,p.r/2); x.restore(); }
      if(f<110) requestAnimationFrame(tick); else x.clearRect(0,0,W,H); })();
  }

  // ---- logging ----
  const CHEERS=['Look at you go!','Nice one!','That’s the spirit!','Proud of you!','Keep it up!'];
  function err(e){ console.warn(e); toast('That didn’t save. Check your connection and try again.'); }
  function pick(a){ S.pendingAct=a; $('fileInput').value=''; $('fileInput').click(); }
  $('fileInput').addEventListener('change', async e=>{
    const f=e.target.files?.[0], a=S.pendingAct; if(!f||!a) return;
    S.busy=a.id; renderToday();
    try{
      const img=await shrink(f);
      const path=await api.uploadPhoto(img);
      await api.loadAll();
      const existing=(S.logs[S.me]||[]).find(l=>l.date===S.day && l.activityId===a.id);
      if(existing){
        await api.setPhotos(existing.id,[...pics(existing), path]);
        await api.loadAll();
        toast('Photo added');
      } else {
        await api.insertLog({player_id:S.me, activity_id:a.id, activity_name:a.name, points:a.points, date:S.day, photos:[path]});
        await api.loadAll();
        toast(`+${a.points} pts · ${CHEERS[Math.floor(Math.random()*CHEERS.length)]}`);
        confetti();
      }
    }catch(x){
      console.warn(x);
      toast('Upload failed. Check your connection and try again.');
    }finally{ S.busy=null; renderToday(); }
  });
  // Resize photos to at most 1600px JPEG so uploads stay small.
  async function shrink(file){
    try{
      const url=URL.createObjectURL(file);
      const im=await new Promise((res,rej)=>{const i=new Image(); i.onload=()=>res(i); i.onerror=rej; i.src=url;});
      const s=Math.min(1,1600/Math.max(im.naturalWidth,im.naturalHeight));
      const c=document.createElement('canvas'); c.width=Math.round(im.naturalWidth*s); c.height=Math.round(im.naturalHeight*s);
      c.getContext('2d').drawImage(im,0,0,c.width,c.height); URL.revokeObjectURL(url);
      const b=await new Promise(r=>c.toBlob(r,'image/jpeg',.82));
      return b||file;
    }catch(e){ return file; }
  }

  // ---- activities form ----
  $('addForm').addEventListener('submit', e=>{
    e.preventDefault(); if(!S.ready) return;
    const nm=$('newName').value.trim(), pts=parseInt($('newPts').value);
    if(!nm||!pts) return;
    const order=S.acts.reduce((m,a)=>Math.max(m,a.order||0),0)+1;
    api.addActivity({name:nm, points:Math.min(1000,Math.max(1,pts)), required:$('newReq').checked, sort:order})
      .then(()=>{ toast('Added '+nm); $('addForm').reset(); }, err);
  });

  // ---- tabs & weeks ----
  function route(){
    const h=(location.hash||'#today').slice(1), v=['today','week','activities'].includes(h)?h:'today';
    for(const t of ['today','week','activities']){ $('pane-'+t).hidden=t!==v; $('tab-'+t).removeAttribute('aria-current'); if(t===v) $('tab-'+t).setAttribute('aria-current','page'); }
    scrollTo(0,0);
  }
  addEventListener('hashchange',route); route();
  $('prevWeek').onclick=()=>{ S.weekOffset--; renderWeek(); };
  $('nextWeek').onclick=()=>{ if(S.weekOffset<0){ S.weekOffset++; renderWeek(); } };

  // ---- boot ----
  let rT; const rerender=()=>{ clearTimeout(rT); rT=setTimeout(render,30); };
  render();

  // ---- Supabase data layer ----
  const api = {
    async loadAll(){
      const db=S.db;
      const [p,a,l]=await Promise.all([
        db.from('players').select('*').order('joined_at'),
        db.from('activities').select('*').order('sort'),
        db.from('logs').select('*').order('created_at')]);
      for(const r of [p,a,l]) if(r.error) throw r.error;
      S.people=p.data.map(r=>({id:r.id, displayName:r.name, emoji:r.emoji, color:r.color, joinedAt:Date.parse(r.joined_at)}));
      S.acts=a.data.map(r=>({id:r.id, name:r.name, points:r.points, required:r.required, order:r.sort}));
      S.logs={};
      for(const r of l.data) (S.logs[r.player_id] ??= []).push({id:r.id, activityId:r.activity_id, activityName:r.activity_name, points:r.points, date:r.date, photos:r.photos||[], createdAt:Date.parse(r.created_at)});
      S.loaded=true; S.peopleLoaded=true; S.ready=true;
      await api.signPhotos();
      rerender();
    },
    async q(p){ const r=await p; if(r.error) throw r.error; return r.data; },
    async signPhotos(){
      const now=Date.now();
      const need=[...new Set(Object.values(S.logs).flat().flatMap(l=>pics(l)))].filter(p=>!S.urls[p] || S.urls[p].exp<now+5*60e3);
      for(let i=0;i<need.length;i+=100){
        const r=await S.db.storage.from('proofs').createSignedUrls(need.slice(i,i+100), 3600);
        if(r.error) { console.warn(r.error); continue; }
        for(const x of r.data) if(x.signedUrl) S.urls[x.path]={url:x.signedUrl, exp:now+3600e3};
      }
    },
    createPlayer(v){ return api.q(S.db.from('players').insert(v)); },
    updatePlayer(id,v){ return api.q(S.db.from('players').update(v).eq('id',id)); },
    addActivity(v){ return api.q(S.db.from('activities').insert(v)).then(api.loadAll); },
    updateActivity(id,v){ return api.q(S.db.from('activities').update(v).eq('id',id)).then(api.loadAll); },
    deleteActivity(id){ return api.q(S.db.from('activities').delete().eq('id',id)).then(api.loadAll); },
    insertLog(v){ return api.q(S.db.from('logs').insert(v)); },
    setPhotos(id,photos){ return api.q(S.db.from('logs').update({photos}).eq('id',id)); },
    deleteLog(id){ return api.q(S.db.from('logs').delete().eq('id',id)); },
    async uploadPhoto(blobFile){
      const path=`${S.me}/${(crypto.randomUUID?crypto.randomUUID():Date.now()+'-'+Math.random().toString(36).slice(2))}.jpg`;
      const r=await S.db.storage.from('proofs').upload(path, blobFile, {contentType:'image/jpeg', upsert:false});
      if(r.error) throw r.error; return path;
    },
    async removePhoto(path){ const r=await S.db.storage.from('proofs').remove([path]); if(r.error) throw r.error; }
  };

  (async()=>{
    if(!CFG.supabaseUrl || !CFG.supabaseAnonKey || !window.supabase){
      S.loaded=true; S.peopleLoaded=true;
      notice(!window.supabase ? 'Couldn’t load the app. Check your connection and reload.' : 'Setup needed: add your Supabase URL and key to config.js.', true);
      render(); return;
    }
    S.db=window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {auth:{persistSession:true, autoRefreshToken:true, storageKey:'proofduel.auth'}});
    let channel=null, lT;
    const refresh=()=>{ clearTimeout(lT); lT=setTimeout(()=>{ if(S.me) api.loadAll().catch(()=>{}); },300); };
    const reset=()=>{ S.me=null; S.people=[]; S.acts=[]; S.logs={}; S.urls={}; S.ready=false; S.loaded=true; S.peopleLoaded=true; };
    async function onSession(session){
      if(!session){
        reset(); if(channel){ S.db.removeChannel(channel); channel=null; }
        render(); openJoin(J.mode==='signin'?'signin':'signup'); return;
      }
      if(S.me===session.user.id && S.ready) return;
      S.me=session.user.id;
      try{ await api.loadAll(); }
      catch(e){ console.warn(e); S.loaded=true; S.peopleLoaded=true; notice('Couldn’t load the challenge. Check your connection and reload.', true); render(); return; }
      notice('');
      if(S.joining){ /* the sign-up form finishes the profile itself */ }
      else if(!S.people.some(p=>p.id===S.me)) openJoin('finish');   // signed in but no profile yet
      else if($('join').open && J.mode!=='edit') $('join').close();
      if(!channel){ channel=S.db.channel('proofduel').on('postgres_changes',{event:'*',schema:'public'},refresh).subscribe(); }
    }
    S.db.auth.onAuthStateChange((ev,session)=>{ if(ev==='TOKEN_REFRESHED') return; setTimeout(()=>onSession(session),0); });
    document.addEventListener('visibilitychange',()=>{ if(!document.hidden) refresh(); });
    setInterval(()=>{ if(!document.hidden) refresh(); }, 60000);
  })();
})();
