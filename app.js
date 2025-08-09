// app.js
// 데이터 파일: webtoon_data.json (index.html과 같은 폴더)
const TAG_MIN_COUNT = 99;        // ✅ 100개 미만은 숨김(= 100 이상만 버튼 생성)
const NO_TAG = "태그없음";        // 가짜 태그 이름

const state = {
  items: [],
  selected: new Set(),           // 선택된 태그들 (여러 개 AND)
  query: "",
  pageSize: 60,
  page: 1,
};

// DOM
const qInput       = document.getElementById('q');
const tagsBox      = document.getElementById('tags');
const grid         = document.getElementById('grid');
const emptyBox     = document.getElementById('empty');
const errorBox     = document.getElementById('error');
const statTotal    = document.getElementById('stat-total');
const statShow     = document.getElementById('stat-show');
const btnClear     = document.getElementById('clear');
const loadMoreBtn  = document.getElementById('load-more');
// ⬇ 모바일 전용 토글/선택 표시줄
const tagToggleBtn = document.getElementById('tag-toggle');
const selectedBar  = document.getElementById('selected-tags');

// 유틸
const text = (v) => (v == null ? "" : String(v));

function countTags(list){
  const map = new Map();
  let noTagCount = 0;

  list.forEach(it => {
    const tags = Array.isArray(it.tags) ? it.tags : [];
    if (tags.length === 0) {
      noTagCount++;
      return;
    }
    tags.forEach(t=>{
      t = (t ?? "").toString().trim(); if(!t) return;
      map.set(t, (map.get(t)||0)+1);
    });
  });

  if (noTagCount > 0) map.set(NO_TAG, noTagCount);
  return map;
}

function buildTagBarOnce(items){
  const counts = countTags(items);
  const entries = Array.from(counts.entries())
    .filter(([,cnt]) => cnt > TAG_MIN_COUNT) // 100개 이상만 노출
    .sort((a,b)=> (b[1]-a[1]) || a[0].localeCompare(b[0]));

  tagsBox.innerHTML = '';
  for (const [name, count] of entries) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tag';
    b.dataset.tag = name;
    b.innerHTML = `${name} <span class="count">${count}</span>`;
    b.addEventListener('click', ()=>{
      // 태그 바는 그대로 유지(재생성 X) — 버튼 클래스만 토글
      if(state.selected.has(name)) state.selected.delete(name);
      else state.selected.add(name);
      b.classList.toggle('active', state.selected.has(name));
      // 선택된 태그 요약 갱신(모바일)
      renderSelectedTags();
      // Ajax처럼 목록 영역만 부분 갱신
      state.page = 1;
      runFilterAndRender(true);
    });
    tagsBox.appendChild(b);
  }
}

function card(item){
  const a = document.createElement('a');
  a.className = 'card';
  a.href = item.shareUrl || '#';
  a.target = item.shareUrl ? '_blank' : '_self';
  a.rel = item.shareUrl ? 'noreferrer' : '';

  const img = document.createElement(item.thumbnail ? 'img' : 'div');
  if (item.thumbnail) {
    img.src = item.thumbnail;
    img.alt = item.title || 'thumbnail';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.fetchPriority = 'low';
    img.className = 'thumb';
  } else {
    img.className = 'thumb';
  }

  const pad = document.createElement('div'); 
  pad.className = 'pad';

  const h = document.createElement('h3'); 
  h.className = 'title'; 
  h.textContent = item.title || '(제목 없음)';

  const au = document.createElement('p'); 
  au.className = 'author'; 
  au.textContent = item.author ? text(item.author) : '';

  const desc = document.createElement('p'); 
  desc.className = 'desc'; 
  desc.textContent = item.description ? text(item.description) : '';

  const taglist = document.createElement('div'); 
  taglist.className = 'taglist';

  // ✅ 태그가 없으면 '태그없음' 배지 표시, 있으면 최대 6개만 표시
  const tags = Array.isArray(item.tags) ? item.tags : [];
  if (tags.length === 0) {
    const s = document.createElement('span');
    s.className = 'chip';
    s.textContent = NO_TAG;
    taglist.appendChild(s);
  } else {
    tags.slice(0, 6).forEach(t => {
      const s = document.createElement('span');
      s.className = 'chip';
      s.textContent = text(t);
      taglist.appendChild(s);
    });
  }

  pad.appendChild(h);
  if (item.author) pad.appendChild(au);
  if (item.description) pad.appendChild(desc);
  pad.appendChild(taglist);

  a.appendChild(img);
  a.appendChild(pad);
  return a;
}

