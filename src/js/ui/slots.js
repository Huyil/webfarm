/* ============ 存档槽位界面 ============ */
let slotPending = '';
function fmtTime(ts){
  if(!ts) return '—';
  const d = new Date(ts);
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
/* 两步确认，避免用原生 confirm（无头/移动端体验都更好） */
function twoStep(btn, key, label, fn){
  if(slotPending !== key){
    slotPending = key;
    btn.textContent = '再点一次确认';
    btn.classList.add('danger');
    setTimeout(() => {
      if(slotPending === key){ slotPending = ''; btn.textContent = label; btn.classList.remove('danger'); }
    }, 2600);
    return;
  }
  slotPending = '';
  fn();
}
function renderSlots(){
  const el = document.getElementById('slotsBody');
  if(!el) return;
  el.innerHTML = '';
  const cur = currentSlot();
  const head = document.createElement('div');
  head.className = 'r-meta';
  head.style.padding = '0 4px 10px';
  head.textContent = '3 个槽位各自独立：金币、作物、成就、任务、装饰仓库、挂机进度都会分别保存。';
  el.appendChild(head);

  const mig = document.createElement('div');
  mig.className = 'slot-btns';
  mig.style.marginBottom = '10px';
  const mb = document.createElement('button');
  mb.className = 'mini primary'; mb.textContent = '📦 存档迁移（导出 / 导入）';
  mb.onclick = () => { SFX.play('click'); openTransfer(); };
  mig.appendChild(mb);
  el.appendChild(mig);

  for(let n = 1; n <= SLOT_COUNT; n++){
    const m = slotMeta(n);
    const card = document.createElement('div');
    card.className = 'slot-card' + (n === cur ? ' current' : '');
    card.innerHTML = `
      <div class="slot-head">
        <span class="slot-no">槽位 ${n}</span>
        ${n === cur ? '<span class="slot-cur">进行中</span>' : ''}
      </div>
      <div class="slot-body">
        ${m.exists
          ? `💰 ${m.coins} 金 · 🏆 ${m.ach} 成就 · 🍳 ${m.dishes} 道菜 · 📦 ${m.crop} 件作物
             <div class="r-meta">保存于 ${fmtTime(m.savedAt)}</div>`
          : '<span class="r-meta">空槽位</span>'}
      </div>`;
    const btns = document.createElement('div');
    btns.className = 'slot-btns';

    if(n === cur){
      const b = document.createElement('button');
      b.className = 'mini'; b.textContent = '立即保存';
      b.onclick = () => { save(); renderSlots(); toast('已保存到槽位 ' + n); };
      btns.appendChild(b);
    } else if(m.exists){
      const b = document.createElement('button');
      b.className = 'mini primary'; b.textContent = '继续这个存档';
      b.onclick = () => useSlot(n);
      btns.appendChild(b);
    }

    if(n !== cur){
      const nb = document.createElement('button');
      nb.className = 'mini'; nb.textContent = m.exists ? '覆盖新建' : '新建存档';
      nb.onclick = () => twoStep(nb, 'new' + n, m.exists ? '覆盖新建' : '新建存档', () => newGameInSlot(n));
      btns.appendChild(nb);

      if(m.exists){
        const db = document.createElement('button');
        db.className = 'mini danger'; db.textContent = '删除';
        db.onclick = () => twoStep(db, 'del' + n, '删除', () => {
          deleteSlot(n); renderSlots(); toast('已删除槽位 ' + n);
        });
        btns.appendChild(db);
      }
    }
    if(m.exists){
      const eb = document.createElement('button');
      eb.className = 'mini'; eb.textContent = '导出';
      eb.onclick = () => { SFX.play('click'); openTransferAt(n); };
      btns.appendChild(eb);
    }
    card.appendChild(btns);
    el.appendChild(card);
  }
}
/* 切换槽位：先把当前进度存好，再载入目标槽 */
function useSlot(n){
  if(n === currentSlot()){ closeSheet(); return; }
  save();
  const loaded = loadFromSlot(n);
  if(!loaded){ toast('槽位 ' + n + ' 是空的'); return; }
  setCurrentSlot(n);
  applyLoaded(loaded, true);
  closeSheet();
  toast('已切换到槽位 ' + n);
}
function newGameInSlot(n){
  save();
  setCurrentSlot(n);
  state = initDecorations(newState());
  resetRuntime();
  centerOnFarm();                 /* 镜头必须回到新农场上，否则小人会像站在虚空里 */
  save();
  renderAll();
  closeSheet();
  toast('槽位 ' + n + ' 已开新档');
}
