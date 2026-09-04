let allFiles=[];const $=id=>document.getElementById(id);
async function load(){
  try{
    const r=await fetch("/api/pdfs?"+Date.now()); if(!r.ok) throw Error();
    allFiles=await r.json(); render();
  }catch(e){$("count").textContent="Server error"; $("empty").classList.remove("hidden")}
}
function render(){
  const q=$("search").value.trim().toLowerCase();
  const files=allFiles.filter(x=>x.title.toLowerCase().includes(q)||x.file.toLowerCase().includes(q));
  $("count").textContent=`${files.length} ឯកសារ`;
  $("grid").innerHTML=files.map((x,i)=>`
    <article class="card"><div class="pdf">PDF</div>
    <h3>${esc(x.title)}</h3><div class="meta">${esc(x.file)}</div>
    <div class="card-actions"><button class="btn primary" onclick="openReader(${i})">📖 អានឯកសារ</button>
    <a class="btn secondary" href="${x.url}" target="_blank">↗</a></div></article>`).join("");
  $("empty").classList.toggle("hidden",files.length>0);
  window.visibleFiles=files;
}
function esc(s){return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}
window.openReader=i=>{const x=window.visibleFiles[i];$("readerTitle").textContent=x.title;$("reader").src=x.url;$("download").href=x.url;$("modal").classList.remove("hidden");document.body.style.overflow="hidden"};
function close(){ $("modal").classList.add("hidden");$("reader").src="about:blank";document.body.style.overflow=""}
$("close").onclick=close;$("modal").onclick=e=>{if(e.target===$("modal"))close()};document.onkeydown=e=>{if(e.key==="Escape")close()};
$("search").oninput=render;$("refresh").onclick=load;
$("theme").onclick=()=>{document.body.classList.toggle("dark");localStorage.theme=document.body.classList.contains("dark")?"dark":"light"};if(localStorage.theme==="dark")document.body.classList.add("dark");
load();