function filterItems(){
  const q = state.query.trim().toLowerCase();
  const need = Array.from(state.selected);

  // NO_TAG 단독 선택 처리 (AND 규칙 상 다른 태그와 함께면 공집합)
  const hasNoTag = need.includes(NO_TAG);
  if (hasNoTag && need.length > 1) return [];  // 태그없음 ∩ (다른태그들) = 공집합

  return state.items.filter(it=>{
    // 텍스트(제목/작가)
    const textHit = q
      ? [String(it.title||"").toLowerCase(), String(it.author||"").toLowerCase()].some(s=>s.includes(q))
      : true;

    // 태그 AND 필터
    const tags = Array.isArray(it.tags) ? it.tags.map(t=>String(t).trim()) : [];

    let tagHit = true;
    if (need.length) {
      if (hasNoTag) tagHit = (tags.length === 0);       // NO_TAG 단독
      else tagHit = need.every(t => tags.includes(t));  // 일반 AND
    }

    return textHit && tagHit;
  });
}

let lastFiltered = [];

function renderGrid(reset=false){
  if (reset) {
    grid.innerHTML = '';
    state.page = 1;
  }
  const total = lastFiltered.length;                    // ✅ 필터링된 총 개수
  const end = Math.min(total, state.page * state.pageSize);
  const start = grid.childElementCount;

  // ✅ '총 N개'를 필터링된 총 개수로 표시
  statTotal.textContent = `총 ${total}개`;
  // 표시 N개는 현재 페이지에서 렌더된 개수
  statShow.textContent  = `표시 ${end}개`;

  if (total === 0) {
    emptyBox.style.display = '';
    loadMoreBtn.style.display = 'none';
    return;
  } else {
    emptyBox.style.display = 'none';
  }

  const frag = document.createDocumentFragment();
  for (let k = start; k < end; k++){
    frag.appendChild(card(lastFiltered[k]));
  }
  grid.appendChild(frag);

  loadMoreBtn.style.display = end < total ? '' : 'none';
}

// Ajax 느낌의 부분 갱신: 태그바는 건드리지 않고, 목록만 갱신
let rafId = null;
function runFilterAndRender(reset){
  if (rafId) cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(()=>{
    lastFiltered = filterItems();
    renderGrid(reset);
  });
}

/* =========================
   모바일용: 태그 토글 & 선택 요약
   ========================= */
function renderSelectedTags(){
  if (!selectedBar) return;
  selectedBar.innerHTML = '';

  if (state.selected.size === 0){
    const span = document.createElement('span');
    span.className = 'chip';
    span.textContent = '선택된 태그 없음';
    selectedBar.appendChild(span);
    return;
  }

  for (const name of state.selected){
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.innerHTML = `${name}<span class="x" title="해제">×</span>`;
    // X 클릭 → 선택 해제
    chip.querySelector('.x').addEventListener('click', ()=>{
      state.selected.delete(name);
      const safe = (window.CSS && CSS.escape) ? CSS.escape(name) : name.replace(/"/g, '\\"');
      const btn = tagsBox.querySelector(`.tag[data-tag="${safe}"]`);
      if (btn) btn.classList.remove('active');
      state.page = 1;
      renderSelectedTags();
      runFilterAndRender(true);
    });
    selectedBar.appendChild(chip);
  }
}

// 모바일: 태그 보기/숨기기 토글 (데스크탑에선 버튼 자체가 숨겨짐)
tagToggleBtn?.addEventListener('click', ()=>{
  const opened = document.body.classList.toggle('tags-open');
  tagToggleBtn.setAttribute('aria-expanded', String(opened));
  tagToggleBtn.textContent = opened ? '태그 숨기기' : '태그 보기';
});

// 이벤트
qInput.addEventListener('input', (() => {
  let t=null;
  return (e)=>{
    clearTimeout(t);
    t = setTimeout(()=>{
      state.query = e.target.value || '';
      state.page = 1;
      runFilterAndRender(true);
    }, 200);
  };
})());

btnClear.addEventListener('click', ()=>{
  // 선택 해제 (태그바 재생성 없이 버튼 클래스만 일괄 해제)
  state.selected.clear();
  tagsBox.querySelectorAll('.tag.active').forEach(el => el.classList.remove('active'));
  state.query = '';
  qInput.value = '';
  renderSelectedTags();        // ⬅ 선택 요약 갱신
  runFilterAndRender(true);
});

loadMoreBtn.addEventListener('click', ()=>{
  state.page += 1;
  renderGrid(false);
});

// 데이터 로드
async function loadData(){
  try{
    const res = await fetch('./webtoon_data.json', { cache: 'no-store' });
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if(!Array.isArray(json)) throw new Error('JSON 최상위가 배열이어야 합니다.');
    state.items = json;

    // 태그 바는 최초 1회만 생성(이후 유지)
    buildTagBarOnce(state.items);

    // 선택된 태그 요약 초기 표시
    renderSelectedTags();

    // 목록만 부분 갱신
    runFilterAndRender(true);
  }catch(err){
    errorBox.style.display = '';
    errorBox.textContent =
      '데이터 로드 실패: ' + err.message +
      '  (Tip: VS Code Live Server 등 로컬 서버로 열어주세요)';
  }
}

// 초기화
loadData();
