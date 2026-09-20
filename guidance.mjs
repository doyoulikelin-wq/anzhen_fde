// Patient-facing guidance. Match and recognition requests only run after a click.
const guidanceCases = [
  { id:'palpitation', label:'心悸就诊', text:'女，45岁。近2个月反复心悸，每次持续数分钟。动态心电图提示阵发性室上性心动过速，目前生命体征平稳，无持续胸痛、晕厥或呼吸困难。希望到心律失常专科门诊进一步评估，请推荐合适的医生并说明就诊准备。' },
  { id:'pressure', label:'血压复诊', text:'男，56岁。有高血压病史5年，近1个月家庭血压平均145/90mmHg，正在规律用药。近期无胸痛、晕厥、呼吸困难。已记录家庭血压，拟到高血压相关门诊复诊，评估长期管理方案。' },
  { id:'recovery', label:'术后复查', text:'男，62岁。冠状动脉搭桥术后6周，病情稳定，切口愈合良好，无胸痛。近期活动耐量下降，希望到心脏康复门诊进行运动评估和术后康复随访，已有出院小结及近期超声心动图报告。' },
];

export function createGuidanceWorkspace(context) {
  const {escape:esc,icon,photo,api}=context;
  const state={caseText:guidanceCases[0].text,preset:'palpitation',version:0,active:true,
    image:null,imagePending:false,imageRecognized:false,imageError:'',ocrPending:false,ocrError:'',uncertain:[],needsReview:false,reviewed:false,
    matchPending:false,matchError:'',analysis:null,ranked:[],limit:4,
    chatDraft:'',messages:[],chatPending:false,chatError:'',chatRetry:null,doctorId:'',
    routeDoctor:null,routeEmergency:false,origin:'lobby'};
  let root=null,matchController=null,chatController=null,ocrController=null;
  let matchSerial=0,chatSerial=0,ocrSerial=0,imageSerial=0;
  const query=s=>root?.querySelector(s);
  const doctors=()=>context.getDoctors().filter(d=>d.name&&d.photo);
  const textList=value=>Array.isArray(value)?value.filter(v=>typeof v==='string'):[];
  const current=()=>state.active&&root?.isConnected;
  const imageNeedsProcessing=()=>state.imagePending||Boolean(state.image&&!state.imageRecognized);
  const caseReady=()=>!imageNeedsProcessing()&&(!state.needsReview||state.reviewed)&&!state.ocrPending;
  const canRecommend=()=>state.caseText.trim().length>=12&&state.caseText.length<=5000&&caseReady()&&!state.matchPending;
  const canChat=()=>caseReady()&&Boolean(state.caseText.trim())&&state.caseText.length<=5000&&!state.chatPending&&Boolean(state.chatDraft.trim());

  function cancelRequests() {
    matchSerial++;chatSerial++;ocrSerial++;
    matchController?.abort();chatController?.abort();ocrController?.abort();
    matchController=chatController=ocrController=null;
    state.matchPending=state.chatPending=state.ocrPending=false;
  }
  function changeCase(text,{resetReview=false}={}) {
    cancelRequests();state.version++;state.caseText=text;state.preset='';
    state.analysis=null;state.ranked=[];state.matchError='';state.limit=4;
    state.messages=[];state.chatRetry=null;state.chatError='';state.doctorId='';
    state.routeDoctor=null;state.routeEmergency=false;
    if(resetReview){state.needsReview=false;state.reviewed=false;state.uncertain=[];}
  }
  function errorText(error,fallback) {
    const message=String(error?.message||fallback);
    return /kimi|moonshot|api.?key|token|模型名称|provider/i.test(message)?fallback:message;
  }
  function updateControls() {
    const button=query('[data-guide-match]');
    if(button){button.disabled=!canRecommend();button.innerHTML=state.matchPending?'<span class="spinner"></span> 正在推荐…':`${icon('spark')}推荐医生与诊室 ${icon('arrow')}`;}
    const count=query('[data-guide-length]');if(count)count.textContent=`${state.caseText.length} / 5000`;
    const chatButton=query('[data-guide-chat-form] button[type="submit"]');if(chatButton)chatButton.disabled=!canChat();
  }
  function render(container) {
    root=container;state.active=true;
    root.innerHTML=`<div class="guide-workspace">
      <div class="guide-intro"><div><span class="guide-kicker">就诊前 · 有方向</span><h2>带着病历，找到就诊的下一步</h2><p>描述病情或识别病历，了解适合的医生、出诊时间与就诊位置。</p></div><div class="guide-mini-steps"><span><b>1</b>整理病情</span><i></i><span><b>2</b>选择医生</span><i></i><span><b>3</b>查看路线</span></div></div>
      <div class="guide-layout"><div class="guide-input-column">
        <section class="panel guide-input-panel"><div class="panel-title"><h2>${icon('file')}我的就诊资料</h2><small>患者导诊</small></div><div class="guide-card-body">
          <label class="field-label">快速填写</label><div class="guide-presets">${guidanceCases.map(p=>`<button type="button" data-guide-preset="${p.id}" class="${state.preset===p.id?'active':''}">${p.label}</button>`).join('')}</div>
          <label class="guide-upload" for="guide-image"><span class="guide-upload-icon">${icon('file')}</span><span><strong>上传病历照片</strong><small>PNG / JPG / WebP · 单张不超过 5 MB</small></span><span class="guide-upload-plus">＋</span></label><input type="file" id="guide-image" data-guide-image accept="image/png,image/jpeg,image/webp" class="guide-file-input" aria-label="上传病历图片"><div data-guide-image-state></div>
          <div class="input-group"><label class="field-label" for="guide-case">病情与就诊需求</label><textarea id="guide-case" data-guide-case maxlength="5000" placeholder="请填写年龄、症状、持续时间、已做检查和本次就诊需求，不要包含姓名、证件号、电话。">${esc(state.caseText)}</textarea><div class="case-footer"><span>请先去除身份信息</span><span data-guide-length>${state.caseText.length} / 5000</span></div></div>
          <div data-guide-review></div><button class="primary block" type="button" data-guide-match></button><p class="guide-data-note">点击推荐、识别或问答后，相关资料将发送至智能分析服务。识别文字请核对后再使用。</p>
        </div></section><div class="guide-urgent-hint">${icon('info')}<span>持续胸痛、严重呼吸困难或意识异常时，请及时寻求急诊帮助，不等待普通门诊推荐。</span></div>
      </div><div class="guide-result-column"><section data-guide-results aria-live="polite"></section><section data-guide-route></section><section class="panel guide-chat" data-guide-chat aria-label="就诊问答"></section></div></div>
    </div>`;
    root.addEventListener('click',onClick);
    root.addEventListener('input',onInput);
    root.addEventListener('change',onChange);
    root.addEventListener('submit',onSubmit);
    renderImage();renderReview();renderResults();renderRoute();renderChat();updateControls();
  }
  function renderImage() {
    const node=query('[data-guide-image-state]');if(!node)return;
    node.innerHTML=`${state.imagePending?'<p class="guide-status" role="status">正在准备图片…</p>':''}${state.image?`<div class="guide-image-preview"><img src="${state.image.dataUrl}" alt="上传的病历预览"><div><strong>${esc(state.image.name)}</strong><small>${state.imageRecognized?(state.reviewed?'已识别 · 文字已核对':'已识别 · 请核对下方文字'):'尚未识别 · 请先识别病历'}</small><button type="button" class="text-button" data-guide-remove-image ${state.ocrPending?'disabled':''}>移除图片</button></div></div><button type="button" class="secondary block" data-guide-extract ${state.ocrPending?'disabled':''}>${state.ocrPending?'<span class="spinner"></span> 正在识别病历…':`${icon('search')}${state.imageRecognized?'重新识别病历':'识别病历'}`}</button>${!state.imageRecognized?'<p class="guide-image-gate" role="status">已选择新病历。请先识别并核对文字，或移除图片后使用当前文字；此前不能推荐或问答。</p>':''}`:''}${state.imageError||state.ocrError?`<p class="guide-error" role="alert">${esc(state.imageError||state.ocrError)}</p>`:''}`;
  }
  function renderReview() {
    const node=query('[data-guide-review]');if(!node)return;
    node.innerHTML=state.needsReview?`<div class="guide-ocr-review"><strong>识别完成，请核对文字</strong>${state.uncertain.length?`<p>需留意：${esc(state.uncertain.join('；'))}</p>`:'<p>请重点核对检查数值、日期和医学术语。</p>'}<label><input type="checkbox" data-guide-reviewed ${state.reviewed?'checked':''}>我已核对并修正识别文字</label></div>`:'';
  }
  function renderResults() {
    const node=query('[data-guide-results]');if(!node)return;
    node.setAttribute('aria-busy',String(state.matchPending));
    const title='<div class="guide-section-heading"><h2>适合您的就诊方向</h2><span>医生与诊室</span></div>';
    if(state.matchPending){node.innerHTML=title+'<div class="guide-empty"><span class="spinner"></span><h3>正在整理病情与就诊方向</h3><p>结合医生公开专长，筛选合适的门诊选择。</p></div>';return;}
    if(state.matchError){node.innerHTML=title+`<div class="guide-empty guide-error-box" role="alert">${icon('info')}<h3>暂未完成推荐</h3><p>${esc(state.matchError)}</p><button type="button" class="primary" data-guide-retry-match>重新推荐</button></div>`;return;}
    if(!state.analysis){node.innerHTML=title+`<div class="guide-empty guide-start"><div class="guide-empty-symbol">${icon('hospital')}</div><h3>先说说您的就诊需要</h3><p>整理左侧病情资料后，点击“推荐医生与诊室”。<br>选择医生，还可以查看出诊时间和院内路线。</p><div class="guide-empty-pills"><span>专业方向</span><span>医生排班</span><span>就诊指引</span></div></div>`;return;}
    if(state.analysis.urgent){node.innerHTML=title+`<div class="guide-emergency" role="alert"><span class="guide-emergency-badge">优先处理 · 急诊</span><h3>目前需要优先寻求急诊评估</h3><p>${esc(state.analysis.summary)}</p><p>请立即联系现场医务人员或急诊服务；不要等待普通门诊排班。线上推荐不能确认当前接诊能力。</p><button type="button" class="primary" data-guide-emergency>查看急诊与人工服务指引 ${icon('arrow')}</button></div>`;return;}
    node.innerHTML=title+`<div class="guide-summary"><span class="guide-kicker">${esc(state.analysis.categoryLabel||'就诊建议')}</span><h3>${esc(state.analysis.valid?'先了解这些专科方向':'还需要补充一些信息')}</h3><p>${esc(state.analysis.summary)}</p>${state.analysis.missing?.length?`<small>建议补充：${esc(state.analysis.missing.join('、'))}</small>`:''}</div>${state.ranked.length?`<div class="guide-doctor-list">${state.ranked.slice(0,state.limit).map(d=>`<article class="guide-doctor-card"><div class="guide-doctor-top">${photo(d)}<div><h3>${esc(d.name)}<small>${esc(d.title)}</small></h3><p>${esc(d.department)}</p></div><div class="guide-score"><strong>${d.score}<small>分</small></strong><span>匹配参考</span></div></div><p class="guide-doctor-bio">${esc(d.bio)}</p><p class="guide-doctor-reason">${icon('check')}<span>${esc(d.reasons[0]||'可进一步核实此方向的门诊接诊需求。')}</span></p><div class="guide-doctor-bottom"><span>${esc(roomFor(d).clinic)} · 位置待院方确认</span><button type="button" class="text-button" data-guide-detail="${esc(d.id)}">查看医生与出诊时间 ${icon('arrow')}</button></div></article>`).join('')}</div>${state.ranked.length>state.limit?'<button type="button" class="secondary block guide-show-more" data-guide-more>查看其他推荐医生</button>':''}`:`<div class="guide-empty"><h3>暂无可依据现有资料推荐的医生</h3><p>可补充症状、检查和就诊目的，或前往人工服务台咨询。</p><button type="button" class="secondary" data-guide-service>查看人工服务指引</button></div>`}<p class="guide-data-note">匹配分帮助比较专业方向，不代表诊断结论或医生水平；实际接诊及挂号安排需向院方确认。</p>`;
  }
  function roomFor(doctor) {
    const text=`${doctor?.department||''} ${(doctor?.expertise||[]).join(' ')} ${(doctor?.profile?.officialClinics||[]).join(' ')}`;
    if(/康复/.test(text))return {clinic:'心脏康复门诊',floor:'门诊楼 2 层',room:'康复评估区',wing:'康复评估区',stop:2};
    if(/外科/.test(doctor?.department||''))return {clinic:doctor.department,floor:'门诊楼 3 层',room:'外科候诊区',wing:'外科候诊区',stop:3};
    return {clinic:doctor?.department||'心血管内科',floor:'门诊楼 2 层',room:/心律失常|房颤/.test(text)?'心律失常门诊区':'心血管内科门诊区',wing:'专科候诊区',stop:2};
  }
  function openDoctor(id) {
    const d=state.ranked.find(item=>item.id===id);if(!d||!state.analysis||state.analysis.urgent)return;
    const room=roomFor(d);
    context.openModal(`<div class="detail-top guide-detail-top">${photo(d,true)}<div><span class="guide-kicker">医生详情 · 出诊安排</span><h2>${esc(d.name)}<span>${esc(d.title)}</span></h2><p>北京安贞医院安徽医院 · ${esc(d.department)}</p><div class="tags">${(d.expertise||[]).slice(0,4).map(t=>`<span class="tag">${esc(t)}</span>`).join('')}</div></div><div class="guide-score"><strong>${d.score}<small>分</small></strong><span>匹配参考</span></div></div><div class="guide-detail-body"><div class="guide-detail-profile"><h3>医生简介</h3><p>${esc(d.bio)}</p><h3>与本次就诊的关联</h3>${d.reasons.map(r=>`<p class="guide-detail-reason">${icon('check')}<span>${esc(r)}</span></p>`).join('')}<div class="guide-room-note"><strong>建议就诊方向</strong><span>${esc(room.clinic)}</span><small>具体诊室和院内位置请以院方当日安排为准</small></div></div><div class="guide-detail-schedule"><h3>近期出诊时间</h3><p>可先查看工作时间，再联系院方确认挂号与接诊安排。</p>${context.renderSchedule(d.id)}</div></div><div class="modal-footer"><p><b>${esc(room.clinic)}</b><br>查看路线不会创建预约</p><button type="button" class="primary" data-guide-route-doctor="${esc(d.id)}">查看就诊路线 ${icon('arrow')}</button></div>`,'导诊医生详情');
    document.querySelector('[data-guide-route-doctor]')?.addEventListener('click',()=>{state.routeDoctor=d;state.routeEmergency=false;setChatDoctor(d.id);context.closeModal();renderRoute();renderChat();query('[data-guide-route]')?.scrollIntoView({behavior:'smooth',block:'start'});});
  }
  function routeData() {
    if(state.routeEmergency)return {clinic:'急诊 / 人工服务',floor:'急诊接诊区域',room:'急诊分诊台',steps:['立即联系现场医务人员，说明症状及所在位置。','由工作人员指引至急诊分诊台；不适明显时请勿独自步行。','向急诊人员出示病历和检查资料，等候现场评估。']};
    const room=state.routeDoctor?roomFor(state.routeDoctor):{clinic:'人工服务',floor:'门诊楼 1 层',room:'综合服务台',stop:1};
    const start=state.origin==='service'?'从综合服务台出发':'从门诊大厅出发';
    return {...room,steps:state.routeDoctor?[`${start}，先向工作人员确认今日科室位置及是否需要挂号。`,`按院内标识前往电梯厅，至${room.floor}，寻找${room.wing}。`,`到分诊台出示挂号或就诊资料，确认${state.routeDoctor.name}医生的当日诊室和候诊安排。`]:[`${start}，寻找“综合服务 / 导诊”标识。`,'向工作人员说明主要症状，出示已整理的病情摘要。','请工作人员协助确认科室、诊室位置及挂号方式。']};
  }
  function renderRoute() {
    const node=query('[data-guide-route]');if(!node)return;
    if(!state.routeDoctor&&!state.routeEmergency&&!state.showService){node.innerHTML='';return;}
    const route=routeData();
    node.innerHTML=`<section class="guide-route-card" aria-label="就诊路线"><div class="guide-route-heading"><div><span class="guide-kicker">下一站 · ${state.routeEmergency?'急诊评估':'到院就诊'}</span><h2>${esc(route.clinic)}</h2><p>${state.routeDoctor?`${esc(state.routeDoctor.name)}医生 · `:''}${esc(route.room)}</p></div>${icon('hospital')}</div><label for="guide-origin" class="field-label">我现在的位置</label><select id="guide-origin" data-guide-origin><option value="lobby" ${state.origin==='lobby'?'selected':''}>门诊大厅</option><option value="service" ${state.origin==='service'?'selected':''}>综合服务台</option></select><div class="guide-map" aria-label="院区路线示意"><div class="guide-map-node start">${icon('user')}<span>${state.origin==='service'?'综合服务台':'门诊大厅'}</span><small>您在这里</small></div><div class="guide-map-link">${icon('arrow')}</div><div class="guide-map-node middle">${icon('hospital')}<span>${state.routeEmergency?'工作人员引导':'院内指引'}</span><small>${state.routeEmergency?'优先分诊':esc(route.floor)}</small></div><div class="guide-map-link">${icon('arrow')}</div><div class="guide-map-node end">${icon('check')}<span>${esc(route.room)}</span><small>向分诊人员确认</small></div></div><ol class="guide-route-steps">${route.steps.map((step,i)=>`<li><b>${i+1}</b><span>${esc(step)}</span></li>`).join('')}</ol><p class="guide-map-note">路线为院区示意，实际位置请以院内标识为准。楼层、区域均为预置指引，尚未对接院方导航。</p><div class="guide-route-actions"><button type="button" class="secondary" data-guide-prepare>查看就诊准备</button>${state.routeDoctor?`<button type="button" class="text-button" data-guide-detail="${esc(state.routeDoctor.id)}">再次查看出诊时间</button>`:''}</div></section>`;
  }
  function renderChat() {
    const node=query('[data-guide-chat]');if(!node)return;
    node.innerHTML=`<div class="panel-title"><h2>${icon('spark')}就诊问答</h2><small>围绕当前病情</small></div><div class="guide-card-body"><p class="guide-chat-intro">可询问就诊资料、医生专长与准备事项。修改病情后将开始新的问答。</p><label class="field-label" for="guide-chat-doctor">咨询对象</label><select id="guide-chat-doctor" data-guide-chat-doctor><option value="">当前病情与就诊准备</option>${doctors().map(d=>`<option value="${esc(d.id)}" ${state.doctorId===d.id?'selected':''}>${esc(d.name)} · ${esc(d.department)}</option>`).join('')}</select><div class="guide-chat-messages" aria-live="polite" aria-busy="${state.chatPending}">${state.messages.length?state.messages.map(m=>`<div class="guide-chat-message ${m.role==='user'?'from-user':''}"><strong>${m.role==='user'?'我':'就诊助手'}</strong><p>${esc(m.content)}</p></div>`).join(''):'<p class="guide-chat-placeholder">例如：这次就诊应该带上哪些检查报告？</p>'}${state.chatPending?'<div class="guide-status"><span class="spinner"></span>正在整理回答…</div>':''}</div>${state.chatError?`<div class="guide-error-box" role="alert"><p>${esc(state.chatError)}</p><button type="button" class="secondary" data-guide-retry-chat>重试问题</button></div>`:''}<form data-guide-chat-form><label class="field-label" for="guide-question">我想咨询</label><textarea id="guide-question" data-guide-question maxlength="1200" rows="3" placeholder="输入就诊相关问题，不要填写身份信息" ${state.chatPending?'disabled':''}>${esc(state.chatDraft)}</textarea><div class="guide-chat-actions"><small>回答用于就诊准备，实际诊疗请由医生评估。</small><button class="primary" type="submit" ${!canChat()?'disabled':''}>${state.chatPending?'正在回答…':'发送问题'} ${icon('arrow')}</button></div></form></div>`;
    const messages=node.querySelector('.guide-chat-messages');if(messages)messages.scrollTop=messages.scrollHeight;
  }
  async function recommend() {
    if(!canRecommend()){context.toast(imageNeedsProcessing()?'请先识别并核对新病历，或移除图片后再推荐。':state.needsReview&&!state.reviewed?'请先核对识别文字。':'请填写至少 12 字的具体病情与就诊需求。');return;}
    const serial=++matchSerial,version=state.version;const controller=new AbortController();matchController=controller;
    state.matchPending=true;state.matchError='';state.analysis=null;state.ranked=[];state.routeDoctor=null;state.routeEmergency=false;state.showService=false;
    renderResults();renderRoute();updateControls();
    try {
      const result=await api('/api/match',{caseText:state.caseText},controller.signal);
      if(serial!==matchSerial||version!==state.version||controller.signal.aborted||!current())return;
      const a=result?.analysis;if(!a||typeof a.valid!=='boolean'||typeof a.urgent!=='boolean'||!Array.isArray(result.ranked))throw Error('推荐结果暂不完整，请重试。');
      const byId=new Map(doctors().map(d=>[d.id,d])),seen=new Set();
      state.ranked=result.ranked.flatMap(item=>{const doctor=byId.get(item?.id);if(!doctor||seen.has(item.id)||!Number.isFinite(item.score))return [];seen.add(item.id);return [{...doctor,score:Math.max(0,Math.min(100,Math.round(item.score))),reasons:textList(item.reasons)}];});
      state.analysis={valid:a.valid,urgent:a.urgent,categoryLabel:String(a.categoryLabel||''),summary:String(a.summary||''),missing:textList(a.missing)};
      if(!a.valid)state.ranked=[];
    } catch(error) {if(serial===matchSerial&&!controller.signal.aborted)state.matchError=errorText(error,'智能推荐暂不可用，请稍后重试。');}
    finally{if(serial===matchSerial){state.matchPending=false;matchController=null;if(current()){renderResults();updateControls();}}}
  }
  async function prepareImage(file) {
    if(!file)return;const serial=++imageSerial;changeCase(state.caseText,{resetReview:true});state.showService=false;state.ocrError='';state.imageError='';state.image=null;state.imageRecognized=false;state.imagePending=false;
    renderReview();renderResults();renderRoute();renderChat();
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)){state.imageError='请选择 PNG、JPG 或 WebP 图片。';renderImage();updateControls();return;}
    if(file.size>5*1024*1024){state.imageError='图片不能超过 5 MB，请压缩后重新上传。';renderImage();updateControls();return;}
    state.imagePending=true;renderImage();updateControls();
    try {
      const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('图片无法读取，请重新选择。'));reader.readAsDataURL(file);});
      const image=await new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(Error('图片格式损坏或无法打开。'));image.src=dataUrl;});
      const scale=Math.min(1,1600/Math.max(image.width,image.height));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));const ctx=canvas.getContext('2d');if(!ctx)throw Error('无法处理此图片，请尝试其他图片。');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
      const prepared=canvas.toDataURL('image/jpeg',0.85);
      if(Math.ceil((prepared.split(',')[1]?.length||0)*3/4)>3*1024*1024)throw Error('图片压缩后仍过大，请裁去无关区域或降低分辨率后重试。');
      if(serial===imageSerial)state.image={name:file.name,dataUrl:prepared};
    }catch(error){if(serial===imageSerial)state.imageError=errorText(error,'图片处理失败，请重试。');}
    finally{if(serial===imageSerial){state.imagePending=false;if(current()){const input=query('[data-guide-image]');if(input)input.value='';renderImage();updateControls();}}}
  }
  async function extract() {
    if(!state.image||state.ocrPending)return;
    changeCase(state.caseText,{resetReview:true});state.imageRecognized=false;state.showService=false;renderReview();renderResults();renderRoute();renderChat();
    const serial=++ocrSerial,version=state.version;const controller=new AbortController();ocrController=controller;state.ocrPending=true;state.ocrError='';renderImage();updateControls();
    try {
      const result=await api('/api/record-extract',{imageDataUrl:state.image.dataUrl},controller.signal);
      if(serial!==ocrSerial||version!==state.version||controller.signal.aborted||!current())return;
      if(typeof result?.text!=='string'||!result.text.trim())throw Error('未识别到可用文字，请换一张清晰图片或直接输入。');
      const text=result.text.trim();changeCase(text,{resetReview:true});state.imageRecognized=true;state.uncertain=textList(result.uncertain);if(text.length>5000)state.uncertain.push('识别原文超过 5000 字，已完整保留；请精简为病情摘要后再推荐或问答。');state.needsReview=true;state.reviewed=false;query('[data-guide-case]').value=state.caseText;renderReview();renderResults();renderRoute();renderChat();context.toast('识别文字已填入，请核对并修正。');
    }catch(error){if(serial===ocrSerial&&!controller.signal.aborted)state.ocrError=errorText(error,'病历识别暂不可用，请稍后重试或手动填写。');}
    finally{if(serial===ocrSerial||!state.ocrPending){state.ocrPending=false;ocrController=null;if(current()){renderImage();updateControls();}}}
  }
  function chatHistory() {
    const messages=state.messages.slice(-12).map(m=>({role:m.role,content:m.content.slice(0,2000)}));
    while(messages.length>1&&(messages[0].role==='assistant'||messages.reduce((n,m)=>n+m.content.length,0)>16000))messages.shift();
    return messages;
  }
  async function sendChat(retry=false) {
    if(state.chatPending||!state.caseText.trim())return;
    if(imageNeedsProcessing()){context.toast('请先识别并核对新病历，或移除图片后再问答。');return;}
    if(state.caseText.length>5000){context.toast('请先将病情摘要整理为 5000 字以内。');return;}
    if(state.needsReview&&!state.reviewed){context.toast('请先核对病历识别文字，再开始问答。');return;}
    const question=state.chatDraft.trim();if(!retry&&!question)return;if(retry&&!state.chatRetry)return;
    if(!retry){state.messages.push({role:'user',content:question});state.chatDraft='';}
    const messages=retry?state.chatRetry:chatHistory(),serial=++chatSerial,version=state.version,doctorId=state.doctorId;const controller=new AbortController();chatController=controller;state.chatPending=true;state.chatError='';state.chatRetry=null;renderChat();
    try{const result=await api('/api/chat',{caseText:state.caseText,messages,...(doctorId?{doctorId}:{})},controller.signal);if(serial!==chatSerial||version!==state.version||controller.signal.aborted||!current())return;if(typeof result?.answer!=='string'||!result.answer.trim())throw Error('暂未获得有效回答，请重试。');state.messages.push({role:'assistant',content:result.answer});}
    catch(error){if(serial===chatSerial&&!controller.signal.aborted){state.chatError=errorText(error,'就诊问答暂不可用，请稍后重试。');state.chatRetry=messages;}}
    finally{if(serial===chatSerial){state.chatPending=false;chatController=null;if(current())renderChat();}}
  }
  function onClick(event) {
    const target=event.target.closest('button');if(!target||!root.contains(target))return;
    if(target.hasAttribute('data-guide-preset')){const p=guidanceCases.find(item=>item.id===target.dataset.guidePreset);if(!p)return;changeCase(p.text,{resetReview:true});state.imageRecognized=false;state.preset=p.id;state.showService=false;state.ocrError='';render(root);}
    else if(target.hasAttribute('data-guide-match')||target.hasAttribute('data-guide-retry-match'))void recommend();
    else if(target.hasAttribute('data-guide-extract'))void extract();
    else if(target.hasAttribute('data-guide-remove-image')){imageSerial++;ocrSerial++;ocrController?.abort();state.image=null;state.imageRecognized=false;state.imageError='';state.ocrError='';state.ocrPending=false;const input=query('[data-guide-image]');if(input)input.value='';renderImage();updateControls();}
    else if(target.hasAttribute('data-guide-detail'))openDoctor(target.dataset.guideDetail);
    else if(target.hasAttribute('data-guide-more')){state.limit+=4;renderResults();}
    else if(target.hasAttribute('data-guide-emergency')){state.routeEmergency=true;state.routeDoctor=null;renderRoute();query('[data-guide-route]')?.scrollIntoView({behavior:'smooth',block:'start'});}
    else if(target.hasAttribute('data-guide-service')){state.showService=true;state.routeEmergency=false;state.routeDoctor=null;renderRoute();}
    else if(target.hasAttribute('data-guide-retry-chat'))void sendChat(true);
    else if(target.hasAttribute('data-guide-prepare')){context.openModal(`<div class="modal-title-bar"><small>到院前 · 资料准备</small><h2>就诊准备清单</h2></div><div class="guide-preparation"><p>建议携带已有的病历、出院小结、近期检查报告，以及当前用药清单和过敏史记录。</p><ul><li>整理主要症状、开始时间、变化过程和本次想解决的问题。</li><li>就诊前核实科室位置、当日出诊安排及是否需要挂号。</li><li>是否空腹、停药或做其他准备，请向接诊科室确认；勿自行调整治疗。</li></ul></div><div class="modal-footer"><p>最终安排以院方通知为准</p><button type="button" class="primary" data-guide-close>我已了解</button></div>`,'就诊准备清单');document.querySelector('[data-guide-close]')?.addEventListener('click',context.closeModal);}
  }
  function setChatDoctor(doctorId) {
    if(state.doctorId===doctorId)return;
    chatSerial++;chatController?.abort();state.chatPending=false;state.doctorId=doctorId;state.messages=[];state.chatError='';state.chatRetry=null;
  }
  function onInput(event) {
    const target=event.target;
    if(target.matches('[data-guide-case]')){changeCase(target.value);state.showService=false;renderResults();renderRoute();renderChat();renderImage();updateControls();root.querySelectorAll('[data-guide-preset]').forEach(button=>button.classList.remove('active'));}
    if(target.matches('[data-guide-question]')){state.chatDraft=target.value;const button=query('[data-guide-chat-form] button[type="submit"]');if(button)button.disabled=!canChat();}
  }
  function onChange(event) {
    const target=event.target;
    if(target.matches('[data-guide-image]'))void prepareImage(target.files?.[0]);
    else if(target.matches('[data-guide-reviewed]')){state.reviewed=target.checked;renderImage();updateControls();}
    else if(target.matches('[data-guide-origin]')){state.origin=target.value;renderRoute();}
    else if(target.matches('[data-guide-chat-doctor]')){setChatDoctor(target.value);renderChat();}
  }
  function onSubmit(event) {if(event.target.matches('[data-guide-chat-form]')){event.preventDefault();void sendChat();}}
  return {render,onLeave(){state.active=false;cancelRequests();imageSerial++;state.imagePending=false;root?.removeEventListener('click',onClick);root?.removeEventListener('input',onInput);root?.removeEventListener('change',onChange);root?.removeEventListener('submit',onSubmit);}};
}
