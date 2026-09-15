const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
let blocks=[],insertIndex=0,coverData="",pastedHtml="";
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const unescapeMd=s=>String(s??"").replace(/\\([~*])/g,"$1");

function sanitize(html){
  const d=new DOMParser().parseFromString(`<div>${html||""}</div>`,"text/html"),r=d.body.firstElementChild;
  r.querySelectorAll("script,style,iframe,object,embed,form,input,button").forEach(x=>x.remove());
  r.querySelectorAll("*").forEach(x=>[...x.attributes].forEach(a=>{const n=a.name.toLowerCase(),v=a.value.trim();if(n==="style"||n.startsWith("on")||n==="srcdoc"||((n==="href"||n==="src")&&/^javascript:/i.test(v)))x.removeAttribute(a.name)}));
  return r.innerHTML;
}
function inline(s){return esc(unescapeMd(s)).replace(/\*\*([^*]+)\*\*/g,"<strong>$1</strong>").replace(/\*([^*]+)\*/g,"<em>$1</em>").replace(/\n/g,"<br>")}
function textOf(html){const x=document.createElement("div");x.innerHTML=html;return x.textContent||""}
function tableFromMarkdown(lines){return{type:"table",caption:"",rows:lines.filter((_,i)=>i!==1).map(line=>line.trim().replace(/^\||\|$/g,"").split("|").map(cell=>unescapeMd(cell.trim()).replace(/^\*\*|\*\*$/g,"")))}}

function parseMarkdown(md){
  const lines=md.replace(/^\uFEFF/,"").replace(/\r/g,"").split("\n"),out=[];let image="",i=0;
  while(i<lines.length){
    const line=lines[i].trim();if(!line){i++;continue}
    const im=line.match(/^!?(?:\[image\]|!\[[^\]]*\])\((https?:\/\/[^)]+)\)$/i);if(im){image=im[1];i++;continue}
    const sp=line.match(/^\*\*([^*\n]+?):\*\*\s*(.*)$/);
    if(sp){let body=sp[2],j=i+1;while(j<lines.length){const raw=lines[j],t=raw.trim();if(!t){if(body&&!body.endsWith("\n"))body+="\n";j++;continue}if(/^\[image\]\(/.test(t)||/^\*\*[^*]+?:\*\*/.test(t)||/^\*\*\*/.test(t)||/^\|/.test(t))break;body+=(body?"\n":"")+raw;j++}out.push({type:"speech",speaker:unescapeMd(sp[1]),body:unescapeMd(body.trim()),avatar:image});image="";i=j;continue}
    if(/^\|/.test(line)&&i+1<lines.length&&/^\|?\s*:?-+/.test(lines[i+1].trim())){const rows=[lines[i]];let j=i+1;while(j<lines.length&&/^\|/.test(lines[j].trim()))rows.push(lines[j++]);out.push(tableFromMarkdown(rows));i=j;continue}
    const narration=line.match(/^\*\*\*(.*?)\*\*\*$/);if(narration){out.push({type:"narration",body:unescapeMd(narration[1])});i++;continue}
    if(image){out.push({type:"contentImage",src:image});image=""}
    let raw=line,j=i+1;while(j<lines.length){const t=lines[j].trim();if(!t||/^\[image\]\(/.test(t)||/^\*\*[^*]+?:\*\*/.test(t)||/^\*\*\*/.test(t)||/^\|/.test(t))break;raw+="\n"+lines[j++]}
    out.push({type:"raw",body:unescapeMd(raw)});i=j;
  }
  if(image)out.push({type:"contentImage",src:image});return out;
}

