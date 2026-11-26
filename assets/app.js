let DATA = null;

/* ====================== 路由与渲染 ======================
   DATA 由末尾 boot() 异步注入；以下逻辑与原单文件版逐行一致，8 处 DATA.xxx 引用未改动。 */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ====================== Markdown（零依赖；先 esc 再解析） ======================
   安全原则：只做「已转义文本」上的结构化替换；所有 href/src 走白名单；
   不识别的语法原样保留为纯文本；表格结构异常整段降级，不产生半渲染 HTML。 */
function safeHref(href){
  const h = String(href ?? "").trim();
  if (!h) return null;
  if (/^(?:https?:\/\/|mailto:)/i.test(h)) return h;
  if (/^[a-z][a-z0-9+.-]*:/i.test(h)) return null;   // javascript: / data: 等一律拒绝
  if (h.startsWith("/") || h.startsWith("//")) return null; // Pages 子路径部署绝对路径会 404
  if (/(^|\/)\.\.(\/|$)/.test(h)) return null;       // 目录穿越
  return /^[^\s<>"']+$/.test(h) ? h : null;
}
function safeVideoSrc(src){
  const s = String(src ?? "").trim();
  if (!/^videos\/[\w\-/]+\.mp4$/i.test(s)) return null; // 仅站内 videos/ 下的 mp4
  if (/(^|\/)\.\.(\/|$)/.test(s)) return null;
  return s;
}
function mdInline(s, boldOnly){
  if (boldOnly) return s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  const store = [];
  const stash = html => { store.push(html); return "\u0001" + (store.length - 1) + "\u0001"; };
  // 顺序：视频 → 链接 → 裸 URL → 粗体 → 斜体；HTML 存入占位符，后续正则不再处理
  s = s.replace(/!\[([^\]\n]*)\]\(([^)\s]+)\)/g, (m, _label, src) => {
    const ok = safeVideoSrc(src);
    return stash(ok ? '<video controls preload="metadata" src="' + ok + '"></video>' : m);
  });
  s = s.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (m, label, href) => {
    const ok = safeHref(href);
    return ok ? stash('<a href="' + ok + '" target="_blank" rel="noopener">' + label + "</a>") : m;
  });
  s = s.replace(/https?:\/\/[^\s<>"']+/g, m => {
    const tm = m.match(/[.,;:!?，。；、！？）】」]+$/);
    const tail = tm ? tm[0] : "";
    const url = m.slice(0, m.length - tail.length);
    if (!safeHref(url)) return m;
    return stash('<a href="' + url + '" target="_blank" rel="noopener">' + url + "</a>") + tail;
  });
  s = s.replace(/\*\*([^*\n]+)\*\*/g, (m, t) => stash("<strong>" + t + "</strong>"));
  s = s.replace(/\*([^*\n]+)\*/g, (m, t) => stash("<em>" + t + "</em>"));
  for (let k = 0; k < 10; k++){
    const next = s.replace(/\u0001(\d+)\u0001/g, (_, i) => store[+i] ?? "");
    if (next === s) break;
    s = next;
  }
  return s;
}
function mdTableRow(line){
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map(x => x.trim());
}
function mdIsSep(line){
  const c = mdTableRow(line);
  return c.length >= 1 && c.every(x => /^:?-{3,}:?$/.test(x));
}
function md(text, { boldOnly = false } = {}){
  const src = String(text ?? "");
  if (boldOnly) return mdInline(esc(src.replace(/\n/g, " ")), true);
  const lines = esc(src).split("\n");
  const out = [];
  let para = [];
  const flush = () => {
    if (!para.length) return;
    out.push("<p>" + para.map(l => mdInline(l, false)).join("<br>") + "</p>");
    para = [];
  };
  for (let i = 0; i < lines.length; i++){
    const t = lines[i].trim();
    if (!t){ flush(); continue; }
    const h = /^(#{1,3})\s+(.+)$/.exec(t);
    if (h){
      flush();
      const lv = h[1].length;
      out.push("<h" + lv + ">" + mdInline(h[2], false) + "</h" + lv + ">");
      continue;
    }
    if (/^-{3,}$/.test(t)){ flush(); out.push("<hr>"); continue; }
    if (t.includes("|") && i + 1 < lines.length && mdIsSep(lines[i + 1])){
      const head = mdTableRow(t), sep = mdTableRow(lines[i + 1]), rows = [];
      let j = i + 2;
      while (j < lines.length && lines[j].trim().includes("|")){ rows.push(mdTableRow(lines[j])); j++; }
      if (head.length === sep.length && rows.every(r => r.length === head.length)){
        flush();
        out.push("<table><thead><tr>" + head.map(c => "<th>" + mdInline(c, false) + "</th>").join("") + "</tr></thead><tbody>" +
          rows.map(r => "<tr>" + r.map(c => "<td>" + mdInline(c, false) + "</td>").join("") + "</tr>").join("") + "</tbody></table>");
        i = j - 1;
        continue;
      }
      // 列数不一致 / 分隔行非法 → 落入下方普通段落处理
    }
    para.push(lines[i]);
  }
  flush();
  return out.join("");
}

function parseHash(){
  const h = location.hash.replace(/^#/, "") || "/";
  const [path, qs] = h.split("?");
  return { path, q:Object.fromEntries(new URLSearchParams(qs || "")) };
}
const categories = () => [...new Set(DATA.items.map(i => i.category))];

function go(hash){ location.hash = hash; }
function jumpTo(y){
  const root = document.documentElement;
  const prev = root.style.scrollBehavior;
  root.style.scrollBehavior = "auto";
  window.scrollTo(0, y);
  root.style.scrollBehavior = prev;
}

let currentMode = "", storyObserver = null;
let pendingSection = null, resumeScroll = false, storyScrollY = 0;
let lastQueryHash = "#/query";

function scrollToPending(){
  if (!pendingSection) return;
  const t = pendingSection; pendingSection = null;
  requestAnimationFrame(() => document.getElementById(t)?.scrollIntoView({behavior:"smooth", block:"start"}));
}
document.addEventListener("click", e => {
  const resumeEl = e.target.closest("[data-resume]");
  if (resumeEl){
    e.preventDefault();
    resumeScroll = true; pendingSection = null;
    $("#sidebar").classList.remove("open");
    go("#/story"); return;
  }
  const el = e.target.closest("[data-nav],[data-scroll]");
  if (!el) return;
  e.preventDefault();
  $("#sidebar").classList.remove("open");
  if (el.dataset.scroll){
    pendingSection = el.dataset.scroll; resumeScroll = false;
    if (parseHash().path !== "/story") go("#/story");
    else scrollToPending();
  } else go(el.dataset.nav);
});
$("#hamburger").addEventListener("click", () => $("#sidebar").classList.toggle("open"));

function renderSideNav(mode){
  $("#mode-story").classList.toggle("on", mode === "story");
  $("#mode-query").classList.toggle("on", mode === "query");
  $("#mode-policy").classList.toggle("on", mode === "policy");
  const nav = $("#side-nav"), label = $("#side-label");
  if (mode === "story"){
    label.textContent = "三大目录 / 小目录";
    nav.innerHTML = DATA.chapters.map(ch => `
      <div class="side-group">${ch.no} ${esc(ch.title)}</div>
      ${ch.sections.map(s => `<a class="sub" href="#/story" data-scroll="${s.id}">${esc(s.title)}</a>`).join("")}
    `).join("");
  } else if (mode === "policy"){
    label.textContent = "快捷检索词（仅检索）";
    nav.innerHTML = ["人工智能","智能制造","高端装备","绿色低碳","数字经济"]
      .map(w => `<a href="#/policy?q=${encodeURIComponent(w)}">${esc(w)}</a>`).join("");
  } else {
    label.textContent = "分类入口";
    nav.innerHTML = categories().map(c => `<a href="#/query?cat=${encodeURIComponent(c)}">${esc(c)}</a>`).join("");
  }
}

function showCover(){
  $("#view-cover").style.display = "flex";
  $("#layout").classList.remove("active");
  currentMode = "";
  updateProgress();
}
function updateProgress(){
  if (currentMode !== "story"){ $("#progress").style.width = "0%"; return; }
  const d = document.documentElement;
  const h = d.scrollHeight - d.clientHeight;
  $("#progress").style.width = (h > 0 ? Math.min(100, Math.max(0, d.scrollTop / h * 100)) : 0) + "%";
}
window.addEventListener("scroll", updateProgress, { passive:true });
window.addEventListener("resize", updateProgress);
function showLayout(title, mode){
  $("#view-cover").style.display = "none";
  $("#layout").classList.add("active");
  $("#topbar-title").textContent = title;
  currentMode = mode;
  renderSideNav(mode);
  $("#progress-wrap").style.display = mode === "story" ? "block" : "none";
  updateProgress();
}

/* ---------- 叙事层 ---------- */
function renderStory(){
  showLayout("叙事层", "story");
  const main = $("#main");
  const secHtml = s => `<section class="sub-sec" id="${s.id}">
      <div class="sec-head">
        <h3>${esc(s.title)}</h3>
        ${s.speaker ? `<span class="speaker">${esc(s.speaker)}</span>` : ""}
        ${s.verify ? `<span class="badge">待核查 · ${esc(s.verifyNote || "")}</span>` : ""}
      </div>
      <p class="lead">${esc(s.lead)}</p>
      ${(s.paras || []).map(p => `<div class="para md">${md(p)}</div>`).join("")}
      ${s.note ? `<p class="note">${esc(s.note)}</p>` : ""}
      ${s.stats ? `<div class="cards">${s.stats.map(t => `<div class="stat"><b>${esc(t.num)}</b><span>${esc(t.label)}</span><span class="src">${esc(t.src || "")}</span></div>`).join("")}</div>` : ""}
      ${s.bars ? `<div>${s.bars.map(b => `<div class="bar-row"><span>${esc(b.name)}</span><span class="bar-track"><span class="bar-fill" style="width:${b.pct}%"></span></span><span>${b.pct}%</span></div>`).join("")}</div>` : ""}
      ${s.drill?.length ? `<a class="drill" href="#/query?cat=${s.drill.map(encodeURIComponent).join(",")}${s.highlight?.length ? "&hl=" + s.highlight.map(encodeURIComponent).join(",") : ""}" data-drill>查看相关数据 →</a>` : ""}
    </section>`;
  main.innerHTML = `<div class="story">` + DATA.chapters.map(ch => `
      <section class="chapter-head" id="${ch.id}">
        <div class="chapter-no">CHAPTER ${ch.no}</div>
        <h2>${esc(ch.title)}</h2>
        <p>${esc(ch.sub)}</p>
        ${ch.source ? `<div class="source">${esc(ch.source)}</div>` : ""}
      </section>
      ${ch.sections.map(secHtml).join("")}
    `).join("") + `</div>`;
  if (storyObserver) storyObserver.disconnect();
  storyObserver = new IntersectionObserver(es => es.forEach(x => x.isIntersecting && x.target.classList.add("show")), { threshold:.08 });
  main.querySelectorAll("section").forEach(sec => storyObserver.observe(sec));
  main.querySelectorAll("[data-drill]").forEach(a => a.addEventListener("click", e => {
    e.preventDefault();
    storyScrollY = document.documentElement.scrollTop;
    go(a.getAttribute("href"));
  }));
  if (resumeScroll){
    resumeScroll = false;
    requestAnimationFrame(() => jumpTo(storyScrollY));
  } else if (pendingSection){
    scrollToPending();
  } else {
    jumpTo(0);
  }
  updateProgress();
}

/* ---------- 查询层 ---------- */
const qState = { q:"", cats:new Set(), hl:new Set(), sort:"year", view:"card" };
function syncQueryHash(){
  const p = new URLSearchParams();
  if (qState.q.trim()) p.set("q", qState.q.trim());
  if (qState.cats.size) p.set("cat", [...qState.cats].join(","));
  if (qState.hl.size) p.set("hl", [...qState.hl].join(","));
  if (qState.sort !== "year") p.set("sort", qState.sort);
  if (qState.view !== "card") p.set("view", qState.view);
  const s = p.toString();
  lastQueryHash = "#/query" + (s ? "?" + s : "");
  try { history.replaceState(null, "", lastQueryHash); } catch(_){}
}
function renderQuery(params){
  showLayout("查询层", "query");
  qState.q = params.q || "";
  qState.cats = new Set(params.cat ? params.cat.split(",") : []);
  qState.hl = new Set(params.hl ? params.hl.split(",") : []);
  qState.sort = ["title", "chapter"].includes(params.sort) ? params.sort : "year";
  qState.view = params.view === "table" ? "table" : "card";
  $("#main").innerHTML = `<div class="query">
    <div class="q-toolbar">
      <input id="q-input" type="search" placeholder="搜索标题 / 摘要 / 标签…" value="${esc(qState.q)}">
      <span style="display:flex;gap:8px;">
        <select id="q-sort"><option value="year">按年份</option><option value="title">按标题</option><option value="chapter">按章节</option></select>
        <button class="chip" id="q-view">视图：${qState.view === "card" ? "卡片" : "表格"}</button>
      </span>
    </div>
    <div class="q-chips" id="q-cats"></div>
    <div id="q-results"></div>
  </div>`;
  $("#q-cats").innerHTML = categories().map(c => `<button class="chip ${qState.cats.has(c) ? "on" : ""}" data-cat="${esc(c)}">${esc(c)}</button>`).join("");
  $("#q-input").addEventListener("input", e => { qState.q = e.target.value; drawResults(); syncQueryHash(); });
  $("#q-sort").value = qState.sort;
  $("#q-sort").addEventListener("change", e => { qState.sort = e.target.value; drawResults(); syncQueryHash(); });
  $("#q-view").addEventListener("click", () => { qState.view = qState.view === "card" ? "table" : "card"; $("#q-view").textContent = "视图：" + (qState.view === "card" ? "卡片" : "表格"); drawResults(); syncQueryHash(); });
  $("#q-cats").addEventListener("click", e => {
    const b = e.target.closest("[data-cat]"); if (!b) return;
    qState.cats.has(b.dataset.cat) ? qState.cats.delete(b.dataset.cat) : qState.cats.add(b.dataset.cat);
    b.classList.toggle("on");
    drawResults(); syncQueryHash();
  });
  drawResults();
  syncQueryHash();
  jumpTo(0);
}
/* 按叙事层 highlight 的章节顺序排序；同一小节内按 id 字典序。
   同一卡被多小节高亮时取首次出现；未被任何小节高亮的排在末尾。 */
function chapterRank(){
  const rank = new Map();
  let n = 0;
  (DATA.chapters || []).forEach(ch => (ch.sections || []).forEach(sec => {
    (sec.highlight || []).forEach(id => { if (!rank.has(id)) rank.set(id, n); });
    n++;
  }));
  return rank;
}
function drawResults(){
  const kw = qState.q.trim().toLowerCase();
  let list = DATA.items.filter(it => {
    if (qState.cats.size && !qState.cats.has(it.category)) return false;
    if (!kw) return true;
    return [it.title, it.summary, it.chapter, ...(it.tags||[])].join(" ").toLowerCase().includes(kw);
  });
  if (qState.sort === "chapter"){
    const rank = chapterRank();
    const last = (DATA.chapters || []).reduce((n, ch) => n + (ch.sections || []).length, 0);
    list.sort((a,b) => {
      const ra = rank.has(a.id) ? rank.get(a.id) : last;
      const rb = rank.has(b.id) ? rank.get(b.id) : last;
      return ra - rb || String(a.id).localeCompare(String(b.id));
    });
  } else {
    list.sort((a,b) => qState.sort === "year" ? (b.year - a.year) : String(a.title).localeCompare(String(b.title), "zh"));
  }
  const box = $("#q-results");
  if (!list.length){ box.innerHTML = `<div class="empty">没有匹配的条目</div>`; return; }
  if (qState.view === "card"){
    box.innerHTML = `<div class="item-list">` + list.map(it => `
      <a class="item-card${qState.hl.has(it.id) ? " hl" : ""}" href="#/item/${it.id}">
        <h3>${esc(it.title)}${it.verify ? `<span class="badge">待核查</span>` : ""}</h3>
        <p>${md(it.summary, { boldOnly:true })}</p>
        <div class="meta">${esc(it.category)} · ${esc(it.chapter)} · ${esc(it.year)}</div>
      </a>`).join("") + `</div>`;
  } else {
    box.innerHTML = `<table><thead><tr><th>标题</th><th>分类</th><th>目录</th><th>年份</th></tr></thead><tbody>` +
      list.map(it => `<tr class="${qState.hl.has(it.id) ? "hl" : ""}"><td><a href="#/item/${it.id}">${esc(it.title)}</a>${it.verify ? ` <span class="badge">待核查</span>` : ""}</td><td>${esc(it.category)}</td><td>${esc(it.chapter)}</td><td>${esc(it.year)}</td></tr>`).join("") +
      `</tbody></table>`;
  }
}

/* ---------- 详情 ---------- */
function renderDetail(id){
  showLayout("详情", "query");
  const it = DATA.items.find(x => x.id === id);
  $("#main").innerHTML = it ? `<div class="detail">
      <div style="display:flex;gap:16px;flex-wrap:wrap;">
        <a class="drill" href="${esc(lastQueryHash)}">← 返回查询层</a>
        <a class="drill" href="#/story" data-resume>← 返回叙事主线</a>
      </div>
      <h2 style="margin-top:12px;">${esc(it.title)}${it.verify ? ` <span class="badge">待核查</span>` : ""}</h2>
      <div class="meta">${esc(it.category)} · ${esc(it.chapter)} · ${esc(it.year)}</div>
      ${(it.links && it.links.length) ? `<div class="src-links"><span class="src-label">数据来源</span>${it.links.map(l => { const href = safeHref(l.href); return href ? `<a class="src-link" href="${esc(href)}" target="_blank" rel="noopener">${esc(l.text)} ↗</a>` : `<span class="src-text">${esc(l.text)}</span>`; }).join("")}</div>` : (it.source ? `<div class="src-links"><span class="src-label">数据来源</span><span class="src-text">${esc(it.source)}</span></div>` : "")}
      <div class="body md">${md(it.detail)}</div>
      ${it.verify ? `<p class="note">本条尚未人工核查。请按《人工核查目录.md》核对后，替换 data/items.json 中对应字段，并把 verify 改为 false。</p>` : ""}
      <div class="tags">${(it.tags||[]).map(t => `<span>${esc(t)}</span>`).join("")}</div>
    </div>` : `<div class="detail"><p class="empty">条目不存在</p></div>`;
  jumpTo(0);
}

/* ---------- 政策层：仅检索中国政府网权威原文，不生成 / 不摘要 / 不解读 ---------- */
const POLICY_API = "https://sousuo.www.gov.cn/search-gov/data";
const POLICY_MAX = 100;      // 接口 n 上限，超过会被服务端拒绝
const POLICY_TIMEOUT = 8000;
const pState = { q:"", field:"quanwen", org:"", year:"", rows:[], total:0, cachedAt:0, loading:false, error:"" };
const policyCache = new Map();
let policyAbort = null, policyTimer = null, policySeq = 0;

// 外部输入一律先 esc，再在已转义文本上做清洗；不把 <em> 转成可注入的 markup
function policyText(s){
  return esc(s)
    .replace(/&lt;\/?em&gt;/gi, "")
    .replace(/&amp;nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function policyHref(raw){
  const h = safeHref(raw);
  if (!h || !/^https?:\/\//i.test(h)) return null;
  try {
    const host = new URL(h).hostname.toLowerCase();
    return (host === "gov.cn" || host.endsWith(".gov.cn")) ? h : null;
  } catch(_){ return null; }
}
async function fetchPolicy({ q, field }, signal){
  const u = new URL(POLICY_API);
  Object.entries({ t:"zhengcelibrary_gw", q, searchfield:field, p:"1", n:String(POLICY_MAX), sort:"pubtime", sortType:"1" })
    .forEach(([k,v]) => u.searchParams.set(k, v));
  for (let attempt = 1; attempt <= 2; attempt++){
    const ac = new AbortController();
    const onAbort = () => ac.abort();
    if (signal) signal.addEventListener("abort", onAbort, { once:true });
    const timer = setTimeout(() => ac.abort(), POLICY_TIMEOUT);
    try {
      const res = await fetch(u, { signal:ac.signal, cache:"no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status + " " + res.statusText);
      const j = await res.json();
      if (j.code === 1001) return { rows:[], total:0 };
      if (j.code !== 200) throw new Error("接口返回 code=" + j.code);
      const rows = j?.searchVO?.listVO;
      if (!Array.isArray(rows)) throw new Error("接口字段缺失：searchVO.listVO");
      return { rows, total: Number(j.totalCount) || rows.length };
    } catch(e){
      if ((signal && signal.aborted) || ac.signal.aborted || attempt === 2) throw e;
      await new Promise(r => setTimeout(r, 400));
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
    }
  }
}
function syncPolicyHash(){
  const p = new URLSearchParams();
  if (pState.q.trim()) p.set("q", pState.q.trim());
  if (pState.field !== "quanwen") p.set("field", pState.field);
  if (pState.org) p.set("org", pState.org);
  if (pState.year) p.set("year", pState.year);
  const s = p.toString();
  try { history.replaceState(null, "", "#/policy" + (s ? "?" + s : "")); } catch(_){}
}
function policyRows(){
  return pState.rows.filter(r => {
    if (pState.org && r.puborg !== pState.org) return false;
    if (pState.year && String(new Date(Number(r.pubtime || 0)).getFullYear()) !== pState.year) return false;
    return true;
  });
}
function drawPolicyResults(){
  const box = $("#policy-results"), st = $("#policy-status");
  if (!box || !st) return;
  const rows = policyRows();
  if (!rows.length){
    const filtered = pState.rows.length > 0;
    st.innerHTML = filtered
      ? `<div class="policy-error">关键词命中 ${pState.rows.length} 条，但被当前机关 / 年份筛选全部过滤。本层只取最新 ${POLICY_MAX} 条，时间筛选为本地过滤（接口时间参数不生效），请清除筛选后再试。</div>`
      : `<div class="empty">未找到匹配政策。试试更短的关键词、切换到标题检索，或清除筛选。</div>`;
    box.innerHTML = ""; return;
  }
  st.innerHTML = `<div class="meta">共 ${esc(pState.total)} 条命中；当前展示最新 ${esc(pState.rows.length)} 条${pState.org || pState.year ? `，筛选后 ${rows.length} 条` : ""}。</div>`;
  box.innerHTML = `<div class="item-list">${rows.map(r => {
    const href = policyHref(r.url);
    const inner = `<h3>${policyText(r.title)}${href ? " ↗" : ""}</h3>
      <p>${policyText(r.summary || "")}</p>
      <div class="meta">${policyText(r.puborg)} · ${policyText(r.pubtimeStr)} · ${policyText(r.childtype)}</div>
      ${r.pcode || r.index ? `<div class="pcode">${policyText(r.pcode || "")}${r.pcode && r.index ? " · " : ""}${policyText(r.index || "")}</div>` : ""}`;
    return href
      ? `<a class="item-card policy-card" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${inner}</a>`
      : `<div class="item-card policy-card">${inner}</div>`;
  }).join("")}</div>`;
}
function renderPolicyFilters(){
  const orgs = [...new Set(pState.rows.map(r => r.puborg).filter(Boolean))];
  const years = [...new Set(pState.rows.map(r => r.pubtime ? String(new Date(Number(r.pubtime)).getFullYear()) : "").filter(y => y && y !== "NaN"))].sort().reverse();
  const orgBox = $("#p-orgs"), yearBox = $("#p-years");
  if (orgBox) orgBox.innerHTML = `<span class="src-label">发文机关</span>` +
    (orgs.length ? orgs.map(o => `<button class="chip${pState.org === o ? " on" : ""}" data-org="${esc(o)}">${esc(o)}</button>`).join("") : `<span class="meta">无</span>`) +
    `<button class="chip${pState.org ? "" : " on"}" data-org="">全部</button>`;
  if (yearBox) yearBox.innerHTML = `<span class="src-label">年份</span>` +
    (years.length ? years.map(y => `<button class="chip${pState.year === y ? " on" : ""}" data-year="${esc(y)}">${esc(y)}</button>`).join("") : `<span class="meta">无</span>`) +
    `<button class="chip${pState.year ? "" : " on"}" data-year="">全部</button>` +
    `<span class="meta">（本地过滤，接口时间参数不生效）</span>`;
}
async function runPolicySearch(){
  clearTimeout(policyTimer);
  policyTimer = setTimeout(async () => {
    if (policyAbort) policyAbort.abort();
    const ac = new AbortController(); policyAbort = ac;
    const seq = ++policySeq;
    const key = pState.field + "|" + pState.q.trim();
    pState.loading = true; pState.error = "";
    const st = $("#policy-status");
    if (st) st.innerHTML = `<div class="policy-loading">正在检索国务院政策文件库…</div>`;
    try {
      const res = await fetchPolicy({ q:pState.q.trim(), field:pState.field }, ac.signal);
      if (seq !== policySeq) return;              // 过期响应直接丢弃
      pState.rows = res.rows; pState.total = res.total;
      pState.cachedAt = Date.now();
      policyCache.set(key, { rows:res.rows, total:res.total, at:pState.cachedAt });
      if (policyCache.size > 20) policyCache.delete(policyCache.keys().next().value);
      pState.org = ""; pState.year = "";
      renderPolicyFilters(); drawPolicyResults();
    } catch(e){
      if (seq !== policySeq || ac.signal.aborted) return;
      const c = policyCache.get(key);
      if (c){
        pState.rows = c.rows; pState.total = c.total; pState.cachedAt = c.at;
        pState.error = "离线缓存 · 检索于 " + new Date(c.at).toLocaleTimeString("zh-CN", {hour:"2-digit", minute:"2-digit"}) + " · " + e.message;
        renderPolicyFilters(); drawPolicyResults();
      } else {
        pState.error = "检索失败：" + e.message + "。请检查网络后重试。";
        pState.rows = []; pState.total = 0;
        $("#policy-results").innerHTML = "";
        st.innerHTML = `<div class="policy-error">${esc(pState.error)} <button class="chip" id="p-retry">重试</button></div>`;
        $("#p-retry")?.addEventListener("click", runPolicySearch);
      }
    } finally {
      if (seq === policySeq) pState.loading = false;
    }
  }, 350);
}
function renderPolicy(params = {}){
  showLayout("政策层 · 政策检索", "policy");
  pState.q = params.q || "";
  pState.field = params.field === "title" ? "title" : "quanwen";
  pState.org = params.org || "";
  pState.year = params.year || "";
  pState.error = "";
  $("#main").innerHTML = `<div class="query policy">
    <div class="policy-notice">本层仅检索并跳转至中国政府网原文。政策概念、理论表述与引语以权威原文为准；本站不代写、不改写、不生成政策内容。</div>
    <div class="q-toolbar">
      <input id="p-input" type="search" placeholder="检索政策标题 / 全文，如：人工智能、智能制造" value="${esc(pState.q)}">
      <button class="chip${pState.field === "title" ? " on" : ""}" id="p-field" title="切换标题/全文检索">${pState.field === "title" ? "标题检索" : "全文检索"}</button>
    </div>
    <div class="q-chips" id="p-orgs"></div>
    <div class="q-chips" id="p-years"></div>
    <div id="policy-status"></div>
    <div id="policy-results"></div>
  </div>`;
  $("#p-input").addEventListener("input", e => { pState.q = e.target.value; syncPolicyHash(); runPolicySearch(); });
  $("#p-field").addEventListener("click", () => {
    pState.field = pState.field === "title" ? "quanwen" : "title";
    $("#p-field").textContent = pState.field === "title" ? "标题检索" : "全文检索";
    $("#p-field").classList.toggle("on", pState.field === "title");
    syncPolicyHash(); runPolicySearch();
  });
  $("#p-orgs").addEventListener("click", e => {
    const b = e.target.closest("[data-org]"); if (!b) return;
    pState.org = b.dataset.org; syncPolicyHash(); renderPolicyFilters(); drawPolicyResults();
  });
  $("#p-years").addEventListener("click", e => {
    const b = e.target.closest("[data-year]"); if (!b) return;
    pState.year = b.dataset.year; syncPolicyHash(); renderPolicyFilters(); drawPolicyResults();
  });
  jumpTo(0);
  runPolicySearch();
}

function router(){
  const { path, q } = parseHash();
  if (path === "/" || path === "") return showCover();
  if (path === "/story") return renderStory();
  if (path === "/query") return renderQuery(q);
  if (path === "/policy") return renderPolicy(q);
  if (path.startsWith("/item/")) return renderDetail(path.slice(6));
  showCover();
}


/* =====================================================================
   数据加载与启动
   DATA 由 boot() 异步赋值；hashchange 与首次 router() 均在赋值之后注册/调用，
   因此上方所有函数里的 DATA.xxx 闭包引用与原版完全等价。
   ===================================================================== */
const DATA_BASE = "data/";
const $boot = () => document.getElementById("boot");

async function fetchJSON(rel, { noStore = false, v = "" } = {}){
  const url = DATA_BASE + rel + (v ? "?v=" + encodeURIComponent(v) : "");
  let res;
  try {
    res = await fetch(url, noStore ? { cache: "no-store" } : undefined);
  } catch (e) {
    throw new Error(rel + "：请求失败（" + e.message + "）。若用 file:// 双击打开，fetch 会被 CORS 拦截，请改用本地 HTTP 服务器");
  }
  if (!res.ok) throw new Error(rel + "：HTTP " + res.status + " " + res.statusText);
  try { return await res.json(); }
  catch (e) { throw new Error(rel + "：JSON 格式错误（" + e.message + "）；请检查双引号、尾逗号、注释与 BOM"); }
}

function validate(d){
  const bad = [];
  if (!d.meta || typeof d.meta.title !== "string") bad.push("meta.json 缺少 title");
  if (!Array.isArray(d.items)) bad.push("items.json 根必须是数组");
  if (!Array.isArray(d.chapters) || !d.chapters.length) bad.push("chapters 为空");
  (Array.isArray(d.chapters) ? d.chapters : []).forEach((ch, i) => {
    if (!ch || !Array.isArray(ch.sections)) bad.push("第 " + (i + 1) + " 个章节缺少 sections 数组");
  });
  if (bad.length) throw new Error("数据结构校验失败：\n" + bad.join("\n"));
}

async function loadAllData(){
  // manifest 不走缓存，保证 dataVersion 一改立即生效；其余文件用 ?v= 版本化
  const manifest = await fetchJSON("manifest.json", { noStore: true });
  const v = manifest.dataVersion || "";
  const chapters = Array.isArray(manifest.chapters) ? manifest.chapters : [];

  const tasks = [
    fetchJSON(manifest.meta || "meta.json", { v }).then(val => ({ k:"meta", val })),
    fetchJSON(manifest.items || "items.json", { v }).then(val => ({ k:"items", val })),
    ...chapters.map(f => fetchJSON(f, { v }).then(val => ({ k:"chapter", val })))
  ];
  // allSettled 收集全部失败文件，但任一失败即抛错 → 绝不降级渲染半页
  const settled = await Promise.allSettled(tasks);
  const failed = settled.filter(r => r.status === "rejected");
  if (failed.length) throw new Error(failed.map(r => "· " + r.reason.message).join("\n"));
  const ok = settled.map(r => r.value); // allSettled 保序 → chapters 顺序 == manifest 顺序

  const assembled = {
    meta: ok.find(x => x.k === "meta").val,
    items: ok.find(x => x.k === "items").val,
    chapters: ok.filter(x => x.k === "chapter").map(x => x.val)
  };
  validate(assembled);
  return assembled;
}

function setBoot(html, isError = false){
  const el = $boot();
  el.innerHTML = html;
  el.classList.toggle("error", isError);
  el.classList.remove("hide");
}
function showBootError(err){
  setBoot('<div class="boot-box">' +
    '<h2>资料库加载失败</h2>' +
    '<pre>' + esc(err.message) + '</pre>' +
    '<p>常见原因：用 file:// 直接双击打开（fetch 被 CORS 拦截）、JSON 语法错误、或文件未推送到 GitHub Pages。</p>' +
    '<button id="boot-retry" type="button">重试</button></div>', true);
  $("#boot-retry").addEventListener("click", () => boot());
}
function setMeta(){
  $("#cover-title").textContent = DATA.meta.title;
  $("#cover-sub").textContent = DATA.meta.sub;
  $("#cover-ver").textContent = DATA.meta.version;
}
let booted = false;
async function boot(){
  setBoot('<div class="boot-box"><div class="boot-spin"></div><p>正在加载资料库…</p></div>');
  try {
    DATA = await loadAllData();          // 唯一赋值点
    setMeta();                           // 先填封面，遮罩消失时无空白闪烁
    if (!booted){
      window.addEventListener("hashchange", router); // 原 L666，移到赋值后且只注册一次
      booted = true;
    }
    router();                            // 读取当前 hash，支持深链接直开
    $boot().classList.add("hide");
  } catch (err) {
    console.error("[boot]", err);
    showBootError(err);                 // 遮罩保留 → 不白屏
  }
}

boot();
