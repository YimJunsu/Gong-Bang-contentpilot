'use client';
import { useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
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
  { group: '만들기', items: [['write', '글 생성하기', 'memo'], ['shorts', '숏폼 만들기', 'clapper']] },
  { group: '자동화', items: [['auto', '글 자동화', 'robot'], ['insta', '인스타 자동화', 'camera'], ['threads', '스레드 자동화', 'sparkles']] },
  { group: '관리', items: [['posts', '글 목록', 'books'], ['jobs', '작업 로그', 'clipboard'], ['settings', '설정', 'gear']] }
];
const TYPE = { write: '글 생성', draft: '임시저장', discover: '수집·추천', scrape: '화면 읽기', shorts: '숏폼 생성', render: '숏폼 렌더링' };
const STATUS = { running: ['hourglass', '진행 중'], done: ['check', '완료'], failed: ['cross', '실패'] };

// 오래 걸리는 일(새로고침·로그인 창·세션 확인)은 다른 화면에 다녀와도 '진행 중'이 남아야 한다.
// 화면은 메뉴를 옮길 때마다 새로 그려지므로, 진행 중 목록은 화면 밖(이 파일)에 두고 끝나면 구독한 화면에 알린다.
const pending = new Set();
const pendingListeners = new Set();
const emitPending = () => pendingListeners.forEach((fn) => fn());
const subscribePending = (fn) => { pendingListeners.add(fn); return () => pendingListeners.delete(fn); };
async function track(key, work) {
  pending.add(key); emitPending();
  try { return await work(); } finally { pending.delete(key); emitPending(); }
}
const usePending = (key) => useSyncExternalStore(subscribePending, () => Boolean(key) && pending.has(key), () => false);

