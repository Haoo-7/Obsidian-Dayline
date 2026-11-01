// 三种排版共用的 Dayline 界面碎片。每个函数返回 HTML 字符串，版式负责摆放。
(() => {
  const D = window.DAYLINE;
  const pad = n => String(n).padStart(2, '0');
  const byDay = Object.fromEntries(D.days.map(x => [x.d, x]));
  const A = '../assets/';
  const WD = ['日', '一', '二', '三', '四', '五', '六'];
  const EX = {
    21: '这份样本以一个干净的收尾结束：足够看懂这一周，也留出重新开始的空间。',
    20: '长远的视野由一条条小记录拼成。今天的方向，稳到可以分享了。',
    19: '没收尾的事不算失败，它是一个刻意留下、等更好的问题回来的地方。',
    18: '小小的节奏还在。一张照片、一段很短的录音，让这一周安静的部分被看见。',
    17: '夜里的信号比早上的轻一些，但它仍然算数。',
  };
  const logoPath = (ring, lens) => `<g transform="translate(-94 -159)"><path fill="${ring}" d="M270 177 C284 166 300 160 319 160 H375 C415 160 447 190 447 231 V311 C447 352 416 383 376 383 H319 C300 383 284 377 270 367 C277 361 283 355 289 348 C298 355 308 358 320 358 H375 C402 358 423 338 423 311 V232 C423 205 402 185 375 185 H320 C308 185 298 188 289 195 C283 188 277 182 270 177 Z"/><path fill="${ring}" fill-rule="evenodd" d="M204 160 C264 160 315 211 315 272 C315 333 265 383 204 383 C144 383 94 333 94 273 C94 213 144 160 204 160 Z M204 185 C158 185 119 225 119 273 C119 320 157 359 204 359 C220 359 235 355 247 348 C230 326 220 301 220 273 C220 244 230 218 247 196 C234 189 220 185 204 185 Z"/><path fill="${lens}" d="M267 212 C282 229 291 250 291 273 C291 296 282 318 267 334 C252 317 244 296 244 273 C244 250 252 228 267 212 Z"/></g>`;
  const chevL = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M10 3 5 8l5 5"/></svg>';
  const chevR = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="m6 3 5 5-5 5"/></svg>';
  const today = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2" y="3" width="12" height="11" rx="2"/><path d="M2 6.5h12M6 10l1.5 1.5L10.5 8.5"/></svg>';

  window.UI = {
    pad, byDay,
    logo: (ring = '#0D1318', lens = '#F1694D') => `<svg viewBox="0 0 354 225" aria-hidden="true">${logoPath(ring, lens)}</svg>`,
    download: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10"/></svg>',
    mnav: () => `<div class="dl-mnav"><span>${chevL}</span><b>2026年7月</b><span>${chevR}</span><span>${today}</span></div>`,
    weather: (otd = true) => `<div class="dl-wcard"><div class="dl-wnow"><img src="${A}clear-day.svg" alt=""><div><b>现在 28°C</b><span>Northstar Cove · 体感 30°C · 湿度 64%</span></div></div>${otd ? `<div class="dl-otd"><i style="background-image:url(${A}01-tide.jpg)"></i><div><b>去年今日</b><span>1 年前 · 7 月 18 日</span></div>${chevR}</div>` : ''}</div>`,
    weekdays: () => `<div class="dl-wk">${['一', '二', '三', '四', '五', '六', '日'].map(w => `<span>${w}</span>`).join('')}</div>`,
    grid: (sel = 18) => {
      const out = [];
      for (let i = 0; i < D.leadingBlanks; i++) out.push('<div class="dl-c blank"></div>');
      for (let d = 1; d <= D.daysInMonth; d++) {
        const x = byDay[d];
        out.push(x
          ? `<div class="dl-c photo${d === sel ? ' sel' : ''}" style="background-image:url(${A}${x.cover}.jpg)"><span class="n">${d}</span>${D.wxSvg(x.wx, 'wx')}<span class="md" style="background:${D.moods[x.mood]}"></span></div>`
          : `<div class="dl-c empty"><span class="n">${d}</span></div>`);
      }
      return `<div class="dl-grid">${out.join('')}</div>`;
    },
    trend: (w = 196) => {
      const wk = D.days.slice(-7), step = (w - 16) / 6;
      const pts = wk.map((x, i) => [8 + i * step, 24 - (x.mood + 2) * 5]);
      return `<div class="dl-trend"><span>近七天心情</span><svg viewBox="0 0 ${w} 30"><polyline points="${pts.map(p => p.join(',')).join(' ')}" fill="none" stroke="#C9C9C9" stroke-width="1.5" stroke-linejoin="round"/>${pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="4" fill="${D.moods[wk[i].mood]}" stroke="#F6F6F6" stroke-width="1.5"/>`).join('')}</svg></div>`;
    },
    cards: (days = [21, 20, 19, 18], sel = 18) => days.map(d => {
      const x = byDay[d], wd = WD[new Date(2026, 6, d).getDay()];
      return `<div class="dl-card${d === sel ? ' on' : ''}" style="--m:${D.moods[x.mood]}"><div><b>7月${d}日 周${wd}${d >= 20 ? '<span class="fav">收藏</span>' : ''}</b><div class="t">${x.title}</div><p>${EX[d]}</p></div><i style="background-image:url(${A}${x.cover}.jpg)"></i></div>`;
    }).join(''),
  };
})();
