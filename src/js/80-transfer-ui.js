/* ============ 存档迁移 · UI（第 1 批：离线三载体） ============ */
let tfUI = null;
let tfBound = false;
function tfState(){
  if(!tfUI) tfUI = { phase:'idle', text:'', pin:'', pin2:'', impPin:'', parsed:null, target:0, out:null, msg:'', err:'' };
  return tfUI;
}
function tfEsc2(s){
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function tfSizeKB(text){ return (text.length / 1024).toFixed(1) + ' KB'; }
function tfSlotLabel(n){
  const m = slotMeta(n);
  if(!m.exists) return '空槽位';
  return `💰 ${m.coins} · 🏆 ${m.ach} 成就 · ${fmtTime(m.savedAt)}`;
}
function renderTransfer(){
  const el = document.getElementById('transferBody');
  if(!el) return;
  const u = tfState();
  if(!tfBound){
    tfBound = true;
    el.addEventListener('click', tfOnClick);
    el.addEventListener('change', tfOnChange);
  }
  u.shareOk = (typeof navigator !== 'undefined' && !!navigator.share);
  const risk = tfStorageRisk();
  const iosHint = risk
    ? '<div class="tf-warn">⚠️ 这台设备可能随时清掉网页存档（iOS 上 7 天没打开就会清、无痕模式也是）。建议把存档导出留一份，或者「添加到主屏幕」再玩。</div>'
    : '';
  const noCrypto = tfHasCrypto() ? '' : '<div class="tf-warn">⚠️ 这台设备的浏览器不支持加密接口，导出/导入用不了（换 Safari / Chrome 新版）。</div>';
  const cur = currentSlot() || 1;

  /* ---------- 导出区 ---------- */
  let out = '';
  if(u.out){
    out = `
      <div class="tf-box">
        <div class="r-meta">已生成（${tfSizeKB(u.out)}）· 密码千万不要忘，忘了这份存档就打不开</div>
        <textarea class="tf-text" readonly rows="3" data-out>${tfEsc2(u.out)}</textarea>
        <div class="tf-btns">
          <button class="mini primary" data-act="copy">复制存档串</button>
          <button class="mini" data-act="selectall">全选</button>
          <button class="mini" data-act="download">下载 .farm 文件</button>
          ${u.shareOk ? '<button class="mini" data-act="share">分享…</button>' : ''}
        </div>
        <div class="tf-btns"><button class="mini" data-act="copylink">复制链接</button>
          <span class="r-meta">手机上「复制」失败时，点「全选」再长按 → 拷贝</span></div>
      </div>`;
  }
  /* ---------- 导入预览 ---------- */
  let prev = '';
  if(u.phase === 'preview' && u.parsed){
    const p = u.parsed, d = p.data;
    const m = d.map || {};
    const tiles = (d.tiles || []).length;
    prev = `
      <div class="tf-box">
        <div class="tf-prev">
          <b>存档摘要</b>
          <div class="r-meta">💰 ${d.coins || 0} 金 · 🗺️ ${(m.w || 0)}×${(m.h || 0)}（${tiles} 块地）
            · 🏆 ${Object.keys(d.achievements || {}).length} 成就
            · 🍳 ${Object.keys(d.dishes || {}).length} 种菜
            · 👤 ${tfEsc2(d.playerName || '（没起名）')}</div>
          <div class="r-meta">导出时间：${fmtTime(d.savedAt)}</div>
        </div>
        <div class="tf-pick">
          <div class="r-meta">导入到哪个存档位？（会覆盖该槽位；覆盖前会自动备份一份）</div>
          ${[1, 2, 3].map(n => `
            <label class="tf-slot${u.target === n ? ' on' : ''}">
              <input type="radio" name="tfSlot" data-slot="${n}" ${u.target === n ? 'checked' : ''}>
              <span>槽位 ${n}${n === cur ? ' · 进行中' : ''}</span>
              <i>${tfSlotLabel(n)}</i>
            </label>`).join('')}
        </div>
        <div class="tf-btns">
          <button class="mini primary" data-act="doimport">确认导入到槽位 ${u.target}</button>
          <button class="mini" data-act="cancel">取消</button>
        </div>
      </div>`;
  }

  el.innerHTML = `
    <div class="tf-wrap">
      ${noCrypto}${iosHint}
      ${u.msg ? '<div class="tf-ok">' + tfEsc2(u.msg) + '</div>' : ''}
      ${u.err ? '<div class="tf-err">' + tfEsc2(u.err) + '</div>' : ''}
      <section class="tf-sec">
        <div class="k-sec-title">📤 导出（槽位 ${u.slot || cur}）</div>
        ${u.out ? out : `
          <div class="tf-row">
            <input class="tf-pin" data-pin="1" type="text" inputmode="numeric" maxlength="4" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" data-lpignore="true" data-form-type="other" value="${tfEsc2(u.pin)}" placeholder="设 4 位密码">
            <input class="tf-pin" data-pin="2" type="text" inputmode="numeric" maxlength="4" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" data-lpignore="true" data-form-type="other" value="${tfEsc2(u.pin2)}" placeholder="再输一次">
          </div>
          <div class="r-meta">密码不放进文件里 —— 导入时要再输一次，忘了就打不开，请务必记住。</div>
          <div class="tf-btns"><button class="mini primary" data-act="gen">生成存档串 / 文件 / 链接</button></div>`}
      </section>
      <section class="tf-sec">
        <div class="k-sec-title">📷 二维码</div>
        ${tfQrNote()}
      </section>
      <section class="tf-sec">
        <div class="k-sec-title">📥 导入</div>
        ${prev}
        ${u.phase === 'preview' ? '' : `
          <textarea class="tf-text" rows="3" data-in placeholder="把存档串粘贴到这里（FT1:…）">${tfEsc2(u.text)}</textarea>
          <div class="tf-row">
            <input class="tf-pin" data-pin="3" type="text" inputmode="numeric" maxlength="4" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" data-lpignore="true" data-form-type="other" value="${tfEsc2(u.impPin)}" placeholder="4 位密码">
            <button class="mini" data-act="pickfile">选择 .farm 文件…</button>
          </div>
          <div class="tf-btns"><button class="mini primary" data-act="parse">解析并预览</button></div>`}
      </section>
      <input type="file" accept=".farm,text/plain,application/json" data-file style="display:none">
    </div>`;
}
/* 二维码这块的实话：整档二维码不现实（上限 2953B，好扫 ≤1.2KB），
   真正好用的是下一批的「8 位短码」—— 二维码里只放短码，扫一下就导入。 */
function tfQrNote(){
  const u = tfState();
  if(!u.out) return '<div class="r-meta">先在上面生成存档串，这里会告诉你这个档能不能用二维码。</div>';
  const n = u.out.length;
  const fit = tfQrFit(u.out);
  if(fit.ok){
    return `<div class="r-meta">这个档 ${(n/1024).toFixed(1)} KB，二维码装得下（${fit.level === 'dense' ? '但点阵很密，两个手机都要对得很准' : '扫起来没问题'}）。` +
           `离线档的二维码要等下一批跟「8 位短码」一起上；在那之前请用上面的文件 / 粘贴串。</div>`;
  }
  return `<div class="tf-warn">这个档 ${(n/1024).toFixed(1)} KB，**二维码装不下**（QR 上限约 2.9KB，手机好扫的在 1.2KB 以内）。` +
         `所以二维码只在下一批的「8 位短码」上有意义 —— 那时二维码里只放 8 个字符，扫一下就导入；<br>` +
         `现在请用「下载 .farm 文件」或「复制存档串」。</div>`;
}
function tfErr(msg){ const u = tfState(); u.err = msg || ''; u.msg = ''; renderTransfer(); }
function tfOk(msg){ const u = tfState(); u.msg = msg || ''; u.err = ''; renderTransfer(); }
/* 导出用 pin/pin2，导入用 impPin —— 以前共用 u.pin，导入框会把导出密码清掉 */
function tfReadPins(which){
  const el = document.getElementById('transferBody');
  if(!el) return;
  const u = tfState();
  const p1 = el.querySelector('[data-pin="1"]'), p2 = el.querySelector('[data-pin="2"]'), p3 = el.querySelector('[data-pin="3"]');
  if(which === 'import'){ if(p3) u.impPin = p3.value; return; }
  if(p1) u.pin = p1.value;
  if(p2) u.pin2 = p2.value;
  if(p3) u.impPin = p3.value;
}
function tfOnChange(e){
  const t = e.target;
  if(t && t.dataset && t.dataset.file !== undefined && t.files && t.files[0]){
    const f = t.files[0];
    const fr = new FileReader();
    fr.onload = () => { const u = tfState(); u.text = String(fr.result || ''); u.err = ''; renderTransfer(); };
    fr.onerror = () => tfErr('文件读不出来');
    fr.readAsText(f);
  }
}
function tfOnClick(e){
  const b = e.target.closest('[data-act]');
  if(!b) return;
  const act = b.dataset.act;
  const el = document.getElementById('transferBody');
  const u = tfState();
  if(act === 'gen'){
    tfReadPins('export');
    if(!/^\d{4}$/.test(String(u.pin || ''))) return tfErr('密码要 4 位数字');
    if(u.pin !== u.pin2) return tfErr('两次输入的密码不一样');
    const slot = u.slot || currentSlot() || 1;
    b.disabled = true;
    tfExportSlot(slot, u.pin).then(r => {
      if(!r.ok) return tfErr(r.msg);
      u.out = r.text; u.msg = '已生成，任选一种方式送到新手机：下载文件 / 复制串 / 复制链接'; u.err = '';
      SFX.play('ding');
      renderTransfer();
    }, () => tfErr('生成失败'));
    return;
  }
  if(act === 'selectall'){
    const ta = el.querySelector('[data-out]');
    if(ta){ ta.focus(); if(ta.select) ta.select(); if(ta.setSelectionRange) ta.setSelectionRange(0, ta.value.length); }
    return;
  }
  if(act === 'copy'){
    tfCopyText(u.out).then(ok => ok ? tfOk('存档串已复制到剪贴板') : tfErr('复制失败，请手动长按选中复制'));
    return;
  }
  if(act === 'copylink'){
    tfCopyText(tfLinkFor(u.out)).then(ok => ok ? tfOk('链接已复制（在手机上长按粘贴发给自己即可）') : tfErr('复制失败'));
    return;
  }
  if(act === 'share'){
    try{
      if(navigator.share && navigator.canShare){
        const data = { title:'小田园存档', text:u.out };
        if(navigator.canShare(data)){ navigator.share(data); return; }
      }
      if(navigator.share){ navigator.share({ title:'小田园存档', text:u.out }); return; }
    }catch(err){}
    return tfErr('这台设备不支持分享，用「复制存档串」也一样');
  }
  if(act === 'download'){
    const ok = tfDownload('xiaotianyuan-' + tfStamp() + '.farm', u.out);
    if(ok) tfOk('文件已开始下载（名字里带时间，别搞混）'); else tfErr('下载失败，改用「复制存档串」');
    return;
  }
  if(act === 'pickfile'){
    const f = el.querySelector('[data-file]');
    if(f) f.click();
    return;
  }
  if(act === 'parse'){
    tfReadPins('import');
    const ta = el.querySelector('[data-in]');
    if(ta) u.text = ta.value;
    if(!String(u.text || '').trim()) return tfErr('先粘贴存档串，或者选一个 .farm 文件');
    if(!/^\d{4}$/.test(String(u.impPin || ''))) return tfErr('请输入 4 位密码');
    b.disabled = true;
    tfReadText(u.text, u.impPin).then(r => {
      if(!r.ok) return tfErr(r.msg);
      u.parsed = r; u.phase = 'preview'; u.err = '';
      if(!u.target) u.target = tfFreeSlot();
      renderTransfer();
    }, () => tfErr('解析失败'));
    return;
  }
  if(act === 'doimport'){
    if(!u.parsed) return;
    const r = el.querySelector('input[name="tfSlot"]:checked');   /* 以界面上选中的为准 */
    if(r && r.dataset && r.dataset.slot) u.target = Number(r.dataset.slot) || u.target;
    tfApplyImport(u.target);
    return;
  }
  if(act === 'cancel'){
    u.phase = 'idle'; u.parsed = null; u.err = ''; u.msg = '';
    renderTransfer();
    return;
  }
}
/* 默认导入目标：优先空槽位，都满了就用非当前槽（避免一上来就覆盖正在玩的） */
function tfFreeSlot(){
  for(let n = 1; n <= SLOT_COUNT; n++) if(!slotMeta(n).exists) return n;
  const cur = currentSlot() || 1;
  for(let n = 1; n <= SLOT_COUNT; n++) if(n !== cur) return n;
  return cur;
}
/* 写盘 + 切换过去 */
function tfApplyImport(slot){
  const u = tfState();
  if(!u.parsed) return;
  const r = tfWriteSlot(slot, u.parsed.data);
  if(!r.ok){ return tfErr(r.msg); }
  save();                          /* 先把当前进度落盘 */
  setCurrentSlot(r.slot);
  const loaded = loadFromSlot(r.slot);
  if(loaded) applyLoaded(loaded, true);
  SFX.play('ding');
  closeSheet();
  toast(r.msg + ' · 已切到这个存档');
}
/* 打开迁移面板（顺带把缓存态清掉，避免上次的串串残留） */
function openTransfer(prefill){
  tfUI = { phase:'idle', text:prefill || '', pin:'', pin2:'', impPin:'', parsed:null, target:tfFreeSlot(), out:null, msg:'', err:'' };
  openSheet('transfer');
  const u = tfState();
  if(prefill) tfStartImport(prefill);
}
/* 从槽位面板点「导出」进来：把导出目标钉在这个槽位上 */
function openTransferAt(slot){
  SFX.play('click');
  tfUI = { phase:'idle', text:'', pin:'', pin2:'', impPin:'', parsed:null, target:tfFreeSlot(), out:null, msg:'', err:'', slot:slot };
  openSheet('transfer');
}
/* 从链接（#s=…）来的：直接进"输密码 → 预览"这一步 */
function tfStartImport(text){
  const u = tfState();
  u.text = text; u.phase = 'idle'; u.parsed = null; u.err = '';
  renderTransfer();
  setTimeout(() => {
    const el = document.getElementById('transferBody');
    const p = el && el.querySelector('[data-pin="3"]');
    if(p && p.focus) p.focus();
    toast('检测到迁移链接：输入这份存档的 4 位密码');
  }, 120);
}
