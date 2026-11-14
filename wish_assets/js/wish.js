/* ==========================================================
   原神抽卡特殊模式 · 页面脚本
   抽取不在本页发生：由主页面按现有权重生成结果后回传，
   本页只负责卡池选择、动画播放与结果展示。
   所有角色 / 卡池视觉均为排版与 CSS 图案，不使用角色贴图。
   ========================================================== */
(function () {
  'use strict';

  var BANNERS = [
    { key: 'moment-of-bloom-2', label: '角色活动祈愿' }
  ];

  var JIALE_NAME = '周佳乐';
  var COUNTER_KEY = 'genshin_wish_counter_v1';
  var SEEN_KEY = 'genshin_seen_v1';
  var STANDALONE = window.parent === window;

  var bannersView = document.getElementById('bannersView');
  var wishView = document.getElementById('wishView');
  var resultsView = document.getElementById('resultsView');
  var wishCanvas = document.getElementById('wishCanvas');
  var wishCtx = wishCanvas ? wishCanvas.getContext('2d') : null;
  var wishFlash = document.getElementById('wishFlash');
  var resultsRow = document.getElementById('resultsRow');
  var toastEl = document.getElementById('giwsToast');

  var state = {
    bannerIndex: 0,
    busy: false,
    jiale: false,
    pendingItems: [],
    pendingNew: [],
    lastItems: [],
    lastCount: 1
  };

  /* ---------- 音效（原神祈愿同款 sfx） ----------
     按钮音效（click / close）默认可用；
     结果揭示音属于「音效拓展」，默认不加载，需在设置中主动开启。
     不使用常驻循环背景音。 */
  var SFX_DIR = 'wish_assets/media/';
  var SFX_FILES = {
    click: 'click.ogg',
    close: 'close.ogg',
    reveal3: 'reveal-3star.ogg',
    reveal4: 'reveal-4star.ogg',
    reveal5: 'reveal-5star.ogg',
    list: 'result-list.ogg'
  };
  var SFX_EXTENDED = { reveal3: 1, reveal4: 1, reveal5: 1, list: 1 };
  var AUDIO_KEY = 'wish_audio_v1';

  var audio = { muted: false, volume: 0.8, extended: false };
  try {
    var savedAudio = JSON.parse(localStorage.getItem(AUDIO_KEY) || 'null');
    if (savedAudio && typeof savedAudio === 'object') {
      audio.muted = !!savedAudio.muted;
      audio.extended = !!savedAudio.extended;
      if (typeof savedAudio.volume === 'number' && isFinite(savedAudio.volume)) {
        audio.volume = Math.max(0, Math.min(1, savedAudio.volume));
      }
    }
  } catch (e) { /* 存储不可用时用默认值 */ }

  function saveAudio() {
    try { localStorage.setItem(AUDIO_KEY, JSON.stringify(audio)); } catch (e) { /* 忽略 */ }
  }

  var sfxCache = {};

  function sfx(name) {
    if (SFX_EXTENDED[name] && !audio.extended) return null;   // 未开启拓展：不创建、不加载
    if (!(name in sfxCache)) {
      try {
        var a = new Audio(SFX_DIR + SFX_FILES[name]);
        a.preload = 'auto';
        a.volume = audio.volume;
        sfxCache[name] = a;
      } catch (e) {
        sfxCache[name] = null;
      }
    }
    return sfxCache[name];
  }

  function playSfx(name) {
    if (audio.muted) return;
    var a = sfx(name);
    if (!a) return;
    try {
      a.volume = audio.volume;
      a.currentTime = 0;
      var p = a.play();
      if (p && typeof p.catch === 'function') p.catch(function () { /* 自动播放被拦截时静默 */ });
    } catch (e) { /* 忽略 */ }
  }

  function stopSfx(name) {
    var a = sfxCache[name];
    if (!a) return;
    try { a.pause(); a.currentTime = 0; } catch (e) { /* 忽略 */ }
  }

  function stopAllSfx() {
    for (var k in sfxCache) stopSfx(k);
  }

  /* 开启拓展：开始加载扩展音效 */
  function ensureExtendedSfx() {
    for (var k in SFX_EXTENDED) {
      if (sfxCache[k] === null) delete sfxCache[k];
      sfx(k);
    }
  }

  /* 关闭拓展：停止并释放扩展音效，不再占用网络与内存 */
  function releaseExtendedSfx() {
    for (var k in SFX_EXTENDED) {
      var a = sfxCache[k];
      if (!a) continue;
      try { a.pause(); a.removeAttribute('src'); a.load(); } catch (e) { /* 忽略 */ }
      delete sfxCache[k];
    }
  }

  function applyAudioSettings() {
    for (var k in sfxCache) {
      var a = sfxCache[k];
      if (!a) continue;
      try { a.volume = audio.volume; } catch (e) { /* 忽略 */ }
    }
    if (audio.muted) stopAllSfx();
  }

  var listSfxTimer = 0;
  var resultsHideTimer = 0;
  var sceneTimer = 0;
  var cinematic = null;

  function sfxForRating(rating) {
    if (rating >= 5) return 'reveal5';
    if (rating === 4) return 'reveal4';
    return 'reveal3';
  }

  /* 仅预加载按钮音效 */
  sfx('click');
  sfx('close');
  if (audio.extended) ensureExtendedSfx();

  /* ---------- 存储 ---------- */
  function loadJSON(key) {
    try {
      var raw = localStorage.getItem(key);
      var obj = raw ? JSON.parse(raw) : null;
      return obj && typeof obj === 'object' ? obj : {};
    } catch (e) { return {}; }
  }
  function saveJSON(key, obj) {
    try { localStorage.setItem(key, JSON.stringify(obj)); } catch (e) { /* 存储不可用时忽略 */ }
  }

  var counters = loadJSON(COUNTER_KEY);
  var seen = loadJSON(SEEN_KEY);

  function refreshCounters() {
    var els = document.querySelectorAll('.wish-counter');
    for (var i = 0; i < els.length; i++) {
      var key = els[i].getAttribute('data-count-for');
      els[i].textContent = String(counters[key] || 0);
    }
  }

  /* ---------- 结果视图 ---------- */
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* 星星结构与原版一致：金色 ★ 逐颗排列 */
  function starsHtml(rating, size) {
    var stars = '';
    for (var i = 0; i < rating; i++) {
      stars += '<span class="star" style="--si:' + i + ';position:relative;overflow:hidden;cursor:default;display:block;float:left;color:#ffd700;font-size:' + size + 'px">★</span>';
    }
    return '<div class="react-stars-wrapper" style="display:flex;justify-content:center">' +
      '<div class="react-stars" style="overflow:hidden;position:relative">' + stars + '</div>' +
      '</div>';
  }

  function nameHtml(name) {
    var text = String(name);
    var chars = '';
    for (var i = 0; i < text.length; i++) {
      chars += '<span class="nm-char" style="--ci:' + i + '">' + escapeHtml(text.charAt(i)) + '</span>';
    }
    return '<span class="vertical-name" style="--n:' + text.length + '">' + chars + '</span>';
  }

  function cardHtml(item, isNew, index) {
    return '<div class="wish-item" data-r="' + item.rating + '" style="--i:' + (index || 0) + '">' +
      (isNew ? '<span class="new-badge">新</span>' : '') +
      '<div class="card-name">' + nameHtml(item.name) + '</div>' +
      '<div class="card-stars">' + starsHtml(item.rating, 12) + '</div>' +
      '</div>';
  }

  function singleHtml(item, isNew) {
    return '<div class="single-card" data-r="' + item.rating + '" style="--i:0">' +
      (isNew ? '<span class="new-badge">新</span>' : '') +
      '<div class="single-glyph" aria-hidden="true"></div>' +
      '<div class="single-name">' + nameHtml(item.name) + '</div>' +
      '<div class="single-stars">' + starsHtml(item.rating, 26) + '</div>' +
      '</div>';
  }

  /* ---------- 结果入场：阻尼弹簧（Web Animations） ---------- */
  var hasElementAnimate = typeof Element !== 'undefined' && !!Element.prototype.animate;

  /* 阻尼振荡位移：从 0 出发、越过 1 后回落，形成回弹 */
  function springFrames(opts) {
    var frames = [];
    var steps = 34;
    var zeta = opts.zeta || 0.52;
    var omega = opts.omega || 11;
    var wd = omega * Math.sqrt(1 - zeta * zeta);
    for (var i = 0; i <= steps; i++) {
      var u = i / steps;
      var t = u * 1.05;
      var p = 1 - Math.exp(-zeta * omega * t) * (Math.cos(wd * t) + (zeta * omega / wd) * Math.sin(wd * t));
      frames.push({
        offset: u,
        opacity: Math.min(1, Math.max(0, p * 1.9)),
        filter: 'blur(' + Math.max(0, (opts.blur || 0) * (1 - p)).toFixed(1) + 'px)',
        transform: 'translate3d(' +
          ((opts.x || 0) * (1 - p)).toFixed(1) + 'px,' +
          ((opts.y || 0) * (1 - p)).toFixed(1) + 'px,0) scale(' +
          (1 + ((opts.scale || 1) - 1) * (1 - p)).toFixed(3) + ')'
      });
    }
    frames[steps] = { offset: 1, opacity: 1, filter: 'none', transform: 'none' };
    return frames;
  }

  function springIn(el, opts, delay) {
    if (!el || !hasElementAnimate) return;
    el.animate(springFrames(opts), {
      duration: opts.duration || 900,
      delay: delay || 0,
      easing: 'linear',
      fill: 'both'
    });
  }

  function animateResults() {
    resultsView.classList.toggle('fallback-anim', !hasElementAnimate);
    if (!hasElementAnimate) return;
    var cards = resultsRow.querySelectorAll('.wish-item, .single-card');
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      var isSingle = card.classList.contains('single-card');
      var cardDelay = isSingle ? 160 : 140 + i * 150;
      springIn(card, isSingle
        ? { y: 46, scale: 0.82, blur: 12, duration: 980 }
        : { x: 92, scale: 0.9, blur: 10, duration: 900 }, cardDelay);
      /* 名字逐字弹出 */
      var chars = card.querySelectorAll('.nm-char');
      for (var c = 0; c < chars.length; c++) {
        springIn(chars[c], { y: 26, scale: 0.4, blur: 7, duration: 760 },
          cardDelay + 150 + c * (isSingle ? 150 : 85));
      }
      /* 星星随后逐颗亮起 */
      var stars = card.querySelectorAll('.react-stars .star');
      for (var s = 0; s < stars.length; s++) {
        springIn(stars[s], { scale: 0.2, blur: 4, duration: 560 },
          cardDelay + 320 + s * 55);
      }
    }
  }

  function showResults(items) {
    state.lastItems = items;
    state.pendingItems = items;
    var wasNew = [];
    var html = '';
    if (items.length === 1) {
      var isNew = !seen[items[0].name];
      if (isNew) wasNew.push(items[0].name);
      html = singleHtml(items[0], isNew);
    } else {
      var sorted = items.slice().sort(function (a, b) { return b.rating - a.rating; });
      for (var i = 0; i < sorted.length; i++) {
        var n = !seen[sorted[i].name];
        if (n) wasNew.push(sorted[i].name);
        html += cardHtml(sorted[i], n, i);
      }
    }
    state.pendingNew = wasNew;
    resultsRow.innerHTML = html;
    resultsView.scrollTop = 0;

    /* 结果页在白光覆盖下瞬时铺满，随后场景淡出露出结果，避免透底与跳屏 */
    clearTimeout(resultsHideTimer);
    resultsView.hidden = false;
    resultsView.classList.remove('show');
    resultsView.classList.add('instant-show');
    animateResults();
    void resultsView.offsetWidth;
    requestAnimationFrame(function () {
      resultsView.classList.add('show');
      requestAnimationFrame(function () { resultsView.classList.remove('instant-show'); });
    });

    /* 祈愿次数：与主界面历史记录互不影响，只用于卡池角标 */
    var bannerKey = BANNERS[state.bannerIndex].key;
    counters[bannerKey] = (counters[bannerKey] || 0) + items.length;
    saveJSON(COUNTER_KEY, counters);
    refreshCounters();

    /* 结果卡出现的瞬间：按最高星级播放揭示音（无常驻背景音） */
    var maxRating = 0;
    for (var q = 0; q < items.length; q++) {
      if (items[q].rating > maxRating) maxRating = items[q].rating;
    }
    playSfx(sfxForRating(maxRating));
    clearTimeout(listSfxTimer);
    if (items.length > 1) {
      listSfxTimer = setTimeout(function () { playSfx('list'); }, 900);
    }
  }

  function backToBanners() {
    clearTimeout(listSfxTimer);
    stopAllSfx();
    for (var i = 0; i < state.pendingNew.length; i++) seen[state.pendingNew[i]] = 1;
    saveJSON(SEEN_KEY, seen);
    state.pendingNew = [];
    state.pendingItems = [];
    document.body.classList.remove('in-wish-flow');

    /* 结果页淡出，露出下方卡池，不做瞬间切换 */
    resultsView.classList.remove('show');
    clearTimeout(resultsHideTimer);
    resultsHideTimer = setTimeout(function () { resultsView.hidden = true; }, 540);

    if (cinematic) { cinematic.destroy(); cinematic = null; }
    clearTimeout(sceneTimer);
    wishView.classList.remove('show');
    sceneTimer = setTimeout(function () { wishView.hidden = true; }, 560);
  }

  document.getElementById('resultsClose').addEventListener('click', function () {
    backToBanners();
    playSfx('close');
  });

  /* 结果页「再来一次」：按上一次的抽数直接再抽，场景淡入盖住结果页 */
  document.getElementById('againBtn').addEventListener('click', function () {
    playSfx('click');
    if (state.busy) return;
    requestWish(state.lastCount || 1);
  });

  /* ---------- 现场绘制的祈愿动画 ----------
     星空、流星、爆闪与粒子全部由 Canvas 实时绘制，不再播放视频。
     时间轴：星空淡入 → 流星划过 → 蓄能 → 爆闪 → 白光过渡到结果页。 */
  var TAU = Math.PI * 2;

  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function buildPalette(rating) {
    if (rating >= 5) return {
      glow: '255, 206, 92',
      core: '255, 250, 232',
      tint: '#fff3d2',
      colors: ['255,246,214', '255,214,110', '255,178,72', '255,255,255']
    };
    if (rating === 4) return {
      glow: '176, 128, 255',
      core: '246, 238, 255',
      tint: '#f0e6ff',
      colors: ['240,226,255', '201,162,255', '148,104,255', '255,255,255']
    };
    return {
      glow: '112, 168, 255',
      core: '235, 246, 255',
      tint: '#e9f3ff',
      colors: ['226,240,255', '143,196,255', '88,152,255', '255,255,255']
    };
  }

  function createCinematic(maxRating, callbacks) {
    var pal = buildPalette(maxRating);
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = 1, h = 1, cx = 0, cy = 0;
    var stars = [], sheds = [], sparks = [], rings = [], rays = [];
    var raf = 0, startAt = 0, lastAt = 0, elapsed = 0;
    var running = false, done = false, burstFired = false;
    var shake = 0;
    var meteorStart = 200, meteorEnd = 2300, burstAt = 2400;
    var finishAt = maxRating >= 5 ? 3600 : 3450;

    function resize() {
      w = window.innerWidth;
      h = window.innerHeight;
      cx = w * 0.5;
      cy = h * 0.48;
      wishCanvas.width = Math.round(w * dpr);
      wishCanvas.height = Math.round(h * dpr);
      wishCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      buildStars();
    }

    function buildStars() {
      stars.length = 0;
      var count = Math.round(Math.min(170, (w * h) / 11000));
      for (var i = 0; i < count; i++) {
        stars.push({
          x: Math.random() * w,
          y: Math.random() * h,
          r: Math.random() * 1.5 + 0.35,
          base: 0.22 + Math.random() * 0.55,
          speed: 0.5 + Math.random() * 1.8,
          phase: Math.random() * TAU
        });
      }
    }

    function blob(x, y, r, rgb, a) {
      var g = wishCtx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(' + rgb + ',' + a + ')');
      g.addColorStop(0.55, 'rgba(' + rgb + ',' + (a * 0.45) + ')');
      g.addColorStop(1, 'rgba(' + rgb + ',0)');
      wishCtx.fillStyle = g;
      wishCtx.beginPath();
      wishCtx.arc(x, y, r, 0, TAU);
      wishCtx.fill();
    }

    function drawBackdrop() {
      var c = wishCtx;
      c.globalCompositeOperation = 'source-over';   // 星空/流星的 lighter 不能残留到下一帧背景
      var g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#05070f');
      g.addColorStop(0.46, '#0a0f24');
      g.addColorStop(1, '#0c1230');
      c.fillStyle = g;
      c.fillRect(-24, -24, w + 48, h + 48);
      blob(w * 0.24, h * 0.28, w * 0.55, '64, 40, 120', 0.2);
      blob(w * 0.82, h * 0.7, w * 0.6, '24, 62, 128', 0.17);
      blob(w * 0.58, h * 0.12, w * 0.4, '96, 58, 150', 0.1);
    }

    function drawStars(now) {
      var c = wishCtx;
      c.globalCompositeOperation = 'lighter';
      for (var i = 0; i < stars.length; i++) {
        var s = stars[i];
        var tw = 0.62 + 0.38 * Math.sin(now * 0.001 * s.speed + s.phase);
        c.fillStyle = 'rgba(214, 230, 255,' + (s.base * tw).toFixed(3) + ')';
        c.fillRect(s.x, s.y, s.r, s.r);
      }
    }

    function meteorPos(e) {
      var p0x = -0.15, p0y = 0.25;
      var p1x = 0.3, p1y = 0.06;
      var p2x = 0.5, p2y = 0.48;
      var u = 1 - e;
      return {
        x: (u * u * p0x + 2 * u * e * p1x + e * e * p2x) * w,
        y: (u * u * p0y + 2 * u * e * p1y + e * e * p2y) * h
      };
    }

    function shed(x, y) {
      if (sheds.length > 170) sheds.splice(0, sheds.length - 170);
      sheds.push({
        x: x + (Math.random() - 0.5) * 20,
        y: y + (Math.random() - 0.5) * 20,
        vx: -30 - Math.random() * 90,
        vy: (Math.random() - 0.5) * 70,
        life: 0.45 + Math.random() * 0.55,
        ttl: 1,
        r: 0.7 + Math.random() * 1.7
      });
    }

    function updateSheds(dt) {
      var c = wishCtx;
      for (var i = sheds.length - 1; i >= 0; i--) {
        var p = sheds[i];
        p.life -= dt;
        if (p.life <= 0) { sheds.splice(i, 1); continue; }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 0.984;
        p.vy = p.vy * 0.984 + 24 * dt;
        var a = Math.max(0, p.life / p.ttl) * 0.7;
        c.fillStyle = 'rgba(255, 232, 176,' + a.toFixed(3) + ')';
        c.beginPath();
        c.arc(p.x, p.y, p.r, 0, TAU);
        c.fill();
      }
    }

    function drawMeteor(e, dt) {
      var c = wishCtx;
      c.globalCompositeOperation = 'lighter';
      c.lineCap = 'round';
      for (var j = 0; j < 32; j++) {
        var t2 = e - j * 0.0105;
        var t3 = e - (j + 1) * 0.0105;
        if (t2 <= 0.002) break;
        var a = meteorPos(Math.max(0, t2));
        var b = meteorPos(Math.max(0, t3));
        var k = 1 - j / 32;
        c.strokeStyle = 'rgba(255, 236, 186,' + (0.62 * k * k).toFixed(3) + ')';
        c.lineWidth = 0.6 + 6.5 * k * k;
        c.beginPath();
        c.moveTo(a.x, a.y);
        c.lineTo(b.x, b.y);
        c.stroke();
      }
      var pos = meteorPos(e);
      var r = 30 + 26 * e;
      var g = c.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, r * 3.4);
      g.addColorStop(0, 'rgba(255, 255, 255, .98)');
      g.addColorStop(0.18, 'rgba(' + pal.core + ', .95)');
      g.addColorStop(0.45, 'rgba(' + pal.glow + ', .5)');
      g.addColorStop(1, 'rgba(' + pal.glow + ', 0)');
      c.fillStyle = g;
      c.beginPath();
      c.arc(pos.x, pos.y, r * 3.4, 0, TAU);
      c.fill();
      c.fillStyle = 'rgba(255, 255, 255, .95)';
      c.beginPath();
      c.arc(pos.x, pos.y, Math.max(2, r * 0.22), 0, TAU);
      c.fill();
      if (e > 0.05) {
        for (var s2 = 0; s2 < 2; s2++) shed(pos.x, pos.y);
      }
    }

    function drawCharge(p, now) {
      var c = wishCtx;
      c.globalCompositeOperation = 'lighter';
      var pulse = 0.72 + 0.28 * Math.sin(now * 0.02);
      var r = 40 + 120 * p * pulse;
      var g = c.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, 'rgba(255, 255, 255,' + (0.5 * p).toFixed(3) + ')');
      g.addColorStop(0.45, 'rgba(' + pal.glow + ',' + (0.4 * p).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(' + pal.glow + ', 0)');
      c.fillStyle = g;
      c.beginPath();
      c.arc(cx, cy, r, 0, TAU);
      c.fill();

      /* 旋转法阵：两颗同心环与刻度，蓄能越满越清晰 */
      var ringR = 68 + 118 * p;
      var rot = now * 0.0005;
      c.save();
      c.translate(cx, cy);
      c.rotate(rot);
      c.strokeStyle = 'rgba(' + pal.glow + ',' + (0.5 * p).toFixed(3) + ')';
      c.lineWidth = 1.4;
      c.beginPath();
      c.arc(0, 0, ringR, 0, TAU);
      c.stroke();
      c.setLineDash([2, 10]);
      c.beginPath();
      c.arc(0, 0, ringR * 0.74, 0, TAU);
      c.stroke();
      c.setLineDash([]);
      for (var i = 0; i < 12; i++) {
        var a = (i / 12) * TAU;
        c.beginPath();
        c.moveTo(Math.cos(a) * ringR * 1.06, Math.sin(a) * ringR * 1.06);
        c.lineTo(Math.cos(a) * ringR * 1.14, Math.sin(a) * ringR * 1.14);
        c.stroke();
      }
      c.restore();
    }

    function fireBurst() {
      if (burstFired) return;
      burstFired = true;
      shake = 14;
      var count = maxRating >= 5 ? 190 : (maxRating === 4 ? 140 : 100);
      for (var i = 0; i < count; i++) {
        var ang = Math.random() * TAU;
        var spd = 140 + Math.random() * (maxRating >= 5 ? 620 : 480);
        var ttl = 0.7 + Math.random() * 1.1;
        sparks.push({
          x: cx + (Math.random() - 0.5) * 16,
          y: cy + (Math.random() - 0.5) * 16,
          vx: Math.cos(ang) * spd,
          vy: Math.sin(ang) * spd * 0.82,
          ttl: ttl,
          life: ttl,
          size: 1 + Math.random() * 2.4,
          rgb: pal.colors[(Math.random() * pal.colors.length) | 0]
        });
      }
      rings.push({ at: 0, max: maxRating >= 5 ? 760 : 540, width: maxRating >= 5 ? 7 : 5 });
      rings.push({ at: 150, max: maxRating >= 5 ? 600 : 440, width: 3 });
      if (maxRating >= 5) rings.push({ at: 320, max: 880, width: 2 });
      for (var k = 0; k < 18; k++) {
        rays.push({ a: (k / 18) * TAU + Math.random() * 0.08, len: 0.12 + Math.random() * 0.3 });
      }
    }

    function drawBurst(bt, dt) {
      var c = wishCtx;
      c.globalCompositeOperation = 'lighter';

      var fa = Math.max(0, 1 - bt / 620);
      if (fa > 0) {
        var fg = c.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.55);
        fg.addColorStop(0, 'rgba(255, 255, 255,' + (0.9 * fa).toFixed(3) + ')');
        fg.addColorStop(0.3, 'rgba(' + pal.glow + ',' + (0.55 * fa).toFixed(3) + ')');
        fg.addColorStop(1, 'rgba(' + pal.glow + ', 0)');
        c.fillStyle = fg;
        c.fillRect(0, 0, w, h);
      }

      for (var i = 0; i < rings.length; i++) {
        var rg = rings[i];
        var rt = bt - rg.at;
        if (rt < 0) continue;
        var p = Math.min(1, rt / rg.max);
        var alpha = (1 - p) * 0.7;
        if (alpha <= 0.003) continue;
        c.strokeStyle = 'rgba(' + pal.glow + ',' + alpha.toFixed(3) + ')';
        c.lineWidth = rg.width * (1 - p) + 0.6;
        c.beginPath();
        c.arc(cx, cy, p * Math.max(w, h) * 0.5, 0, TAU);
        c.stroke();
      }

      var ra = Math.max(0, 1 - bt / 900);
      if (ra > 0) {
        for (var j = 0; j < rays.length; j++) {
          var ray = rays[j];
          var ang = ray.a + bt * 0.00022;
          var len = Math.min(w, h) * ray.len * (0.35 + ra * 0.65);
          var x1 = cx + Math.cos(ang) * 20;
          var y1 = cy + Math.sin(ang) * 20;
          var x2 = cx + Math.cos(ang) * len;
          var y2 = cy + Math.sin(ang) * len;
          var lg = c.createLinearGradient(x1, y1, x2, y2);
          lg.addColorStop(0, 'rgba(' + pal.core + ',' + (0.34 * ra).toFixed(3) + ')');
          lg.addColorStop(1, 'rgba(' + pal.glow + ', 0)');
          c.strokeStyle = lg;
          c.lineWidth = 2;
          c.beginPath();
          c.moveTo(x1, y1);
          c.lineTo(x2, y2);
          c.stroke();
        }
      }

      for (var n = sparks.length - 1; n >= 0; n--) {
        var sp = sparks[n];
        sp.life -= dt;
        if (sp.life <= 0) { sparks.splice(n, 1); continue; }
        sp.vx *= 0.985;
        sp.vy = sp.vy * 0.985 + 60 * dt;
        sp.x += sp.vx * dt;
        sp.y += sp.vy * dt;
        var a2 = Math.max(0, sp.life / sp.ttl) * 0.9;
        c.fillStyle = 'rgba(' + sp.rgb + ',' + a2.toFixed(3) + ')';
        c.beginPath();
        c.arc(sp.x, sp.y, sp.size, 0, TAU);
        c.fill();
      }
    }

    function frame(now) {
      if (done) return;
      if (!startAt) { startAt = now; lastAt = now; }
      elapsed = now - startAt;
      var dt = Math.min(0.05, (now - lastAt) / 1000 || 0.016);
      lastAt = now;

      if (!burstFired && elapsed >= burstAt) fireBurst();
      if (elapsed >= finishAt) {
        done = true;
        window.removeEventListener('resize', resize);
        callbacks.finish();
        return;
      }

      var c = wishCtx;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (shake > 0.4) {
        c.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
        shake *= Math.pow(0.002, dt);
      }

      drawBackdrop();
      drawStars(now);

      if (!burstFired) {
        var mt = Math.max(0, Math.min(1, (elapsed - meteorStart) / (meteorEnd - meteorStart)));
        if (elapsed >= meteorStart) drawMeteor(easeInOutCubic(mt), dt);
        updateSheds(dt);
        var charge = Math.max(0, Math.min(1, (elapsed - (burstAt - 420)) / 420));
        if (charge > 0) drawCharge(charge, now);
      } else {
        updateSheds(dt);
        drawBurst(elapsed - burstAt, dt);
      }

      raf = requestAnimationFrame(frame);
    }

    function start() {
      if (running) return;
      running = true;
      resize();
      window.addEventListener('resize', resize);
      raf = requestAnimationFrame(frame);
    }

    function destroy() {
      done = true;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      window.removeEventListener('resize', resize);
    }

    function finishNow() {
      if (done) return;
      done = true;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      window.removeEventListener('resize', resize);
      if (!burstFired) fireBurst();
      callbacks.finish();
    }

    return { start: start, skip: finishNow, destroy: destroy };
  }

  /* 白光覆盖时切换场景，再整体淡出露出结果页 */
  function fadeSceneOut(withFlash) {
    clearTimeout(sceneTimer);
    if (withFlash && wishFlash) {
      wishFlash.style.transition = 'none';
      wishFlash.style.opacity = '0';
      void wishFlash.offsetWidth;
      wishFlash.style.transition = 'opacity .16s ease';
      wishFlash.style.opacity = '1';
    }
    sceneTimer = setTimeout(function () {
      wishView.classList.remove('show');
      sceneTimer = setTimeout(function () {
        wishView.hidden = true;
        if (wishFlash) {
          wishFlash.style.transition = 'none';
          wishFlash.style.opacity = '0';
        }
      }, 640);
    }, withFlash ? 240 : 0);
  }

  function playWish(items) {
    if (!items.length) { state.busy = false; return; }
    state.pendingItems = items;
    state.lastCount = items.length;
    var maxRating = 0;
    for (var i = 0; i < items.length; i++) {
      if (items[i].rating > maxRating) maxRating = items[i].rating;
    }

    if (!wishCtx) {
      /* 极端情况下没有 Canvas：直接进结果页，保持功能可用 */
      document.body.classList.add('in-wish-flow');
      showResults(items);
      return;
    }

    /* 场景淡入盖住当前画面（卡池或结果页），随后流星入场 */
    clearTimeout(sceneTimer);
    clearTimeout(resultsHideTimer);
    setSettingsOpen(false);
    wishView.hidden = false;
    wishView.classList.remove('show');
    void wishView.offsetWidth;
    wishView.classList.add('show');
    document.body.classList.add('in-wish-flow');
    if (wishFlash) {
      wishFlash.style.setProperty('--flash-tint', buildPalette(maxRating).tint);
      wishFlash.style.transition = 'none';
      wishFlash.style.opacity = '0';
    }

    cinematic = createCinematic(maxRating, {
      finish: function () {
        cinematic = null;
        showResults(items);
        fadeSceneOut(true);
      }
    });
    cinematic.start();
  }

  document.getElementById('skipBtn').addEventListener('click', function () {
    if (wishView.hidden) return;
    playSfx('click');
    if (cinematic) cinematic.skip();
  });

  /* ---------- 佳乐庆典：屏幕上方连点三下 ---------- */
  function toast(text) {
    if (!toastEl) return;
    toastEl.textContent = text;
    toastEl.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function () { toastEl.classList.remove('show'); }, 1700);
  }

  function setJiale(on, silent) {
    state.jiale = !!on;
    document.body.classList.toggle('jiale', state.jiale);
    if (!silent) {
      playSfx('click');
      toast(state.jiale ? '佳乐庆典已开启' : '佳乐庆典已关闭');
    }
    if (STANDALONE) return;
    try {
      parent.postMessage({ type: 'wish-jiale', on: state.jiale }, '*');
    } catch (e) { /* 忽略 */ }
  }

  var topHits = [];
  document.addEventListener('click', function (e) {
    if (e.clientY > window.innerHeight * 0.24) { topHits.length = 0; return; }
    var t = e.target;
    if (t && t.closest && t.closest('button, .banner-button, .wish-button, .close-window, .close-button, .skip-button')) {
      topHits.length = 0;
      return;
    }
    var now = performance.now();
    topHits.push(now);
    while (topHits.length && now - topHits[0] > 800) topHits.shift();
    if (topHits.length < 3) return;
    topHits.length = 0;
    if (navigator.vibrate) { try { navigator.vibrate(25); } catch (err) { /* 忽略 */ } }
    setJiale(!state.jiale);
  }, false);

  /* ---------- 设置面板（左下角） ---------- */
  var settingsBtn = document.getElementById('settingsBtn');
  var settingsPanel = document.getElementById('settingsPanel');
  var settingsClose = document.getElementById('settingsClose');
  var muteToggle = document.getElementById('muteToggle');
  var volumeRange = document.getElementById('volumeRange');
  var volumeText = document.getElementById('volumeText');
  var extendedToggle = document.getElementById('extendedToggle');

  function syncSettingsUI() {
    var pct = Math.round(audio.volume * 100);
    if (muteToggle) muteToggle.setAttribute('aria-checked', audio.muted ? 'true' : 'false');
    if (extendedToggle) extendedToggle.setAttribute('aria-checked', audio.extended ? 'true' : 'false');
    if (volumeRange) {
      volumeRange.value = String(pct);
      volumeRange.style.setProperty('--vol', pct + '%');
    }
    if (volumeText) volumeText.textContent = pct + '%';
  }

  function setSettingsOpen(open) {
    if (!settingsPanel) return;
    settingsPanel.hidden = !open;
    if (settingsBtn) settingsBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  if (settingsBtn) {
    settingsBtn.addEventListener('click', function () {
      playSfx('click');
      setSettingsOpen(settingsPanel.hidden);
    });
  }
  if (settingsClose) {
    settingsClose.addEventListener('click', function () {
      playSfx('close');
      setSettingsOpen(false);
    });
  }
  if (muteToggle) {
    muteToggle.addEventListener('click', function () {
      audio.muted = !audio.muted;
      saveAudio();
      applyAudioSettings();
      syncSettingsUI();
      if (!audio.muted) playSfx('click');
    });
  }
  if (extendedToggle) {
    extendedToggle.addEventListener('click', function () {
      audio.extended = !audio.extended;
      saveAudio();
      if (audio.extended) ensureExtendedSfx();
      else releaseExtendedSfx();
      playSfx('click');
      syncSettingsUI();
    });
  }
  if (volumeRange) {
    volumeRange.addEventListener('input', function () {
      var pct = parseInt(volumeRange.value, 10) || 0;
      audio.volume = Math.max(0, Math.min(1, pct / 100));
      volumeRange.style.setProperty('--vol', pct + '%');
      if (volumeText) volumeText.textContent = pct + '%';
      applyAudioSettings();
    });
    volumeRange.addEventListener('change', function () {
      saveAudio();
      playSfx('click');
    });
  }

  /* 点击面板以外区域收起设置 */
  document.addEventListener('click', function (e) {
    if (!settingsPanel || settingsPanel.hidden) return;
    if (settingsPanel.contains(e.target) || (settingsBtn && settingsBtn.contains(e.target))) return;
    setSettingsOpen(false);
  }, false);

  syncSettingsUI();

  /* ---------- 与主页面的抽取通信 ---------- */
  function requestWish(count) {
    if (state.busy) return;
    state.busy = true;
    if (STANDALONE) {
      /* 直接打开本页时用于预览的固定样例，不参与任何概率计算 */
      var demo;
      if (state.jiale) {
        demo = [];
        for (var k = 0; k < count; k++) demo.push({ name: JIALE_NAME, rating: 5 });
      } else {
        demo = [
          { name: '田寿康', rating: 4 },
          { name: '陈敬杰', rating: 4 },
          { name: '丁小龙', rating: 4 },
          { name: '蔡兴喆', rating: 4 }
        ].slice(0, count);
      }
      setTimeout(function () { state.busy = false; playWish(demo); }, 120);
      return;
    }
    try {
      parent.postMessage({
        type: 'wish-draw',
        count: count,
        banner: BANNERS[state.bannerIndex].key,
        jiale: state.jiale
      }, '*');
    } catch (e) {
      state.busy = false;
      return;
    }
    /* 主页面未响应时解锁按钮，避免卡死 */
    setTimeout(function () { state.busy = false; }, 8000);
  }

  document.getElementById('wishBtn').addEventListener('click', function () {
    playSfx('click');
    requestWish(1);
  });
  document.getElementById('wishBtn4').addEventListener('click', function () {
    playSfx('click');
    requestWish(4);
  });

  window.addEventListener('message', function (e) {
    if (e.source !== window.parent || !e.data) return;
    if (e.data.type === 'wish-result') {
      state.busy = false;
      playWish(e.data.items || []);
    }
    if (e.data.type === 'wish-init') {
      setJiale(!!e.data.jiale, true);
    }
  });

  /* ---------- 退出 ---------- */
  function exitMode() {
    stopAllSfx();
    if (cinematic) { cinematic.destroy(); cinematic = null; }
    clearTimeout(sceneTimer);
    clearTimeout(resultsHideTimer);
    document.body.classList.remove('in-wish-flow');
    wishView.classList.remove('show');
    wishView.hidden = true;
    resultsView.classList.remove('show');
    resultsView.hidden = true;
    if (wishFlash) {
      wishFlash.style.transition = 'none';
      wishFlash.style.opacity = '0';
    }
    if (STANDALONE) return;
    try { parent.postMessage({ type: 'wish-close' }, '*'); } catch (e) { /* 忽略 */ }
  }
  document.getElementById('closeWindow').addEventListener('click', function () {
    exitMode();
    playSfx('close');
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (settingsPanel && !settingsPanel.hidden) { setSettingsOpen(false); return; }
    if (!resultsView.hidden) { backToBanners(); return; }
    exitMode();
  });

  /* ---------- 初始化 ---------- */
  refreshCounters();
  if (!STANDALONE) {
    try { parent.postMessage({ type: 'wish-hello' }, '*'); } catch (e) { /* 忽略 */ }
  }
})();
