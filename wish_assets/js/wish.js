/* ==========================================================
   原神抽卡特殊模式 · 页面脚本
   抽取不在本页发生：由主页面按现有权重生成结果后回传，
   本页只负责卡池选择、动画播放与结果展示。
   所有角色 / 卡池视觉均为排版与 CSS 图案，不使用角色贴图。
   ========================================================== */
(function () {
  'use strict';

  var BANNERS = [
    { key: 'moment-of-bloom-2', label: 'Character Event Wish' }
  ];

  var JIALE_NAME = '周佳乐';
  var COUNTER_KEY = 'genshin_wish_counter_v1';
  var SEEN_KEY = 'genshin_seen_v1';
  var STANDALONE = window.parent === window;

  var bannersView = document.getElementById('bannersView');
  var wishView = document.getElementById('wishView');
  var resultsView = document.getElementById('resultsView');
  var slider = document.getElementById('slider');
  var wishVideo = document.getElementById('wishVideo');
  var resultsRow = document.getElementById('resultsRow');
  var selectBannerEl = document.getElementById('selectBanner');
  var toastEl = document.getElementById('giwsToast');

  var state = {
    bannerIndex: 0,
    busy: false,
    jiale: false,
    pendingItems: [],
    pendingNew: [],
    lastItems: []
  };

  /* ---------- 音效（原神祈愿同款 sfx） ----------
     按钮音效（click / close）默认可用；
     其余抽卡音效属于「音效拓展」，默认不加载，需在设置中主动开启。 */
  var SFX_DIR = 'wish_assets/media/';
  var SFX_FILES = {
    click: 'click.ogg',
    close: 'close.ogg',
    wish: 'wish-backsound.ogg',
    reveal3: 'reveal-3star.ogg',
    reveal4: 'reveal-4star.ogg',
    reveal5: 'reveal-5star.ogg',
    list: 'result-list.ogg'
  };
  var SFX_EXTENDED = { wish: 1, reveal3: 1, reveal4: 1, reveal5: 1, list: 1 };
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
        if (name === 'wish') a.loop = true;
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
      if (!a.loop) a.currentTime = 0;
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

  /* ---------- 卡池切换 ---------- */
  function selectBanner(index) {
    if (index < 0 || index >= BANNERS.length) return;
    state.bannerIndex = index;
    slider.style.transform = 'translate3d(-' + (index * 100) + '%,0,0)';
    var btns = selectBannerEl.children;
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('selected', i === index);
      btns[i].setAttribute('aria-selected', i === index ? 'true' : 'false');
    }
  }

  selectBannerEl.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest ? e.target.closest('.banner-button') : null;
    if (!btn) return;
    playSfx('click');
    var key = btn.getAttribute('data-banner');
    for (var i = 0; i < BANNERS.length; i++) {
      if (BANNERS[i].key === key) { selectBanner(i); return; }
    }
  });

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
      stars += '<span style="position:relative;overflow:hidden;cursor:default;display:block;float:left;color:#ffd700;font-size:' + size + 'px">★</span>';
    }
    return '<div class="react-stars-wrapper" style="display:flex;justify-content:center">' +
      '<div class="react-stars" style="overflow:hidden;position:relative">' + stars + '</div>' +
      '</div>';
  }

  function nameHtml(name) {
    return '<span class="vertical-name">' + escapeHtml(name) + '</span>';
  }

  function cardHtml(item, isNew) {
    return '<div class="wish-item" data-r="' + item.rating + '">' +
      (isNew ? '<span class="new-badge">New</span>' : '') +
      '<div class="card-name">' + nameHtml(item.name) + '</div>' +
      '<div class="card-stars">' + starsHtml(item.rating, 12) + '</div>' +
      '</div>';
  }

  function singleHtml(item, isNew) {
    var rank = item.rating === 5 ? '5★' : (item.rating === 4 ? '4★' : '3★');
    return '<div class="single-card" data-r="' + item.rating + '">' +
      (isNew ? '<span class="new-badge">New</span>' : '') +
      '<div class="single-glyph" aria-hidden="true"></div>' +
      '<div class="single-name">' + nameHtml(item.name) + '</div>' +
      '<div class="single-stars">' + starsHtml(item.rating, 26) + '</div>' +
      '<div class="single-caption">' + rank + ' · ' + escapeHtml(item.name) + '</div>' +
      '</div>';
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
        html += cardHtml(sorted[i], n);
      }
    }
    state.pendingNew = wasNew;
    resultsRow.innerHTML = html;

    bannersView.hidden = true;
    wishView.hidden = true;
    resultsView.hidden = false;

    /* 祈愿次数：与主界面历史记录互不影响，只用于卡池角标 */
    var bannerKey = BANNERS[state.bannerIndex].key;
    counters[bannerKey] = (counters[bannerKey] || 0) + items.length;
    saveJSON(COUNTER_KEY, counters);
    refreshCounters();

    /* 抽卡音效：结束流星背景音，按最高星级播放揭示音 */
    stopSfx('wish');
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
    resultsView.hidden = true;
    wishView.hidden = true;
    bannersView.hidden = false;
    wishVideo.onended = null;
    wishVideo.onerror = null;
    try { wishVideo.pause(); wishVideo.removeAttribute('src'); wishVideo.load(); } catch (e) { /* 忽略 */ }
  }

  document.getElementById('resultsClose').addEventListener('click', function () {
    backToBanners();
    playSfx('close');
  });

  /* ---------- 动画 ---------- */
  function videoFor(count, maxRating) {
    if (count === 1) {
      if (maxRating >= 5) return 'wish_assets/media/5starwish-single.mp4';
      if (maxRating === 4) return 'wish_assets/media/4starwish-single.mp4';
      return 'wish_assets/media/3starwish-single.mp4';
    }
    if (maxRating >= 5) return 'wish_assets/media/5starwish.mp4';
    /* 原仓库没有多人 3 星动画，全 3 星时沿用多人 4 星动画的镜头 */
    return 'wish_assets/media/4starwish.mp4';
  }

  function playWish(items) {
    if (!items.length) { state.busy = false; return; }
    state.pendingItems = items;
    var maxRating = 0;
    for (var i = 0; i < items.length; i++) {
      if (items[i].rating > maxRating) maxRating = items[i].rating;
    }
    bannersView.hidden = true;
    resultsView.hidden = true;
    wishView.hidden = false;
    stopSfx('wish');
    playSfx('wish');
    wishVideo.src = videoFor(items.length, maxRating);
    wishVideo.load();

    var finished = false;
    function finish() {
      if (finished) return;
      finished = true;
      showResults(items);
    }
    wishVideo.onended = finish;
    wishVideo.onerror = function () { finish(); };
    var p = wishVideo.play();
    if (p && typeof p.catch === 'function') {
      p.catch(function () { setTimeout(finish, 350); });
    }
    /* 兜底：视频异常卡住时不让页面永远停在动画页 */
    setTimeout(function () { if (!wishView.hidden) finish(); }, 12000);
  }

  document.getElementById('skipBtn').addEventListener('click', function () {
    if (wishView.hidden) return;
    playSfx('click');
    wishVideo.pause();
    showResults(state.pendingItems || []);
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
  selectBanner(0);
  if (!STANDALONE) {
    try { parent.postMessage({ type: 'wish-hello' }, '*'); } catch (e) { /* 忽略 */ }
  }
})();