function htmlTable(table){return{type:"table",caption:table.querySelector("caption")?.textContent?.trim()||"",rows:[...table.querySelectorAll("tr")].map(row=>[...row.children].map(cell=>cell.textContent.trim()))}}
function parseRoll20Html(html){
  const d=new DOMParser().parseFromString(html,"text/html"),out=[];let lastSpeaker="",lastAvatar="";
  [...d.body.children].forEach(el=>{
    if(el.matches(".message.desc")){const c=el.cloneNode(true);c.querySelectorAll(".spacer").forEach(x=>x.remove());out.push({type:"narration",bodyHtml:sanitize(c.innerHTML)});return}
    if(el.matches(".message.general")){
      const c=el.cloneNode(true),currentAvatar=c.querySelector(".avatar img")?.src||"",currentSpeaker=c.querySelector(".by")?.textContent?.replace(/:\s*$/,"").trim()||"";
      if(currentSpeaker)lastSpeaker=currentSpeaker;if(currentAvatar)lastAvatar=currentAvatar;
      const speaker=currentSpeaker||lastSpeaker||"이름 없음",avatar=currentAvatar||lastAvatar||"",tables=[...c.querySelectorAll("table")].map(htmlTable);
      c.querySelectorAll(".sheet-rolltemplate-coc-1,table").forEach(x=>x.remove());c.querySelectorAll(".spacer,.avatar,.by").forEach(x=>x.remove());
      const bodyHtml=sanitize(c.innerHTML),hasBody=textOf(bodyHtml).trim();if(hasBody||tables.length||currentSpeaker)out.push({type:"speech",speaker,bodyHtml,avatar});tables.forEach(t=>out.push(t));return;
    }
    if(el.matches(".sheet-rolltemplate-coc-1")||el.tagName==="TABLE"){const t=el.matches("table")?el:el.querySelector("table");if(t)out.push(htmlTable(t));return}
    const img=el.querySelector?.("img");if(img)out.push({type:"contentImage",src:img.src});
  });return out;
}
function isHtml(s){return /<(div|table|p|span)[\s>]/i.test(s)&&/(class=["'][^"']*(message|sheet-rolltemplate)|<table)/i.test(s)}
function initials(name){return(name||"?").trim().slice(0,1)}
function narrationClass(text){if(/CHAPTER|챕터/i.test(text))return"chapter";if(/판정/.test(text)&&/[✷✦]/.test(text))return"check-banner";if(/^[─━―\s✦✷]+$/.test(text))return"divider-text";return""}
function resultClass(v){if(/대성공|극단|어려운|보통 성공|성공/.test(v))return"result-success";if(/대실패|실패/.test(v))return"result-fail";return""}

function renderBlock(b,i,edit=true){
  let h="";
  if(b.type==="speech"){const body=b.bodyHtml?sanitize(b.bodyHtml):inline(b.body);h=`<div class="message general">${b.avatar?`<img class="avatar" src="${esc(b.avatar)}" alt="${esc(b.speaker)} 인장">`:`<span class="avatar placeholder">${esc(initials(b.speaker))}</span>`}<span class="by editable" ${edit?'contenteditable="true" data-field="speaker"':""}>${esc(b.speaker)}</span><span>:</span> <span class="editable" ${edit?'contenteditable="true" data-field="bodyHtml"':""}>${body}</span></div>`}
  if(b.type==="narration"){const body=b.bodyHtml?sanitize(b.bodyHtml):inline(b.body),cl=narrationClass(textOf(body));h=`<div class="message desc"><span class="editable ${cl}" ${edit?'contenteditable="true" data-field="bodyHtml"':""}>${body}</span></div>`}
  if(b.type==="table")h=`<div class="roll-wrap"><table class="roll-table">${b.caption?`<caption class="editable" ${edit?'contenteditable="true" data-field="caption"':""}>${esc(b.caption)}</caption>`:""}<tbody>${b.rows.map((row,ri)=>`<tr>${row.map((v,ci)=>{const tag=ci===0?"th":"td",cl=ci===1&&/판정결과/.test(row[0])?resultClass(v):"";return`<${tag} class="editable ${cl}" ${edit?`contenteditable="true" data-row="${ri}" data-cell="${ci}"`:""}>${esc(v)}</${tag}>`}).join("")}</tr>`).join("")}</tbody></table></div>`;
  if(b.type==="raw")h=`<div class="raw editable" ${edit?'contenteditable="true" data-field="body"':""}>${inline(b.body)}</div>`;
  if(b.type==="contentImage")h=`<div class="content-image"><img src="${esc(b.src)}" alt="삽입 이미지"></div>`;
  if(b.type==="handout")h=`<article class="handout"><div class="handout-head"><strong class="editable" ${edit?'contenteditable="true" data-field="title"':""}>${esc(b.title)}</strong><small>HANDOUT</small></div><div class="handout-body editable" ${edit&&b.mode==="text"?'contenteditable="true" data-field="body"':""}>${b.mode==="image"?`<img src="${esc(b.data)}" alt="${esc(b.title)}">`:inline(b.body)}</div></article>`;
  if(!edit)return h;return`<div class="block" data-index="${i}">${h}<div class="block-tools"><button type="button" data-move="up">↑</button><button type="button" data-delete>삭제</button><button type="button" data-move="down">↓</button></div></div>`;
}

function sync(el){const wrap=el.closest(".block");if(!wrap)return;const b=blocks[Number(wrap.dataset.index)];if(el.dataset.row!==undefined){b.rows[Number(el.dataset.row)][Number(el.dataset.cell)]=el.textContent;return}if(el.dataset.field==="bodyHtml"){b.bodyHtml=sanitize(el.innerHTML);return}if(el.dataset.field)b[el.dataset.field]=el.textContent}
function render(){
  $("#timeline").innerHTML=blocks.map((b,i)=>`<div class="insert-slot"><button type="button" data-insert="${i}">＋ 핸드아웃</button></div>${renderBlock(b,i)}`).join("")+`<div class="insert-slot"><button type="button" data-insert="${blocks.length}">＋ 핸드아웃</button></div>`;
  const people=new Set(blocks.filter(b=>b.type==="speech"&&b.speaker!=="이름 없음").map(b=>b.speaker));$("#message-count").textContent=`로그 항목 ${blocks.length}`;$("#character-count").textContent=`등장인물 ${people.size}`;$("#handout-count").textContent=`핸드아웃 ${blocks.filter(b=>b.type==="handout").length}`;
  $$('[data-insert]').forEach(x=>x.onclick=()=>openHandout(Number(x.dataset.insert)));$$('[data-delete]').forEach(x=>x.onclick=()=>{blocks.splice(Number(x.closest(".block").dataset.index),1);render()});$$('[data-move]').forEach(x=>x.onclick=()=>{const i=Number(x.closest(".block").dataset.index),j=x.dataset.move==="up"?i-1:i+1;if(j<0||j>=blocks.length)return;[blocks[i],blocks[j]]=[blocks[j],blocks[i]];render()});$$('.editable').forEach(x=>x.addEventListener("input",()=>sync(x)));
}

function fail(m){$("#import-error").textContent=m;$("#import-error").hidden=false}
function start(content,name=""){blocks=isHtml(content)?parseRoll20Html(content):parseMarkdown(content);if(!blocks.length){fail("변환할 수 있는 로그를 찾지 못했어요.");return}$("#title-input").value=$("#session-title").value.trim()||name.replace(/\.(md|markdown|txt|html)$/i,"")||"롤20 세션 로그";$("#import-view").hidden=true;$("#editor-view").hidden=false;render();window.scrollTo(0,0)}
function readFile(file){if(!file)return;const r=new FileReader();r.onload=()=>start(r.result,file.name);r.onerror=()=>fail("파일을 읽지 못했어요.");r.readAsText(file)}
const drop=$("#dropzone");drop.onclick=()=>$("#file-input").click();drop.onkeydown=e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();$("#file-input").click()}};$("#file-input").onchange=e=>readFile(e.target.files[0]);["dragenter","dragover"].forEach(n=>drop.addEventListener(n,e=>{e.preventDefault();drop.classList.add("drag")}));["dragleave","drop"].forEach(n=>drop.addEventListener(n,e=>{e.preventDefault();drop.classList.remove("drag")}));drop.addEventListener("drop",e=>readFile(e.dataTransfer.files[0]));
$("#rich-input").addEventListener("paste",e=>{const html=e.clipboardData.getData("text/html"),text=e.clipboardData.getData("text/plain");if(html){e.preventDefault();pastedHtml=html;$("#rich-input").innerHTML=sanitize(html)}else pastedHtml=text});$("#rich-input").addEventListener("input",()=>{if(!$("#rich-input").innerHTML.trim())pastedHtml=""});$("#convert-button").onclick=()=>{const content=pastedHtml||$("#rich-input").innerText;if(!content.trim()){fail("파일이나 붙여넣은 내용이 없어요.");return}start(content)};

function openHandout(i){insertIndex=i;$("#handout-title").value="";$("#handout-body").value="";$("#handout-image").value="";$("#image-name").textContent="이미지 선택";$("#handout-type").value="text";$("#text-field").hidden=false;$("#image-field").hidden=true;$("#handout-dialog").showModal()}
function closeHandout(){$("#handout-dialog").close()}
$("#modal-x").onclick=closeHandout;$("#modal-cancel").onclick=closeHandout;$("#handout-dialog").addEventListener("click",e=>{if(e.target===$("#handout-dialog"))closeHandout()});$("#handout-type").onchange=e=>{const image=e.target.value==="image";$("#text-field").hidden=image;$("#image-field").hidden=!image};$("#handout-image").onchange=e=>$("#image-name").textContent=e.target.files[0]?.name||"이미지 선택";
$("#add-handout").onclick=()=>{const title=$("#handout-title").value.trim()||"제목 없는 핸드아웃",mode=$("#handout-type").value;if(mode==="text"){blocks.splice(insertIndex,0,{type:"handout",mode,title,body:$("#handout-body").value});closeHandout();render();return}const file=$("#handout-image").files[0];if(!file){toast("이미지를 선택해주세요.");return}const r=new FileReader();r.onload=()=>{blocks.splice(insertIndex,0,{type:"handout",mode,title,data:r.result});closeHandout();render()};r.readAsDataURL(file)};

$("#cover-input").onchange=e=>{const file=e.target.files[0];if(!file)return;const r=new FileReader();r.onload=()=>{coverData=r.result;$("#cover-preview img").src=coverData;$("#cover-preview").hidden=false;$("#remove-cover").hidden=false;$("#cover-label").textContent=file.name};r.readAsDataURL(file)};$("#remove-cover").onclick=()=>{coverData="";$("#cover-preview").hidden=true;$("#remove-cover").hidden=true;$("#cover-label").textContent="이미지 선택"};

const exportCss=`*{box-sizing:border-box}body{margin:0;background:#fff;color:#333;font:13.65px/1.55 "Segoe UI",Roboto,sans-serif}.archive{width:min(960px,100%);margin:auto;background:#f1f1f1}.cover{padding:24px;background:#fff;border-bottom:1px solid #ddd}.cover img{display:block;max-width:100%;max-height:720px;margin:auto}.title{padding:22px;text-align:center;background:#fff;border-bottom:1px solid #ddd}.title h1{margin:0;font:700 28px/1.3 Georgia,serif}.message{position:relative;color:#333}.message.general{padding:7px 16px 8px 45px;background:#f1f1f1!important;max-width:100%;overflow:hidden}.message.desc{padding:8px 18px;background:#f1f1f1;font-style:italic;font-weight:700;text-align:center}.message:before{content:"";position:absolute;top:0;left:0;right:0;height:2px;background:#e1e1e1}.avatar{position:absolute;left:6px;top:8px;width:28px;height:28px;object-fit:cover}.avatar.placeholder{display:grid;place-items:center;border-radius:50%;background:#d3d3d3;font-size:11px;font-weight:700}.by{font-weight:700;margin-right:4px}.chapter,.check-banner{color:#fff!important;background:#33363b!important;font-style:normal}.chapter{display:block;padding:8px 12px;margin:-8px -18px}.check-banner{display:inline-block;border-radius:20px;padding:5px 25px}.divider-text{color:#55585d;font-style:normal}.roll-wrap{padding:8px 16px 9px 45px;background:#f1f1f1;max-width:100%;overflow:hidden}.roll-table,.message table,.sheet-rolltemplate-coc-1 table{border-collapse:collapse;background:#fff;color:#111;width:100%!important;max-width:100%!important;table-layout:fixed!important;font-size:13px}.roll-table caption{padding:3px;color:#fff;background:#111;font-weight:700;border:1px solid #111}.roll-table td,.roll-table th,.message table td,.message table th{border:1px solid #111;padding:3px 6px;min-width:0!important;overflow-wrap:anywhere}.roll-table th{width:38%;text-align:left}.roll-table td{text-align:center}.result-success{background:#18743a!important;color:#fff}.result-fail{background:#bd1831!important;color:#fff}.handout{margin:24px 36px;background:#fff;border:1px solid #242424;box-shadow:6px 6px 0 #bdbdb9}.handout-head{display:flex;justify-content:space-between;background:#242424;color:#fff;padding:9px 13px}.handout-head small{font:700 10px ui-monospace;color:#ddd}.handout-body{padding:18px;white-space:pre-wrap}.handout img,.content-image img{display:block;max-width:100%;max-height:80vh;margin:auto}.content-image{padding:20px;background:#fff}.raw{padding:7px 16px;background:#f1f1f1;white-space:pre-wrap}@media(max-width:600px){.message.general{padding-right:8px}.handout{margin:20px 14px}}`;
function documentHtml(data,title){return`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${exportCss}</style></head><body><main class="archive">${coverData?`<div class="cover"><img src="${coverData}" alt="${esc(title)} 썸네일"></div>`:""}<header class="title"><h1>${esc(title)}</h1></header>${data.map((b,i)=>renderBlock(b,i,false)).join("")}</main></body></html>`}
async function embedAvatars(){const copy=structuredClone(blocks),urls=[...new Set(copy.filter(b=>b.avatar&&!b.avatar.startsWith("data:")).map(b=>b.avatar))];if(!urls.length)return copy;$("#image-status").hidden=false;let ok=0;for(let i=0;i<urls.length;i++){const u=urls[i];$("#image-status").textContent=`인장 저장 중 ${i+1}/${urls.length}`;try{const response=await fetch(u);if(!response.ok)throw new Error();const blob=await response.blob(),data=await new Promise((yes,no)=>{const r=new FileReader();r.onload=()=>yes(r.result);r.onerror=no;r.readAsDataURL(blob)});copy.forEach(b=>{if(b.avatar===u)b.avatar=data});ok++}catch{}}$("#image-status").textContent=ok===urls.length?`인장 ${ok}개를 HTML에 저장했어요.`:`인장 ${ok}/${urls.length}개 저장. 나머지는 원본 링크로 유지돼요.`;return copy}
async function finalHtml(){const data=$("#embed-images").checked?await embedAvatars():structuredClone(blocks),title=$("#title-input").value.trim()||"롤20 세션 로그";return documentHtml(data,title)}
$("#preview-button").onclick=async()=>{const html=await finalHtml(),url=URL.createObjectURL(new Blob([html],{type:"text/html"}));$("#preview-frame").src=url;$("#preview-dialog").showModal()};$("#preview-close").onclick=()=>$("#preview-dialog").close();$("#download-button").onclick=async()=>{const html=await finalHtml(),title=$("#title-input").value.trim()||"롤20 세션 로그",a=document.createElement("a");a.href=URL.createObjectURL(new Blob([html],{type:"text/html;charset=utf-8"}));a.download=title.replace(/[\\/:*?"<>|]/g,"_")+".html";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),3000);toast("HTML을 저장했어요.")};
$("#reset-button").onclick=()=>{if(!confirm("현재 편집 내용을 닫을까요?"))return;blocks=[];coverData="";pastedHtml="";$("#editor-view").hidden=true;$("#import-view").hidden=false;$("#rich-input").innerHTML="";window.scrollTo(0,0)};
function toast(m){const t=$("#toast");t.textContent=m;t.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.hidden=true,2400)}
