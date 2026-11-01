// Dayline 官网：区块出场、心情那一屏的滑动驱动叙事、安装面板的切换与复制。
// 动效用 GSAP + ScrollTrigger，平滑滚动用 Lenis；开了“减少动态效果”时全部直接到位。
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hasGsap = typeof gsap !== 'undefined' && typeof ScrollTrigger !== 'undefined';
  const motion = hasGsap && !reduce;

  // 7 月 1–21 日的心情点：截图里每个点的中心（占截图宽高的比例）和心情值。
  // 来自 Obsidian 里截取月历时读出的真实位置；重新截月历时一起更新。
  const DOTS = [[1,.464,.45,1],[2,.5946,.45,2],[3,.7275,.45,0],[4,.8581,.45,2],[5,.0676,.5708,1],[6,.2005,.5708,1],[7,.3311,.5708,2],[8,.464,.5708,1],[9,.5946,.5708,0],[10,.7275,.5708,2],[11,.8581,.5708,-1],[12,.0676,.6937,2],[13,.2005,.6937,1],[14,.3311,.6937,2],[15,.464,.6937,0],[16,.5946,.6937,1],[17,.7275,.6937,-1],[18,.8581,.6937,2],[19,.0676,.8146,1],[20,.2005,.8146,2],[21,.3311,.8146,2]];
  const COLOR = { 2: '#ee6a54', 1: '#f0b34f', 0: '#55b6c9', '-1': '#4d6fb8', '-2': '#7652c7' };
  const LEVEL = [[2, '很好'], [1, '较好'], [0, '平稳'], [-1, '较低'], [-2, '很低']];
  // 曲线落在截图坐标（444×480）里：横轴 7 月 1–21 日，纵轴五级心情。
  const W = 444, H = 480, X0 = 82, X1 = 420, YTOP = 160, STEP = 44;
  const cx = d => X0 + (d - 1) * (X1 - X0) / 20;
  const cy = m => YTOP + (2 - m) * STEP;

  // ---------- 心情舞台的静态结构 ----------
  const chart = $('#mood-chart'), dotsBox = $('#mood-dots'), scale = $('#mood-scale');
  if (chart) {
    const ns = 'http://www.w3.org/2000/svg';
    LEVEL.forEach(([m]) => { const l = document.createElementNS(ns, 'line'); l.setAttribute('x1', X0 - 8); l.setAttribute('x2', X1 + 8); l.setAttribute('y1', cy(m)); l.setAttribute('y2', cy(m)); chart.appendChild(l); });
    const pl = document.createElementNS(ns, 'polyline');
    pl.setAttribute('points', DOTS.map(([d, , , m]) => `${cx(d)},${cy(m)}`).join(' '));
    pl.setAttribute('pathLength', '1');
    pl.style.strokeDasharray = '1'; pl.style.strokeDashoffset = '1';
    chart.appendChild(pl);
    dotsBox.innerHTML = DOTS.map(([d, x, y, m]) => `<i data-d="${d}" style="left:${x * 100}%;top:${y * 100}%;background:${COLOR[m]}"></i>`).join('');
    scale.innerHTML = LEVEL.map(([m, t]) => `<span style="top:${cy(m) / H * 100}%">${t}</span>`).join('') +
      `<span class="ax" style="left:${(cx(1) - 18) / W * 100}%;top:${(cy(-2) + 22) / H * 100}%">7月1日</span>` +
      `<span class="ax" style="left:${(cx(21) - 34) / W * 100}%;top:${(cy(-2) + 22) / H * 100}%">7月21日</span>`;
  }
  // 终态：减少动态效果或没有动效库时直接显示曲线
  const showFinal = () => {
    if (!chart) return;
    $('.mood-wash').style.opacity = .95;
    $('.mood-cal').style.opacity = 0;
    $('#mood-title').style.opacity = 1;
    $('#mood-chart polyline').style.strokeDashoffset = '0';
    $$('#mood-dots i').forEach(el => {
      const [d, , , m] = DOTS[el.dataset.d - 1];
      el.style.opacity = 1;
      el.style.left = cx(d) / W * 100 + '%'; el.style.top = cy(m) / H * 100 + '%';
      el.style.transform = 'scale(1.3)';
    });
    $$('#mood-scale span').forEach(s => { s.style.opacity = 1; });
    $$('#steps li').forEach(li => li.classList.add('on'));
  };
  // ---------- 第 1 屏：引线（从笔记原文和放大格子的真实位置算出） ----------
  // 格子图正好是那一格（截图时放大 3 倍，四周的留白已裁掉），天气图标和心情点在格子里的位置按比例取。
  const part = { badge: [0.8758, 0.1338], dot: [0.1879, 0.8217] };
  const at = (p, cell) => { const [x, y] = part[p]; return { x: cell.left + x * cell.width, y: cell.top + y * cell.height }; };
  const leaders = $('#leaders');
  const drawLeaders = () => {
    if (!leaders || getComputedStyle(leaders).display === 'none') return;
    const st = $('#notes-stage').getBoundingClientRect();
    const rel = r => ({ left: r.left - st.left, top: r.top - st.top, right: r.right - st.left, bottom: r.bottom - st.top, width: r.width, height: r.height });
    const cell = rel($('#cell').getBoundingClientRect());
    const em = rel($('#embed').getBoundingClientRect());
    const label = k => rel($(`.callouts [data-for="${k}"]`).getBoundingClientRect());
    const end = k => { const l = label(k); return { x: l.left - 14, y: l.top + 12 }; };
    const b = at('badge', cell), d = at('dot', cell), eb = end('badge'), ec = end('cover'), ed = end('dot');
    const cover = { x: cell.left + cell.width * .5, y: cell.top + cell.height * .42 };
    const paths = [
      [`M${em.right + 8},${em.top + em.height / 2} C${(em.right + cell.left) / 2},${em.top + em.height / 2} ${(em.right + cell.left) / 2},${cover.y} ${cell.left - 6},${cover.y}`, 'cover', [em.right + 8, em.top + em.height / 2]],
      [`M${b.x},${b.y} H${eb.x}`, '', [b.x, b.y]],
      [`M${cell.right - 18},${cover.y} H${ec.x}`, '', [cell.right - 18, cover.y]],
      [`M${d.x},${d.y} V${cell.bottom + 18} H${cell.right + 24} V${ed.y} H${ed.x}`, '', [d.x, d.y]],
    ];
    const drawn = leaders.classList.contains('drawn') || !motion;
    leaders.setAttribute('viewBox', `0 0 ${st.width} ${st.height}`);
    leaders.innerHTML = paths.map(([p, c, [x, y]]) => `<path class="${c}" d="${p}" pathLength="1" style="stroke-dasharray:1;stroke-dashoffset:${drawn ? 0 : 1}"/><circle class="${c}" cx="${x}" cy="${y}" r="3.5" style="opacity:${drawn ? 1 : 0}"/>`).join('');
  };

  // ---------- 安装面板：切换方式，滑块跟着走 ----------
  const tabs = $$('.tabs [role="tab"]'), ind = $('#tab-ind');
  const placeInd = (t, animate) => { if (!ind || !t) return; if (!animate) ind.style.transition = 'none'; ind.style.width = t.offsetWidth + 'px'; ind.style.transform = `translateX(${t.offsetLeft}px)`; if (!animate) { void ind.offsetWidth; ind.style.transition = ''; } };
  const select = (t, focus) => {
    tabs.forEach(x => { const on = x === t; x.setAttribute('aria-selected', on); x.tabIndex = on ? 0 : -1; $('#' + x.getAttribute('aria-controls')).hidden = !on; });
    placeInd(t, true);
    if (focus) t.focus();
    const pane = $('#' + t.getAttribute('aria-controls'));
    if (motion && pane) gsap.fromTo(pane, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: .26, ease: 'power2.out' });
  };
  const panes = $('#panes');
  const fixPaneHeight = () => {
    if (!panes) return;
    panes.style.minHeight = '';
    const all = $$('.pane', panes);
    const was = all.map(p => p.hidden);
    all.forEach(p => { p.hidden = false; p.style.position = 'absolute'; p.style.visibility = 'hidden'; p.style.width = panes.clientWidth + 'px'; });
    const h = Math.max(...all.map(p => p.offsetHeight));
    all.forEach((p, i) => { p.hidden = was[i]; p.style.position = ''; p.style.visibility = ''; p.style.width = ''; });
    panes.style.minHeight = h + 'px';
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => select(t));
    t.addEventListener('keydown', e => {
      const n = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
      if (n === undefined) return;
      e.preventDefault(); select(tabs[(n + tabs.length) % tabs.length], true);
    });
  });

  // ---------- 复制：说出复制了什么 ----------
  const live = $('#toast');
  const say = msg => { live.textContent = ''; setTimeout(() => { live.textContent = msg; }, 30); };
  const legacyCopy = v => { const ta = document.createElement('textarea'); ta.value = v; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok; };
  $$('.val[data-copy]').forEach(btn => btn.addEventListener('click', async () => {
    const v = btn.dataset.copy, cp = $('.cp', btn);
    let ok = false;
    try { await navigator.clipboard.writeText(v); ok = true; } catch { ok = legacyCopy(v); }
    say(ok ? `已复制：${v}` : '没能复制，请手动选中文字');
    cp.textContent = ok ? '已复制' : '请手动复制';
    btn.classList.toggle('done', ok);
    clearTimeout(btn._t);
    btn._t = setTimeout(() => { cp.textContent = '复制'; btn.classList.remove('done'); }, 1600);
    if (ok && motion) gsap.fromTo(cp, { scale: .85 }, { scale: 1, duration: .35, ease: 'back.out(3)' });
  }));
  // ---------- 导航：滚过首屏后加底色；首屏按钮离开视口后，导航里出现安装按钮 ----------
  const nav = $('#nav'), heroCta = $('#hero-cta');
  const syncNav = () => {
    nav.classList.toggle('solid', scrollY > 24);
    const r = heroCta.getBoundingClientRect();
    nav.classList.toggle('show-cta', r.bottom < 72);
    const m = $('#memory').getBoundingClientRect();
    nav.classList.toggle('dark', m.top < 72 && m.bottom > 36);
  };
  addEventListener('scroll', syncNav, { passive: true });
  syncNav();

  const ready = fn => (document.readyState === 'complete' ? fn() : addEventListener('load', fn, { once: true }));
  if (!motion) {
    showFinal();
    ready(drawLeaders);
    addEventListener('resize', drawLeaders);
    ready(() => { placeInd($('.tabs [aria-selected="true"]'), false); fixPaneHeight(); });
    addEventListener('resize', () => { placeInd($('.tabs [aria-selected="true"]'), false); fixPaneHeight(); });
    return;
  }

  gsap.registerPlugin(ScrollTrigger);
  // 平滑滚动接进 GSAP 的时钟，滚动驱动的那一段才走得均匀
  const lenis = typeof Lenis !== 'undefined' ? new Lenis({ lerp: .12 }) : null;
  if (lenis) {
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add(t => lenis.raf(t * 1000));
    gsap.ticker.lagSmoothing(0);
  }
  $$('a[href^="#"]').forEach(a => a.addEventListener('click', e => {
    const id = a.getAttribute('href');
    const el = id.length > 1 && $(id);
    if (!el) return;
    e.preventDefault();
    if (lenis) lenis.scrollTo(el, { offset: id === '#top' ? -200 : -72, duration: 1.1 });
    else el.scrollIntoView({ behavior: 'smooth' });
    history.replaceState(null, '', id);
  }));

  // 只播一次的出场：滚到位置时开始，往回滚不重播
  const once = (trigger, build, start = 'top 90%') => ScrollTrigger.create({ trigger, start, once: true, onEnter: build });
  const hide = (els, v = { opacity: 0, y: 24 }) => gsap.set(els, v);

  // 首屏：标题按行从遮罩里升起，月历带一点重量落下，时间线晚 80ms 跟上
  gsap.timeline({ defaults: { ease: 'power3.out' } })
    .from('.h-hero .ln > span', { yPercent: 110, duration: .62, stagger: .07 })
    .from('.lede, .act, .hero .fine, .feats', { opacity: 0, y: 14, duration: .45, stagger: .05 }, .2)
    .from('.hero-cal', { opacity: 0, y: 46, duration: .7, ease: 'back.out(1.15)' }, .12)
    .from('.hero-tl', { opacity: 0, y: 30, duration: .6 }, .2);

  // 第 1 屏：原文逐行显出 → 格子遮罩揭开 → 引线描出 → 标注落位
  hide('.md-src', { opacity: 0, y: 16 });
  hide('.md-src .l', { opacity: 0, x: -10 });
  hide('.cell', { clipPath: 'inset(50% 50% 50% 50% round 13%)' });
  hide('.callouts li', { opacity: 0, x: 10 });
  once('#notes-stage', () => {
    drawLeaders();
    gsap.timeline({ defaults: { ease: 'power2.out' }, onComplete: () => leaders.classList.add('drawn') })
      .to('.md-src', { opacity: 1, y: 0, duration: .35 })
      .to('.md-src .l', { opacity: 1, x: 0, duration: .28, stagger: .025 }, .05)
      .to('#leaders path.cover', { strokeDashoffset: 0, duration: .45, ease: 'power1.inOut' }, .4)
      .to('#leaders circle.cover', { opacity: 1, duration: .15 }, .4)
      .to('.cell', { clipPath: 'inset(0% 0% 0% 0% round 13%)', duration: .55, ease: 'power3.inOut' }, .78)
      .fromTo('.cell img', { scale: 1.08 }, { scale: 1, duration: .75, ease: 'power3.out' }, .78)
      .to('#leaders path:not(.cover)', { strokeDashoffset: 0, duration: .35, stagger: .06, ease: 'power1.inOut' }, 1.1)
      .to('#leaders circle:not(.cover)', { opacity: 1, duration: .15, stagger: .06 }, 1.1)
      .to('.callouts li', { opacity: 1, x: 0, duration: .3, stagger: .06 }, 1.25);
  }, 'top 70%');
  addEventListener('resize', drawLeaders);

  // 第 2 屏：截图上升，七个条件沿阅读方向依次展开
  hide('.search-shot', { opacity: 0, y: 40 });
  hide('.search-eg > *', { opacity: 0, x: -8 });
  once('.search', () => gsap.timeline({ defaults: { ease: 'power3.out' } })
    .to('.search-shot', { opacity: 1, y: 0, duration: .7 })
    .to('.search-eg > *', { opacity: 1, x: 0, duration: .3, stagger: .12 }, .45));
  // 第 3 屏：固定舞台，滑动驱动。照片褪去 → 只剩心情点 → 点移到曲线上连成这个月。往回滚倒放。
  const stage = $('#mood-stage');
  const dotEls = $$('#mood-dots i');
  const stepEls = $$('#steps li');
  const setStep = n => stepEls.forEach((li, i) => li.classList.toggle('on', i === n));
  gsap.set('#mood-chart line, #mood-title', { opacity: 0 });
  gsap.matchMedia().add({ wide: '(min-width: 701px)', narrow: '(max-width: 700px)' }, ctx => {
    const dist = ctx.conditions.wide ? 2200 : 1500;
    gsap.timeline({
      scrollTrigger: { trigger: '#mood-pin', start: 'top top', end: '+=' + dist, pin: true, scrub: .6, invalidateOnRefresh: true,
        onUpdate: s => setStep(s.progress < .15 ? 0 : s.progress < .45 ? 1 : 2) },
      defaults: { ease: 'none' },
    })
      .to({}, { duration: .5 })
      .to('.mood-wash', { opacity: .95, duration: 1 })
      .to(dotEls, { opacity: 1, scale: 1.25, duration: .5 }, '<.3')
      .to({}, { duration: .5 })
      .to('.mood-cal', { opacity: 0, duration: .5 })
      .addLabel('move', '<')
      .to(dotEls, {
        x: i => (cx(DOTS[i][0]) / W - DOTS[i][1]) * stage.offsetWidth,
        y: i => (cy(DOTS[i][3]) / H - DOTS[i][2]) * stage.offsetHeight,
        duration: 1.2, stagger: .04, ease: 'power2.inOut' }, 'move')
      .to('#mood-chart polyline', { strokeDashoffset: 0, duration: 20 * .04 + .4 }, 'move+=.9')
      .to('#mood-chart line, #mood-scale span, #mood-title', { opacity: 1, duration: .5, stagger: .03 }, 'move+=.4')
      .to({}, { duration: .8 });
    return () => setStep(0);
  });

  // 心情编辑框落下后稳住，五级颜色依次亮起
  hide('.picker', { opacity: 0, y: 40 });
  once('.mood-detail', () => gsap.timeline({ defaults: { ease: 'power3.out' } })
    .to('.picker', { opacity: 1, y: 0, duration: .7, ease: 'back.out(1.1)' }));

  // 第 4 屏：照片从左边揭开并回缩
  hide('.otd', { clipPath: 'inset(0% 100% 0% 0% round 28px)' });
  once('.memory', () => gsap.timeline({ defaults: { ease: 'power3.out' } })
    .to('.otd', { clipPath: 'inset(0% 0% 0% 0% round 28px)', duration: .8, ease: 'power3.inOut' })
    .fromTo('.otd img', { scale: 1.08 }, { scale: 1, duration: 1 }, 0), 'top 65%');

  // 第 5 屏：文件树逐行写出，Dayline 新增的那个 JSON 最后亮一下
  hide('.tree .t', { opacity: 0, x: -8 });
  hide('.defaults > div', { opacity: 0, y: 12 });
  once('.privacy-grid', () => gsap.timeline({ defaults: { ease: 'power2.out' } })
    .to('.tree .t', { opacity: 1, x: 0, duration: .25, stagger: .045 })
    .fromTo('.tree .new', { backgroundColor: 'rgba(13,19,24,.1)' }, { backgroundColor: 'rgba(13,19,24,0)', duration: .9 }, '-=.15')
    .to('.defaults > div', { opacity: 1, y: 0, duration: .35, stagger: .06 }, .2));

  // 第 6 屏：安装面板带一点重量落下；页脚字标从下面升起
  hide('.panel', { opacity: 0, y: 50 });
  once('.install', () => gsap.to('.panel', { opacity: 1, y: 0, duration: .75, ease: 'back.out(1.2)' }));
  gsap.set('.foot-logo', { opacity: 0, scale: .9 });
  gsap.set('.foot-line, .foot-cta', { opacity: 0, y: 18 });
  once('.foot', () => gsap.timeline({ defaults: { ease: 'power3.out' } })
    .to('.foot-logo', { opacity: 1, scale: 1, duration: .7, ease: 'back.out(1.4)' })
    .to('.foot-line, .foot-cta', { opacity: 1, y: 0, duration: .45, stagger: .08 }, .15), 'top 88%');

  placeInd($('.tabs [aria-selected="true"]'), false);
  fixPaneHeight();
  addEventListener('resize', () => { placeInd($('.tabs [aria-selected="true"]'), false); fixPaneHeight(); });
  ready(() => { placeInd($('.tabs [aria-selected="true"]'), false); fixPaneHeight(); ScrollTrigger.refresh(); });
  if (document.fonts) document.fonts.ready.then(() => ScrollTrigger.refresh());
})();
