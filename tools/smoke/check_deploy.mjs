#!/usr/bin/env node
/* 部署后冒烟检查：只用 Node 18+ 自带的 fetch，零依赖。
   目的：把"部署成功但站点坏了"（路径错、版本串、资源缺失）挡在线上。
   用法：SMOKE_BASE=https://qicny233.github.io/RandomlyPick-LiquidGlass/ \
         node tools/smoke/check_deploy.mjs */

const BASE = (process.env.SMOKE_BASE ||
  (process.env.GITHUB_REPOSITORY
    ? `https://${process.env.GITHUB_REPOSITORY.split('/')[0].toLowerCase()}.github.io/${process.env.GITHUB_REPOSITORY.split('/')[1]}/`
    : 'https://qicny233.github.io/RandomlyPick-LiquidGlass/')).replace(/\/?$/, '/');

const STAMP = Date.now();
const failures = [];
const EXPECT_BETA = process.env.SMOKE_EXPECT_BETA !== '0';

function withStamp(path) {
  return BASE + path + (path.includes('?') ? '&' : '?') + 'smoke=' + STAMP;
}

async function getText(path) {
  const res = await fetch(withStamp(path), { redirect: 'follow' });
  return { status: res.status, text: await res.text() };
}

async function head(path) {
  const res = await fetch(withStamp(path), { method: 'HEAD', redirect: 'follow' });
  return res.status;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function check(name, fn, attempts = 4) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      await fn();
      console.log('PASS  ' + name);
      return;
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 4000));
    }
  }
  console.error('FAIL  ' + name + '  :: ' + last.message);
  failures.push(name);
}

await check('正式版首页可访问且含渠道设置', async () => {
  const r = await getText('');
  assert(r.status === 200, 'status=' + r.status);
  assert(r.text.includes('随机人员生成器'), 'missing app title');
  assert(r.text.includes('id="channelOpts"'), 'missing channel switcher');
  assert(!r.text.includes('id="raceFrame"'), 'release unexpectedly contains race UI');
});

await check('正式版 version.json 可读取', async () => {
  const r = await getText('version.json');
  assert(r.status === 200, 'status=' + r.status);
  const v = JSON.parse(r.text);
  assert(typeof v.version === 'string' && /^\d+\.\d+\.\d+/.test(v.version), 'bad version=' + v.version);
  console.log('      release = ' + v.version);
});

if (EXPECT_BETA) {
  await check('Beta 首页可访问且含赛车', async () => {
    const r = await getText('beta/');
    assert(r.status === 200, 'status=' + r.status);
    assert(r.text.includes('随机人员生成器'), 'missing app title');
    assert(r.text.includes('id="channelOpts"'), 'missing channel switcher');
    assert(r.text.includes('id="raceFrame"'), 'missing race UI');
  });
  
  await check('Beta version.json 可读取', async () => {
    const r = await getText('beta/version.json');
    assert(r.status === 200, 'status=' + r.status);
    const v = JSON.parse(r.text);
    assert(typeof v.version === 'string' && /^\d+\.\d+\.\d+/.test(v.version), 'bad version=' + v.version);
    console.log('      beta    = ' + v.version);
  });
  
  await check('Beta 赛车资源齐全', async () => {
    assert(await head('beta/race.html') === 200, 'beta/race.html missing');
    assert(await head('beta/three.global.min.js') === 200, 'beta/three.global.min.js missing');
  });
  
} else {
  console.log('SKIP  Beta 检查（本次部署未包含 Beta）');
}

await check('正式版根目录不含赛车页（两版互不污染）', async () => {
  assert(await head('race.html') === 404, 'root race.html should be 404');
});

if (failures.length) {
  console.error('\n' + failures.length + ' 项失败：' + failures.join('；'));
  process.exit(1);
}
console.log('\n全部通过：' + BASE);