// 버튼 하나의 "누르는 동안 잠금 + 오류 알림"
// loading: 누르는 동안 글자 대신 도는 표시 / track: 진행 중 이름 — 주면 다른 화면에 다녀와도 진행 중으로 보인다 / busy: 서버가 알려 준 진행 중
function Action({ run, children, icon, primary, big, danger, loading, track: key, busy: outside }) {
  const [mine, setBusy] = useState(false);
  const tracked = usePending(key);
  const busy = mine || tracked || Boolean(outside);
  const dialog = useDialog();
  const click = async (e) => {
    e.stopPropagation();
    setBusy(true);
    try { await (key ? track(key, run) : run()); } catch (error) { await dialog.alert(error.message, '하지 못했습니다'); } finally { setBusy(false); }
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

// 파일 고르기: 여러 번 골라도 앞서 고른 파일에 더해진다(다른 폴더 파일도 함께). 끌어다 놓기도 된다. ×로 하나씩 뺀다
// files·setFiles는 부모가 가진다 — 글 생성하기는 메뉴를 옮겨도 고른 파일이 남는다
const fileKey = (f) => `${f.name}|${f.size}|${f.lastModified}`;
function FilePick({ files, setFiles, accept, hint }) {
  const [over, setOver] = useState(false);
  const add = (list) => setFiles((old = []) => {
    const seen = new Set(old.map(fileKey));
    return [...old, ...[...list].filter((f) => !seen.has(fileKey(f)) && seen.add(fileKey(f)))];
  });
  return (
    <div>
      <label className={`drop${over ? ' over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); }}>
        <div>
          <b>{files.length ? `${files.length}개 · 더 추가하기` : '파일 고르기'}</b>
          <div className="muted">{files.length ? '다른 폴더 파일도 계속 더할 수 있습니다. 끌어다 놓아도 됩니다' : hint}</div>
        </div>
        <input type="file" multiple accept={accept} onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
      </label>
      {files.length > 0 && (
        <div className="chips">
          {files.map((f) => (
            <span key={fileKey(f)} className="chip">{f.name}
              <button type="button" aria-label={`${f.name} 빼기`} onClick={() => setFiles((old) => old.filter((x) => x !== f))}>×</button>
            </span>
          ))}
          <button type="button" className="chip-clear" onClick={() => setFiles([])}>모두 빼기</button>
        </div>
      )}
    </div>
  );
}
// account: 그 계정의 작업 폴더(tmp)에 올린다
async function uploadAll(files, onProgress, account = '') {
  const batch = Date.now().toString(36);
  const paths = [];
  for (const f of files || []) {
    onProgress(`올리는 중: ${f.name}`);
    paths.push((await api(`/api/upload?batch=${batch}&account=${encodeURIComponent(account || '')}&name=${encodeURIComponent(f.name)}`, { method: 'POST', body: f })).path);
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

// 네이버 계정이 둘 이상일 때만 "어느 계정으로 할지" 고르게 한다. 계정마다 작업 폴더·임시저장 블로그가 다를 수 있다
const naverOf = (config) => {
  const list = (config?.accounts || []).filter((a) => a.service === 'naver');
  return { list, def: list.find((a) => a.id === config?.defaultNaver) || list[0] || null };
};
const AccountPick = ({ list, value, onChange }) => (list.length > 1 ? (
  <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="네이버 계정" style={{ width: 'auto' }}>
    {list.map((a) => <option key={a.id} value={a.id}>{a.name}{a.blogId ? ` (${a.blogId})` : ''}</option>)}
  </select>
) : null);
// 계정의 작업 폴더 정보(경로·분류·규칙 유무). 기본 계정이면 이미 받은 값을 쓰고, 다른 계정이면 서버에 묻는다
function useFolder(id, isDefault, fallback, version) {
  const [info, setInfo] = useState(null);
  useEffect(() => {
    setInfo(null);
    if (isDefault || !id) return;
    api(`/api/folder?account=${encodeURIComponent(id)}`).then(setInfo).catch(() => {});
  }, [id, isDefault, version]);
  return isDefault ? fallback : info || { categories: [] };
}

// 글 미리보기: 글 폴더의 HTML을 그대로 그려 본다(스크립트는 막힘). PC 폭 / 휴대폰 폭
const b64url = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function PostPreview({ dir, title, onClose }) {
  const ref = useRef(null);
  const [mobile, setMobile] = useState(false);
  useEffect(() => { const d = ref.current; if (d && !d.open) d.showModal(); }, []);
  // 닫기: close 이벤트를 기다리지 않고 바로 알린다(화면이 가려져 있으면 이벤트가 늦게 온다)
  const close = () => { ref.current?.close(); onClose(); };
  const src = `/api/postfile/${b64url(dir)}/`;
  return (
    <dialog className="modal" ref={ref} onClose={onClose} onClick={(e) => { if (e.target === ref.current) close(); }}>
      <div className="modal-body">
        <div className="modal-head">
          <div><b>{title || dir.split(/[\\/]/).pop()}</b><div className="sub">{dir}</div></div>
          <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
            <div className="segment" role="group" aria-label="미리보기 폭">
              {[[false, 'PC'], [true, '휴대폰']].map(([m, name]) => <button key={name} type="button" className={mobile === m ? 'on' : ''} onClick={() => setMobile(m)}>{name}</button>)}
            </div>
            <a className="btn" href={src} target="_blank" rel="noreferrer">새 탭에서 열기</a>
            <Action run={() => post('/api/open', { path: dir })}>폴더</Action>
            <button className="btn" onClick={close}>닫기</button>
          </div>
        </div>
        <div className="preview-frame">
          <iframe title="글 미리보기" sandbox="" src={src} style={{ width: mobile ? 390 : '100%' }} />
        </div>
      </div>
    </dialog>
  );
}

export default function Page() {
  const [tab, setTab] = useState('home');
  const [state, setState] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [posts, setPosts] = useState([]);
  const [draft, setDraft] = useState({ topic: '', category: '', notes: '', links: '', photos: [], refFiles: [] });

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
    home: <Home state={state} posts={posts} running={running} reload={loadState} startJob={startJob} pickTopic={pickTopic} go={go} />,
    reward: <HotKeywords startJob={startJob} pickTopic={pickTopic} engine={state?.config?.engine} go={go} />,
    shortents: <Shortents startJob={startJob} pickTopic={pickTopic} engine={state?.config?.engine} />,
    auto: <Soon title="글 자동화" desc="정해진 시간마다 숏텐츠·핫 키워드에서 좋은 주제를 골라 글까지 자동으로 만듭니다">지금은 글 생성하기나 숏텐츠의 "이걸로 글쓰기"로 한 편씩 만들 수 있습니다.</Soon>,
    insta: <Soon title="인스타 자동화" desc="만든 글·숏폼을 인스타그램 게시물·릴스로 바꿔 올리는 기능입니다">아직 만들기 전입니다. 기능이 정해지면 이 화면에서 쓸 수 있습니다.</Soon>,
    threads: <Soon title="스레드 자동화" desc="만든 글을 스레드(Threads)에 맞는 짧은 글로 바꿔 올리는 기능입니다">아직 만들기 전입니다. 기능이 정해지면 이 화면에서 쓸 수 있습니다.</Soon>,
    write: <Write draft={draft} setDraft={setDraft} engine={state?.config?.engine} startJob={startJob} categories={state?.categories || []} hasRules={state?.hasRules} naver={naverOf(state?.config)} rootOk={state?.rootOk} root={state?.root} go={go} />,
    shorts: state && <Shorts config={state.config} reload={loadState} startJob={startJob} jobs={jobs} />,
    posts: <Posts posts={posts} startJob={startJob} categories={state?.categories || []} naver={naverOf(state?.config)} reload={() => { loadPosts().catch(() => {}); loadState().catch(() => {}); }} />,
    jobs: <Jobs jobs={jobs} reload={loadJobs} />,
    settings: state && <Settings config={state.config} sessions={state.accounts || {}} loggingIn={state.loggingIn} reload={loadState} />
  };

  return (
    <DialogProvider>
    <TourContext.Provider value={startTour}>
    <div className="shell">
      <nav className="side" aria-label="메뉴" data-tour="nav">
        <div className="side-menu">
        <div className="brand">공방-콘텐츠파일럿</div>
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
        </div>
        <SessionBadge state={state} go={go} />
      </nav>
      <main key={tab} className="page">{views[tab]}</main>
      {tour && <Tour key={tour} steps={TOURS[tour]} onClose={endTour} go={go} />}
    </div>
    </TourContext.Provider>
    </DialogProvider>
  );
}

// 사이드바 맨 아래: 기본 네이버 계정이 로그인돼 있는지. 누르면 계정 관리로 간다
function SessionBadge({ state, go }) {
  const account = naverOf(state?.config).def;
  const s = state?.session;
  const loggingIn = usePending(account && `login-${account.id}`) || (account && state?.loggingIn === account.id);
  const [cls, text] = !state ? ['', '불러오는 중'] : !account ? ['off', '네이버 계정 없음'] : loggingIn ? ['wait', '로그인하는 중']
    : !s ? ['', '로그인 확인 전'] : s.loggedIn ? ['on', '로그인됨'] : ['off', '로그인 필요'];
  return (
    <button className="side-foot" onClick={() => go('settings')} title={s?.checkedAt ? `${when(s.checkedAt)} 확인 · 눌러서 계정 관리` : '눌러서 계정 관리'}>
      <span className={`dot ${cls}`} aria-hidden="true" />
      <span><b>{text}</b><small>{account ? `네이버 · ${account.name}` : '설정에서 추가'}</small></span>
    </button>
  );
}

// 로그인 창: 사람이 창에서 로그인할 때까지(최대 5분) 기다린다. 대시보드·계정 관리 어디서 눌러도 같은 진행 중 표시를 쓴다
const LOGIN_NOTE = '열린 크롬 창에서 직접 로그인하세요 (최대 5분)';
async function openLogin(id, reload) {
  try {
    const r = await post('/api/login', { id });
    if (r.error) throw new Error(r.error);
  } finally { reload(); }
}
const checkSession = async (id, reload) => { await post('/api/session', { id }); await reload(); };

function Home({ state, posts, running, reload, startJob, pickTopic, go }) {
  const startTour = useContext(TourContext);
  const startSetup = () => startTour('setup');
  const s = state?.session;
  const account = naverOf(state?.config).def;
  const loggingIn = usePending(account && `login-${account.id}`) || (account && state?.loggingIn === account.id);
  const note = loggingIn ? LOGIN_NOTE : '';
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
            <div className="label">네이버 로그인{account && ` · ${account.name}`}</div>
            <div className="big">{!account ? '계정 없음' : !s ? '확인 전' : s.loggedIn ? '로그인됨' : '로그인 필요'}</div>
            <div className="muted">{!account ? '설정 → 계정 관리에서 추가하세요' : note || (s?.checkedAt ? `${account.blogId ? `${account.blogId} · ` : ''}${when(s.checkedAt)} 확인` : '세션을 확인해 주세요')}</div>
          </div>
          <div className="row" data-tour="home-login" style={{ gap: 6, flexDirection: 'column', alignItems: 'stretch' }}>
            {account ? (
              <>
                <Action loading track={`session-${account.id}`} run={() => checkSession(account.id, reload)}>세션 확인</Action>
                <Action loading track={`login-${account.id}`} busy={state?.loggingIn === account.id} run={() => openLogin(account.id, reload)}>로그인 창 열기</Action>
              </>
            ) : null}
            <button className="btn" onClick={() => go('settings')}>{account ? '계정 관리' : '계정 추가'}</button>
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

function Write({ draft, setDraft, engine: defaultEngine, startJob, categories, hasRules, naver, rootOk, root, go }) {
  const [engine, setEngine] = useState(defaultEngine || 'codex');
  const [autoDraft, setAutoDraft] = useState(true);
  const [note, setNote] = useState('');
  useEffect(() => { if (defaultEngine) setEngine(defaultEngine); }, [defaultEngine]);
  const set = (key) => (e) => setDraft((d) => ({ ...d, [key]: e.target.value }));
  const setList = (key) => (next) => setDraft((d) => ({ ...d, [key]: typeof next === 'function' ? next(d[key] || []) : next }));
  const links = linksOf(draft.links);
  // 계정마다 작업 폴더가 다를 수 있다 → 분류·규칙 안내도 고른 계정 폴더 기준
  const account = draft.account || naver.def?.id || '';
  const folder = useFolder(account, account === (naver.def?.id || ''), { categories, rootOk, hasRules, root });
  const pickAccount = (id) => setDraft((d) => ({ ...d, account: id, category: '' }));

  const submit = async () => {
    if (!draft.topic.trim()) throw new Error('주제를 입력하세요');
    const badLines = String(draft.links || '').split('\n').map((l) => l.trim()).filter((l) => l && !/^https?:\/\//i.test(l));
    if (badLines.length) throw new Error(`참고 링크는 http(s)로 시작하는 주소만 한 줄에 하나씩 넣어 주세요: ${badLines[0]}`);
    const photoPaths = await uploadAll(draft.photos, setNote, account);
    const refPaths = await uploadAll(draft.refFiles, setNote, account);
    const { photos: _p, refFiles: _r, ...fields } = draft;
    await startJob({ type: 'write', ...fields, topic: draft.topic.trim(), engine, files: photoPaths, refs: refPaths, links, draft: autoDraft, account });
    setDraft({ topic: '', category: '', notes: '', links: '', photos: [], refFiles: [], account: draft.account }); // 숏텐츠 출처도 함께 비운다
  };

  return (
    <>
      <Head title="글 생성하기" desc="주제와 참고 자료를 주면 블로그 폴더 규칙(AGENTS.md)대로 한 편을 씁니다. 원하면 네이버 임시저장까지 합니다" />
      {folder.rootOk === false && (
        <p className="note" style={{ marginBottom: 18 }}>이 계정의 작업 폴더가 지정되지 않았거나 없어 글을 쓸 수 없습니다. <a href="#" onClick={(e) => { e.preventDefault(); go('settings'); }}>설정</a>에서 기본 작업 폴더나 계정별 작업 폴더(예: D:\BLOG\내블로그)를 지정하세요.</p>
      )}
      {folder.rootOk && folder.hasRules === false && (
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
            <textarea value={draft.links || ''} onChange={set('links')} rows={3} placeholder={'공식 페이지·뉴스룸·유튜브 주소를 한 줄에 하나씩\nhttps://korean.visitseoul.net/...'} />
            <small>{links.length ? `${links.length}개 — 서버가 페이지 내용과 쓸 만한 이미지 후보를 함께 넘깁니다(유튜브는 썸네일)` : '페이지 내용을 읽어 사실 확인에 씁니다'}</small>
          </label>
          <label className="field"><span>요청사항</span>
            <textarea value={draft.notes} onChange={set('notes')} rows={6} placeholder={REQUEST_EXAMPLE} />
            <small>강조할 내용, 인용·볼드, 쓸 이미지, 썸네일 장면, 말투 등 — ChatGPT에 쓰던 그대로 적으면 됩니다</small>
          </label>
          <div className="grid2">
            <div className="field"><span>내 사진·영상</span><FilePick files={draft.photos || []} setFiles={setList('photos')} accept="image/*,video/*" hint="직접 찍은 사진 — 본문에 '내 사진'으로 들어갑니다. 없으면 공식 사진·영상 캡처를 찾아 씁니다(출처는 사진 아래 한 줄)" /></div>
            <div className="field"><span>참고 자료</span><FilePick files={draft.refFiles || []} setFiles={setList('refFiles')} accept=".pdf,.html,.htm,.txt,.md,.docx,image/*" hint="PDF·HTML·캡처 — 내용 확인용, 이미지는 우리 스타일로 새로 만듭니다" /></div>
          </div>
        </div>
        <div className="grid2" data-tour="write-options">
          <label className="field"><span>카테고리</span>
            <select value={draft.category} onChange={set('category')}>
              <option value="">규칙에 따라 자동</option>{(folder.categories || []).filter((c) => c.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <div className="field"><span>AI 엔진</span><Engine value={engine} onChange={setEngine} /></div>
        </div>

        <div className="row" data-tour="write-start" style={{ marginTop: 6 }}>
          <Action primary big run={submit}>글 생성 시작</Action>
          <label className="check"><input type="checkbox" checked={autoDraft} onChange={(e) => setAutoDraft(e.target.checked)} />다 쓰면 임시저장까지</label>
          {naver.list.length > 1 && <span className="muted">계정</span>}
          <AccountPick list={naver.list} value={account} onChange={pickAccount} />
          <span className="muted">{note || (folder.root ? `저장 폴더: ${folder.root}` : '')}</span>
        </div>
      </section>
    </>
  );
}

// ---- 글 목록: 분류·검색·임시저장 상태·정렬로 거르고, 날짜별로 묶어 본다 ----
const day = (iso) => { const d = new Date(iso); return Number.isNaN(d) ? '날짜 없음' : d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' }); };
const openFolder = (p) => post('/api/open', { path: p });

function Posts({ posts: defaultPosts, startJob, categories: defaultCats, reload, naver }) {
  const dialog = useDialog();
  // 계정을 고르면 그 계정 작업 폴더의 글을 보고, 그 계정으로 임시저장한다
  const [account, setAccount] = useState('');
  const acct = account || naver.def?.id || '';
  const isDefault = acct === (naver.def?.id || '');
  const [other, setOther] = useState(null);
  useEffect(() => {
    setOther(null);
    if (!isDefault) api(`/api/posts?account=${encodeURIComponent(acct)}`).then(setOther).catch(() => setOther([]));
  }, [acct, isDefault, defaultPosts]);
  const folder = useFolder(acct, isDefault, { categories: defaultCats }, defaultPosts);
  const posts = isDefault ? defaultPosts : other || [];
  const categories = folder.categories || [];
  const [preview, setPreview] = useState(null);
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
      <Head title="글 목록" desc={`작업 폴더의 글 ${posts.length}편. 누르면 미리보기, 아무 글이나 바로 네이버에 임시저장할 수 있습니다`} />
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
          {naver.list.length > 1 && <span className="muted" style={{ marginLeft: 'auto' }}>계정</span>}
          <AccountPick list={naver.list} value={acct} onChange={(id) => { setAccount(id); setCat('all'); }} />
        </div>
        {shown.length ? (
          <table className="posts" data-tour="posts-table">
            <tbody>{rows.map((r) => (r.head ? (
              <tr key={`h-${r.head}`} className="grouprow"><td colSpan={4}>{r.head} <span className="muted">{r.n}편</span></td></tr>
            ) : (
              <tr key={r.path} className="click" onClick={() => setPreview(r)} title="눌러서 미리보기">
                <td style={{ width: 76 }}>{r.thumb ? <img className="thumb" src={`/api/image?path=${encodeURIComponent(r.thumb)}`} alt="" loading="lazy" /> : <div className="thumb" />}</td>
                <td>
                  <div className="title-cell">{r.cat && <span className="cat">{catName(r.cat)}</span>}{r.title}</div>
                  <div className="sub">{r.keyword} · 이미지 {r.images}장 · 태그 {r.tags}개</div>
                </td>
                <td style={{ width: 150 }}>{r.drafted ? <span className="status done"><Emoji name="check" size={18} />{when(r.drafted)}</span> : <span className="muted">임시저장 전</span>}</td>
                <td style={{ width: 380 }}>
                  <div className="actions">
                    <Action run={() => setPreview(r)}>미리보기</Action>
                    <Action run={() => openFolder(r.path)}>폴더</Action>
                    <Action primary={!r.drafted} run={() => startJob({ type: 'draft', postDir: r.path, account: acct })}>{r.drafted ? '다시 임시저장' : '임시저장'}</Action>
                    <Action danger run={() => remove(r)}>삭제</Action>
                  </div>
                </td>
              </tr>
            )))}</tbody>
          </table>
        ) : <Empty title={posts.length ? '조건에 맞는 글이 없습니다' : '글이 없습니다'}>{posts.length ? '분류나 검색어를 바꿔 보세요.' : folder.root ? `작업 폴더: ${folder.root}` : '이 계정의 작업 폴더를 설정에서 지정하세요.'}</Empty>}
      </section>
      {preview && <PostPreview dir={preview.path} title={preview.title} onClose={() => setPreview(null)} />}
    </>
  );
}

// ---- 작업 로그: 줄을 누르면 바로 아래에 로그가 열리고, 다시 누르면 닫힌다 ----
// 다시 생성(글): 의견을 적고, 만든 글을 고칠지(빠름) 처음부터 새로 쓸지 고른다
function RetryDialog({ job, onClose, onStarted }) {
  const ref = useRef(null);
  const canRevise = job.status === 'done' && Boolean(job.result?.postDir);
  const [how, setHow] = useState(canRevise ? 'revise' : 'new');
  const [feedback, setFeedback] = useState('');
  const [draft, setDraft] = useState(job.input.draft !== false);
  useEffect(() => { const d = ref.current; if (d && !d.open) d.showModal(); }, []);
  const close = () => { ref.current?.close(); onClose(); };
  const start = async () => {
    if (how === 'revise' && !feedback.trim()) throw new Error('무엇을 고칠지 적어 주세요');
    const n = await post(`/api/jobs/${job.id}/retry`, { feedback, how, draft });
    close();
    onStarted(n);
  };
  return (
    <dialog className="modal retry" ref={ref} onClose={onClose} onClick={(e) => { if (e.target === ref.current) close(); }}>
      <div className="modal-body">
        <div className="modal-head"><div><b>{job.status === 'failed' ? '재시도' : '다시 생성'}</b><div className="sub">{job.input.topic}</div></div></div>
        {canRevise && (
          <div className="field"><span>어떻게 할까요?</span>
            <div className="segment" role="group" aria-label="다시 생성 방법">
              {[['revise', '지금 글 고치기'], ['new', '처음부터 새로 쓰기']].map(([id, name]) => <button key={id} type="button" className={how === id ? 'on' : ''} onClick={() => setHow(id)}>{name}</button>)}
            </div>
            <small>{how === 'revise' ? '만든 글 폴더를 그대로 두고 적은 의견만 반영해 고칩니다. 처음부터 쓰는 것보다 빠릅니다.' : '같은 주제·자료로 새 글 폴더에 처음부터 다시 씁니다. 지금 글은 그대로 남습니다.'}</small>
          </div>
        )}
        <label className="field"><span>의견·원하는 점</span>
          <textarea autoFocus rows={6} value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder={'예)\n제목에 가격을 넣어 줘\n두 번째 소제목은 빼고 웨이팅 팁을 더 자세히\n썸네일은 더 밝게'} />
          <small>{how === 'revise' ? '고칠 점을 적어 주세요(필수)' : '비워 두면 같은 조건으로 다시 씁니다'}</small>
        </label>
        <label className="check"><input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} />다 쓰면 임시저장까지{draft && job.input.draft ? ' (네이버 임시저장 글이 하나 더 생깁니다)' : ''}</label>
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 18 }}>
          <button className="btn" onClick={close}>취소</button>
          <Action primary run={start}>다시 생성 시작</Action>
        </div>
      </div>
    </dialog>
  );
}

function Jobs({ jobs, reload }) {
  const dialog = useDialog();
  const [open, setOpen] = useState(null);
  const [preview, setPreview] = useState(null);
  const [again, setAgain] = useState(null);
  const stop = (fn) => (e) => { e.stopPropagation(); fn(); };
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
                      {j.type === 'write' && j.status === 'done' && j.result?.postDir && <button className="btn" onClick={stop(() => setPreview({ dir: j.result.postDir, title: j.input.topic }))}>미리보기</button>}
                      {j.type === 'write' && <button className="btn" onClick={stop(() => setAgain(j))}>{j.status === 'failed' ? '재시도' : '다시 생성'}</button>}
                      {!['render', 'write'].includes(j.type) && <Action run={retry(j)}>{j.status === 'failed' ? '재시도' : '다시 생성'}</Action>}
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
      {preview && <PostPreview dir={preview.dir} title={preview.title} onClose={() => setPreview(null)} />}
      {again && <RetryDialog job={again} onClose={() => setAgain(null)} onStarted={(n) => { setOpen(n.id); reload(); }} />}
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
          <p className="note">키 없이 무료. 따로 조절하지 않아도 됩니다 — AI가 대본을 쓸 때 문장마다 감정(보통·강조·화남·속삭임·신남)을 정하고, 렌더링할 때 그 감정에 맞춰 높낮이·속도·음량·음색과 화면 움직임(줌·흔들기·이모지)을 자동으로 붙여 흉내 냅니다. 대본 고치기에서 문장의 tone을 바꿀 수도 있습니다.</p>
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
  const [files, setFiles] = useState([]);
  const load = useCallback(() => api('/api/shorts').then(setList).catch(() => {}), []);
  const doneCount = jobs.filter((j) => ['shorts', 'render'].includes(j.type) && j.status !== 'running').length;
  useEffect(() => { load(); }, [load, doneCount]);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const current = list.find((s) => s.dir === open);

  const submit = async () => {
    if (!form.topic.trim() && !files.length) throw new Error('주제나 자료 중 하나는 있어야 합니다');
    const paths = await uploadAll(files, setNote);
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
        <div className="field"><span>자료</span><FilePick files={files} setFiles={setFiles} accept="image/*,video/*,.pdf" hint="사진·영상·PDF — 장면 배경과 내용으로 씁니다" /></div>
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

// ---- 계정 관리: 네이버(여러 개) · 인스타그램 · 스레드. 비밀번호는 받지 않는다 ----
const SERVICE_INFO = {
  naver: { title: '네이버 블로그', idLabel: '블로그 아이디', idKey: 'blogId', idHint: '비워 두면 로그인한 뒤 세션 확인 때 채워집니다', namePh: '예: 오덕이, 준기자' },
  instagram: { title: '인스타그램', idLabel: '인스타 아이디', idKey: 'handle', idHint: '@ 없이 적어도 됩니다', namePh: '예: 오덕이 인스타' },
  threads: { title: '스레드', idLabel: '스레드 아이디', idKey: 'handle', idHint: '보통 인스타 아이디와 같습니다', namePh: '예: 오덕이 스레드' }
};

function AccountForm({ edit, setEdit, save }) {
  const info = SERVICE_INFO[edit.service];
  const set = (key) => (e) => setEdit((x) => ({ ...x, [key]: e.target.value }));
  return (
    <div className="acct-form">
      <div className="grid2">
        <label className="field"><span>이름</span><input autoFocus value={edit.name} onChange={set('name')} placeholder={info.namePh} /><small>화면에서 계정을 구분하는 이름</small></label>
        <label className="field"><span>{info.idLabel}</span><input value={edit.value} onChange={set('value')} /><small>{info.idHint}</small></label>
      </div>
      {edit.service === 'naver' && (
        <label className="field"><span>작업 폴더 (선택)</span><input value={edit.folder || ''} onChange={set('folder')} placeholder="예: D:\BLOG\JunmoSSI" />
          <small>이 계정의 글을 쓰고 모아 둘 폴더(AGENTS.md가 있는 곳). 비워 두면 아래 '기본 작업 폴더'를 씁니다</small>
        </label>
      )}
      <div className="row">
        <Action primary run={save}>{edit.id ? '수정 저장' : '추가'}</Action>
        <button className="btn" onClick={() => setEdit(null)}>취소</button>
        {edit.service === 'naver' && !edit.id && <span className="muted">추가한 뒤 '로그인 창 열기'로 이 계정에 로그인하세요</span>}
      </div>
    </div>
  );
}

function Accounts({ config, sessions, loggingIn, reload }) {
  const dialog = useDialog();
  const [edit, setEdit] = useState(null); // { id?, service, name, value }
  useSyncExternalStore(subscribePending, () => pending.size, () => 0); // 로그인 진행 중 문구를 바로 바꾸려고
  const accounts = config.accounts || [];
  const def = naverOf(config).def;
  const save = async () => {
    await post('/api/accounts', { id: edit.id, service: edit.service, name: edit.name, [SERVICE_INFO[edit.service].idKey]: edit.value, folder: edit.folder || '' });
    setEdit(null); await reload();
  };
  const remove = async (a) => {
    const ok = await dialog.confirm({
      title: '계정을 지울까요?',
      message: a.service === 'naver'
        ? `「${a.name}」 계정과 이 PC에 남은 로그인 기록(크롬 프로필 폴더)을 휴지통으로 옮깁니다. 다시 쓰려면 새로 추가하고 로그인해야 합니다.`
        : `「${a.name}」 계정을 목록에서 지웁니다.`,
      ok: '삭제', danger: true
    });
    if (!ok) return;
    await post('/api/accounts/delete', { id: a.id }); await reload();
  };
  const editOf = (a) => setEdit({ id: a.id, service: a.service, name: a.name, value: a[SERVICE_INFO[a.service].idKey] || '', folder: a.folder || '' });

  return (
    <section className="panel" data-tour="settings-accounts">
      <h2 className="panel-title">계정 관리</h2>
      <p className="muted" style={{ marginTop: -6 }}>비밀번호는 받지 않습니다. 네이버는 계정마다 '로그인 창 열기'로 뜬 크롬에서 직접 로그인하고, 로그인 기록은 계정마다 따로 남습니다. 바로 저장되며 아래 '설정 저장'은 누르지 않아도 됩니다.</p>
      {Object.entries(SERVICE_INFO).map(([service, info]) => {
        const list = accounts.filter((a) => a.service === service);
        return (
          <div key={service} className="acct-group">
            <div className="acct-head">
              <b>{info.title}</b>
              {service !== 'naver' && <span className="pill soon">자동화 준비 중</span>}
              <button className="btn" style={{ marginLeft: 'auto' }} onClick={() => setEdit({ service, name: '', value: '' })}>계정 추가</button>
            </div>
            {list.length ? (
              <table className="posts">
                <tbody>{list.map((a) => {
                  if (edit?.id === a.id) return <tr key={a.id}><td colSpan={3}><AccountForm edit={edit} setEdit={setEdit} save={save} /></td></tr>;
                  const s = sessions[a.id];
                  return (
                    <tr key={a.id}>
                      <td>
                        <div className="title-cell">{a.name}{service === 'naver' && def?.id === a.id && <span className="pill">기본</span>}</div>
                        <div className="sub">{(service === 'naver' ? a.blogId : a.handle && `@${a.handle}`) || `${info.idLabel} 없음`}</div>
                        {service === 'naver' && <div className="sub">작업 폴더: {a.folder || `기본 작업 폴더${config.blogRoot ? ` (${config.blogRoot})` : ' (지정 안 됨)'}`}</div>}
                      </td>
                      <td style={{ width: 230 }}>
                        {service === 'naver' ? (
                          <>
                            {!s ? <span className="muted">확인 전</span> : <span className={`status ${s.loggedIn ? 'done' : 'failed'}`}><Emoji name={s.loggedIn ? 'check' : 'cross'} size={18} />{s.loggedIn ? '로그인됨' : '로그인 필요'}</span>}
                            <div className="sub">{pending.has(`login-${a.id}`) || loggingIn === a.id ? LOGIN_NOTE : (s?.checkedAt ? `${when(s.checkedAt)} 확인` : '')}</div>
                            {s?.blogId && a.blogId && s.blogId !== a.blogId && <div className="sub">로그인한 블로그 주소: {s.blogId} (네이버 아이디와 블로그 주소가 달라도 같은 블로그일 수 있습니다)</div>}
                          </>
                        ) : <span className="muted">연결 방식은 자동화를 만들 때 정합니다</span>}
                      </td>
                      <td style={{ width: 420 }}>
                        <div className="actions">
                          {service === 'naver' && def?.id !== a.id && <Action run={async () => { await post('/api/accounts/default', { id: a.id }); await reload(); }}>기본으로</Action>}
                          {service === 'naver' && <Action loading track={`session-${a.id}`} run={() => checkSession(a.id, reload)}>세션 확인</Action>}
                          {service === 'naver' && <Action loading primary={!s?.loggedIn} track={`login-${a.id}`} busy={loggingIn === a.id} run={() => openLogin(a.id, reload)}>로그인 창 열기</Action>}
                          <button className="btn" onClick={() => editOf(a)}>수정</button>
                          <Action danger run={() => remove(a)}>삭제</Action>
                        </div>
                      </td>
                    </tr>
                  );
                })}</tbody>
              </table>
            ) : <p className="muted acct-empty">아직 없습니다.</p>}
            {edit && edit.service === service && !edit.id && <AccountForm edit={edit} setEdit={setEdit} save={save} />}
          </div>
        );
      })}
    </section>
  );
}

function Settings({ config, sessions, loggingIn, reload }) {
  const [form, setForm] = useState(config);
  const [saved, setSaved] = useState('');
  const set = (key) => (e) => { setSaved(''); setForm((f) => ({ ...f, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })); };
  const save = async () => {
    const { blogRoot, engine, headless } = form;
    await post('/api/config', { blogRoot, engine, headless, codexEffort: form.codexEffort || '', videoCapture: Boolean(form.videoCapture), notify: form.notify !== false, shortentsIntervalMin: Number(form.shortentsIntervalMin ?? 30) || 0 });
    setSaved('저장했습니다'); reload();
  };
  return (
    <>
      <Head title="설정" desc="이 PC에만 저장됩니다 (config.json). 숏폼 목소리는 숏폼 만들기에서 정합니다" />
      <Accounts config={config} sessions={sessions} loggingIn={loggingIn} reload={reload} />
      <section className="panel" data-tour="settings-blog">
        <h2 className="panel-title">블로그</h2>
        <label className="field"><span>기본 작업 폴더</span><input value={form.blogRoot || ''} onChange={set('blogRoot')} /><small>AGENTS.md가 있는 폴더. 글은 이 폴더 규칙대로 씁니다. 계정 관리에서 네이버 계정마다 다른 폴더를 줄 수 있고, 안 주면 이 폴더를 씁니다</small></label>
        <label className="check"><input type="checkbox" checked={form.headless !== false} onChange={set('headless')} />브라우저 창을 띄우지 않고 실행</label>
      </section>
      <section className="panel" data-tour="settings-collect">
        <h2 className="panel-title">수집할 화면</h2>
        <label className="field"><span>숏텐츠 자동 조회 간격 (분)</span><input type="number" min="0" step="5" value={form.shortentsIntervalMin ?? 30} onChange={set('shortentsIntervalMin')} /><small>서버가 켜져 있는 동안 이 간격으로 숏텐츠를 새로 받습니다. 0이면 자동 조회를 끕니다</small></label>
      </section>
      <section className="panel" data-tour="settings-ai">
        <h2 className="panel-title">AI</h2>
        <div className="field"><span>기본 엔진</span><Engine value={form.engine} onChange={(v) => { setSaved(''); setForm((f) => ({ ...f, engine: v })); }} /></div>
        <label className="field"><span>codex 생각 깊이</span>
          <select value={form.codexEffort || ''} onChange={set('codexEffort')}>
            <option value="">codex 설정 그대로</option>
            <option value="xhigh">아주 깊게 — 가장 꼼꼼, 가장 느림</option>
            <option value="high">깊게</option>
            <option value="medium">보통 — 빠름</option>
            <option value="low">얕게 — 가장 빠름, 실수 늘 수 있음</option>
          </select>
          <small>얕을수록 글이 빨리 나오지만 규칙·검증을 덜 꼼꼼히 봅니다. 이미지 생성·검증 시간은 그대로라 줄어드는 폭에 한계가 있습니다</small>
        </label>
        <label className="check"><input type="checkbox" checked={form.notify !== false} onChange={set('notify')} />작업이 끝나면 Windows 알림 띄우기</label>
      </section>
      <section className="panel" data-tour="settings-images">
        <h2 className="panel-title">이미지</h2>
        <p className="muted" style={{ marginTop: -6 }}>글에 내 사진이 없으면 공식 사진·공식 화면을 먼저 찾아 쓰고, 없을 때만 생성합니다. 언론사 사진·개인 SNS 사진은 쓰지 않고, 사진 아래에 출처가 한 줄 붙습니다.</p>
        <label className="check"><input type="checkbox" checked={Boolean(form.videoCapture)} onChange={set('videoCapture')} />공식 유튜브 영상 장면 캡처 허용</label>
        <small className="muted" style={{ display: 'block', marginTop: 6 }}>AI가 공식 채널 영상의 필요한 장면을 골라 화면만 캡처합니다(영상 파일은 받지 않음). 자동으로 영상 페이지를 여는 방식이라 유튜브 약관상 애매한 부분이 있어 기본은 꺼 둡니다. 끄면 영상 썸네일만 씁니다.</small>
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
  const refreshing = usePending('shortents-refresh') || Boolean(data?.busy);
  useEffect(() => { load(); const t = setInterval(load, refreshing ? 3000 : 60_000); return () => clearInterval(t); }, [load, refreshing]);

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
        <Action loading track="shortents-refresh" busy={refreshing} run={() => post('/api/shortents/refresh')}>지금 새로고침</Action>
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
  const refreshing = usePending('hot-refresh') || Boolean(data?.busy);
  useEffect(() => { load(); const t = setInterval(load, refreshing ? 3000 : 60_000); return () => clearInterval(t); }, [load, refreshing]);

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
        <Action loading track="hot-refresh" busy={refreshing} run={() => post('/api/hotkeywords/refresh')}>지금 새로고침</Action>
      </Head>
      {data && !data.loggedIn && (
        <p className="note" style={{ marginBottom: 14 }}>기본 네이버 계정의 로그인이 필요합니다. <a href="#" onClick={(e) => { e.preventDefault(); go('settings'); }}>설정 → 계정 관리</a>에서 로그인한 뒤 새로고침하세요.</p>
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

// ---- 자동화 메뉴(준비 중): 글 자동화·인스타 자동화·스레드 자동화 자리만 잡아 둔다 ----
function Soon({ title, desc, children }) {
  return (
    <>
      <Head title={title} desc={desc} />
      <section className="panel">
        <Empty title="준비 중입니다">{children}</Empty>
      </section>
    </>
  );
}
