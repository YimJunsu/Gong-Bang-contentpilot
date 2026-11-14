'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useDialog } from './dialog';

const CATEGORY = { FOOD: '맛집', CAFE: '카페', BEAUTY: '뷰티', LIFE: '생활', TRAVEL: '여행', KIDS: '육아', PET: '반려', DIGITAL: '디지털', ETC: '기타' };
const TYPE = { VISIT: '방문', DELIVERY: '배송', REPORTER: '기자단', ETC: '기타' };
const KEYS = ['q', 'sido', 'sigungu', 'category', 'type', 'source', 'endWithin', 'hasPoint', 'includeClosed', 'bookmarked', 'sort'];
const split = (s) => (s || '').split(',').filter(Boolean);
const toggle = (s, v) => (split(s).includes(v) ? split(s).filter(x => x !== v) : [...split(s), v]).join(',');
const time = (s) => s ? new Date(s).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '아직 수집 전';
const deadline = (item) => item.status !== 'OPEN' ? '마감' : item.dDay == null ? '마감 미공개' : item.dDay === 0 ? '오늘 마감' : `D-${item.dDay}`;
const count = (v) => v == null ? '미공개' : v.toLocaleString('ko-KR');
const region = (item) => item.type === 'DELIVERY' ? '지역 무관' : [item.region.sido, item.region.sigungu].filter(Boolean).join(' ') || item.region.raw || '지역 미분류';
const readQuery = () => Object.fromEntries([...new URLSearchParams(window.location.search)].filter(([key]) => KEYS.includes(key)));

function MultiPick({ label, options, value, onChange }) {
  const selected = split(value);
  return <details className="campaign-pick">
    <summary>{label}{selected.length ? ` · ${selected.length}` : ' · 전체'}</summary>
    <div className="campaign-pick-options">
      {options.length ? options.map(({ id, name, count: n, disabled }) => <label key={id}>
        <input type="checkbox" checked={selected.includes(id)} disabled={disabled} onChange={() => onChange(toggle(value, id))} />
        <span>{name}</span>{n != null && <small>{n.toLocaleString()}</small>}
      </label>) : <span className="muted">시·도를 고르면 수집된 시·군·구가 표시됩니다.</span>}
    </div>
  </details>;
}

function FilterFields({ value, choices, change }) {
  const regions = choices?.regions || [];
  const districts = [...new Set(regions.filter(r => split(value.sido).includes(r.name)).flatMap(r => r.districts))].sort((a, b) => a.localeCompare(b, 'ko'));
  return <>
    <div className="campaign-filter-line">
      <MultiPick label="시·도" value={value.sido} options={regions.map(r => ({ id: r.name, name: r.name, count: r.count }))} onChange={sido => change({ sido, sigungu: '' })} />
      <MultiPick label="시·군·구" value={value.sigungu} options={districts.map(s => ({ id: s, name: s }))} onChange={sigungu => change({ sigungu })} />
      <MultiPick label="사이트" value={value.source} options={(choices?.sources || []).map(s => ({ id: s.id, name: `${s.name}${!s.available ? ' · 원본 바로가기' : s.delayed ? ' · 업데이트 지연' : ''}`, count: s.count, disabled: !s.available }))} onChange={source => change({ source })} />
      <small className="muted">배송형은 지역 무관입니다.</small>
    </div>
    <fieldset className="campaign-chip-field"><legend>유형</legend><div className="campaign-chips">
      {[['', '전체'], ...Object.entries(TYPE)].map(([id, name]) => <button key={id} type="button" className={`btn${(value.type || '') === id ? ' selected' : ''}`} aria-pressed={(value.type || '') === id} onClick={() => change({ type: id })}>{name}</button>)}
    </div></fieldset>
    <fieldset className="campaign-chip-field"><legend>카테고리</legend><div className="campaign-chips">
      {Object.entries(CATEGORY).map(([id, name]) => <button key={id} type="button" className={`btn${split(value.category).includes(id) ? ' selected' : ''}`} aria-pressed={split(value.category).includes(id)} onClick={() => change({ category: toggle(value.category, id) })}>{name}</button>)}
    </div></fieldset>
    <fieldset className="campaign-chip-field"><legend>마감</legend><div className="campaign-chips">
      {[['', '전체'], ['0', '오늘'], ['3', '3일 이내'], ['7', '7일 이내']].map(([id, name]) => <button key={id} type="button" className={`btn${(value.endWithin ?? '') === id ? ' selected' : ''}`} aria-pressed={(value.endWithin ?? '') === id} onClick={() => change({ endWithin: id })}>{name}</button>)}
    </div></fieldset>
    <div className="campaign-checks">
      {[['hasPoint', '포인트·원고료 있음'], ['bookmarked', '즐겨찾기만'], ['includeClosed', '마감 포함']].map(([id, name]) => <label key={id}><input type="checkbox" checked={value[id] === 'true'} onChange={e => change({ [id]: e.target.checked ? 'true' : '' })} />{name}</label>)}
    </div>
  </>;
}

