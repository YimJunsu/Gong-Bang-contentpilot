// HTML 파일 → 네이버 SmartEditor ONE 문서모델 컴포넌트 배열 + 검수용 통계.
// 스키마는 에디터가 실제로 만드는 se3#SE_COPIED_DATA 형태를 따른다 (추측 아님).
// DOM은 parse 함수로 주입한다 (브라우저: DOMParser). 순수 문자열 유틸은 node 테스트 대상.
(function attachHtml(root, factory) {
  const api = factory();
  root.NBHHtml = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createHtml() {
  const FONT = 'nanumgothic';
  const LINE_HEIGHT = 1.8;
  const BODY = { fontFamily: FONT, fontSizeCode: 'fs16', fontColor: '#000000' };
  const CAPTION = { fontFamily: FONT, fontSizeCode: 'fs13', fontColor: '#555555' };
  const SMALL = { fontFamily: FONT, fontSizeCode: 'fs15', fontColor: '#000000' };
  const HEADING = { fontFamily: FONT, bold: true };
  const HIGHLIGHT_BG = '#fff593';

  // ---- 순수 문자열 유틸 ----
  const collapseSpace = (value) => String(value || '').replace(/​/g, '').replace(/\s+/g, ' ').trim();
  const countText = (text) => ({ characters: text.replace(/\s/g, '').length, charactersWithSpaces: text.replace(/[\r\n]/g, '').length });
  const fileNameOf = (src) => decodeURIComponent(collapseSpace(src).split(/[?#]/)[0].split('/').pop() || '');
  const isRemote = (src) => /^(https?:)?\/\//i.test(String(src || ''));
  const isOutsidePath = (src) => /(^|\/)\.\.\//.test(String(src || ''));
  const imageLabel = (alt, src) => `■ 사진: ${collapseSpace(alt) || fileNameOf(src) || '이미지'}`;
  const hexOf = (value) => {
    const rgb = String(value || '').match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    if (rgb) return `#${[rgb[1], rgb[2], rgb[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;
    const hex = String(value || '').trim().toLowerCase();
    return /^#[0-9a-f]{6}$/.test(hex) ? hex : '';
  };
  // 네이버가 받는 크기 코드로 근사
  const SIZE_CODES = [11, 13, 15, 16, 19, 24, 28, 30, 34, 38];
  const sizeCode = (px) => {
    const n = Number(String(px || '').replace(/[^\d.]/g, ''));
    if (!Number.isFinite(n) || n <= 0) return '';
    return `fs${SIZE_CODES.reduce((best, size) => (Math.abs(size - n) < Math.abs(best - n) ? size : best), SIZE_CODES[0])}`;
  };

  const isNoColor = (value) => !value || value === 'transparent' || /^rgba\(\s*\d+,\s*\d+,\s*\d+,\s*0\)$/.test(value) || value === 'rgb(255, 255, 255)';
  const SKIP_INLINE = new Set(['SCRIPT', 'STYLE', 'BR', 'HR', 'TABLE', 'THEAD', 'TBODY', 'TR', 'UL', 'OL', 'IMG']);
  // <style> 블록의 CSS를 인라인 style로 내린다 (Chrome이 복사할 때 하는 일). 렌더된 문서(iframe)에서만 동작.
  function inlineComputedStyles(doc) {
    const win = doc?.defaultView;
    if (!win?.getComputedStyle) return false;
    const root = doc.querySelector('article') || doc.body;
    root.querySelectorAll('*').forEach((el) => {
      if (SKIP_INLINE.has(el.tagName)) return;
      const cs = win.getComputedStyle(el);
      el.style.color = cs.color;
      el.style.fontSize = cs.fontSize;
      if (Number(cs.fontWeight) >= 600 || cs.fontWeight === 'bold') el.style.fontWeight = '700';
      if (cs.fontStyle === 'italic') el.style.fontStyle = 'italic';
      if (/underline|line-through/.test(cs.textDecorationLine)) el.style.textDecorationLine = cs.textDecorationLine;
      if (!isNoColor(cs.backgroundColor)) el.style.backgroundColor = cs.backgroundColor;
      if (['P', 'LI', 'TD', 'TH', 'DIV', 'FIGCAPTION', 'BLOCKQUOTE'].includes(el.tagName) && cs.textAlign === 'center') el.style.textAlign = 'center';
    });
    return true;
  }

  // ---- 컴포넌트 빌더 ----
  const textNode = (value, style, url) => ({
    id: '', ctype: 'textNode', value,
    ...(style && Object.keys(style).length ? { style: { ctype: 'nodeStyle', ...style } } : {}),
    ...(url ? { link: { ctype: 'urlLink', url } } : {})
  });
  const paragraph = (nodes, style, align) => ({
    id: '', ctype: 'paragraph',
    nodes: nodes.length ? nodes : [textNode('', style)],
    style: { ctype: 'paragraphStyle', lineHeight: LINE_HEIGHT, ...(align ? { align } : {}) }
  });
  const textComponent = (paragraphs) => ({ id: '', layout: 'default', ctype: 'text', value: paragraphs });
  const sectionTitle = (value) => ({ id: '', ctype: 'sectionTitle', layout: 'default', title: [paragraph([textNode(value, HEADING)])] });
  // 네이버 툴바의 '구분선 추가'가 넣는 기본 구분선 (data-value="default"). line1은 첫 번째 스타일이라 더 굵다.
  // 네이버에서 직접 쓴 글의 구분선은 se-section-align-center다 (발행 글 HTML로 확인, 2026-10-08). 이미지와 같은 align 필드.
  const horizontalLine = () => ({ id: '', layout: 'default', align: 'center', ctype: 'horizontalLine' });
  const quotation = (paragraphs) => ({ id: '', ctype: 'quotation', layout: 'default', value: paragraphs, source: null });
  const captionOf = (text) => (text ? [{ id: '', ctype: 'paragraph', nodes: [{ id: '', ctype: 'textNode', value: text }] }] : null);

  // ---- 인라인 변환 ----
  const styleOf = (element) => {
    const out = {};
    const css = element.style || {};
    const color = hexOf(css.color);
    const background = hexOf(css.backgroundColor);
    const size = sizeCode(css.fontSize);
    if (color && color !== '#000000') out.fontColor = color;
    if (background && background !== '#ffffff') out.backgroundColor = background;
    if (size) out.fontSizeCode = size;
    if (/^(700|800|900|bold|bolder)$/i.test(css.fontWeight || '')) out.bold = true;
    if (css.fontStyle === 'italic') out.italic = true;
    const deco = css.textDecorationLine || css.textDecoration || '';
    if (/underline/.test(deco)) out.underline = true;
    if (/line-through/.test(deco)) out.strike = true;
    return out;
  };
  const alignOf = (element) => {
    const align = element.style?.textAlign;
    return align === 'center' || align === 'right' || align === 'justify' ? align : '';
  };

  // 문단 안의 <br>은 SE에서 별도 문단이다. <br> 기준으로 잘라 문단 배열을 만든다.
  function elementToParagraphs(element, baseStyle) {
    const groups = [[]];
    const push = (node) => groups[groups.length - 1].push(node);
    const walk = (node, style, url) => {
      if (node.nodeType === 3) {
        const value = node.nodeValue.replace(/\s+/g, ' ');
        if (value.trim() || groups[groups.length - 1].length) push(textNode(value, style, url));
        return;
      }
      if (node.nodeType !== 1) return;
      const tag = node.tagName.toLowerCase();
      if (tag === 'br') { groups.push([]); return; }
      let nextStyle = { ...style, ...styleOf(node) };
      let nextUrl = url;
      if (tag === 'strong' || tag === 'b') nextStyle.bold = true;
      if (tag === 'em' || tag === 'i') nextStyle.italic = true;
      if (tag === 'u') nextStyle.underline = true;
      if (tag === 's' || tag === 'strike' || tag === 'del') nextStyle.strike = true;
      if (tag === 'mark') nextStyle.backgroundColor = nextStyle.backgroundColor || HIGHLIGHT_BG;
      if (tag === 'a' && node.getAttribute('href')) nextUrl = node.getAttribute('href');
      for (const child of node.childNodes) walk(child, nextStyle, nextUrl);
    };
    const rootStyle = { ...baseStyle, ...styleOf(element) };
    for (const child of element.childNodes) walk(child, rootStyle, null);
    const align = alignOf(element);
    return groups.map((nodes) => paragraph(trimEdges(nodes), rootStyle, align));
  }
  // HTML 들여쓰기에서 온 앞뒤 공백은 본문에 들어가면 안 된다.
  function trimEdges(nodes) {
    const list = nodes.slice();
    if (list.length) list[0] = { ...list[0], value: list[0].value.replace(/^\s+/, '') };
    if (list.length) { const last = list.length - 1; list[last] = { ...list[last], value: list[last].value.replace(/\s+$/, '') }; }
    return list.filter((node, index) => node.value !== '' || list.length === 1 || index === 0);
  }

  function tableComponent(table, doc) {
    const rows = [...table.querySelectorAll('tr')];
    const columnCount = Math.max(...rows.map((row) => row.children.length), 1);
    const width = Number((100 / columnCount).toFixed(2));
    return {
      id: '', ctype: 'table',
      // 표 모양은 borderStyleName이 아니라 layout이 정한다. table_layout5 = 가로줄만, 세로줄 없음.
      layout: 'table_layout5', width: 100, columnCount, borderStyleName: 'thinLine',
      rows: rows.map((row) => ({
        ctype: 'tableRow',
        cells: [...row.children].map((cell) => ({
          id: '', ctype: 'tableCell',
          colSpan: Number(cell.getAttribute('colspan') || 1),
          rowSpan: Number(cell.getAttribute('rowspan') || 1),
          width, height: 43,
          value: elementToParagraphs(cell, cell.tagName === 'TH' ? { ...BODY, bold: true } : BODY)
        }))
      }))
    };
  }

  // 이미지 종류: 이모지만 원래 크기, 썸네일·사진은 문서 너비.
  const imageKind = (box, index) => {
    const cls = box.classList || { contains: () => false };
    if (cls.contains('emoji')) return 'emoji';
    if (cls.contains('thumb') || cls.contains('thumbnail')) return 'thumbnail';
    return index === 0 ? 'thumbnail' : 'photo'; // 표시가 없으면 첫 장을 대표이미지로
  };
  function imagePlaceholder(figure, index) {
    const img = figure.querySelector?.('img') || figure;
    const src = img.getAttribute('src') || '';
    return {
      __nbhImage: true, order: index,
      token: img.getAttribute('data-image-token') || `IMAGE_${String(index + 1).padStart(2, '0')}`,
      rawSrc: src, fileName: fileNameOf(src), remote: isRemote(src),
      alt: img.getAttribute('alt') || '', kind: imageKind(figure, index)
    };
  }

  // 지도는 placeId로만 넣는다. 이름으로 검색하면 지점이 여러 개일 때 엉뚱한 곳이 잡힌다.
  function findPlaceId(doc) {
    const explicit = doc.querySelector('[data-place-id]')?.getAttribute('data-place-id');
    if (explicit) return explicit.trim();
    const links = [...doc.querySelectorAll('a[href]')].map((anchor) => anchor.getAttribute('href'));
    const patterns = [/place\.naver\.com\/[a-z]+\/(\d{5,})/i, /map\.naver\.com\/[^\s"']*?\/place\/(\d{5,})/i, /[?&]placeId=(\d{5,})/i, /,(\d{5,}),PLACE_POI/i];
    for (const pattern of patterns) for (const href of links) { const matched = href.match(pattern); if (matched) return matched[1]; }
    return '';
  }

  const BLOCK_CONTAINERS = new Set(['DIV', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'MAIN', 'ASIDE', 'FIGURE']);
  const BLOCK_SELECTOR = 'p,div,section,article,header,footer,main,aside,figure,figcaption,table,ul,ol,h1,h2,h3,h4,blockquote,hr';

  // 네이버 본문을 가운데 정렬로 옮기고 싶을 때 (HTML은 왼쪽 정렬로 두고 삽입 시에만 적용)
  function centerParagraphs(components) {
    const SKIP = new Set(['table', 'horizontalLine', 'image', 'placesMap']);
    const walk = (node) => {
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (!node || typeof node !== 'object') return;
      if (node.ctype === 'paragraph') node.style = { ...(node.style || { ctype: 'paragraphStyle' }), align: 'center' };
      Object.entries(node).forEach(([key, value]) => { if (key !== 'ctype' && value && typeof value === 'object') walk(value); });
    };
    components.forEach((component) => { if (!SKIP.has(component.ctype)) walk(component); });
    return components;
  }

  function parseArticle(source, parse) {
    const text = String(source || '');
    if (!text.trim()) return { ok: false, error: 'FILE_EMPTY' };
    let doc;
    try { doc = parse(text); } catch { return { ok: false, error: 'PARSE_FAILED' }; }
    const root = doc?.querySelector?.('article') || doc?.querySelector?.('body > main, main') || doc?.body;
    if (!root) return { ok: false, error: 'PARSE_FAILED' };
    root.querySelectorAll('script, style, noscript, template, iframe, object, embed').forEach((el) => el.remove());

    const components = [];
    const images = [];
    const tables = [];
    let title = collapseSpace(doc.querySelector('title')?.textContent || '');
    let tags = [];
    let placeName = '';
    let headings = 0;
    let listItems = 0;
    let buffer = [];
    const flush = () => { if (buffer.length) { components.push(textComponent(buffer)); buffer = []; } };
    const placeId = findPlaceId(doc);
    // 본문 글자 크기 = 문단 크기 중 가장 흔한 값 (계산된 스타일이 인라인으로 박힌 경우에만 잡힌다)
    const sizeCounts = {};
    root.querySelectorAll('p').forEach((p) => { const px = Number(sizeCode(p.style?.fontSize).slice(2)); if (px) sizeCounts[px] = (sizeCounts[px] || 0) + 1; });
    const bodySizePx = Number(Object.keys(sizeCounts).sort((a, b) => sizeCounts[b] - sizeCounts[a])[0] || 0);

    const visit = (element, baseStyle) => {
      const tag = element.tagName?.toLowerCase();
      const cls = element.classList || { contains: () => false };
      // <br>은 공백으로 (제목이 "신청방법7곳"처럼 붙지 않게)
      if (tag === 'h1') { title = collapseSpace(element.innerHTML.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')) || title; return; }
      if (tag === 'h2' || tag === 'h3' || tag === 'h4') {
        flush(); headings += 1;
        components.push(sectionTitle(collapseSpace(element.textContent)));
        return;
      }
      if (tag === 'hr') { flush(); components.push(horizontalLine()); return; }
      if (tag === 'blockquote') {
        flush();
        const inner = [...element.children].filter((child) => child.tagName === 'P');
        components.push(quotation(inner.length ? inner.flatMap((child) => elementToParagraphs(child, baseStyle)) : elementToParagraphs(element, baseStyle)));
        return;
      }
      if (tag === 'table') {
        flush();
        tables.push({ hasHeader: Boolean(element.querySelector('thead th, th')), columnCount: element.querySelectorAll('tr')[0]?.children.length || 0 });
        components.push(tableComponent(element, doc));
        return;
      }
      // 글쓴이가 <p><img></p>로 감싸는 경우가 있다. 글자 없이 이미지만 든 블록은 이미지로 본다.
      const imageOnlyBlock = element.querySelector?.('img') && !collapseSpace(element.textContent)
        && !element.querySelector('table, ul, ol') && element.querySelectorAll('img').length === 1;
      // 이미지 상자: <img>, img만 든 figure/div/p
      if (tag === 'img' || (imageOnlyBlock && ['figure', 'div', 'p', 'span'].includes(tag))) {
        flush();
        const placeholder = imagePlaceholder(element, images.length);
        const inner = element.querySelector?.('figcaption, .caption');
        if (inner?.textContent.trim()) placeholder.caption = collapseSpace(inner.textContent);
        images.push(placeholder); components.push(placeholder);
        return;
      }
      // 캡션이 형제 문단인 경우 바로 앞 이미지의 정식 캡션으로 붙인다.
      if (cls.contains('caption') || tag === 'figcaption') {
        const previous = components[components.length - 1];
        if (!buffer.length && previous?.__nbhImage && !previous.caption) { previous.caption = collapseSpace(element.textContent); return; }
        buffer.push(...elementToParagraphs(element, CAPTION));
        return;
      }
      // class="quote"처럼 태그가 아닌 인용 상자도 인용구 컴포넌트로
      if (cls.contains('quote') && tag !== 'blockquote') {
        flush();
        components.push(quotation(elementToParagraphs(element, baseStyle)));
        return;
      }
      if (cls.contains('tags') || cls.contains('hashtags')) {
        // <span>#a</span><span>#b</span>는 붙어 있어 공백 분리가 안 된다. # 기준으로 뽑는다.
        const raw = element.textContent || '';
        tags = (raw.match(/#[^\s#]+/g) || raw.split(/\s+/)).map((tag) => tag.replace(/^#/, '').trim()).filter(Boolean);
        flush();
        // 네이버는 본문의 #해시태그를 태그로 뽑는다(_extractHashedKeywords). 공백으로 띄워 넣어야 인식된다.
        const line = tags.map((tag) => `#${tag}`).join(' ');
        // 글자 크기·정렬은 HTML(계산된 스타일)을 따른다. 없으면 기본 본문 크기.
        const size = sizeCode(element.style?.fontSize);
        const tagStyle = size ? { ...BODY, fontSizeCode: size } : BODY;
        components.push(textComponent([paragraph([textNode(line, tagStyle)], tagStyle, alignOf(element))]));
        return;
      }
      if (cls.contains('place')) {
        flush();
        placeName = element.getAttribute('data-place-name') || placeName;
        if (placeId) components.push({ __nbhPlace: true, placeId });
        for (const child of element.children) visit(child, SMALL);
        return;
      }
      if (tag === 'p') {
        // 이미지 바로 뒤의 가운데 정렬 작은 문단은 사진 설명으로 본다 (class="caption"이 없는 HTML 대응).
        // 별도 문단으로 두면 왼쪽 정렬로 남고 사진을 옮길 때 따라가지 않는다.
        // 본문 자체가 13px인 글(전부 13px·가운데)에서는 본문 첫 문단이 캡션으로 먹히므로, 본문보다 작을 때만 캡션으로 본다.
        const previous = components[components.length - 1];
        const code = sizeCode(element.style?.fontSize);
        const small = ['fs11', 'fs13'].includes(code) && (!bodySizePx || Number(code.slice(2)) < bodySizePx);
        if (!buffer.length && previous?.__nbhImage && !previous.caption && alignOf(element) === 'center' && small) {
          previous.caption = collapseSpace(element.textContent);
          return;
        }
        buffer.push(...elementToParagraphs(element, baseStyle));
        return;
      }
      if (tag === 'li') {
        listItems += 1;
        const paragraphs = elementToParagraphs(element, baseStyle);
        const first = paragraphs[0]?.nodes[0];
        if (first) first.value = `- ${first.value}`;
        buffer.push(...paragraphs);
        return;
      }
      if (tag === 'ul' || tag === 'ol') { for (const child of element.children) visit(child, baseStyle); return; }
      if (BLOCK_CONTAINERS.has(element.tagName)) {
        const style = cls.contains('source') ? SMALL : baseStyle;
        // 블록 자식이 있으면 내려가되, div에 직접 붙은 텍스트 노드도 문단으로 살린다.
        // (요소 자식만 순회하면 <div class="note">본문…</div> 같은 글이 통째로 사라진다)
        if ([...element.children].some((child) => child.matches(BLOCK_SELECTOR))) {
          for (const node of element.childNodes) {
            if (node.nodeType === 3) {
              const text = collapseSpace(node.nodeValue);
              if (text) buffer.push(paragraph([textNode(text, style)], style));
            } else if (node.nodeType === 1) visit(node, style);
          }
          return;
        }
        // 블록 자식이 없으면 통째로 한 문단 묶음 (<br>·<strong>·텍스트가 섞인 안내 상자)
        if (element.textContent?.trim()) buffer.push(...elementToParagraphs(element, style));
        return;
      }
      if (element.textContent?.trim()) buffer.push(...elementToParagraphs(element, baseStyle));
    };

    for (const child of root.children) visit(child, BODY);
    flush();

    const body = collectText(components);
    const stats = {
      ...countText(body), titleCharacters: title.replace(/\s/g, '').length,
      paragraphs: components.filter((c) => c.ctype === 'text').reduce((sum, c) => sum + c.value.length, 0),
      headings, tables: tables.length,
      listItems,
      quotes: components.filter((c) => c.ctype === 'quotation').length,
      rules: components.filter((c) => c.ctype === 'horizontalLine').length,
      images: images.length,
      links: countLinks(components),
      tags: tags.length
    };
    return {
      ok: true, title, components, images, tables, tags, stats,
      placeId, placeName, hasPlaceSlot: components.some((c) => c.__nbhPlace),
      firstParagraph: firstParagraphText(components), body
    };
  }

  const walkValues = (node, visit) => {
    if (Array.isArray(node)) { node.forEach((item) => walkValues(item, visit)); return; }
    if (!node || typeof node !== 'object') return;
    visit(node);
    Object.values(node).forEach((value) => walkValues(value, visit));
  };
  function collectText(components) {
    const parts = [];
    walkValues(components, (node) => { if (node.ctype === 'textNode' && node.value) parts.push(node.value); });
    return parts.join('');
  }
  function countLinks(components) {
    let count = 0;
    walkValues(components, (node) => { if (node.ctype === 'urlLink') count += 1; });
    return count;
  }
  function firstParagraphText(components) {
    const first = components.find((component) => component.ctype === 'text');
    return first ? collectText([first.value[0]]) : '';
  }

  // 자리표시자를 네이버가 업로드해준 진짜 image 컴포넌트로 바꾼다.
  function fillImages(components, uploaded, placeComponent = null) {
    return components.flatMap((component) => {
      if (component.__nbhPlace) return placeComponent ? [placeComponent] : [];
      if (!component.__nbhImage) return [component];
      const real = uploaded.get(component.token);
      // 업로드 못 한 이미지는 자리표시 문단으로 남긴다 (본문이 통째로 실패하지 않게)
      if (!real) return [textComponent([paragraph([textNode(imageLabel(component.alt, component.rawSrc), CAPTION)], CAPTION, 'center')])];
      return [{
        ...real, align: 'center',
        caption: captionOf(component.caption),
        represent: component.kind === 'thumbnail',
        contentMode: component.kind === 'emoji' ? 'normal' : 'fit'
      }];
    });
  }

  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  }

  return {
    FONT, BODY, CAPTION, HIGHLIGHT_BG, SIZE_CODES,
    collapseSpace, countText, fileNameOf, isRemote, isOutsidePath, imageLabel, hexOf, sizeCode,
    parseArticle, fillImages, centerParagraphs, findPlaceId, collectText, escapeHTML, inlineComputedStyles
  };
});
