'use client';
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Tour, TOURS, TOUR_OF_TAB, TourContext } from './tour';
import { DialogProvider, useDialog } from './dialog';

// 서버(server.mjs)는 x-bh 헤더가 없는 POST를 막는다 (다른 사이트발 요청 차단)
async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { 'x-bh': '1', ...(opts.headers || {}) } });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}
const post = (path, data) => api(path, { method: 'POST', body: JSON.stringify(data || {}) });
const when = (iso) => (iso ? new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

// 아이콘은 Fluent 3D 이모지만 쓴다 (public/emoji, MIT). 장식이라 alt는 비운다
const Emoji = ({ name, size = 22 }) => <img className="emoji" src={`/emoji/${name}.png`} width={size} height={size} alt="" draggable={false} />;

const MENU = [
  { group: null, items: [['home', '대시보드', 'chart']] },
  { group: '찾기', items: [['reward', '핫 키워드', 'fire'], ['shortents', '숏텐츠', 'news']] },
  { group: '만들기', items: [['auto', '글 자동화', 'robot'], ['write', '글 생성하기', 'memo'], ['shorts', '숏폼 만들기', 'clapper']] },
  { group: '관리', items: [['posts', '글 목록', 'books'], ['jobs', '작업 로그', 'clipboard'], ['settings', '설정', 'gear']] }
];
const TYPE = { write: '글 생성', draft: '임시저장', discover: '수집·추천', scrape: '화면 읽기', shorts: '숏폼 생성', render: '숏폼 렌더링' };
const STATUS = { running: ['hourglass', '진행 중'], done: ['check', '완료'], failed: ['cross', '실패'] };

// 버튼 하나의 "누르는 동안 잠금 + 오류 알림"
function Action({ run, children, icon, primary, big, danger, loading }) { // loading: 누르는 동안 글자 대신 도는 표시
  const [busy, setBusy] = useState(false);
  const dialog = useDialog();
  const click = async (e) => {
    e.stopPropagation();
    setBusy(true);
    try { await run(); } catch (error) { await dialog.alert(error.message, '하지 못했습니다'); } finally { setBusy(false); }
  };
  const cls = ['btn', primary && 'primary', big && 'big', danger && 'danger'].filter(Boolean).join(' ');
  return (
    <button className={`${cls}${busy && loading ? ' is-loading' : ''}`} disabled={busy} onClick={click} aria-busy={busy}>
      <span className="label">{children}</span>{busy && loading && <span className="spin" aria-label="불러오는 중" />}
    </button>
  );
}

function Head({ title, desc, children }) {
  const startTour = useContext(TourContext);
  return (
    <header className="head">
      <div>
        <div className="title-row"><h1>{title}</h1><button className="guide" onClick={() => startTour()}>사용 안내</button></div>
        {desc && <p>{desc}</p>}
      </div>
      {children && <div className="tools" data-tour="head-tools">{children}</div>}
    </header>
  );
}
const Empty = ({ icon = 'folder', title, children }) => (
  <div className="empty"><div><b>{title}</b><span className="muted">{children}</span></div></div>
);
const Status = ({ status }) => { const [icon, text] = STATUS[status] || STATUS.failed; return <span className={`status ${status}`}><Emoji name={icon} size={18} />{text}</span>; };

// 파일 고르기: 넓은 영역 + 고른 파일 이름 표시
function FilePick({ inputRef, accept, hint }) {
  const [names, setNames] = useState([]);
  return (
    <label className="drop">
      <div>
        <b>{names.length ? `${names.length}개 선택됨` : '파일 고르기'}</b>
        <div className="muted">{names.length ? names.join(', ') : hint}</div>
      </div>
      <input type="file" multiple accept={accept} ref={inputRef} onChange={(e) => setNames([...e.target.files].map((f) => f.name))} />
    </label>
  );
}
async function uploadAll(input, onProgress) {
  const batch = Date.now().toString(36);
  const paths = [];
  for (const f of input?.files || []) {
    onProgress(`올리는 중: ${f.name}`);
    paths.push((await api(`/api/upload?batch=${batch}&name=${encodeURIComponent(f.name)}`, { method: 'POST', body: f })).path);
  }
  onProgress('');
  return paths;
}
const Engine = ({ value, onChange }) => (
  <div className="segment" role="group" aria-label="AI 엔진">
    {[['codex', 'codex · 글+이미지'], ['claude', 'claude']].map(([id, name]) => (
      <button key={id} type="button" className={value === id ? 'on' : ''} onClick={() => onChange(id)}>{name}</button>
    ))}
  </div>
);

export default function Page() {
  const [tab, setTab] = useState('home');
  const [state, setState] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [posts, setPosts] = useState([]);
  const [draft, setDraft] = useState({ topic: '', category: '', notes: '', links: '' });

  const loadState = useCallback(async () => setState(await api('/api/state')), []);
  const loadPosts = useCallback(async () => setPosts(await api('/api/posts')), []);

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('tab'); // 알림을 누르면 ?tab=jobs 로 열린다
    try { setTab(fromUrl || localStorage.getItem('tab') || 'home'); } catch { setTab(fromUrl || 'home'); }
    loadState().catch(() => {}); loadPosts().catch(() => {});
  }, [loadState, loadPosts]);

  // 작업 목록 폴링. 진행 중 작업 수가 줄면(=하나 끝남) 상태·글 목록을 새로 읽는다
  const running = jobs.filter((j) => j.status === 'running').length;
  const prevRunning = useRef(0);
  const loadJobs = useCallback(() => api('/api/jobs').then(setJobs).catch(() => {}), []);
  useEffect(() => {
    loadJobs();
    const timer = setInterval(loadJobs, 3000);
    return () => clearInterval(timer);
  }, [loadJobs]);
  useEffect(() => {
    if (running < prevRunning.current) { loadState().catch(() => {}); loadPosts().catch(() => {}); }
    prevRunning.current = running;
  }, [running, loadState, loadPosts]);

  const go = (id) => { setTab(id); try { localStorage.setItem('tab', id); } catch { /* 무시 */ } };
  const [tour, setTour] = useState(null);
  const startTour = useCallback((id) => setTour(id || TOUR_OF_TAB[tab] || 'home'), [tab]);
  const endTour = (finished) => {
    if (tour === 'setup') { try { localStorage.setItem('tour-setup-seen', finished ? 'done' : 'closed'); } catch { /* 무시 */ } }
    setTour(null);
  };
  useEffect(() => {
    if (!state) return;
    let seen = null;
    try { seen = localStorage.getItem('tour-setup-seen'); } catch { /* 무시 */ }
    if (!seen) setTour('setup');
  }, [Boolean(state)]); // eslint-disable-line react-hooks/exhaustive-deps
  const pickTopic = (topic, category = '', source = null) => { setDraft((d) => ({ ...d, topic, category, sourceUrl: source?.linkUrl || '', shortentsId: source?.gdid || '', sourceLabel: source ? `숏텐츠 · ${source.category}` : '' })); go('write'); };
  const startJob = async (body) => { await post('/api/jobs', body); go('jobs'); };

  const views = {
    home: <Home state={state} posts={posts} running={running} reload={loadState} startJob={startJob} pickTopic={pickTopic} />,
    reward: <HotKeywords startJob={startJob} pickTopic={pickTopic} engine={state?.config?.engine} go={go} />,
    shortents: <Shortents startJob={startJob} pickTopic={pickTopic} engine={state?.config?.engine} />,
    auto: <AutoPosts />,
    write: <Write draft={draft} setDraft={setDraft} engine={state?.config?.engine} startJob={startJob} categories={state?.categories || []} hasRules={state?.hasRules} />,
    shorts: state && <Shorts config={state.config} reload={loadState} startJob={startJob} jobs={jobs} />,
    posts: <Posts posts={posts} startJob={startJob} categories={state?.categories || []} reload={() => { loadPosts().catch(() => {}); loadState().catch(() => {}); }} />,
    jobs: <Jobs jobs={jobs} reload={loadJobs} />,
    settings: state && <Settings config={state.config} reload={loadState} />
  };

  return (
    <DialogProvider>
    <TourContext.Provider value={startTour}>
    <div className="shell">
      <nav className="side" aria-label="메뉴" data-tour="nav">
        <div className="brand">블로그 헬퍼</div>
        {MENU.map(({ group, items }) => (
          <div key={group || 'top'}>
            {group && <div className="group">{group}</div>}
            {items.map(([id, name]) => (
              <button key={id} className={`nav${tab === id ? ' on' : ''}`} onClick={() => go(id)} aria-current={tab === id ? 'page' : undefined}>
                {name}
                {id === 'jobs' && running > 0 && <span className="count">{running}</span>}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <main key={tab} className="page">{views[tab]}</main>
      {tour && <Tour key={tour} steps={TOURS[tour]} onClose={endTour} go={go} />}
    </div>
    </TourContext.Provider>
    </DialogProvider>
  );
}

function Home({ state, posts, running, reload, startJob, pickTopic }) {
  const startTour = useContext(TourContext);
  const startSetup = () => startTour('setup');
  const [session, setSession] = useState(null);
  const [note, setNote] = useState('');
  const s = session || state?.session;
  const today = state?.today?.replace(/-/g, '');
  const todayPosts = posts.filter((p) => p.name.startsWith(today));
  const d = state?.discover;
  return (
    <>
      <Head icon="chart" title="오늘의 작업" desc={state?.today ? `${state.today} · 오늘 올릴 주제를 고르고 글과 숏폼을 맡겨 두세요` : ''}>
        <button className="btn" onClick={() => startSetup()}>처음 설정 안내</button>
      </Head>
      {state && !state.rootOk && (
        <p className="note" style={{ marginBottom: 18 }}>블로그 작업 폴더가 없습니다. 설정에서 글을 모아 둘 폴더를 지정하세요. 그 안의 하위 폴더가 그대로 글 분류가 됩니다.</p>
      )}
      <section className="strip" data-tour="home-strip">
        <div>
          <div style={{ flex: 1 }}>
            <div className="label">네이버 로그인</div>
            <div className="big">{!s ? '확인 전' : s.loggedIn ? '로그인됨' : '로그인 필요'}</div>
            <div className="muted">{note || (s?.checkedAt ? `${s.blogId ? `${s.blogId} · ` : ''}${when(s.checkedAt)} 확인` : '세션을 확인해 주세요')}</div>
          </div>
          <div className="row" data-tour="home-login" style={{ gap: 6, flexDirection: 'column', alignItems: 'stretch' }}>
            <Action icon="search" run={async () => setSession(await post('/api/session'))}>세션 확인</Action>
            <Action icon="key" run={async () => {
              setNote('열린 크롬 창에서 직접 로그인하세요 (최대 5분)');
              const r = await post('/api/login');
              setSession(r.session); setNote(r.error || ''); reload();
            }}>로그인 창 열기</Action>
          </div>
        </div>
        <div>
          <div><div className="label">오늘 만든 글</div><div className="big">{todayPosts.length}편</div><div className="muted">임시저장 {todayPosts.filter((p) => p.drafted).length}편</div></div>
        </div>
        <div>
          <div><div className="label">진행 중 작업</div><div className="big">{running}개</div><div className="muted">{running ? '작업 로그에서 확인' : '쉬는 중'}</div></div>
        </div>
      </section>

      <section className="panel" data-tour="home-picks">
        <h2 className="panel-title">추천 주제
          <span className="tools"><span className="muted">{d ? `${when(d.at)} 수집` : ''}</span>
            <Action primary icon="search" run={() => startJob({ type: 'discover' })}>핫 키워드·숏텐츠 수집하고 추천받기</Action>
          </span>
        </h2>
        {d?.picks?.length ? (
          <table>
            <thead><tr><th style={{ width: 110 }}>분류</th><th>주제</th><th>왜 지금인가</th><th /></tr></thead>
            <tbody>{d.picks.map((p) => (
              <tr key={p.topic}>
                <td>{p.category && <span className="cat">{state?.categories?.find((c) => c.id === p.category)?.name || p.category}</span>}</td>
                <td><div className="title-cell">{p.topic}</div><div className="sub">{p.main_keyword}</div></td>
                <td>{p.why}<div className="sub">{p.angle}</div></td>
                <td><div className="actions"><button className="btn" onClick={() => pickTopic(p.topic, p.category)}>이 주제로 쓰기</button></div></td>
              </tr>
            ))}</tbody>
          </table>
        ) : (
          <Empty icon="sparkles" title="아직 추천이 없습니다">수집 버튼을 누르면 핫 키워드·숏텐츠를 읽고 이미 쓴 주제를 뺀 추천을 만듭니다.</Empty>
        )}
      </section>
    </>
  );
}

// ---- 글 생성하기(한 편): 주제 + 참고 링크 + 요청사항 + 내 사진 / 참고 자료를 넘겨 AI가 한 편을 쓴다 ----
// 내 사진은 '내가 찍은 사진'으로 본문에 쓰고, 참고 자료는 사실 확인용 — 그 안의 이미지는 블로그 스타일로 새로 만든다.
const REQUEST_EXAMPLE = `예)
치이카와 샵에 대한 내용으로 작성, 강조 볼드·인용 추가
PDF 중 참고 이미지 쓸만한 건 우리 스타일로 새로 생성
웨이팅 꿀팁도 같이, 정확성·가독성·SEO·GEO 최대화
썸네일: 오덕이랑 치이카와가 손잡고 노는 장면 1:1`;
const linksOf = (text) => [...new Set(String(text || '').split(/\s+/).filter((s) => /^https?:\/\/\S+$/i.test(s)))];

function Write({ draft, setDraft, engine: defaultEngine, startJob, categories, hasRules }) {
  const [engine, setEngine] = useState(defaultEngine || 'codex');
  const [autoDraft, setAutoDraft] = useState(true);
  const [note, setNote] = useState('');
  const photos = useRef(null);
  const refs = useRef(null);
  useEffect(() => { if (defaultEngine) setEngine(defaultEngine); }, [defaultEngine]);
  const set = (key) => (e) => setDraft((d) => ({ ...d, [key]: e.target.value }));
  const links = linksOf(draft.links);

  const submit = async () => {
    if (!draft.topic.trim()) throw new Error('주제를 입력하세요');
    const badLines = String(draft.links || '').split('\n').map((l) => l.trim()).filter((l) => l && !/^https?:\/\//i.test(l));
    if (badLines.length) throw new Error(`참고 링크는 http(s)로 시작하는 주소만 한 줄에 하나씩 넣어 주세요: ${badLines[0]}`);
    const photoPaths = await uploadAll(photos.current, setNote);
    const refPaths = await uploadAll(refs.current, setNote);
    await startJob({ type: 'write', ...draft, topic: draft.topic.trim(), engine, files: photoPaths, refs: refPaths, links, draft: autoDraft });
    setDraft({ topic: '', category: '', notes: '', links: '' }); // 숏텐츠 출처도 함께 비운다
  };

  return (
    <>
      <Head title="글 생성하기" desc="주제와 참고 자료를 주면 블로그 폴더 규칙(AGENTS.md)대로 한 편을 씁니다. 원하면 네이버 임시저장까지 합니다" />
      {hasRules === false && (
        <p className="note" style={{ marginBottom: 18 }}>블로그 폴더에 작성 규칙(AGENTS.md)이 없어 기본 형식으로 씁니다. 말투·분량·폴더 구조를 정해 AGENTS.md에 적어 두면 그대로 따릅니다.</p>
      )}
      <section className="panel">
        <label className="field" data-tour="write-topic"><span>무엇에 대해 쓸까요?</span>
          <input className="topic" value={draft.topic} onChange={set('topic')} placeholder="예: 용산 아이파크몰 치이카와마켓 웨이팅" />
        </label>
        {draft.sourceUrl && (
          <p className="note" style={{ marginTop: -6, marginBottom: 16 }}>
            {draft.sourceLabel} 요약 화면을 참고 자료로 함께 넘깁니다.{' '}
            <a href="#" onClick={(e) => { e.preventDefault(); setDraft((d) => ({ ...d, sourceUrl: '', shortentsId: '', sourceLabel: '' })); }}>빼기</a>
          </p>
        )}
        <div data-tour="write-refs">
          <label className="field"><span>참고 링크</span>
            <textarea value={draft.links || ''} onChange={set('links')} rows={3} placeholder={'공식 페이지·공지 주소를 한 줄에 하나씩\nhttps://korean.visitseoul.net/...'} />
            <small>{links.length ? `${links.length}개 — 서버가 페이지 내용을 읽어 함께 넘기고, 필요한 이미지는 AI가 내려받아 씁니다` : '페이지 내용을 읽어 사실 확인에 씁니다'}</small>
          </label>
          <label className="field"><span>요청사항</span>
            <textarea value={draft.notes} onChange={set('notes')} rows={6} placeholder={REQUEST_EXAMPLE} />
            <small>강조할 내용, 인용·볼드, 쓸 이미지, 썸네일 장면, 말투 등 — ChatGPT에 쓰던 그대로 적으면 됩니다</small>
          </label>
          <div className="grid2">
            <div className="field"><span>내 사진·영상</span><FilePick inputRef={photos} accept="image/*,video/*" hint="직접 찍은 사진 — 본문에 '내 사진'으로 들어갑니다" /></div>
            <div className="field"><span>참고 자료</span><FilePick inputRef={refs} accept=".pdf,.html,.htm,.txt,.md,.docx,image/*" hint="PDF·HTML·캡처 — 내용 확인용, 이미지는 우리 스타일로 새로 만듭니다" /></div>
          </div>
        </div>
        <div className="grid2" data-tour="write-options">
          <label className="field"><span>카테고리</span>
            <select value={draft.category} onChange={set('category')}>
              <option value="">규칙에 따라 자동</option>{categories.filter((c) => c.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <div className="field"><span>AI 엔진</span><Engine value={engine} onChange={setEngine} /></div>
        </div>
        <div className="row" data-tour="write-start" style={{ marginTop: 6 }}>
          <Action primary big run={submit}>글 생성 시작</Action>
          <label className="check"><input type="checkbox" checked={autoDraft} onChange={(e) => setAutoDraft(e.target.checked)} />다 쓰면 임시저장까지</label>
          <span className="muted">{note}</span>
        </div>
      </section>
    </>
  );
}

// ---- 글 목록: 분류·검색·임시저장 상태·정렬로 거르고, 날짜별로 묶어 본다 ----
const day = (iso) => { const d = new Date(iso); return Number.isNaN(d) ? '날짜 없음' : d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' }); };
const openFolder = (p) => post('/api/open', { path: p });

function Posts({ posts, startJob, categories, reload }) {
  const dialog = useDialog();
  const catName = (id) => categories.find((c) => c.id === id)?.name || id;
  const remove = async (p) => {
    const ok = await dialog.confirm({
      title: '글을 삭제할까요?',
      message: `「${p.title}」 폴더(글·이미지·meta.json 전부)를 휴지통으로 옮깁니다. 휴지통에서 되살릴 수 있습니다.`,
      ok: '삭제', danger: true
    });
    if (!ok) return;
    await post('/api/posts/delete', { path: p.path });
    reload();
  };
  const [cat, setCat] = useState('all');
  const [q, setQ] = useState('');
  const [drafted, setDrafted] = useState('');
  const [sort, setSort] = useState('new');
  const tabs = [['all', '전체', posts.length], ...categories.map((c) => [c.id, c.name, c.count])];
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = posts
    .filter((p) => cat === 'all' || p.cat === cat)
    .filter((p) => !drafted || (drafted === 'yes' ? p.drafted : !p.drafted))
    .filter((p) => words.every((w) => `${p.title} ${p.keyword} ${p.name}`.toLowerCase().includes(w)))
    .sort((a, b) => (sort === 'title' ? a.title.localeCompare(b.title, 'ko') : sort === 'old' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name)));
  // 날짜순일 때만 날짜 머리줄로 묶는다
  const rows = [];
  let lastDay = null;
  for (const p of shown) {
    const d = day(p.created);
    if (sort !== 'title' && d !== lastDay) { rows.push({ head: d, n: shown.filter((x) => day(x.created) === d).length }); lastDay = d; }
    rows.push(p);
  }

  return (
    <>
      <Head title="글 목록" desc={`블로그 폴더의 글 ${posts.length}편. 아무 글이나 바로 네이버에 임시저장할 수 있습니다`} />
      <section className="panel">
        <div className="toolbar" data-tour="posts-toolbar">
          {categories.length > 1 && (
            <div className="segment" role="group" aria-label="분류">
              {tabs.map(([id, name, n]) => <button key={id || 'none'} type="button" className={cat === id ? 'on' : ''} onClick={() => setCat(id)}>{name} <span className="n">{n}</span></button>)}
            </div>
          )}
          <input className="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="제목·키워드 검색" />
          <select value={drafted} onChange={(e) => setDrafted(e.target.value)} aria-label="임시저장 상태">
            <option value="">임시저장 전체</option><option value="no">아직 안 한 글</option><option value="yes">임시저장한 글</option>
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="정렬">
            <option value="new">최신순</option><option value="old">오래된순</option><option value="title">제목순</option>
          </select>
        </div>
        {shown.length ? (
          <table className="posts" data-tour="posts-table">
            <tbody>{rows.map((r) => (r.head ? (
              <tr key={`h-${r.head}`} className="grouprow"><td colSpan={4}>{r.head} <span className="muted">{r.n}편</span></td></tr>
            ) : (
              <tr key={r.path}>
                <td style={{ width: 76 }}>{r.thumb ? <img className="thumb" src={`/api/image?path=${encodeURIComponent(r.thumb)}`} alt="" loading="lazy" /> : <div className="thumb" />}</td>
                <td>
                  <div className="title-cell">{r.cat && <span className="cat">{catName(r.cat)}</span>}{r.title}</div>
                  <div className="sub">{r.keyword} · 이미지 {r.images}장 · 태그 {r.tags}개</div>
                </td>
                <td style={{ width: 150 }}>{r.drafted ? <span className="status done"><Emoji name="check" size={18} />{when(r.drafted)}</span> : <span className="muted">임시저장 전</span>}</td>
                <td style={{ width: 290 }}>
                  <div className="actions">
                    <Action run={() => openFolder(r.path)}>폴더</Action>
                    <Action primary={!r.drafted} run={() => startJob({ type: 'draft', postDir: r.path })}>{r.drafted ? '다시 임시저장' : '임시저장'}</Action>
                    <Action danger run={() => remove(r)}>삭제</Action>
                  </div>
                </td>
              </tr>
            )))}</tbody>
          </table>
        ) : <Empty title="조건에 맞는 글이 없습니다">분류나 검색어를 바꿔 보세요.</Empty>}
      </section>
    </>
  );
}

// ---- 작업 로그: 줄을 누르면 바로 아래에 로그가 열리고, 다시 누르면 닫힌다 ----
function Jobs({ jobs, reload }) {
  const dialog = useDialog();
  const [open, setOpen] = useState(null);
  const [log, setLog] = useState('');
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    setLog('불러오는 중…');
    const read = async () => {
      const el = box.current;
      const atEnd = !el || el.scrollTop + el.clientHeight >= el.scrollHeight - 20;
      setLog((await api(`/api/jobs/${open}/log`).catch(() => '')) || '아직 출력이 없습니다.');
      if (atEnd) requestAnimationFrame(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight; });
    };
    read();
    const timer = setInterval(read, 3000);
    return () => clearInterval(timer);
  }, [open]);

  const after = async (run) => { await run(); await reload(); };
  const retry = (j, mode) => () => after(async () => { const n = await post(`/api/jobs/${j.id}/retry`, { mode }); setOpen(n.id); });
  const remove = (j) => () => after(async () => {
    if (!(await dialog.confirm({ title: '작업 기록을 지울까요?', message: '기록과 로그만 지웁니다. 만든 글·영상 파일은 그대로 둡니다.', ok: '지우기', danger: true }))) return;
    await api(`/api/jobs/${j.id}`, { method: 'DELETE' });
    if (open === j.id) setOpen(null);
  });
  const clear = () => after(async () => {
    if (!(await dialog.confirm({ title: '끝난 기록을 모두 지울까요?', message: '완료·실패한 작업 기록을 지웁니다. 진행 중인 작업은 남습니다.', ok: '모두 지우기', danger: true }))) return;
    await post('/api/jobs/clear'); setOpen(null);
  });

  return (
    <>
      <Head title="작업 로그" desc="백그라운드 작업의 진행과 결과. 줄을 누르면 로그가 열리고, 다시 누르면 닫힙니다">
        <Action danger run={clear}>끝난 기록 모두 지우기</Action>
      </Head>
      <section className="panel" data-tour="jobs-table">
        {jobs.length ? (
          <table>
            <thead><tr><th style={{ width: 110 }}>상태</th><th>작업</th><th style={{ width: 120 }}>시작</th><th /></tr></thead>
            <tbody>{jobs.map((j) => [
              <tr key={j.id} className={`click${open === j.id ? ' on' : ''}`} onClick={() => setOpen(open === j.id ? null : j.id)} aria-expanded={open === j.id}>
                <td><Status status={j.status} /></td>
                <td>
                  <div className="title-cell">{TYPE[j.type] || j.type}{(j.input.topic || j.input.postDir || j.input.dir) && <span style={{ fontWeight: 500 }}> · {j.input.topic || (j.input.postDir || j.input.dir).split(/[\\/]/).pop()}</span>}</div>
                  {(j.result?.postDir || j.result?.dir) && <div className="sub">{j.result.postDir || j.result.dir}</div>}
                  {j.error && <div className="error">{j.error}</div>}
                </td>
                <td className="muted" style={{ whiteSpace: 'nowrap' }}>{when(j.startedAt)}</td>
                <td>
                  {j.status !== 'running' && (
                    <div className="actions">
                      {['shorts', 'render'].includes(j.type) && (j.result?.dir || j.input.dir) && <Action run={retry(j, 'render')}>영상만 다시</Action>}
                      {j.type !== 'render' && <Action run={retry(j)}>{j.status === 'failed' ? '재시도' : '다시 생성'}</Action>}
                      <Action danger run={remove(j)}>삭제</Action>
                    </div>
                  )}
                </td>
              </tr>,
              open === j.id && (
                <tr key={`${j.id}-log`} className="logrow"><td colSpan={4}><pre className="log" ref={box}>{log}</pre></td></tr>
              )
            ])}</tbody>
          </table>
        ) : <Empty title="작업 기록이 없습니다">글이나 숏폼을 시작하면 여기에 진행 상황이 쌓입니다.</Empty>}
      </section>
    </>
  );
}

// ---- 숏폼 만들기 ----
const TITLE_FONTS = [['blackhan', '검은고딕', '굵고 각진 예능 자막'], ['dohyeon', '도현', '단정한 정보형'], ['jua', '주아', '둥글고 귀여운']];
const VOICES = [['ko-KR-SunHiNeural', '선희 · 여'], ['ko-KR-InJoonNeural', '인준 · 남'], ['ko-KR-HyunsuMultilingualNeural', '현수 · 남']];
// 글꼴 미리보기: 영상과 같은 제목 스타일(흰 글씨/노란 글씨 + 검은 외곽선)
const fontFaces = TITLE_FONTS.map(([id]) => `@font-face{font-family:"pv-${id}";src:url("/api/font?name=${id}")}`).join('');

function VoiceSettings({ config, reload }) {
  const [tts, setTts] = useState(config.tts || {});
  const [saved, setSaved] = useState('');
  const set = (key, value) => { setSaved(''); setTts((t) => ({ ...t, [key]: value })); };
  const provider = tts.provider || 'edge';
  const save = async () => { await post('/api/config', { tts }); setSaved('저장했습니다'); reload(); };
  return (
    <details className="voice" data-tour="shorts-voice">
      <summary>목소리 설정 <span className="muted">· {provider === 'edge' ? `Edge ${(VOICES.find(([id]) => id === tts.voice) || VOICES[0])[1]}` : provider === 'elevenlabs' ? 'ElevenLabs' : 'Google Cloud'}</span></summary>
      <div className="field" style={{ marginTop: 12 }}><span>음성 서비스</span>
        <div className="segment" role="group" aria-label="음성 서비스">
          {[['edge', 'Edge · 무료'], ['elevenlabs', 'ElevenLabs · 감정 표현'], ['google', 'Google Cloud']].map(([id, name]) => (
            <button key={id} type="button" className={provider === id ? 'on' : ''} onClick={() => set('provider', id)}>{name}</button>
          ))}
        </div>
      </div>
      {provider === 'edge' && (
        <>
          <div className="grid2">
            <label className="field"><span>목소리</span><select value={tts.voice || VOICES[0][0]} onChange={(e) => set('voice', e.target.value)}>{VOICES.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
            <label className="field"><span>기본 속도</span><input value={tts.rate || '+10%'} onChange={(e) => set('rate', e.target.value)} /><small>예: +10%, -5%</small></label>
          </div>
          <p className="note">키 없이 무료. 속삭임·화남 같은 감정은 높낮이·속도·음량과 음향 효과로 흉내 냅니다.</p>
        </>
      )}
      {provider === 'elevenlabs' && (
        <>
          <div className="grid2">
            <label className="field"><span>API 키</span><input type="password" value={tts.elevenApiKey || ''} onChange={(e) => set('elevenApiKey', e.target.value)} /></label>
            <label className="field"><span>목소리 ID</span><input value={tts.elevenVoiceId || 'pNInz6obpgDQGcFmaJgB'} onChange={(e) => set('elevenVoiceId', e.target.value)} /><small>기본값은 Adam</small></label>
          </div>
          <p className="note">eleven_v3 모델이 감정(속삭임·외침·화남)을 진짜로 연기합니다. 무료 요금제는 월 1만 크레딧이고 상업적 이용이 안 되며 출처 표기가 필요합니다.</p>
        </>
      )}
      {provider === 'google' && (
        <div className="grid2">
          <label className="field"><span>API 키</span><input type="password" value={tts.googleApiKey || ''} onChange={(e) => set('googleApiKey', e.target.value)} /></label>
          <label className="field"><span>목소리</span><input value={tts.googleVoice || 'ko-KR-Neural2-A'} onChange={(e) => set('googleVoice', e.target.value)} /></label>
        </div>
      )}
      <div className="row" style={{ marginTop: 12 }}><Action run={save}>목소리 저장</Action>{saved && <span className="status done"><Emoji name="check" size={18} />{saved}</span>}</div>
    </details>
  );
}

function ShortDialog({ short, onClose, startJob }) {
  const ref = useRef(null);
  const [text, setText] = useState(JSON.stringify(short.script || { title: [], scenes: [] }, null, 2));
  useEffect(() => { const d = ref.current; if (d && !d.open) d.showModal(); }, []);
  const rerender = async () => {
    let script;
    try { script = JSON.parse(text); } catch { throw new Error('대본 JSON 형식이 올바르지 않습니다. 쉼표·따옴표를 확인하세요.'); }
    await post('/api/shorts/script', { dir: short.dir, script });
    ref.current?.close();
    await startJob({ type: 'render', dir: short.dir });
  };
  return (
    <dialog className="modal" ref={ref} onClose={onClose} onClick={(e) => { if (e.target === ref.current) ref.current.close(); }}>
      <div className="modal-body">
      <div className="modal-head">
        <div><b>{(short.script?.title || []).join(' ').replace(/\*/g, '') || short.name}</b><div className="sub">{short.name}</div></div>
        <div className="row" style={{ gap: 8 }}>
          <Action run={() => openFolder(short.dir)}>폴더</Action>
          <button className="btn" onClick={() => ref.current.close()} aria-label="닫기">닫기</button>
        </div>
      </div>
      <div className="split">
        {short.video ? (
          <video className="preview" controls autoPlay src={`/api/shorts/video?dir=${encodeURIComponent(short.dir)}&v=${encodeURIComponent(short.video)}`} />
        ) : <div className="note">영상이 아직 없습니다. 대본을 확인하고 렌더링하세요.</div>}
        <div>
          <label className="field"><span>대본 고치기</span>
            <textarea className="code" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
            <small>문장을 고치고 다시 렌더링하면, 바뀐 문장만 음성을 새로 만듭니다.</small>
          </label>
          <div className="row"><Action primary run={rerender}>저장하고 다시 렌더링</Action></div>
          {short.script?.description && <div className="note" style={{ marginTop: 14 }}>{short.script.description}<br />{(short.script.hashtags || []).join(' ')}</div>}
        </div>
      </div>
      </div>
    </dialog>
  );
}

function Shorts({ config, reload, startJob, jobs }) {
  const [form, setForm] = useState({ topic: '', notes: '', font: 'blackhan' });
  const [engine, setEngine] = useState(config.engine || 'codex');
  const [note, setNote] = useState('');
  const [list, setList] = useState([]);
  const [open, setOpen] = useState(null);
  const files = useRef(null);
  const load = useCallback(() => api('/api/shorts').then(setList).catch(() => {}), []);
  const doneCount = jobs.filter((j) => ['shorts', 'render'].includes(j.type) && j.status !== 'running').length;
  useEffect(() => { load(); }, [load, doneCount]);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const current = list.find((s) => s.dir === open);

  const submit = async () => {
    if (!form.topic.trim() && !files.current?.files.length) throw new Error('주제나 자료 중 하나는 있어야 합니다');
    const paths = await uploadAll(files.current, setNote);
    await startJob({ type: 'shorts', ...form, topic: form.topic.trim(), engine, files: paths });
  };

  return (
    <>
      <style>{fontFaces}</style>
      <Head title="숏폼 만들기" desc="자료를 주면 대본·음성·자막·효과를 붙여 세로 영상(1080×1920)으로 만듭니다" />
      <section className="panel">
        <div data-tour="shorts-topic">
        <label className="field"><span>무엇에 대한 영상인가요?</span>
          <input className="topic" value={form.topic} onChange={set('topic')} placeholder="비워 두면 자료를 보고 정합니다" />
        </label>
        <label className="field"><span>메모</span>
          <textarea value={form.notes} onChange={set('notes')} placeholder="꼭 넣을 숫자, 말투(예: 친구한테 말하듯) 등" />
        </label>
        <div className="field"><span>자료</span><FilePick inputRef={files} accept="image/*,video/*,.pdf" hint="사진·영상·PDF — 장면 배경과 내용으로 씁니다" /></div>
        </div>
        <div className="field"><span>제목 글꼴</span>
          <div className="fontcards" data-tour="shorts-fonts" role="radiogroup" aria-label="제목 글꼴">
            {TITLE_FONTS.map(([id, name, desc]) => (
              <button key={id} type="button" role="radio" aria-checked={form.font === id} className={`fontcard${form.font === id ? ' on' : ''}`} onClick={() => setForm((f) => ({ ...f, font: id }))}>
                <div className="fontsample" style={{ fontFamily: `"pv-${id}"` }}><div>강릉 커피축제</div><div className="y">이번 주말</div></div>
                <div className="fontname"><b>{name}</b> <span className="muted">{desc}</span></div>
              </button>
            ))}
          </div>
        </div>
        <div className="field"><span>AI 엔진</span><Engine value={engine} onChange={setEngine} /></div>
        <VoiceSettings config={config} reload={reload} />
        <div className="row" style={{ marginTop: 18 }}><Action primary big run={submit}>숏폼 만들기 시작</Action><span className="muted">{note}</span></div>
      </section>

      <section className="panel" data-tour="shorts-list">
        <h2 className="panel-title">만든 숏폼 <span className="muted" style={{ fontWeight: 600 }}>{list.length}개 · 누르면 미리보기와 대본이 열립니다</span></h2>
        {list.length ? (
          <table>
            <thead><tr><th>제목</th><th style={{ width: 160 }}>영상</th></tr></thead>
            <tbody>{list.map((s) => (
              <tr key={s.dir} className="click" onClick={() => setOpen(s.dir)}>
                <td><div className="title-cell">{(s.script?.title || []).join(' ').replace(/\*/g, '') || '(대본 없음)'}</div><div className="sub">{s.name}</div></td>
                <td>{s.video ? <span className="status done"><Emoji name="check" size={18} />{when(s.video)}</span> : <span className="muted">아직 없음</span>}</td>
              </tr>
            ))}</tbody>
          </table>
        ) : <Empty title="아직 만든 숏폼이 없습니다">위에서 자료를 넣고 시작해 보세요.</Empty>}
      </section>
      {current && <ShortDialog key={current.dir} short={current} onClose={() => setOpen(null)} startJob={startJob} />}
    </>
  );
}

function Settings({ config, reload }) {
  const [form, setForm] = useState(config);
  const [saved, setSaved] = useState('');
  const set = (key) => (e) => { setSaved(''); setForm((f) => ({ ...f, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })); };
  const save = async () => {
    const { blogRoot, blogId, engine, headless } = form;
    await post('/api/config', { blogRoot, blogId, engine, headless, notify: form.notify !== false, shortentsIntervalMin: Number(form.shortentsIntervalMin ?? 30) || 0 });
    setSaved('저장했습니다'); reload();
  };
  return (
    <>
      <Head title="설정" desc="이 PC에만 저장됩니다 (config.json). 숏폼 목소리는 숏폼 만들기에서 정합니다" />
      <section className="panel" data-tour="settings-blog">
        <h2 className="panel-title">블로그</h2>
        <label className="field"><span>블로그 작업 폴더</span><input value={form.blogRoot || ''} onChange={set('blogRoot')} /><small>AGENTS.md가 있는 폴더. 글은 이 폴더 규칙대로 씁니다</small></label>
        <label className="field"><span>네이버 블로그 아이디</span><input value={form.blogId || ''} onChange={set('blogId')} /><small>로그인하면 자동으로 채워집니다</small></label>
        <label className="check"><input type="checkbox" checked={form.headless !== false} onChange={set('headless')} />브라우저 창을 띄우지 않고 실행</label>
      </section>
      <section className="panel" data-tour="settings-collect">
        <h2 className="panel-title">수집할 화면</h2>
        <label className="field"><span>숏텐츠 자동 조회 간격 (분)</span><input type="number" min="0" step="5" value={form.shortentsIntervalMin ?? 30} onChange={set('shortentsIntervalMin')} /><small>서버가 켜져 있는 동안 이 간격으로 숏텐츠를 새로 받습니다. 0이면 자동 조회를 끕니다</small></label>
      </section>
      <section className="panel" data-tour="settings-ai">
        <h2 className="panel-title">AI</h2>
        <div className="field"><span>기본 엔진</span><Engine value={form.engine} onChange={(v) => { setSaved(''); setForm((f) => ({ ...f, engine: v })); }} /></div>
        <label className="check"><input type="checkbox" checked={form.notify !== false} onChange={set('notify')} />작업이 끝나면 Windows 알림 띄우기</label>
      </section>
      <div className="row" data-tour="settings-save"><Action primary big run={save}>설정 저장</Action>{saved && <span className="status done"><Emoji name="check" size={18} />{saved}</span>}</div>
    </>
  );
}

// ---- 숏텐츠: 검색창 숏텐츠(전체) + 분류별 숏텐츠를 자동으로 받아 두고, 골라서 바로 글을 쓴다 ----
const ago = (iso) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (!Number.isFinite(m)) return '';
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}시간 전` : `${Math.round(h / 24)}일 전`;
};
const clock = (iso) => (iso ? new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '');
const JOB_STATE = { running: '작성 중', done: '작성함', failed: '작성 실패' };

function Shortents({ startJob, pickTopic, engine }) {
  const dialog = useDialog();
  const [data, setData] = useState(null);
  const [cat, setCat] = useState('all');
  const [scope, setScope] = useState('now');
  const [onlyNew, setOnlyNew] = useState(false);
  const [hideSimilar, setHideSimilar] = useState(false);
  const load = useCallback(() => api('/api/shortents').then(setData).catch(() => {}), []);
  useEffect(() => { load(); const t = setInterval(load, 60_000); return () => clearInterval(t); }, [load]);

  const all = (data?.items || []).filter((x) => scope === 'all' || x.isCurrent);
  const cats = Object.entries(all.reduce((m, x) => ({ ...m, [x.category]: (m[x.category] || 0) + 1 }), {})).sort((a, b) => b[1] - a[1]);
  const shown = all
    .filter((x) => cat === 'all' || x.category === cat)
    .filter((x) => !onlyNew || x.isNew)
    .filter((x) => !hideSimilar || !x.similar);

  const write = async (x) => {
    const ok = await dialog.confirm({
      title: '이 숏텐츠로 글을 쓸까요?',
      message: `「${x.title}」\n숏텐츠 요약 화면을 참고 자료로 넘겨 백그라운드에서 씁니다. 다 쓰면 글 목록에서 임시저장할 수 있습니다.`,
      ok: '글쓰기 시작'
    });
    if (!ok) return;
    await startJob({ type: 'write', topic: x.title, category: '', notes: `네이버 숏텐츠 [${x.category}] 주제`, engine, files: [], draft: false, sourceUrl: x.linkUrl, shortentsId: x.gdid });
  };

  return (
    <>
      <Head title="숏텐츠" desc={data?.lastFetch
        ? `${clock(data.lastFetch)}에 받음${data.intervalMin ? ` · ${data.intervalMin}분마다 자동 · 다음 ${clock(data.nextFetch)}` : ' · 자동 조회 꺼짐'}`
        : '네이버 검색창 숏텐츠와 분류별 숏텐츠를 모아 둡니다'}>
        <Action loading run={async () => { await post('/api/shortents/refresh'); await load(); }}>지금 새로고침</Action>
      </Head>
      {data?.lastError && <p className="note" style={{ marginBottom: 14 }}>{data.lastError}</p>}
      <section className="panel" data-tour="shortents-list">
        <div className="toolbar" data-tour="shortents-filter">
          <div className="segment" role="group" aria-label="범위">
            {[['now', '지금 목록'], ['all', '최근 이틀']].map(([id, name]) => <button key={id} type="button" className={scope === id ? 'on' : ''} onClick={() => setScope(id)}>{name}</button>)}
          </div>
          <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="분류">
            <option value="all">전체 분류 ({all.length})</option>
            {cats.map(([name, n]) => <option key={name} value={name}>{name} ({n})</option>)}
          </select>
          <label className="check"><input type="checkbox" checked={onlyNew} onChange={(e) => setOnlyNew(e.target.checked)} />새로 뜬 것만</label>
          <label className="check"><input type="checkbox" checked={hideSimilar} onChange={(e) => setHideSimilar(e.target.checked)} />비슷한 글 있는 건 숨기기</label>
        </div>
        {shown.length ? (
          <table className="posts">
            <tbody>{shown.map((x) => (
              <tr key={x.gdid}>
                <td style={{ width: 76 }}>{x.imageUrl ? <img className="thumb" src={x.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <div className="thumb" />}</td>
                <td>
                  <div className="title-cell">
                    <span className="cat">{x.category}</span>{x.title}
                    {x.isNew && <span className="pill new">NEW</span>}
                  </div>
                  {x.desc && <div className="sub clamp">{x.desc}</div>}
                  <div className="sub">{ago(x.firstSeen)}부터 보임{!x.isCurrent && ` · 지금 목록엔 없음(${ago(x.lastSeen)}까지)`}</div>
                  {x.similar && <div className="warn-line">비슷한 글이 있어요: {x.similar.title}</div>}
                </td>
                <td style={{ width: 120 }}>{x.job ? <Status status={x.job.status} /> : null}{x.job && <div className="sub">{JOB_STATE[x.job.status]}</div>}</td>
                <td style={{ width: 330 }}>
                  <div className="actions">
                    <a className="btn" href={x.linkUrl} target="_blank" rel="noreferrer">네이버에서 보기</a>
                    <button className="btn" onClick={() => pickTopic(x.title, '', x)}>글 생성하기로</button>
                    <Action primary={!x.job} run={() => write(x)}>{x.job ? '다시 쓰기' : '이걸로 글쓰기'}</Action>
                  </div>
                </td>
              </tr>
            ))}</tbody>
          </table>
        ) : <Empty title={data ? '조건에 맞는 숏텐츠가 없습니다' : '불러오는 중'}>{data && !data.lastFetch ? '지금 새로고침을 눌러 처음 받아 오세요.' : '거르기 조건을 바꿔 보세요.'}</Empty>}
      </section>
    </>
  );
}

// ---- 핫 키워드: 어드바이저 트렌드 > 주제별 인기유입검색어(어제 기준) ----
const Change = ({ value }) => (value == null ? <span className="pill new">NEW</span>
  : value > 0 ? <span className="chg up">▲{value}</span> : value < 0 ? <span className="chg down">▼{-value}</span> : <span className="chg">-</span>);
const searchUrl = (q) => `https://search.naver.com/search.naver?query=${encodeURIComponent(q)}`;

function HotKeywords({ startJob, pickTopic, engine, go }) {
  const dialog = useDialog();
  const [data, setData] = useState(null);
  const [cat, setCat] = useState('all');
  const [rising, setRising] = useState(false);
  const [hideSimilar, setHideSimilar] = useState(false);
  const load = useCallback(() => api('/api/hotkeywords').then(setData).catch(() => {}), []);
  useEffect(() => { load(); const t = setInterval(load, 60_000); return () => clearInterval(t); }, [load]);

  const cats = data?.categories || [];
  const rows = cats.filter((c) => cat === 'all' || c.category === cat)
    .flatMap((c) => c.items.map((k) => ({ ...k, category: c.category })))
    .filter((k) => !rising || k.change == null || k.change > 0)
    .filter((k) => !hideSimilar || !k.similar);

  const write = async (k) => {
    const ok = await dialog.confirm({
      title: '이 검색어로 글을 쓸까요?',
      message: `「${k.query}」 (${k.category} ${k.rank}위)
검색어를 주제로 백그라운드에서 씁니다. 다 쓰면 글 목록에서 임시저장할 수 있습니다.`,
      ok: '글쓰기 시작'
    });
    if (!ok) return;
    await startJob({ type: 'write', topic: k.query, category: '', notes: `네이버 어드바이저 주제별 인기유입검색어 [${k.category}] ${k.rank}위 — 이 검색어로 들어오는 사람이 찾는 내용을 정확히 담아라`, engine, files: [], draft: false, hotKeyword: k.query });
  };

  return (
    <>
      <Head title="핫 키워드" desc={data?.date
        ? `${data.date} 하루 기준 · ${clock(data.fetchedAt)}에 받음 · 로그인돼 있으면 6시간마다 자동`
        : '크리에이터 어드바이저 주제별 인기유입검색어를 받아 둡니다'}>
        <Action loading run={async () => { await post('/api/hotkeywords/refresh'); await load(); }}>지금 새로고침</Action>
      </Head>
      {data && !data.loggedIn && (
        <p className="note" style={{ marginBottom: 14 }}>네이버 로그인이 필요합니다. <a href="#" onClick={(e) => { e.preventDefault(); go('home'); }}>대시보드</a>에서 로그인한 뒤 새로고침하세요.</p>
      )}
      {data?.lastError && <p className="note" style={{ marginBottom: 14 }}>{data.lastError}</p>}
      <section className="panel" data-tour="hot-list">
        <div className="toolbar" data-tour="hot-filter">
          <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="주제">
            <option value="all">전체 주제 ({cats.length})</option>
            {cats.map((c) => <option key={c.category} value={c.category}>{c.category} ({c.items.length})</option>)}
          </select>
          <label className="check"><input type="checkbox" checked={rising} onChange={(e) => setRising(e.target.checked)} />오르는 것만 (▲·NEW)</label>
          <label className="check"><input type="checkbox" checked={hideSimilar} onChange={(e) => setHideSimilar(e.target.checked)} />비슷한 글 있는 건 숨기기</label>
        </div>
        {rows.length ? (
          <table>
            <thead><tr><th style={{ width: 110 }}>주제</th><th style={{ width: 50 }}>순위</th><th>검색어</th><th style={{ width: 70 }}>변동</th><th style={{ width: 110 }} /><th style={{ width: 330 }} /></tr></thead>
            <tbody>{rows.map((k) => (
              <tr key={`${k.category}-${k.query}`}>
                <td><span className="cat">{k.category}</span></td>
                <td className="muted">{k.rank}</td>
                <td><div className="title-cell">{k.query}</div>{k.similar && <div className="warn-line">비슷한 글이 있어요: {k.similar.title}</div>}</td>
                <td><Change value={k.change} /></td>
                <td>{k.job && <><Status status={k.job.status} /><div className="sub">{JOB_STATE[k.job.status]}</div></>}</td>
                <td>
                  <div className="actions">
                    <a className="btn" href={searchUrl(k.query)} target="_blank" rel="noreferrer">검색해 보기</a>
                    <button className="btn" onClick={() => pickTopic(k.query)}>글 생성하기로</button>
                    <Action primary={!k.job} run={() => write(k)}>{k.job ? '다시 쓰기' : '이걸로 글쓰기'}</Action>
                  </div>
                </td>
              </tr>
            ))}</tbody>
          </table>
        ) : <Empty title={data ? '보여 줄 검색어가 없습니다' : '불러오는 중'}>{data && !data.fetchedAt ? '로그인한 뒤 지금 새로고침을 눌러 처음 받아 오세요.' : '거르기 조건을 바꿔 보세요.'}</Empty>}
      </section>
    </>
  );
}

// ---- 글 자동화(준비 중): 정해진 시간마다 SEO 좋은 주제를 골라 글까지 자동으로 만든다 ----
function AutoPosts() {
  return (
    <>
      <Head title="글 자동화" desc="정해진 시간마다 숏텐츠·핫 키워드에서 좋은 주제를 골라 글까지 자동으로 만듭니다" />
      <section className="panel">
        <Empty title="준비 중입니다">지금은 글 생성하기나 숏텐츠의 "이걸로 글쓰기"로 한 편씩 만들 수 있습니다.</Empty>
      </section>
    </>
  );
}