export default function Campaigns({ api, Action, Head }) {
  const dialog = useDialog();
  const [filters, setFilters] = useState(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [view, setView] = useState('cards');
  const [choices, setChoices] = useState(null);
  const [status, setStatus] = useState(null);
  const [data, setData] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [bookmarkBusy, setBookmarkBusy] = useState([]);
  const [mobileDraft, setMobileDraft] = useState({});
  const [mobileOpen, setMobileOpen] = useState(false);
  const sheet = useRef(null);
  const more = useRef(null);
  const lastQuery = useRef('');
  const statusStamp = useRef('');
  const currentFilters = useRef({});
  currentFilters.current = filters || {};
  const busy = Boolean(status?.busy || data?.busy);

  useEffect(() => {
    const restore = () => { const value = readQuery(); setFilters(value); setSearch(value.q || ''); setPage(0); };
    restore();
    try { setView(localStorage.getItem('campaign-view') === 'table' ? 'table' : 'cards'); } catch { /* 저장이 차단된 브라우저 */ }
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);

  const change = useCallback((patch) => {
    const next = { ...currentFilters.current, ...patch };
    for (const k of Object.keys(next)) if (next[k] === '') delete next[k];
    const query = new URLSearchParams(next).toString();
    const url = `/campaigns${query ? `?${query}` : ''}`;
    if (window.location.pathname + window.location.search !== url) window.history.pushState({}, '', url);
    currentFilters.current = next;
    setFilters(next);
    setPage(0);
  }, []);
  useEffect(() => {
    if (filters == null || search === (filters.q || '')) return;
    const timer = setTimeout(() => change({ q: search }), 300);
    return () => clearTimeout(timer);
  }, [search, filters, change]);

  const query = filters == null ? null : new URLSearchParams(filters).toString();
  useEffect(() => {
    if (query == null) return;
    let active = true;
    const controller = new AbortController();
    const changed = lastQuery.current !== query;
    lastQuery.current = query;
    setLoading(true); setError('');
    if (changed || page === 0 || view === 'table') setRows([]);
    api(`/api/campaigns?${query}&page=${page}&size=24`, { signal: controller.signal }).then(result => {
      if (!active) return;
      setData(result);
      setRows(old => view === 'cards' && page > 0 && !changed ? [...old, ...result.content.filter(c => !old.some(x => x.id === c.id))] : result.content);
    }).catch(e => { if (active) setError(e.message || '공고를 불러오지 못했습니다.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [api, query, page, view, revision]);

  const reloadStatus = useCallback(async () => {
    const [c, s] = await Promise.all([api('/api/campaigns/filters'), api('/api/admin/sources')]);
    setChoices(c); setStatus(s);
    return s;
  }, [api]);
  useEffect(() => {
    let active = true;
    const read = () => reloadStatus().then(s => {
      const stamp = JSON.stringify([s.busy, s.sources.map(source => [source.id, source.lastSuccessAt, source.enabled, source.hidden])]);
      if (active && statusStamp.current !== stamp) { statusStamp.current = stamp; setPage(0); setRevision(r => r + 1); }
    }).catch(e => { if (active) setError(e.message); });
    read();
    const timer = setInterval(read, busy ? 3000 : 60_000);
    return () => { active = false; clearInterval(timer); };
  }, [reloadStatus, busy]);

  const hasMore = Boolean(data && (page + 1) * data.size < data.totalElements);
  useEffect(() => {
    if (view !== 'cards' || !hasMore || loading || error || !more.current) return;
    const observer = new IntersectionObserver(entries => { if (entries[0].isIntersecting) { observer.disconnect(); setPage(p => p + 1); } }, { rootMargin: '180px' });
    observer.observe(more.current);
    return () => observer.disconnect();
  }, [view, hasMore, loading, error, page]);
  useEffect(() => {
    if (mobileOpen) sheet.current?.showModal();
    else sheet.current?.close();
  }, [mobileOpen]);

  const refresh = async (id) => {
    await api(id ? `/api/admin/sources/${id}/run` : '/api/campaigns/refresh', { method: 'POST' });
    await reloadStatus();
    setPage(0);
    setRevision(r => r + 1);
  };
  const bookmark = async (item) => {
    setBookmarkBusy(old => [...old, item.id]);
    try {
      await api(`/api/campaigns/${item.id}/bookmark`, { method: item.bookmarked ? 'DELETE' : 'POST' });
      if (filters.bookmarked === 'true' && item.bookmarked) { setPage(0); setRevision(r => r + 1); }
      else setRows(old => old.map(c => c.id === item.id ? { ...c, bookmarked: !c.bookmarked } : c));
    } catch (e) { await dialog.alert(e.message, '즐겨찾기를 저장하지 못했습니다'); }
    finally { setBookmarkBusy(old => old.filter(id => id !== item.id)); }
  };
  const star = (item) => <button className={`campaign-star${item.bookmarked ? ' on' : ''}`} disabled={bookmarkBusy.includes(item.id)} aria-label={`${item.title} 즐겨찾기 ${item.bookmarked ? '해제' : '추가'}`} aria-pressed={item.bookmarked} onClick={() => bookmark(item)}>{item.bookmarked ? '★' : '☆'}</button>;
  const chooseView = (v) => { setView(v); setPage(0); try { localStorage.setItem('campaign-view', v); } catch { /* 무시 */ } };
  const reset = () => { setSearch(''); change(Object.fromEntries(KEYS.map(k => [k, '']))); };
  const label = (key, v) => key === 'source' ? choices?.sources.find(s => s.id === v)?.name || v : key === 'category' ? CATEGORY[v] || v : key === 'type' ? TYPE[v] || v : ({ hasPoint: '포인트·원고료', includeClosed: '마감 포함', bookmarked: '즐겨찾기', endWithin: `${v}일 이내` })[key] || v;
  const activeFilters = Object.entries(filters || {}).filter(([k, v]) => k !== 'sort' && v).flatMap(([k, v]) => split(v).map(part => ({ k, v: part, label: label(k, part) })));

  return <>
    <Head title="체험단 정보 조회" desc="여러 사이트의 블로그 체험단을 한곳에서 찾고, 원본에서 신청하세요.">
      <Action loading track="campaigns-refresh" busy={busy} run={() => refresh()}>지금 수집하기</Action>
    </Head>
    <section className="panel campaign-search-panel" data-tour="campaign-filter">
      <form className="campaign-search" onSubmit={e => { e.preventDefault(); change({ q: search }); }}>
        <label><span className="sr-only">체험단 검색</span><input type="search" placeholder="업체명, 지역, 제공 내역으로 검색" value={search} onChange={e => setSearch(e.target.value)} /></label>
        <button className="btn primary" type="submit">검색</button>
        <button className="btn campaign-mobile-filter" type="button" onClick={() => { setMobileDraft(filters || {}); setMobileOpen(true); }}>필터{activeFilters.length ? ` ${activeFilters.length}` : ''}</button>
      </form>
      <div className="campaign-desktop-filter"><FilterFields value={filters || {}} choices={choices} change={change} /></div>
      {activeFilters.length > 0 && <div className="campaign-active chips">{activeFilters.map(({ k, v, label: text }) => <span className="chip" key={`${k}-${v}`}>{text}<button aria-label={`${text} 필터 해제`} onClick={() => { if (k === 'q') setSearch(''); change({ [k]: ['source', 'sido', 'sigungu', 'category'].includes(k) ? toggle(filters[k], v) : '', ...(k === 'sido' ? { sigungu: '' } : {}) }); }}>×</button></span>)}<button className="chip-clear" onClick={reset}>필터 초기화</button></div>}
    </section>
    <div className="campaign-results-bar" data-tour="campaign-results">
      <div><b>모집 공고 <span className="campaign-total">{data?.totalElements.toLocaleString() ?? '—'}</span></b><span className="muted">네이버 블로그</span></div>
      <div className="row">
        <label><span className="sr-only">공고 정렬</span><select value={filters?.sort || 'deadline'} onChange={e => change({ sort: e.target.value })}>
          <option value="deadline">마감 임박순</option><option value="latest">최신 등록순</option><option value="competition">경쟁률 낮은 순</option><option value="recruit">모집 인원 많은 순</option>
        </select></label>
        <div className="segment" role="group" aria-label="공고 보기">{[['cards', '카드'], ['table', '표']].map(([id, name]) => <button key={id} className={view === id ? 'on' : ''} aria-pressed={view === id} onClick={() => chooseView(id)}>{name}</button>)}</div>
      </div>
    </div>
    {error && <div className="panel campaign-error" role="alert"><b>정보를 불러오지 못했습니다.</b><p>{error}</p><button className="btn" onClick={() => { setRevision(r => r + 1); reloadStatus().catch(() => {}); }}>다시 시도</button></div>}
    {view === 'cards' && <div className="campaign-grid" aria-busy={loading}>
      {rows.map(item => <article className="campaign-card" key={item.id}>
        <a href={item.goUrl} target="_blank" rel="noopener noreferrer" aria-label={`${item.title} · ${item.source.name} 원본 공고 (새 탭)`}>
          <div className="campaign-image">{item.thumbnailUrl ? <img src={item.thumbnailUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={e => { e.currentTarget.hidden = true; }} /> : null}<span className="campaign-image-fallback" aria-hidden="true">{item.source.name}</span><span className={`campaign-dday${item.status === 'OPEN' && item.dDay != null && item.dDay <= 1 ? ' urgent' : ''}`}>{deadline(item)}</span></div>
          <div className="campaign-card-body"><div className="campaign-meta"><b>{item.source.name}</b><span>{TYPE[item.type]} · {region(item)}</span></div>
            <h2>{item.title}</h2><p className="campaign-reward">{item.reward || '제공 내역은 원본 공고에서 확인하세요'}</p>
            <div className="campaign-tags"><span>{CATEGORY[item.category]}</span>{item.point > 0 && <span>{item.point.toLocaleString()}P</span>}</div>
          </div>
        </a>
        <div className="campaign-card-foot"><span>모집 {count(item.recruitCount)} · 신청 {count(item.applicantCount)}{item.competition != null && <small>경쟁률 {item.competition.toFixed(1)}:1</small>}</span>{star(item)}</div>
      </article>)}
      {loading && !rows.length && Array.from({ length: 6 }, (_, i) => <div className="campaign-skeleton" key={i} aria-label="공고 불러오는 중"><div /><span /><span /></div>)}
    </div>}
    {view === 'table' && <section className="panel campaign-table-panel" aria-busy={loading}><div className="table-wrap"><table className="campaign-table"><thead><tr>
      <th>사이트</th><th>제목 · 제공 내역</th><th>지역</th><th>유형</th><th>카테고리</th><th><button onClick={() => change({ sort: 'recruit' })}>모집 / 신청{filters?.sort === 'recruit' ? ' ↓' : ''}</button></th><th><button onClick={() => change({ sort: 'deadline' })}>마감{!filters?.sort || filters.sort === 'deadline' ? ' ↑' : ''}</button></th><th><span className="sr-only">즐겨찾기</span></th>
    </tr></thead><tbody>{rows.map(item => <tr key={item.id}><td>{item.source.name}</td><td><a href={item.goUrl} target="_blank" rel="noopener noreferrer"><b>{item.title}</b><span>{item.reward}</span></a></td><td>{region(item)}</td><td>{TYPE[item.type]}</td><td>{CATEGORY[item.category]}</td><td>{count(item.recruitCount)} / {count(item.applicantCount)}{item.competition != null && <small>{item.competition.toFixed(1)}:1</small>}</td><td><span className={item.status === 'OPEN' && item.dDay != null && item.dDay <= 1 ? 'campaign-urgent-text' : ''}>{deadline(item)}</span></td><td>{star(item)}</td></tr>)}
      {loading && !rows.length && Array.from({ length: 4 }, (_, i) => <tr key={i}><td colSpan="8"><div className="campaign-row-skeleton" /></td></tr>)}
    </tbody></table></div></section>}
    {!loading && !error && !rows.length && <div className="panel empty"><div><b>{data?.lastUpdatedAt ? '조건에 맞는 공고가 없습니다' : '아직 수집된 공고가 없습니다'}</b><p className="muted">{data?.lastUpdatedAt ? '다른 지역이나 카테고리로 찾아보세요.' : '지금 수집하기를 누르거나, 아래 사이트에서 원본 공고를 확인하세요.'}</p>{activeFilters.length > 0 && <button className="btn" onClick={reset}>필터 초기화</button>}</div></div>}
    {view === 'cards' && hasMore && !error && <div className="campaign-pagination" ref={more}><button className={`btn${loading ? ' is-loading' : ''}`} disabled={loading} onClick={() => setPage(p => p + 1)}><span className="label">더 보기</span>{loading && <span className="spin" aria-label="불러오는 중" />}</button></div>}
    {view === 'table' && data?.totalElements > 24 && <div className="campaign-pagination"><button className="btn" disabled={page === 0 || loading} onClick={() => setPage(p => p - 1)}>이전</button><span>{page + 1} / {Math.ceil(data.totalElements / data.size)}</span><button className="btn" disabled={!hasMore || loading} onClick={() => setPage(p => p + 1)}>다음</button></div>}
    <p className="muted campaign-disclosure">최근 업데이트 {time(data?.lastUpdatedAt)} · 정보는 원본 사이트와 다를 수 있으며, 신청은 원본 사이트에서 진행됩니다. 즐겨찾기는 이 PC에 저장됩니다.</p>
    <details className="panel campaign-sources" data-tour="campaign-sources"><summary><b>사이트 및 수집 상태</b><span className="muted">3시간 간격 · 한국 시간 06~24시</span></summary>
      <p className="muted">공개 목록의 일부를 순서대로 수집합니다. 수집을 끄면 해당 사이트 공고가 목록에서 숨겨집니다.</p>
      {(status?.sources || choices?.sources || []).map(s => <div className="campaign-source" key={s.id}>
        <div><a href={s.baseUrl} target="_blank" rel="noopener noreferrer"><b>{s.name} ↗</b></a><small>{!s.available ? s.reason : s.busy ? '수집 중' : `${!s.enabled ? '수집 꺼짐' : s.delayed ? '업데이트 지연' : '수집 켜짐'} · ${s.count.toLocaleString()}개 · ${time(s.lastSuccessAt)}`}</small>{s.available && s.lastError && <small className="campaign-urgent-text">{s.lastError}</small>}{s.pageLimit && <small>최근 목록 30페이지 이내의 공고입니다.</small>}</div>
        {s.available && <div className="row"><Action loading busy={busy} run={() => refresh(s.id)}>수집</Action><Action run={async () => { await api(`/api/admin/sources/${s.id}`, { method: 'POST', body: JSON.stringify({ enabled: !s.enabled }) }); await reloadStatus(); setPage(0); setRevision(r => r + 1); }}>{s.enabled ? '끄기' : '켜기'}</Action></div>}
      </div>)}
      {status?.logs?.length > 0 && <details className="campaign-logs"><summary>최근 수집 이력</summary>{status.logs.slice(0, 10).map((log, i) => <p key={i}><b>{choices?.sources.find(s => s.id === log.sourceId)?.name}</b> · {time(log.startedAt)} · {({ SUCCESS: '성공', PARTIAL: '일부 확인 필요', FAIL: '실패' })[log.result]} · {log.fetched}개 확인{log.error ? ` · ${log.error}` : ` · 새 공고 ${log.inserted}개 · 변경 ${log.updated}개`}</p>)}</details>}
      <p className="muted">수집 관련 문의·중단 요청: <a href="https://github.com/YimJunsu/Gong-Bang-contentpilot/issues" target="_blank" rel="noopener noreferrer">프로젝트 문의</a>. 위의 끄기 버튼으로 즉시 비활성화할 수 있습니다.</p>
    </details>
    <dialog className="campaign-filter-sheet" ref={sheet} onCancel={() => setMobileOpen(false)} onClose={() => setMobileOpen(false)} onClick={e => { if (e.target === sheet.current) setMobileOpen(false); }}>
      <div className="campaign-sheet-body"><div className="campaign-sheet-head"><h2>체험단 필터</h2><button className="btn" onClick={() => setMobileOpen(false)}>닫기</button></div>
        <FilterFields value={mobileDraft} choices={choices} change={patch => setMobileDraft(old => ({ ...old, ...patch }))} />
        <div className="campaign-sheet-actions"><button className="btn" onClick={() => setMobileDraft({})}>초기화</button><button className="btn primary" onClick={() => { const patch = Object.fromEntries(KEYS.map(k => [k, mobileDraft[k] || ''])); setSearch(patch.q); change(patch); setMobileOpen(false); }}>필터 적용</button></div>
      </div>
    </dialog>
  </>;
}
