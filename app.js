/* SZLYANA — local-first study tools with optional Netlify AI study-package generation. */
(() => {
"use strict";
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const DB_NAME="szlyana-db", DB_VERSION=1;
let db, ocrWorkerPromise=null, state={materials:[],cards:[],subjects:[],sessions:[],quizzes:[],reviewers:[],goal:120};
let deck=[],deckIndex=0,quiz=null,lastQuizExport=null,quizIndex=0,quizTimer=null,reviewDraft=null,progressHideTimer=null;
const subjectCatalog={
 MEDTECH:["CC","CD","AUBF","HEMA","HISTO","PARA","BACTE"],
 IT:["NETW","SEPC","HCIN","SFCR","ITPM","ITPC","IAAS"]
};
const defaultSubjects=[
 ...subjectCatalog.MEDTECH.map(name=>({name,group:"MEDTECH"})),
 ...subjectCatalog.IT.map(name=>({name,group:"IT"}))
];
function categoryForSubject(subject){return subjectCatalog.MEDTECH.includes(subject)?"MEDTECH":subjectCatalog.IT.includes(subject)?"IT":"";}
function fillSubjectOptions(category,select,placeholder="Choose a subject…"){
 if(!select)return;
 const list=subjectCatalog[category]||[];
 select.innerHTML=`<option value="">${placeholder}</option>`+list.map(x=>`<option value="${x}">${x}</option>`).join("");
 select.disabled=!list.length;
}
const uid=()=>Math.random().toString(36).slice(2)+Date.now().toString(36);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
// One canonical source is cleaned once at import/edit time and reused by every study tool.
function cleanStudyText(input){
 let text=String(input??"").normalize("NFC").replace(/\r\n?/g,"\n").replace(/\u0000/g,"")
  .replace(/[\uFFFD\u0001-\u0008\u000B\u000C\u000E-\u001F]/g,"")
  .replace(/[ \t]+$/gm,"").replace(/[ \t]{2,}/g," ");
 const kept=[];
 for(const raw of text.split("\n")){
  const line=raw.trim();
  if(!line){if(kept.length&&kept[kept.length-1]!=="")kept.push("");continue;}
  if(/^[-–—_·•.]{3,}$/.test(line)||/^(?:page\s*)?\d+\s*(?:of\s*\d+)?$/i.test(line)||/^---\s*page\s+\d+\s*---$/i.test(line))continue;
  const meaningful=(line.match(/[A-Za-z0-9]/g)||[]).length;
  if(line.length>8&&meaningful/line.length<0.22)continue;
  if(/(?:�{1,}|(?:undefined|null|NaN)){2,}/i.test(line))continue;
  kept.push(line);
 }
 return kept.join("\n").replace(/\n{3,}/g,"\n\n").trim();
}
function validateStudyText(text){
 const t=String(text||"").trim(),words=(t.match(/\b[\p{L}\p{N}]+\b/gu)||[]).length;
 const chars=(t.match(/[A-Za-z0-9]/g)||[]).length;
 if(t.length<40||words<6||chars/Math.max(1,t.length)<0.28)
  throw Error("The extracted content is incomplete or too corrupted to use safely. Check the original file or paste a clearer copy.");
 const lines=t.split("\n").filter(x=>x.trim());
 const garbage=lines.filter(x=>x.length>12&&(x.match(/[A-Za-z0-9]/g)||[]).length/x.length<0.2).length;
 if(lines.length&&garbage/lines.length>0.2)
  throw Error("Too much corrupted text was detected. This material was rejected instead of generating unreliable study content.");
 return true;
}
function openDB(){return new Promise((resolve,reject)=>{const r=indexedDB.open(DB_NAME,DB_VERSION);r.onupgradeneeded=()=>{const d=r.result;["materials","cards","subjects","sessions","quizzes","reviewers","settings"].forEach(n=>{if(!d.objectStoreNames.contains(n))d.createObjectStore(n,{keyPath:"id"});});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function all(store){return new Promise((res,rej)=>{const r=db.transaction(store).objectStore(store).getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});}
function put(store,obj){return new Promise((res,rej)=>{const r=db.transaction(store,"readwrite").objectStore(store).put(obj);r.onsuccess=()=>res(obj);r.onerror=()=>rej(r.error);});}
function del(store,id){return new Promise((res,rej)=>{const r=db.transaction(store,"readwrite").objectStore(store).delete(id);r.onsuccess=()=>res();r.onerror=()=>rej(r.error);});}
async function refresh(){
 for(const k of ["materials","cards","subjects","sessions","quizzes","reviewers"])state[k]=await all(k);
 for(const m of state.materials){
  const cleaned=cleanStudyText(m.text);
  if(cleaned!==m.text)m.text=cleaned;
  m.sourceText=m.text;
  // Normalize metadata without guessing a subject for legacy unclassified files.
  if(!m.category&&categoryForSubject(m.subject))m.category=categoryForSubject(m.subject);
  if(!categoryForSubject(m.subject)){m.subject="";m.category="";}
  await put("materials",m);
 }
 state.materials=await all("materials");
 for(const card of state.cards){const material=state.materials.find(m=>m.id===card.materialId);if(material){card.category=material.category||"";card.subject=material.subject||"";await put("cards",card);}}
 const g=await all("settings");state.goal=g.find(x=>x.id==="goal")?.value||120;
 const savedByName=new Map(state.subjects.map(x=>[x.name,x]));
 state.subjects=defaultSubjects.map(item=>({...savedByName.get(item.name),id:savedByName.get(item.name)?.id||uid(),...item}));
 for(const item of state.subjects)await put("subjects",item);
 for(const old of (await all("subjects")).filter(x=>!defaultSubjects.some(d=>d.name===x.name)))await del("subjects",old.id);
 renderAll();
}
function toast(msg){const el=$("#toast");el.textContent=msg;el.classList.add("show");setTimeout(()=>el.classList.remove("show"),2600);}
function showPage(name){$$(".page").forEach(p=>p.classList.toggle("active",p.id==="page-"+name));$$(".nav-link[data-page]").forEach(b=>b.classList.toggle("active",b.dataset.page===name));$("#pageName").textContent=name.replace(/^\w/,c=>c.toUpperCase()).replace("Quizzes","Quiz & mock exam");$("#sidebar").classList.remove("open");if(name==="dashboard")renderDashboard();}
function go(name){showPage(name);}
document.addEventListener("click",e=>{const nav=e.target.closest("[data-page]");if(nav){e.preventDefault();go(nav.dataset.page);}const g=e.target.closest("[data-go]");if(g)go(g.dataset.go);});
$("#menuToggle").addEventListener("click",()=>$("#sidebar").classList.toggle("open"));
function applyTheme(theme){document.documentElement.dataset.theme=theme;localStorage.setItem("szlyana-theme",theme);const dark=theme==="dark";const label=dark?"Switch to light mode":"Switch to dark mode";$("#themeToggle").innerHTML=`<span>${dark?"☀":"☾"}</span> ${label}`;$("#themeToggle").setAttribute("aria-pressed",String(dark));const top=$("#themeToggleTop");if(top){top.innerHTML=`${dark?"☀":"☾"} <span>${dark?"Light mode":"Dark mode"}</span>`;top.setAttribute("aria-label",label);top.setAttribute("aria-pressed",String(dark));top.title=label;}}
function toggleTheme(){applyTheme(document.documentElement.dataset.theme==="dark"?"light":"dark");}
$("#themeToggle").addEventListener("click",toggleTheme);
$("#themeToggleTop").addEventListener("click",toggleTheme);
applyTheme(localStorage.getItem("szlyana-theme")==="dark"?"dark":"light");
$("#todayLabel").textContent=new Date().toLocaleDateString(undefined,{weekday:"short",month:"short",day:"numeric",year:"numeric"});
function renderAll(){renderDashboard();renderLibrary();renderSelects();renderFlash();renderHistory();renderPlanner();renderSubjects();}
function renderDashboard(){if(!db)return;$("#statMaterials").textContent=state.materials.length;$("#statCards").textContent=state.cards.length;$("#statQuizzes").textContent=state.quizzes.length;$("#statSessions").textContent=state.sessions.filter(s=>s.done).length;const done=state.sessions.filter(s=>s.done).length,pending=state.sessions.length-done,pct=state.sessions.length?Math.round(done/state.sessions.length*100):0;$("#progressPercent").textContent=pct+"%";$("#progressRing").style.background=`conic-gradient(var(--purple) ${pct*3.6}deg,var(--line) ${pct*3.6}deg)`;$("#completedCount").textContent=done;$("#pendingCount").textContent=pending;$("#quizCount").textContent=state.quizzes.length;const recent=[...state.materials].sort((a,b)=>b.created-a.created).slice(0,3);$("#recentMaterials").innerHTML=recent.length?recent.map(m=>`<div class="history-row"><b>${esc(m.name)}</b><span>${new Date(m.created).toLocaleDateString()}</span></div>`).join(""):`<div class="empty-state compact"><span>✧</span><b>Your library is waiting</b><p>Upload notes or paste text to get started.</p></div>`;const up=state.sessions.filter(s=>!s.done&&s.date>=new Date().toISOString().slice(0,10)).sort((a,b)=>a.date.localeCompare(b.date)).slice(0,3);$("#upcomingSessions").innerHTML=up.length?up.map(sessionHTML).join(""):`<div class="empty-state compact"><span>♡</span><b>No sessions yet</b><p>Add a study session to your planner.</p></div>`;}
function renderLibrary(){const q=$("#materialSearch").value.toLowerCase(),sub=$("#subjectFilter").value;const list=state.materials.filter(m=>(!q||(m.name+" "+m.text).toLowerCase().includes(q))&&(!sub||m.subject===sub));$("#materialCount").textContent=list.length+" materials";$("#materialGrid").innerHTML=list.length?list.map(m=>`<article class="material-card"><div class="file-icon">${fileEmoji(m.type)}</div><h3 title="${esc(m.name)}">${esc(m.name)}</h3><p>${esc(m.category||"Unassigned")} / ${esc(m.subject||"Unassigned")} · ${wordCount(m.text).toLocaleString()} words</p><div class="card-actions"><button class="mini-btn" data-action="view" data-id="${m.id}">Preview</button><button class="mini-btn" data-action="cards" data-id="${m.id}">Make cards</button><button class="mini-btn" data-action="rename" data-id="${m.id}">Rename</button><button class="mini-btn" data-action="delete" data-id="${m.id}">Delete</button></div></article>`).join(""):`<div class="empty-state"><span>▤</span><b>No matching materials</b><p>Try another search or add a study document.</p></div>`;}
function fileEmoji(t){return ({pdf:"▧",docx:"▤",pptx:"▣",txt:"≡",csv:"▦",xlsx:"▦",image:"▧"})[t]||"▤";}
function renderSelects(){const opts=state.materials.map(m=>`<option value="${m.id}">${esc(m.name)}</option>`).join("");["flashMaterial","quizMaterial","reviewMaterial"].forEach(id=>{const el=$("#"+id),v=el.value;el.innerHTML='<option value="">Choose a material…</option>'+opts;el.value=v;});const sub=$("#subjectFilter"),sv=sub.value;sub.innerHTML='<option value="">All subjects</option>'+state.subjects.map(s=>`<option value="${esc(s.name)}">${esc(s.name)}</option>`).join("");sub.value=sv;}
function renderFlash(){const diff=state.cards.filter(c=>c.difficult).length;$("#difficultCount").textContent=diff;if(!deck.length){$("#flashcardStage").innerHTML=`<div class="empty-state"><span>▣</span><b>Your next "I got it!" moment starts here</b><p>Generate flashcards from your library or create one manually.</p><button class="btn btn-outline" data-go="library">Open study library</button></div>`;$("#cardPosition").textContent="0 / 0";return;}const c=deck[deckIndex];$("#deckMeta").textContent=c.sourceName||"Personal flashcard deck";$("#cardPosition").textContent=`${deckIndex+1} / ${deck.length}`;$("#flashcardStage").innerHTML=`<div class="flashcard" id="activeFlash"><div class="flashcard-inner"><div class="flash-face front"><small>QUESTION</small><strong>${esc(c.question)}</strong></div><div class="flash-face back"><small>ANSWER</small><strong>${esc(c.answer)}</strong></div></div></div>`;$("#activeFlash").addEventListener("click",e=>e.currentTarget.classList.toggle("flipped"));}
function renderHistory(){const list=[...state.quizzes].sort((a,b)=>b.created-a.created);$("#quizHistory").innerHTML=list.length?list.slice(0,8).map(q=>`<div class="history-row"><b>${esc(q.title||"Practice test")}</b><span>${q.score}/${q.total} · ${new Date(q.created).toLocaleDateString()}</span></div>`).join(""):`<div class="empty-state compact"><span>◷</span><b>No attempts yet</b><p>Your results will appear here.</p></div>`;}
function sessionHTML(s){const d=new Date(s.date+"T00:00:00");return `<div class="session-row"><div class="session-date">${d.getDate()}<small>${d.toLocaleDateString(undefined,{month:"short"}).toUpperCase()}</small></div><div class="session-info"><b>${esc(s.title)}</b><small>${esc(s.subject||"Independent study")} · ${s.minutes} min ${s.done?"· Completed":""}</small></div><button title="Mark complete" data-session-done="${s.id}">${s.done?"✓":"○"}</button><button title="Delete" data-session-delete="${s.id}">×</button></div>`;}
function renderPlanner(){const sorted=[...state.sessions].sort((a,b)=>a.date.localeCompare(b.date));$("#sessionList").innerHTML=sorted.length?sorted.map(sessionHTML).join(""):`<div class="empty-state"><span>▦</span><b>Your planner is clear</b><p>Add your first study session.</p></div>`;$("#dailyGoal").value=state.goal;const today=new Date().toISOString().slice(0,10),mins=state.sessions.filter(s=>s.done&&s.date===today).reduce((n,s)=>n+Number(s.minutes),0);$("#goalMinutes").textContent=mins;$("#goalTarget").textContent=state.goal;$("#goalBar").style.width=Math.min(100,mins/state.goal*100)+"%";}
function renderSubjects(){const groups=["MEDTECH","IT"];const buckets={MEDTECH:[],IT:[]};state.subjects.forEach(s=>{if(buckets[s.group])buckets[s.group].push(s);});$("#subjectGrid").innerHTML=groups.map(g=>`<div class="subject-group-title">${g}</div>${buckets[g].map(s=>{const count=state.materials.filter(m=>m.subject===s.name).length;return `<article class="subject-card"><div class="subject-top"><span class="subject-emoji">${g==="MEDTECH"?"🧪":"💻"}</span></div><h3>${esc(s.name)}</h3><p>${count} study materials</p></article>`;}).join("")}`).join("");}
function wordCount(t){return (t.trim().match(/\S+/g)||[]).length;}
async function requestStudyPackage(material,force=false){
 const reviewFormat=$("#reviewFormat")?.value||"detailed";
 if(material.studyPackage&&!force&&material.studyPackage.reviewFormat===reviewFormat)return material.studyPackage;
 const response=await fetch("/.netlify/functions/generate-study-package",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sourceText:material.sourceText||material.text,sourceName:material.name,category:material.category,subject:material.subject,reviewFormat})});
 let payload={};try{payload=await response.json();}catch{}
 if(!response.ok||!payload.ok||!payload.package)throw Error(payload.error||"The AI study-package service is unavailable.");
 material.studyPackage=payload.package;material.studyPackageGeneratedAt=Date.now();await put("materials",material);return payload.package;
}
async function persistPackageFlashcards(material,pkg){
 const existing=state.cards.filter(c=>c.materialId===material.id),known=new Set(existing.map(c=>cardKey(c.question)+"::"+cardKey(c.answer)));let added=0;
 for(const card of (pkg.flashcards||[])){const question=String(card.front||"").trim(),answer=String(card.back||"").trim(),key=cardKey(question)+"::"+cardKey(answer);if(question&&answer&&!known.has(key)){known.add(key);await put("cards",{id:uid(),question,answer,materialId:material.id,sourceName:material.name,category:material.category,subject:material.subject,difficult:false,known:false,generated:true});added++;}}
 return added;
}
function downloadTextFile(filename,content){const blob=new Blob([content],{type:"text/plain;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$("#materialSearch").addEventListener("input",renderLibrary);$("#subjectFilter").addEventListener("change",renderLibrary);
const drop=$("#dropZone"),fileInput=$("#fileInput"),uploadCategory=$("#uploadCategory"),uploadSubject=$("#uploadSubject");
uploadCategory.addEventListener("change",()=>{fillSubjectOptions(uploadCategory.value,uploadSubject);});
const flashCategory=$("#flashCategory"),flashSubject=$("#flashSubject");
flashCategory.addEventListener("change",()=>fillSubjectOptions(flashCategory.value,flashSubject));
fileInput.addEventListener("change",()=>processFiles([...fileInput.files]));
$("#flashFileInput").addEventListener("change",e=>processFiles([...e.target.files],true));
["dragenter","dragover"].forEach(n=>drop.addEventListener(n,e=>{e.preventDefault();drop.classList.add("dragover");}));
["dragleave","drop"].forEach(n=>drop.addEventListener(n,e=>{e.preventDefault();drop.classList.remove("dragover");}));
drop.addEventListener("drop",e=>processFiles([...e.dataTransfer.files]));
function progress(title,detail,pct){clearTimeout(progressHideTimer);const panel=$("#processing"),bar=$("#processingBar"),track=panel.querySelector(".processing-track"),value=Math.max(0,Math.min(100,Number(pct)||0));panel.classList.remove("hidden");$("#processingTitle").textContent=title;$("#processingDetail").textContent=detail;$("#processingPercent").textContent=value+"%";bar.style.width=value+"%";track.setAttribute("aria-valuenow",String(value));}
function progressEnd(){const panel=$("#processing");$("#processingBar").style.width="100%";$("#processingPercent").textContent="100%";clearTimeout(progressHideTimer);progressHideTimer=setTimeout(()=>panel.classList.add("hidden"),450);}
const MAX_FILES_PER_SELECTION=10;
const MAX_FILE_SIZE_BYTES=1024*1024*1024; // 1 GB per file
async function processFiles(files,selectForFlash=false){
 const category=selectForFlash?flashCategory.value:uploadCategory.value;
 const subject=selectForFlash?flashSubject.value:uploadSubject.value;
 if(!category||!subject||categoryForSubject(subject)!==category){toast("Choose MEDTECH or IT and then select its subject before uploading.");return;}
 const selected=[...files].filter(Boolean);
 if(selected.length>MAX_FILES_PER_SELECTION){toast("Select up to 10 files at a time. You selected "+selected.length+".");return;}
 const valid=selected.filter(file=>{if(file.size>MAX_FILE_SIZE_BYTES){toast(file.name+" is larger than the 1 GB per-file limit and was skipped.");return false;}return true;});
 if(!valid.length)return;
 let lastImportedId="";
 for(let idx=0;idx<valid.length;idx++){
  const file=valid[idx],ctx={cancelled:false};
  try{
   progress(`Processing ${idx+1} of ${valid.length}: ${file.name}`,"Preparing your file… large documents are processed page by page.",2);
   const ext=file.name.split(".").pop().toLowerCase();let text="",type=ext;
   if(ext==="txt"||ext==="csv"){text=await file.text();progress("Reading "+file.name,"Text extracted successfully",90);}
   else if(ext==="pdf")text=await extractPDF(file,ctx);
   else if(ext==="docx"){text=await extractDOCX(file,ctx);}
   else if(ext==="xlsx"){if(!window.XLSX)throw Error("Spreadsheet library did not load.");const wb=XLSX.read(await file.arrayBuffer(),{type:"array"});text=wb.SheetNames.map(n=>`## ${n}\n`+XLSX.utils.sheet_to_csv(wb.Sheets[n])).join("\n\n");progress("Reading "+file.name,"Spreadsheet extracted",90);}
   else if(ext==="pptx"){text=await extractPPTX(file,ctx);}
   else if(["jpg","jpeg","png","webp"].includes(ext)){type="image";text=await runOCR(file,ctx);}
   else throw Error("This file type is not supported.");
   text=cleanStudyText(text);if(!text.trim())throw Error("No readable text was found in this file.");validateStudyText(text);
   const material={id:uid(),name:file.name,type,category,subject,text,created:Date.now(),size:file.size,sourceText:text,processingStatus:"validated"};
   await put("materials",material);lastImportedId=material.id;
   if($("#autoGeneratePackage")?.checked){progress("Generating study package", "Creating the reviewer, quiz, and flashcards from your extracted notes…", 96);try{const pkg=await requestStudyPackage(material);await persistPackageFlashcards(material,pkg);toast("Uploaded and generated the complete study package for "+file.name);}catch(aiError){toast("File saved. AI package not generated: "+aiError.message);}}
   progress("Saved "+file.name,"All available pages were added to your study library",98);if(!$("#autoGeneratePackage")?.checked)toast("Added "+file.name);
  }catch(err){toast(file.name+": "+err.message);}finally{progressEnd();}
 }
 await refresh();fileInput.value="";const flashPicker=$("#flashFileInput");if(flashPicker)flashPicker.value="";
 if(selectForFlash&&lastImportedId){$("#flashMaterial").value=lastImportedId;toast("Material ready. Generate your flashcards.");}
}
async function getOCRWorker(){
 if(!window.Tesseract)throw Error("OCR library did not load. Check your internet connection.");
 if(!ocrWorkerPromise){ocrWorkerPromise=(async()=>await Tesseract.createWorker("eng"))().catch(err=>{ocrWorkerPromise=null;throw err;});}
 return ocrWorkerPromise;
}
async function runOCR(source,ctx={cancelled:false},onProgress=null){
 if(ctx.cancelled)throw Error("File loading cancelled.");
 const worker=await getOCRWorker(),result=await worker.recognize(source);
 if(ctx.cancelled)throw Error("File loading cancelled.");
 if(onProgress)onProgress();
 return result.data.text||"";
}
async function extractPDF(file,ctx={cancelled:false}){
 if(!window.pdfjsLib)throw Error("PDF.js did not load. Check your internet connection.");
 pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
 const pdf=await pdfjsLib.getDocument({data:await file.arrayBuffer()}).promise;
 const out=[];let ocrPages=0;
 for(let i=1;i<=pdf.numPages;i++){
  if(ctx.cancelled)throw Error("File loading cancelled.");
  const page=await pdf.getPage(i),content=await page.getTextContent();
  const positioned=content.items.filter(x=>String(x.str||"").trim()).map(x=>({
   text:String(x.str).trim(),x:Number(x.transform?.[4]||0),y:Number(x.transform?.[5]||0),
   width:Number(x.width||0)
  }));
  positioned.sort((a,b)=>b.y-a.y||a.x-b.x);
  const rows=[];
  for(const item of positioned){
   let row=rows.find(r=>Math.abs(r.y-item.y)<=3);
   if(!row){row={y:item.y,items:[]};rows.push(row);}
   row.items.push(item);
  }
  rows.sort((a,b)=>b.y-a.y);
  // Detect a substantial gutter and read left column top-to-bottom before right column.
  const gaps=[];
  for(const row of rows){
   const items=row.items.slice().sort((a,b)=>a.x-b.x);
   for(let k=1;k<items.length;k++){
    const gap=items[k].x-(items[k-1].x+items[k-1].width);
    if(gap>55)gaps.push({gap,cut:(items[k].x+items[k-1].x+items[k-1].width)/2});
   }
  }
  gaps.sort((a,b)=>b.gap-a.gap);
  const cut=gaps[0]?.cut;
  const isTwoColumns=!!cut&&positioned.filter(x=>x.x<cut).length>=4&&positioned.filter(x=>x.x>=cut).length>=4;
  const renderRows=(items)=>rows.map(r=>r.items.filter(x=>items(x)).sort((a,b)=>a.x-b.x)
   .map(x=>x.text).join(" ").replace(/\s+/g," ").trim()).filter(Boolean).join("\n");
  let txt=isTwoColumns
   ? [renderRows(x=>x.x<cut),renderRows(x=>x.x>=cut)].filter(Boolean).join("\n\n")
   : renderRows(()=>true);
  const needsOCR=txt.length<25||(txt.match(/[A-Za-z0-9]/g)||[]).length/Math.max(1,txt.length)<0.28;
  progress(`Reading PDF page ${i} of ${pdf.numPages}`,needsOCR?`Scanned page detected · OCR ${ocrPages+1} · all pages included`:`Extracting selectable text · ${ocrPages} pages require OCR`,Math.min(96,Math.round((i-1)/pdf.numPages*90)+4));
  if(needsOCR){
   ocrPages++;
   const viewport=page.getViewport({scale:1.35}),canvas=document.createElement("canvas");
   const context=canvas.getContext("2d",{willReadFrequently:true});
   canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
   await page.render({canvasContext:context,viewport}).promise;
   txt=await runOCR(canvas,ctx,()=>progress(`Reading PDF page ${i} of ${pdf.numPages}`,`OCR completed · ${ocrPages} scanned pages processed`,Math.min(96,Math.round(i/pdf.numPages*90)+4)));
   canvas.width=0;canvas.height=0;
  }
  out.push(`\n\n${txt}`);page.cleanup();
  if(i%2===0)await new Promise(resolve=>setTimeout(resolve,0));
 }
 return out.join("");
}
async function blobFromDataURL(dataURL){const response=await fetch(dataURL);return response.blob();}
async function extractDOCX(file,ctx){
 if(!window.mammoth)throw Error("DOCX library did not load. Check your internet connection and retry.");
 const arrayBuffer=await file.arrayBuffer(),raw=await mammoth.extractRawText({arrayBuffer});
 const html=await mammoth.convertToHtml({arrayBuffer},{convertImage:mammoth.images.imgElement(image=>image.read("base64").then(data=>({src:`data:${image.contentType};base64,${data}`})))});
 const doc=new DOMParser().parseFromString(html.value,"text/html"),images=[...doc.images];
 let out=raw.value||"";
 for(let i=0;i<images.length;i++){
  if(ctx.cancelled)throw Error("File loading cancelled.");
  const src=images[i].getAttribute("src");if(!src||!src.startsWith("data:image/"))continue;
  progress(`Reading DOCX image ${i+1} of ${images.length}`,"Recognizing text inside an embedded image…",Math.min(94,70+Math.round((i/images.length)*24)));
  try{const imageText=await runOCR(await blobFromDataURL(src),ctx);if(imageText.trim())out+=`\n\n[Text recognized in embedded image ${i+1}]\n${imageText.trim()}`;}
  catch(err){if(ctx.cancelled)throw err;out+=`\n\n[Embedded image ${i+1}: OCR could not read this image]`;}
  await new Promise(resolve=>setTimeout(resolve,0));
 }
 progress("Reading "+file.name,`Document text and ${images.length} embedded image(s) checked`,96);
 return out;
}
function resolveZipPath(baseFile,target){if(target.startsWith("/"))return target.slice(1);const parts=baseFile.split("/");parts.pop();for(const part of target.split("/")){if(!part||part===".")continue;if(part==="..")parts.pop();else parts.push(part);}return parts.join("/");}
async function extractPPTX(file,ctx={cancelled:false}){
 if(!window.JSZip)throw Error("PPTX library did not load.");
 const zip=await JSZip.loadAsync(await file.arrayBuffer()),slides=Object.keys(zip.files).filter(n=>/^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a,b)=>Number(a.match(/slide(\d+)/)[1])-Number(b.match(/slide(\d+)/)[1]));
 let out=[];
 for(let i=0;i<slides.length;i++){
  if(ctx.cancelled)throw Error("File loading cancelled.");
  const slidePath=slides[i],xml=await zip.files[slidePath].async("text"),doc=new DOMParser().parseFromString(xml,"text/xml");
  out.push(`Slide ${i+1}\n`+[...doc.getElementsByTagName("a:t")].map(n=>n.textContent).join(" "));
  const relPath=slidePath.replace("slides/","slides/_rels/")+".rels",relFile=zip.files[relPath];
  if(!relFile)continue;
  const relDoc=new DOMParser().parseFromString(await relFile.async("text"),"text/xml"),rels={};
  [...relDoc.getElementsByTagName("Relationship")].forEach(r=>{if(r.getAttribute("Id"))rels[r.getAttribute("Id")]=r.getAttribute("Target");});
  const imageIds=[...new Set([...doc.getElementsByTagName("a:blip")].map(n=>n.getAttribute("r:embed")).filter(Boolean))];
  for(let j=0;j<imageIds.length;j++){
   if(ctx.cancelled)throw Error("File loading cancelled.");
   const target=rels[imageIds[j]];if(!target)continue;
   const imagePath=resolveZipPath(slidePath,target),imageFile=zip.files[imagePath];if(!imageFile||imageFile.dir)continue;
   const ext=imagePath.split(".").pop().toLowerCase();if(!["png","jpg","jpeg","webp","bmp","tif","tiff"].includes(ext))continue;
   progress(`Reading slide ${i+1} of ${slides.length}`,`OCR on embedded image ${j+1} of ${imageIds.length}…`,Math.min(95,Math.round((i/slides.length)*85+5)));
   try{const imageText=await runOCR(await imageFile.async("blob"),ctx);if(imageText.trim())out.push(`[Slide ${i+1} · text recognized in embedded image ${j+1}]\n${imageText.trim()}`);}
   catch(err){if(ctx.cancelled)throw err;out.push(`[Slide ${i+1} · embedded image ${j+1}: OCR could not read this image]`);}
   await new Promise(resolve=>setTimeout(resolve,0));
  }
  progress(`Reading slide ${i+1} of ${slides.length}`,"Slide text and embedded images checked",Math.min(96,Math.round(((i+1)/slides.length)*90)+4));
 }
 return out.join("\n\n");
}
function openModal(title,html,onSave){$("#modalTitle").textContent=title;$("#modalBody").innerHTML=html;$("#modalBackdrop").classList.remove("hidden");$("#closeModal").onclick=closeModal;$("#modalCancel")?.addEventListener("click",closeModal);$("#modalSave")?.addEventListener("click",async()=>{try{await onSave();closeModal();}catch(e){toast(e.message);}});}
function closeModal(){$("#modalBackdrop").classList.add("hidden");}
$("#closeModal").addEventListener("click",closeModal);$("#modalBackdrop").addEventListener("click",e=>{if(e.target.id==="modalBackdrop")closeModal();});
$("#openPaste").addEventListener("click",()=>openModal("Paste study text",`<label>Material title<input id="pasteName" placeholder="e.g. Cell Biology Notes"></label><label>Course category<select id="pasteCategory"><option value="">Choose category…</option><option value="MEDTECH">MEDTECH</option><option value="IT">IT</option></select></label><label>Subject<select id="pasteSubject" disabled><option value="">Choose a category first…</option></select></label><label>Study text<textarea id="pasteText" placeholder="Paste your notes or lesson content here…"></textarea></label><div class="modal-actions"><button class="btn btn-outline" id="modalCancel">Cancel</button><button class="btn" id="modalSave">Save material</button></div>`,async()=>{const name=$("#pasteName").value.trim(),text=cleanStudyText($("#pasteText").value),category=$("#pasteCategory").value,subject=$("#pasteSubject").value;if(!name||!text)throw Error("Enter a title and some study text.");if(!category||!subject||categoryForSubject(subject)!==category)throw Error("Choose a course category and subject.");validateStudyText(text);await put("materials",{id:uid(),name,type:"txt",category,subject,text,sourceText:text,processingStatus:"validated",created:Date.now(),size:text.length});await refresh();toast("Study material saved.");}));
$("#modalBody").addEventListener("change",e=>{if(e.target.id==="pasteCategory")fillSubjectOptions(e.target.value,$("#pasteSubject"));},{once:true});
$("#materialGrid").addEventListener("click",async e=>{const b=e.target.closest("[data-action]");if(!b)return;const m=state.materials.find(x=>x.id===b.dataset.id);if(!m)return;switch(b.dataset.action){case"view":openModal(m.name,`<p class="fine-print">${esc(m.subject||"Unassigned")} · ${wordCount(m.text)} words</p><textarea id="editMaterialText">${esc(m.text)}</textarea><div class="modal-actions"><button class="btn btn-outline" id="modalCancel">Close</button><button class="btn" id="modalSave">Save edits</button></div>`,async()=>{m.text=cleanStudyText($("#editMaterialText").value);validateStudyText(m.text);m.sourceText=m.text;delete m.studyPackage;delete m.studyPackageGeneratedAt;for(const card of state.cards.filter(c=>c.materialId===m.id&&c.generated))await del("cards",card.id);await put("materials",m);await refresh();toast("Text updated. Generate a fresh study package for the revised source.");});break;case"rename":openModal("Rename material",`<label>Material name<input id="renameValue" value="${esc(m.name)}"></label><div class="modal-actions"><button class="btn btn-outline" id="modalCancel">Cancel</button><button class="btn" id="modalSave">Save</button></div>`,async()=>{m.name=$("#renameValue").value.trim()||m.name;await put("materials",m);await refresh();});break;case"delete":if(confirm(`Delete "${m.name}" and its saved flashcards?`)){await del("materials",m.id);for(const c of state.cards.filter(c=>c.materialId===m.id))await del("cards",c.id);deck=[];await refresh();toast("Material deleted.");}break;case"cards":await generateForMaterial(m);go("flashcards");break;}});
function splitSentences(t){return t.replace(/\r/g," ").split(/(?<=[.!?])\s+(?=[A-Z0-9])|\n+/).map(s=>s.trim()).filter(s=>s.length>25&&s.length<900);}
function cardKey(value){return String(value||"").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," ");}
function generatePairs(text){
 const out=[],seen=new Set();
 const clean=x=>String(x||'').replace(/^#{1,6}\s*/,'').replace(/^[\s•▪*-]+/,'').replace(/^\d+[.)]\s*/,'').replace(/\s+/g,' ').trim().replace(/[.;:]+$/,'').trim();
 const valid=(s,min=3,max=420)=>!!s&&s.length>=min&&s.length<=max&&!/[>{}_]{2,}/.test(s)&&!/[#$%^*@~`\\]/.test(s)&&!/[!?]{3,}/.test(s)&&!/(?:undefined|null|NaN)/i.test(s)&&(s.match(/[A-Za-z]/g)||[]).length>=Math.min(3,s.length);
 const add=(question,answer)=>{
  question=String(question||'').trim().replace(/[?]+$/,'')+'?';answer=clean(answer);
  if(!valid(question,12,180)||!valid(answer,3,420))return;
  const k=cardKey(question)+'::'+cardKey(answer);
  if(!seen.has(k)){seen.add(k);out.push([question,answer]);}
 };
 const lines=String(text||'').split(/\n+/).map(x=>x.trim()).filter(Boolean);
 for(const raw of lines){
  const line=raw.replace(/\s+/g,' ').trim();if(/^#{1,6}\s/.test(line))continue;
  let m=line.match(/^(?:conventional |normal |therapeutic )?reference range for (.+?)\s*(?:is|:|—)\s*(.{3,})$/i);
  if(m){add(`What is the conventional reference range for ${clean(m[1])}`,m[2]);continue;}
  m=line.match(/^([^:—]{2,100})\s*[:—]\s*(.{3,})$/);
  if(!m)m=line.match(/^([A-Z][A-Za-z0-9()/' -]{1,85}?)\s+-\s+(.{5,})$/);
  if(m){
   const term=clean(m[1]),answer=clean(m[2]);
   if(/(?:reference|normal|therapeutic)\s+range|\brange\b/i.test(term+' '+answer)||(/\b(?:ng\/mL|pg\/mL|mg\/dL|mmol\/L|µmol\/L|μmol\/L|mEq\/L|IU\/L|U\/L|g\/dL|mg\/L|mL\/min|cells\/?(?:µL|μL|uL)|%|seconds?|minutes?|hours?|days?)\b/i.test(answer)&&/\b(?:troponin|glucose|hemoglobin|hematocrit|creatinine|urea|platelet|WBC|RBC|cholesterol|sodium|potassium|calcium|test|level|count)\b/i.test(term))){
    add(`What is the conventional reference range for ${term}`,answer);
   }else if(/\b(?:definition|defined as|refers to|means)\b/i.test(term+' '+answer)){
    add(`What is the definition of ${term}`,answer);
   }else if(/^(?:function|role)\s+of\s+/i.test(term)){
    add(`What is the primary function of ${term.replace(/^(?:function|role)\s+of\s+/i,'')}`,answer);
   }else{
    add(`What is ${term}`,answer);
   }
   continue;
  }
  const sentence=line.replace(/^[-•*]\s+/,'');
  m=sentence.match(/^([A-Z][A-Za-z0-9()/' -]{1,85}?)\s+(?:is defined as|is|are|refers to|means|consists of|includes|produces|causes|occurs when)\s+(.{5,260})[.]?$/i);
  if(m&&m[1].split(/\s+/).length<=10){
   const term=clean(m[1]),answer=clean(m[2]);
   if(/\b(?:reference|normal|therapeutic)\s+range\b/i.test(answer))add(`What is the conventional reference range for ${term}`,answer);
   else add(`What is the definition or meaning of ${term}`,answer);
  }
 }
 return out.slice(0,300);
}
async function generateForMaterial(m){
 try{validateStudyText(cleanStudyText(m.text));const pkg=await requestStudyPackage(m);if(!Array.isArray(pkg.flashcards)||!pkg.flashcards.length)throw Error("The AI package did not contain reliable flashcards for this source.");
  const added=await persistPackageFlashcards(m,pkg);await refresh();deck=state.cards.filter(c=>c.materialId===m.id);deckIndex=0;renderFlash();toast(added?`${added} AI-generated specific flashcards added.`:"No new cards: matching flashcards already exist.");
 }catch(e){toast(e.message||"Could not generate flashcards.");}
}
$("#generateCards").addEventListener("click",async()=>{const m=state.materials.find(x=>x.id===$("#flashMaterial").value);if(!m){toast("Choose a study material first.");return;}await generateForMaterial(m);});
$("#createCardBtn").addEventListener("click",()=>openModal("Create flashcard",`<label>Question<input id="cardQ" placeholder="Enter a question or term"></label><label>Answer<textarea id="cardA" placeholder="Enter the answer or definition"></textarea></label><label>Subject / source<select id="cardSource"><option value="">Personal card</option>${state.materials.map(m=>`<option value="${m.id}">${esc(m.name)}</option>`).join("")}</select></label><div class="modal-actions"><button class="btn btn-outline" id="modalCancel">Cancel</button><button class="btn" id="modalSave">Create card</button></div>`,async()=>{const q=$("#cardQ").value.trim(),a=$("#cardA").value.trim();if(!q||!a)throw Error("Add both a question and an answer.");if(/[>{}_#$%^*@~`\\]/.test(q)||/[>{}_#$%^*@~`\\]/.test(a)||q.length<5)throw Error("Please enter a clear, complete question and answer.");const m=state.materials.find(x=>x.id===$("#cardSource").value);await put("cards",{id:uid(),question:q,answer:a,materialId:m?.id||null,sourceName:m?.name||"Personal card",category:m?.category||"",subject:m?.subject||"",difficult:false,known:false});await refresh();deck=state.cards;deckIndex=deck.length-1;renderFlash();}));
$("#prevCard").addEventListener("click",()=>{if(deck.length){deckIndex=(deckIndex-1+deck.length)%deck.length;renderFlash();}});$("#nextCard").addEventListener("click",()=>{if(deck.length){deckIndex=(deckIndex+1)%deck.length;renderFlash();}});$("#shuffleCards").addEventListener("click",()=>{for(let i=deck.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[deck[i],deck[j]]=[deck[j],deck[i]];}deckIndex=0;renderFlash();});async function markCard(field,val){if(!deck.length)return;const c=deck[deckIndex];c[field]=val;await put("cards",c);await refresh();deck=deck.map(x=>x.id===c.id?c:x);renderFlash();}$("#markDifficult").addEventListener("click",()=>markCard("difficult",true));$("#markKnown").addEventListener("click",()=>markCard("known",true));
$("#exportFlashcards").addEventListener("click",()=>{if(!deck.length){toast("There are no flashcards to export.");return;}const first=deck[0],header=`DY\nJULIANA FAITH S.\nFLASHCARDS\nCategory: ${first.category||"Personal"}\nSubject: ${first.subject||"Unassigned"}\n\n`;const body=deck.map((c,i)=>`${i+1}. QUESTION: ${c.question}\n   ANSWER: ${c.answer}`).join("\n\n");downloadTextFile("szlyana-flashcards.txt",header+body);toast("Flashcard deck exported.");});
function buildQuestions(text,count,type){
 const pairs=generatePairs(text),qs=[],used=new Set();
 const cleanQuestion=s=>String(s||'').trim();
 const validQuestion=q=>q&&q.length>=8&&q.length<=180&&
  !/[>{}_#$%^*@~`\\]/.test(q)&&/[A-Za-z]/.test(q)&&
  !/(?:undefined|null|NaN)/i.test(q);
 const add=q=>{
  q.q=cleanQuestion(q.q);
  if(!validQuestion(q.q)||!q.answer||String(q.answer).trim().length<2)return;
  if(q.type==='choice'){
   q.options=[...new Set((q.options||[]).map(x=>String(x).trim()).filter(Boolean))];
   if(q.options.length!==4||q.options.filter(x=>x===q.answer).length!==1)return;
  }
  const k=cardKey(q.q);
  if(!used.has(k)){used.add(k);qs.push(q);}
 };
 const distractorsFor=answer=>{
  const pool=[...new Set(pairs.map(p=>p[1]).filter(x=>x!==answer&&x.length>=5))];
  if(pool.length<3)return null;
  const wrong=pool.sort(()=>Math.random()-.5).slice(0,3);
  if(new Set([answer,...wrong]).size!==4)return null;
  return [answer,...wrong].sort(()=>Math.random()-.5);
 };
 const mcq=()=>pairs.forEach(([question,def])=>{
  const term=question.replace(/^What is\s+/i,'').replace(/\?$/,'');
  const options=distractorsFor(def);
  if(options)add({type:'choice',format:'Multiple choice',q:`What is ${term}?`,options,answer:def});
 });
 const fill=()=>pairs.forEach(([question,def])=>{
  const term=question.replace(/^What is\s+/i,'').replace(/\?$/,'');
  const words=def.split(/\s+/);
  if(words.length>=4)add({type:'text',format:'Fill in the blank',q:`What does ${term} refer to?`,answer:def});
 });
 const enumeration=()=>{
  const lines=String(text||'').split(/\n+/).map(x=>x.trim()).filter(Boolean);
  let heading='',group=[],groups=[];
  for(const line of lines){
   if(/^#{1,6}\s/.test(line)){heading=line.replace(/^#{1,6}\s*/,'').trim();continue;}
   if(/^(?:1[.)])\s+/.test(line)){if(group.length>=2&&heading)groups.push({heading,items:group});group=[];}
   if(/^(?:\d+[.)]|[-•▪])\s+/.test(line)){
    const item=line.replace(/^(?:\d+[.)]|[-•▪])\s*/,'').trim();
    if(item.length>=2&&!/[>{}_#$%^*@~`\\]/.test(item))group.push(item);
   }else if(line.length>4&&line.length<100&&!/[:—]$/.test(line))heading=line.replace(/[.:]$/,'');
  }
  if(group.length>=2&&heading)groups.push({heading,items:group});
  groups.forEach(({heading,items})=>add({type:'enumeration',format:'Enumeration',q:`What are the ${items.length} items under ${heading}?`,answer:items.map((x,i)=>`${i+1}. ${x}`).join('\n')}));
 };
 const identification=()=>pairs.forEach(([question,def])=>{
  const term=question.replace(/^What is\s+/i,'').replace(/\?$/,'');
  add({type:'text',format:'Identification',q:`What is ${term}?`,answer:def});
 });
 const tf=()=>pairs.forEach(([question,def])=>{
  const term=question.replace(/^What is\s+/i,'').replace(/\?$/,'');
  add({type:'choice',format:'True or false',q:`${term} is described as: ${def}`,options:['True','False'],answer:'True'});
 });
 if(type==='mixed'){mcq();enumeration();identification();tf();}
 else if(type==='mcq')mcq();
 else if(type==='enumeration')enumeration();
 else if(type==='identification')identification();
 else if(type==='tf')tf();
 else if(type==='fill')fill();
 return qs.sort(()=>Math.random()-.5).slice(0,count);
}
$("#startQuiz").addEventListener("click",async()=>{const m=state.materials.find(x=>x.id===$("#quizMaterial").value);if(!m){toast("Choose a study material first.");return;}const count=Math.max(1,Math.min(50,Number($("#questionCount").value)||10));try{validateStudyText(cleanStudyText(m.text));toast("Generating source-grounded quiz questions…");const pkg=await requestStudyPackage(m);const qs=(pkg.quiz||[]).slice(0,count).map(q=>({type:"choice",format:"Multiple choice",q:q.question,options:q.options.map(o=>String(o).replace(/^[A-D]\.\s*/,"")),answer:q.referenceAnswer,rationale:q.rationale})).filter(q=>q.options?.length===4&&q.options.filter(o=>String(o).replace(/^[A-D]\.\s*/,"").trim()===q.answer.trim()).length===1);if(!qs.length)throw Error("The source did not support enough reliable four-option MCQs.");quiz={material:m,questions:qs,answers:Array(qs.length).fill(null),submitted:false,mode:$("#quizMode").value,started:Date.now(),rewardPlayedFor:[]};quizIndex=0;$("#quizSetup").classList.add("hidden");$("#quizResult").classList.add("hidden");$("#quizArea").classList.remove("hidden");$("#quizModeLabel").textContent=quiz.mode==="exam"?"MOCK EXAM":"PRACTICE";if(quizTimer)clearInterval(quizTimer);if(quiz.mode==="exam"){let seconds=qs.length*60;$("#quizTimer").textContent="Time: "+formatTime(seconds);quizTimer=setInterval(()=>{seconds--;$("#quizTimer").textContent="Time: "+formatTime(seconds);if(seconds<=0){clearInterval(quizTimer);finishQuiz();}},1000);}renderQuestion();}catch(e){toast(e.message||"Could not generate quiz.");}});
function formatTime(s){return `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;}
function renderQuestion(){const q=quiz.questions[quizIndex];$("#quizProgress").textContent=`Question ${quizIndex+1} of ${quiz.questions.length}`;$("#quizProgressBar").style.width=(quizIndex/quiz.questions.length*100)+"%";$("#questionContent").innerHTML=`<div class="question-source">${esc(q.format||"Question")}</div><h2 class="question-title">${esc(q.q)}</h2>${q.type==="choice"?`<div class="answer-options">${q.options.map(o=>`<label class="answer-option ${quiz.answers[quizIndex]===o?"selected":""}"><input type="radio" name="answer" value="${esc(o)}" ${quiz.answers[quizIndex]===o?"checked":""}>${esc(o)}</label>`).join("")}</div>`:`<input id="textAnswer" class="answer-input" placeholder="Type your answer…" value="${esc(quiz.answers[quizIndex]||"")}" style="width:100%;padding:13px;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--text)">`}`;$("#questionContent").querySelectorAll("input").forEach(inp=>inp.addEventListener("change",()=>{quiz.answers[quizIndex]=inp.value;}));$("#submitAnswer").classList.toggle("hidden",quiz.submitted);$("#nextQuestion").classList.toggle("hidden",!quiz.submitted);$("#nextQuestion").textContent=quizIndex===quiz.questions.length-1?"See results →":"Next question →";$("#questionContent").querySelectorAll("input").forEach(i=>i.disabled=quiz.submitted);if(quiz.submitted){const ok=normalize(quiz.answers[quizIndex])===normalize(q.answer);const praise=ok?"YEHEY, YOU DID GREAT, MY LOVE, I AM PROUD OF YOU":"IT'S OKAY, BABY! TRY AGAIN! I AM PROUD OF YOU";if(ok&&!quiz.rewardPlayedFor?.includes(quizIndex)){quiz.rewardPlayedFor=quiz.rewardPlayedFor||[];quiz.rewardPlayedFor.push(quizIndex);playRewardSound();}$("#questionContent").insertAdjacentHTML("beforeend",`<div class="answer-feedback ${ok?"correct":"wrong"}"><b>${praise}</b><br><b>Reference answer:</b><div style="white-space:pre-line">${esc(q.answer)}</div>${q.rationale?`<p><b>Rationale:</b> ${esc(q.rationale)}</p>`:""}</div>`);}}
function normalize(s){return String(s||"").toLowerCase().replace(/[^a-z0-9]/g,"").trim();}
function playRewardSound(){
 try{
  const AudioCtx=window.AudioContext||window.webkitAudioContext;if(!AudioCtx)return;
  const ctx=new AudioCtx();if(ctx.state==="suspended")ctx.resume();
  const now=ctx.currentTime;
  [[523.25,0],[659.25,.13],[783.99,.26],[1046.5,.42]].forEach(([frequency,delay],i)=>{
   const osc=ctx.createOscillator(),gain=ctx.createGain();osc.type="sine";osc.frequency.setValueAtTime(frequency,now+delay);
   gain.gain.setValueAtTime(.0001,now+delay);gain.gain.exponentialRampToValueAtTime(.16,now+delay+.025);gain.gain.exponentialRampToValueAtTime(.0001,now+delay+.19);
   osc.connect(gain);gain.connect(ctx.destination);osc.start(now+delay);osc.stop(now+delay+.2);
  });
  setTimeout(()=>ctx.close().catch(()=>{}),1000);
 }catch(e){console.warn("Reward sound unavailable",e);}
}
$("#submitAnswer").addEventListener("click",()=>{const q=quiz.questions[quizIndex];if(q.type==="choice")quiz.answers[quizIndex]=$('input[name="answer"]:checked')?.value||"";else quiz.answers[quizIndex]=$("#textAnswer").value.trim();if(!quiz.answers[quizIndex]){toast("Choose or enter an answer first.");return;}quiz.submitted=true;renderQuestion();});
$("#nextQuestion").addEventListener("click",()=>{if(quizIndex<quiz.questions.length-1){quizIndex++;quiz.submitted=false;renderQuestion();}else finishQuiz();});
$("#quitQuiz").addEventListener("click",()=>{if(confirm("Exit this practice test? Your unfinished answers will not be saved.")){clearInterval(quizTimer);quiz=null;$("#quizArea").classList.add("hidden");$("#quizSetup").classList.remove("hidden");}});
async function finishQuiz(){if(!quiz)return;clearInterval(quizTimer);const score=quiz.questions.reduce((n,q,i)=>n+(normalize(quiz.answers[i])===normalize(q.answer)?1:0),0);lastQuizExport={material:quiz.material,questions:quiz.questions,answers:[...quiz.answers],score,mode:quiz.mode};const result={id:uid(),title:quiz.material.name,score,total:quiz.questions.length,created:Date.now(),mode:quiz.mode,category:quiz.material.category,subject:quiz.material.subject};await put("quizzes",result);$("#quizArea").classList.add("hidden");$("#quizResult").classList.remove("hidden");$("#quizResult").innerHTML=`<div class="eyebrow">PRACTICE COMPLETE</div><div class="result-score">${Math.round(score/result.total*100)}%</div><h2>${score} out of ${result.total} correct</h2><p class="muted">Based on ${esc(quiz.material.name)}</p><button class="btn" id="reviewQuiz">Review answers</button> <button class="btn btn-outline" id="exportQuiz">Export quiz</button> <button class="btn btn-outline" id="againQuiz">New practice test</button><div id="reviewAnswers" class="hidden" style="text-align:left;margin-top:20px">${quiz.questions.map((q,i)=>`<div class="answer-source"><b>${i+1}. ${esc(q.q)}</b><p>Your answer: ${esc(quiz.answers[i]||"No answer")}<br>Reference: <span style="white-space:pre-line">${esc(q.answer)}</span>${q.rationale?`<br>Rationale: ${esc(q.rationale)}`:""}</p></div>`).join("")}</div>`;$("#reviewQuiz").onclick=()=>$("#reviewAnswers").classList.toggle("hidden");$("#exportQuiz").onclick=()=>{if(!lastQuizExport)return;const d=lastQuizExport,header=`DY\nJULIANA FAITH S.\nQUIZ REVIEW\nCategory: ${d.material.category||"Unassigned"}\nSubject: ${d.material.subject||"Unassigned"}\nScore: ${d.score}/${d.questions.length}\n\n`;const body=d.questions.map((q,i)=>`${i+1}. ${q.q}\n${(q.options||[]).map((o,j)=>`${String.fromCharCode(65+j)}. ${o}`).join("\n")}\nYour answer: ${d.answers[i]||"No answer"}\nCorrect answer: ${q.answer}\nRationale: ${q.rationale||"Not provided"}`).join("\n\n");downloadTextFile("szlyana-quiz-review.txt",header+body);};$("#againQuiz").onclick=()=>{$("#quizResult").classList.add("hidden");$("#quizSetup").classList.remove("hidden");};quiz=null;await refresh();}
function renderReviewerPaper(text){
 const lines=String(text||"").split(/\n+/).map(x=>x.trim()).filter(Boolean),colors=["#17365d","#2563a6","#0f766e","#b45309","#6d28d9"];
 let n=0,html='<div class="paper-header"><strong>'+esc(reviewDraft?.header||"STUDY REVIEWER")+'</strong></div>';
 for(const line of lines){
  if(/^\[EXPORT CONFIGURATION\]|^SOURCE NOTE$|^CATEGORY:|^SUBJECT:|^Generated |^SOURCE-BASED|^This reviewer/i.test(line))continue;
  const heading=/^#{1,3}\s/.test(line)||(line===line.toUpperCase()&&/[A-Z]/.test(line)&&line.length<100);
  const value=line.replace(/^#{1,3}\s*/,"");
  if(heading)html+=`<h2 style="--topic-color:${colors[n++%colors.length]}">${esc(value)}</h2>`;
  else if(/^[-•▪*]\s/.test(line))html+=`<p class="paper-bullet">${esc(value.replace(/^[-•▪*]\s*/,""))}</p>`;
  else if(/^(definition|defined as)\s*:/i.test(line))html+=`<p class="paper-definition">${esc(value)}</p>`;
  else if(/^example\s*:/i.test(line))html+=`<p class="paper-example">${esc(value)}</p>`;
  else if(/^(important|remember|warning|note)\s*:/i.test(line))html+=`<p class="paper-important">${esc(value)}</p>`;
  else html+=`<p>${esc(value)}</p>`;
 }
 return html;
}
$("#generateReviewer").addEventListener("click",async()=>{
 const m=state.materials.find(x=>x.id===$("#reviewMaterial").value);if(!m){toast("Choose a source material.");return;}
 try{validateStudyText(m.text);toast("Generating the complete AI study package…");const pkg=await requestStudyPackage(m);if(!pkg.reviewer?.trim())throw Error("The AI did not return a Natural Reviewer.");
  reviewDraft={material:m,text:pkg.reviewer,header:String(pkg.header||`${m.subject||"STUDY"} REVIEWER`).toUpperCase(),package:pkg};
  $("#reviewTitle").value=reviewDraft.header;$("#reviewText").value=pkg.reviewer;$("#reviewPaper").innerHTML=renderReviewerPaper(pkg.reviewer);$("#reviewerOutput").classList.remove("hidden");
  await persistPackageFlashcards(m,pkg);await refresh();deck=state.cards.filter(c=>c.materialId===m.id);deckIndex=0;renderFlash();toast(`Study package ready: ${pkg.quiz?.length||0} quiz questions and ${pkg.flashcards?.length||0} flashcards generated. Open Quiz to start the MCQ set.`);
 }catch(e){toast(e.message||"Could not generate the study package.");}
});
$("#reviewText").addEventListener("input",()=>{if(reviewDraft){reviewDraft.text=$("#reviewText").value;$("#reviewPaper").innerHTML=renderReviewerPaper($("#reviewText").value);}});
$("#reviewTitle").addEventListener("input",()=>{if(reviewDraft){reviewDraft.header=$("#reviewTitle").value.toUpperCase();$("#reviewPaper").innerHTML=renderReviewerPaper($("#reviewText").value);}});
async function downloadReviewerPDF(customFilename){
 if(!reviewDraft)return;
 if(!window.jspdf?.jsPDF){toast("PDF generator did not load. Check your internet connection and try again.");return;}
 const button=$("#saveReviewerPdf"),oldLabel=button.textContent;button.disabled=true;button.textContent="Preparing PDF…";
 try{
  const {jsPDF}=window.jspdf,doc=new jsPDF({orientation:"portrait",unit:"pt",format:[612,936],compress:true});
  const fontFiles=[['LiberationSerif-Regular.ttf','normal'],['LiberationSerif-Bold.ttf','bold'],['LiberationSerif-Italic.ttf','italic'],['LiberationSerif-BoldItalic.ttf','bolditalic']];
  for(const [file,style] of fontFiles){const response=await fetch(`assets/fonts/${file}`);if(!response.ok)throw Error(`Could not load PDF font: ${file}`);const bytes=new Uint8Array(await response.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i++)binary+=String.fromCharCode(bytes[i]);doc.addFileToVFS(file,btoa(binary));doc.addFont(file,'LiberationSerif',style);}
  const pageW=612,pageH=936,margin=36,gutter=27,colW=(pageW-margin*2-gutter)/2,lineH=18,bottom=pageH-margin-22;
  let col=0,y=82,pageNo=1;
  const drawPageHeader=()=>{doc.setFont('LiberationSerif','bold');doc.setFontSize(12);doc.setTextColor(20,20,20);doc.text(reviewDraft.header||$('#reviewTitle').value||'STUDY REVIEWER',pageW/2,48,{align:'center'});doc.setFontSize(9);doc.setTextColor(100,100,100);doc.text(`Page ${pageNo}`,pageW/2,pageH-margin,{align:'center'});};
  const newPage=()=>{doc.addPage([pageW,pageH],'portrait');pageNo++;col=0;y=82;drawPageHeader();};
  const nextColumn=()=>{if(col===0){col=1;y=82;}else newPage();};
  const ensure=(height)=>{if(y+height>bottom)nextColumn();};
  drawPageHeader();
  const lines=String($('#reviewText').value||'').split(/\n+/).map(x=>x.trim()).filter(Boolean);
  const palette=[[23,54,93],[37,99,166],[15,118,110],[180,83,9],[109,40,217]];let headingIndex=0;
  for(const raw of lines){
   if(/^SOURCE NOTE$|^SOURCE CONTENT$|^CATEGORY:|^SUBJECT:|^Generated |^SOURCE-BASED|^This reviewer/i.test(raw))continue;
   const isHeading=(raw===raw.toUpperCase()&&/[A-Z]/.test(raw)&&raw.length<100)||/^#{1,6}\s/.test(raw);
   let text=raw.replace(/^#{1,6}\s*/,'').replace(/^[-•▪*]\s*/,'').replace(/\*\*(.*?)\*\*/g,'$1').replace(/__(.*?)__/g,'$1'),font='normal',size=12,color=[25,25,25],indent=0;
   if(isHeading){font='bold';size=12;color=palette[headingIndex++%palette.length];}
   else if(/^[-•▪*]\s/.test(raw)){indent=12;}
   else if(/^(important|remember|warning|note)\s*:/i.test(raw)){font='bold';color=[150,85,0];}
   const width=colW-indent,linesWrapped=doc.splitTextToSize(text,width);const blockHeight=linesWrapped.length*lineH+(isHeading?5:4);
   ensure(blockHeight);
   if(y+blockHeight>bottom){nextColumn();ensure(blockHeight);}
   doc.setFont('LiberationSerif',font);doc.setFontSize(size);doc.setLineHeightFactor(1.5);doc.setTextColor(...color);
   if(isHeading){doc.setFillColor(color[0],color[1],color[2]);doc.setDrawColor(color[0],color[1],color[2]);doc.setLineWidth(1.2);doc.line(margin+col*(colW+gutter),y-11,margin+col*(colW+gutter)+colW,y-11);}
   const x=margin+col*(colW+gutter)+indent;
   doc.text(linesWrapped,x,y,{maxWidth:width,align:isHeading?'left':'justify',lineHeightFactor:1.5});y+=linesWrapped.length*lineH;
   y+=isHeading?5:4;
  }
  const safeName=String(customFilename||$('#reviewTitle').value||'szlyana-reviewer').replace(/\.pdf$/i,'').replace(/[^a-z0-9-_]+/gi,'-').replace(/^-+|-+$/g,'').toLowerCase()||'szlyana-reviewer';
  doc.save(`${safeName}.pdf`);toast('Long Bond Paper PDF downloaded.');
 }catch(error){console.error(error);toast(error.message||'Could not generate the PDF.');}
 finally{button.disabled=false;button.textContent=oldLabel;}
}
async function saveReviewerAsPDF(){
 if(!reviewDraft){toast("Generate a reviewer first.");return;}
 const suggested=(reviewDraft.header||"SZLYANA_REVIEWER").replace(/[^a-z0-9]+/gi,"_").replace(/^_+|_+$/g,"").toLowerCase()+".pdf";
 openModal("Save reviewer as PDF",`<p class="fine-print">Choose the filename for your downloadable PDF.</p><label>File name<input id="customExportFilename" value="${esc(suggested)}" maxlength="100" autocomplete="off"></label><div class="modal-actions"><button class="btn btn-outline" id="modalCancel">Cancel</button><button class="btn" id="modalSave">Download PDF</button></div>`,async()=>{const filename=$("#customExportFilename").value.trim();if(!filename)throw Error("Enter a filename before downloading.");await downloadReviewerPDF(filename);});
}
$("#saveReviewerPdf").addEventListener("click",saveReviewerAsPDF);
$("#saveReviewer").addEventListener("click",async()=>{if(!reviewDraft)return;await put("reviewers",{id:uid(),name:reviewDraft.header||$("#reviewTitle").value,text:$("#reviewText").value,created:Date.now(),source:reviewDraft.material.name,category:reviewDraft.material.category,subject:reviewDraft.material.subject});toast("Reviewer saved in this browser.");});
$("#askAssistant").addEventListener("click",()=>{const q=$("#assistantQuestion").value.trim();if(!q){toast("Type a question first.");return;}const terms=q.toLowerCase().split(/\W+/).filter(x=>x.length>2),matches=[];for(const m of state.materials){const paras=m.text.split(/\n+|(?<=[.!?])\s+/).filter(x=>x.trim().length>30);for(const p of paras){const score=terms.reduce((n,t)=>n+(p.toLowerCase().includes(t)?1:0),0);if(score)matches.push({p,m,score});}}matches.sort((a,b)=>b.score-a.score);const top=matches.slice(0,5);$("#assistantAnswer").innerHTML=top.length?`<p class="fine-print">Found ${top.length} relevant passage(s). These are matches from your saved sources, not AI-generated answers.</p>`+top.map(x=>`<div class="answer-source"><b>${esc(x.m.name)} · ${x.score} matching terms</b><p>${esc(x.p)}</p></div>`).join(""):`<div class="empty-state compact"><span>⌕</span><b>Not found in your saved materials</b><p>The available source text does not contain enough matching information to answer this question.</p></div>`;});
$("#addSession").addEventListener("click",()=>openModal("Schedule a study session",`<label>Session title<input id="sessionTitle" placeholder="e.g. Review cell structure"></label><label>Subject<select id="sessionSubject"><option value="">Independent study</option>${state.subjects.map(s=>`<option>${esc(s.name)}</option>`).join("")}</select></label><label>Date<input type="date" id="sessionDate" value="${new Date().toISOString().slice(0,10)}"></label><label>Duration (minutes)<input type="number" id="sessionMinutes" value="60" min="5" max="1440"></label><div class="modal-actions"><button class="btn btn-outline" id="modalCancel">Cancel</button><button class="btn" id="modalSave">Add session</button></div>`,async()=>{const title=$("#sessionTitle").value.trim();if(!title)throw Error("Enter a session title.");await put("sessions",{id:uid(),title,subject:$("#sessionSubject").value,date:$("#sessionDate").value,minutes:Number($("#sessionMinutes").value)||60,done:false});await refresh();}));
$("#sessionList").addEventListener("click",async e=>{const done=e.target.closest("[data-session-done]"),delb=e.target.closest("[data-session-delete]");if(done){const s=state.sessions.find(x=>x.id===done.dataset.sessionDone);s.done=!s.done;await put("sessions",s);await refresh();}if(delb){await del("sessions",delb.dataset.sessionDelete);await refresh();}});
$("#saveGoal").addEventListener("click",async()=>{state.goal=Math.max(10,Number($("#dailyGoal").value)||120);await put("settings",{id:"goal",value:state.goal});renderPlanner();toast("Daily goal saved.");});
$("#addSubject").addEventListener("click",()=>toast("The MEDTECH and IT subject lists are fixed to your official course codes."));

/* Data export/import: all records are kept on this browser only. */
const exportBtn=document.createElement("button");exportBtn.className="nav-link";exportBtn.innerHTML="<span>⇩</span> Export backup";$("#sidebar .sidebar-bottom").append(exportBtn);exportBtn.addEventListener("click",async()=>{const data={version:1,exported:new Date().toISOString()};for(const k of ["materials","cards","subjects","sessions","quizzes","reviewers"])data[k]=state[k];data.goal=state.goal;const blob=new Blob([JSON.stringify(data)],{type:"application/json"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="szlyana-backup.json";a.click();URL.revokeObjectURL(a.href);toast("Backup exported.");});
const importBtn=document.createElement("button");importBtn.className="nav-link";importBtn.innerHTML="<span>⇧</span> Import backup";$("#sidebar .sidebar-bottom").append(importBtn);importBtn.addEventListener("click",()=>$("#hiddenImport").click());$("#hiddenImport").addEventListener("change",async e=>{const f=e.target.files[0];if(!f)return;try{const d=JSON.parse(await f.text());for(const k of ["materials","cards","subjects","sessions","quizzes","reviewers"])if(Array.isArray(d[k]))for(const item of d[k])await put(k,item);if(d.goal)await put("settings",{id:"goal",value:d.goal});await refresh();toast("Backup imported.");}catch(err){toast("Could not read this backup file.");}e.target.value="";});
/* Basic data clear control. */
const clearBtn=document.createElement("button");clearBtn.className="nav-link";clearBtn.innerHTML="<span>⌫</span> Delete local data";$("#sidebar .sidebar-bottom").append(clearBtn);clearBtn.addEventListener("click",async()=>{if(!confirm("Permanently delete all SZLYANA data stored in this browser? Export a backup first if you may need it."))return;for(const k of ["materials","cards","subjects","sessions","quizzes","reviewers","settings"]){await new Promise(r=>{const tx=db.transaction(k,"readwrite");tx.objectStore(k).clear();tx.oncomplete=r;});}state={materials:[],cards:[],subjects:[],sessions:[],quizzes:[],reviewers:[],goal:120};deck=[];await refresh();toast("Local study data cleared.");});
(async()=>{try{db=await openDB();await refresh();}catch(e){console.error(e);toast("This browser does not support local database storage.");}})();
})();