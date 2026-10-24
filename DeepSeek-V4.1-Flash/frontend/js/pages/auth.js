(function () {
  'use strict';
  const N = window.NoldOJ;

  async function loginPage(page, ctx) {
    const redirect = ctx.query.get('redirect') || '/';
    const cfg = N.state.config;
    page.innerHTML = `
      <div style="max-width:420px;margin:40px auto">
        <div class="card">
          <h2 style="margin-top:0">登录 NoldOJ</h2>
          <form id="login-form">
            <label>用户名</label><input name="username" autocomplete="username" required />
            <label>密码</label><input name="password" type="password" autocomplete="current-password" required />
            <div id="captcha-box" hidden>
              <label>验证码</label>
              <div class="inline"><input name="captcha" placeholder="输入图中字符" style="flex:1" />
                <span id="captcha-img" style="cursor:pointer" title="点击刷新"></span></div>
            </div>
            <div class="inline" style="margin-top:10px"><input type="checkbox" name="force" id="force" /><label for="force" style="margin:0">强制登录（踢出其他会话）</label></div>
            <button class="btn" style="width:100%;margin-top:16px" type="submit">登录</button>
          </form>
          <p class="muted" style="text-align:center;margin-bottom:0">
            还没有账号？<a href="#/register">立即注册</a></p>
        </div>
      </div>`;

    let captchaId = 'disabled';
    const box = page.querySelector('#captcha-box');
    const imgHost = page.querySelector('#captcha-img');
    async function refreshCaptcha() {
      if (!cfg.captchaEnabled) { box.hidden = true; return; }
      const data = await N.api('/api/auth/captcha');
      captchaId = data.id;
      box.hidden = false;
      imgHost.innerHTML = data.svg;
    }
    imgHost.onclick = () => refreshCaptcha().catch(() => {});
    await refreshCaptcha().catch(() => {});

    page.querySelector('#login-form').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await N.login(fd.get('username'), fd.get('password'), captchaId, fd.get('captcha') || '');
        N.toast('登录成功', 'success');
        N.navigate(redirect);
      } catch (err) {
        N.toast(err.message, 'error');
        refreshCaptcha().catch(() => {});
      }
    };
  }

  async function registerPage(page, ctx) {
    if (!N.state.config.allowRegistration) {
      page.innerHTML = `<div class="card center">当前未开放注册</div>`;
      return;
    }
    page.innerHTML = `
      <div style="max-width:420px;margin:40px auto">
        <div class="card">
          <h2 style="margin-top:0">注册账号</h2>
          <form id="reg-form">
            <label>用户名（3-20 位，字母/数字/下划线/中文）</label>
            <input name="username" required />
            <label>密码（至少 6 位）</label><input name="password" type="password" required />
            <label>确认密码</label><input name="confirm" type="password" required />
            <div id="captcha-box" hidden>
              <label>验证码</label>
              <div class="inline"><input name="captcha" style="flex:1" />
                <span id="captcha-img" style="cursor:pointer"></span></div>
            </div>
            <button class="btn" style="width:100%;margin-top:16px" type="submit">注册</button>
          </form>
          <p class="muted" style="text-align:center;margin-bottom:0">
            已有账号？<a href="#/login${ctx.query.get('redirect') ? `?redirect=${encodeURIComponent(ctx.query.get('redirect'))}` : ''}">去登录</a></p>
        </div>
      </div>`;

    let captchaId = 'disabled';
    const box = page.querySelector('#captcha-box');
    const imgHost = page.querySelector('#captcha-img');
    if (N.state.config.captchaEnabled) {
      try {
        const data = await N.api('/api/auth/captcha');
        captchaId = data.id; box.hidden = false; imgHost.innerHTML = data.svg;
      } catch { /* ignore */ }
    }
    imgHost.onclick = async () => {
      try { const d = await N.api('/api/auth/captcha'); captchaId = d.id; imgHost.innerHTML = d.svg; } catch { /* ignore */ }
    };

    page.querySelector('#reg-form').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      if (fd.get('password') !== fd.get('confirm')) { N.toast('两次输入的密码不一致', 'error'); return; }
      try {
        await N.register({ username: fd.get('username'), password: fd.get('password'), captchaId, captcha: fd.get('captcha') || '' });
        N.toast('注册成功，请登录', 'success');
        N.navigate(`/login${ctx.query.get('redirect') ? `?redirect=${encodeURIComponent(ctx.query.get('redirect'))}` : ''}`);
      } catch (err) {
        N.toast(err.message, 'error');
      }
    };
  }

  N.pages = N.pages || {};
  N.pages.login = loginPage;
  N.pages.register = registerPage;
})();
