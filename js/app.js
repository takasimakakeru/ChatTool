/* 社内チャット - メインスクリプト */
(function () {
  'use strict';

  const POLL_MS = 3000;
  const PAGE_SIZE = 200;
  const ICONS = ['💬', '📢', '☕', '🙋', '💼', '📊', '🛠️', '🎉', '📅', '🏢', '💡', '🍱'];

  const $ = (id) => document.getElementById(id);
  const els = {
    app: $('app'), channelList: $('channelList'), channelName: $('channelName'),
    channelDesc: $('channelDesc'), messages: $('messages'), form: $('composerForm'),
    input: $('messageInput'), sendBtn: $('sendBtn'), status: $('status'),
    meBtn: $('meBtn'), meName: $('meName'), meAvatar: $('meAvatar'),
    nameModal: $('nameModal'), nameForm: $('nameForm'), nameInput: $('nameInput'),
    channelModal: $('channelModal'), channelForm: $('channelForm'),
    channelNameInput: $('channelNameInput'), channelDescInput: $('channelDescInput'),
    iconPicker: $('iconPicker'), addChannelBtn: $('addChannelBtn'),
    menuBtn: $('menuBtn'), backdrop: $('backdrop'), toast: $('toast')
  };

  const state = {
    name: localStorage.getItem('chat_name') || '',
    clientId: localStorage.getItem('chat_client_id') || createId(),
    channels: [],
    currentId: localStorage.getItem('chat_channel') || '',
    messages: [],
    pending: [],
    signature: '',
    pollTimer: null,
    selectedIcon: ICONS[0],
    loadingChannel: false
  };
  localStorage.setItem('chat_client_id', state.clientId);

  function createId() {
    return 'c-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  /* ---------- API ---------- */
  async function api(path, options = {}) {
    const res = await fetch('tables/' + path, {
      headers: { 'Content-Type': 'application/json' },
      ...options
    });
    if (!res.ok) throw new Error('通信エラー (' + res.status + ')');
    if (res.status === 204) return null;
    return res.json();
  }

  function setStatus(ok) {
    els.status.classList.toggle('ok', ok);
    els.status.classList.toggle('error', !ok);
    els.status.querySelector('.status-text').textContent = ok ? 'オンライン' : '接続エラー';
  }

  /* ---------- Utils ---------- */
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function linkify(text) {
    return escapeHtml(text).replace(/(https?:\/\/[^\s<]+)/g,
      '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
  }
  function colorFor(name) {
    let h = 0;
    for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return 'hsl(' + h + ', 55%, 52%)';
  }
  function initial(name) { return (String(name || '?').trim()[0] || '?').toUpperCase(); }
  function toDate(ts) { return new Date(typeof ts === 'number' ? ts : Number(ts) || ts); }
  function fmtTime(ts) {
    const d = toDate(ts);
    return d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function fmtDate(ts) {
    const d = toDate(ts);
    const today = new Date();
    const y = new Date(); y.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return '今日';
    if (d.toDateString() === y.toDateString()) return '昨日';
    const w = '日月火水木金土'[d.getDay()];
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日（' + w + '）';
  }
  let toastTimer;
  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { els.toast.hidden = true; }, 2500);
  }

  /* ---------- User ---------- */
  function renderMe() {
    els.meName.textContent = state.name || '未設定';
    els.meAvatar.textContent = initial(state.name);
    els.meAvatar.style.background = colorFor(state.name);
  }
  function openNameModal() {
    els.nameInput.value = state.name;
    els.nameModal.hidden = false;
    setTimeout(() => els.nameInput.focus(), 50);
  }
  els.nameForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = els.nameInput.value.trim();
    if (!v) return;
    state.name = v;
    localStorage.setItem('chat_name', v);
    els.nameModal.hidden = true;
    renderMe();
    els.input.focus();
  });
  els.meBtn.addEventListener('click', openNameModal);

  /* ---------- Channels ---------- */
  async function loadChannels() {
    const res = await api('channels?limit=200');
    state.channels = (res.data || []).sort((a, b) =>
      (a.sort_order || 999) - (b.sort_order || 999) || (a.created_at || 0) - (b.created_at || 0));
    if (!state.channels.find((c) => c.id === state.currentId)) {
      state.currentId = state.channels[0] ? state.channels[0].id : '';
    }
    renderChannels();
  }

  function renderChannels() {
    els.channelList.innerHTML = state.channels.map((c) =>
      '<button class="channel-item' + (c.id === state.currentId ? ' active' : '') + '" data-id="' + escapeHtml(c.id) + '">' +
      '<span class="ch-icon">' + escapeHtml(c.icon || '💬') + '</span>' +
      '<span class="ch-name">' + escapeHtml(c.name) + '</span></button>'
    ).join('');
    const cur = state.channels.find((c) => c.id === state.currentId);
    els.channelName.textContent = cur ? (cur.icon || '💬') + ' ' + cur.name : 'チャンネルがありません';
    els.channelDesc.textContent = cur ? (cur.description || '') : '左の「＋」からチャンネルを作成してください';
    document.title = cur ? cur.name + ' | 社内チャット' : '社内チャット';
  }

  els.channelList.addEventListener('click', (e) => {
    const btn = e.target.closest('.channel-item');
    if (!btn) return;
    selectChannel(btn.dataset.id);
    els.app.classList.remove('menu-open');
  });

  function selectChannel(id) {
    if (id === state.currentId && state.messages.length) return;
    state.currentId = id;
    localStorage.setItem('chat_channel', id);
    state.messages = [];
    state.pending = [];
    state.signature = '';
    renderChannels();
    els.messages.innerHTML = '<div class="empty">読み込み中…</div>';
    refreshMessages(true);
    els.input.focus();
  }

  // チャンネル作成
  els.iconPicker.innerHTML = ICONS.map((i) => '<button type="button" data-icon="' + i + '">' + i + '</button>').join('');
  function updateIconPicker() {
    els.iconPicker.querySelectorAll('button').forEach((b) =>
      b.classList.toggle('selected', b.dataset.icon === state.selectedIcon));
  }
  els.iconPicker.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    state.selectedIcon = b.dataset.icon;
    updateIconPicker();
  });
  els.addChannelBtn.addEventListener('click', () => {
    els.channelNameInput.value = '';
    els.channelDescInput.value = '';
    state.selectedIcon = ICONS[0];
    updateIconPicker();
    els.channelModal.hidden = false;
    setTimeout(() => els.channelNameInput.focus(), 50);
  });
  els.channelModal.addEventListener('click', (e) => {
    if (e.target === els.channelModal || e.target.hasAttribute('data-close')) els.channelModal.hidden = true;
  });
  els.channelForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = els.channelNameInput.value.trim();
    if (!name) return;
    if (state.channels.some((c) => c.name === name)) { toast('同じ名前のチャンネルがあります'); return; }
    try {
      const created = await api('channels', {
        method: 'POST',
        body: JSON.stringify({
          name, description: els.channelDescInput.value.trim(),
          icon: state.selectedIcon, sort_order: 100 + state.channels.length
        })
      });
      els.channelModal.hidden = true;
      await loadChannels();
      selectChannel(created.id);
      toast('「' + name + '」を作成しました');
    } catch (err) {
      toast('作成に失敗しました。もう一度お試しください');
    }
  });

  /* ---------- Messages ---------- */
  async function fetchChannelMessages(channelId) {
    const base = 'messages?search=' + encodeURIComponent(channelId) + '&sort=created_at&limit=' + PAGE_SIZE;
    const first = await api(base + '&page=1');
    let rows = first.data || [];
    const pages = Math.ceil((first.total || 0) / PAGE_SIZE);
    if (pages > 1) {
      // 最新の2ページ分（最大400件）を取得
      const targets = [pages - 1, pages].filter((p) => p > 1);
      const more = await Promise.all(targets.map((p) => api(base + '&page=' + p)));
      more.forEach((r) => { rows = rows.concat(r.data || []); });
    }
    const map = new Map();
    rows.forEach((m) => { if (m.channel_id === channelId) map.set(m.id, m); });
    return [...map.values()].sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
  }

  async function refreshMessages(forceScroll) {
    const channelId = state.currentId;
    if (!channelId) { renderMessages(true); return; }
    try {
      const list = await fetchChannelMessages(channelId);
      if (channelId !== state.currentId) return; // 途中でチャンネル切替
      state.messages = list;
      setStatus(true);
      const sig = list.map((m) => m.id).join(',') + '|' + state.pending.length;
      if (sig !== state.signature || forceScroll) {
        state.signature = sig;
        renderMessages(forceScroll);
      }
    } catch (err) {
      setStatus(false);
      if (forceScroll) els.messages.innerHTML = '<div class="empty"><span class="big">⚠️</span>メッセージを読み込めませんでした。<br>しばらくしてから再読み込みしてください。</div>';
    }
  }

  function renderMessages(forceScroll) {
    const box = els.messages;
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    const all = state.messages.concat(state.pending);

    if (!state.currentId) {
      box.innerHTML = '<div class="empty"><span class="big">📭</span>チャンネルがありません。</div>';
      return;
    }
    if (!all.length) {
      const cur = state.channels.find((c) => c.id === state.currentId);
      box.innerHTML = '<div class="empty"><span class="big">' + escapeHtml(cur ? cur.icon || '💬' : '💬') +
        '</span>まだメッセージはありません。<br>最初のメッセージを送ってみましょう！</div>';
      return;
    }

    let html = '';
    let lastDate = '', lastAuthor = '', lastTs = 0;
    all.forEach((m) => {
      const ts = m.created_at || Date.now();
      const dateKey = toDate(ts).toDateString();
      if (dateKey !== lastDate) {
        html += '<div class="date-sep"><span>' + fmtDate(ts) + '</span></div>';
        lastAuthor = '';
      }
      const authorKey = (m.author || '') + '|' + (m.client_id || '');
      const cont = authorKey === lastAuthor && ts - lastTs < 5 * 60 * 1000;
      const mine = m.client_id === state.clientId;
      html +=
        '<article class="msg' + (cont ? ' cont' : '') + (mine ? ' mine' : '') + (m._sending ? ' sending' : '') + '">' +
          '<span class="avatar" style="background:' + colorFor(m.author) + '">' + escapeHtml(initial(m.author)) + '</span>' +
          '<div class="msg-body">' +
            (cont ? '' : '<div class="msg-meta"><span class="msg-author">' + escapeHtml(m.author || '名無し') +
              '</span><span class="msg-time">' + (m._sending ? '送信中…' : fmtTime(ts)) + '</span></div>') +
            '<div class="msg-text">' + linkify(m.content) + '</div>' +
          '</div>' +
          (mine && !m._sending ? '<div class="msg-actions"><button data-del="' + escapeHtml(m.id) + '">削除</button></div>' : '') +
        '</article>';
      lastDate = dateKey; lastAuthor = authorKey; lastTs = ts;
    });
    box.innerHTML = html;
    if (forceScroll || nearBottom) box.scrollTop = box.scrollHeight;
  }

  els.messages.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-del]');
    if (!btn) return;
    if (!confirm('このメッセージを削除しますか？')) return;
    try {
      await api('messages/' + encodeURIComponent(btn.dataset.del), { method: 'DELETE' });
      state.messages = state.messages.filter((m) => m.id !== btn.dataset.del);
      state.signature = '';
      renderMessages(false);
      toast('削除しました');
    } catch (err) {
      toast('削除に失敗しました');
    }
  });

  /* ---------- Composer ---------- */
  function autoResize() {
    els.input.style.height = 'auto';
    els.input.style.height = Math.min(els.input.scrollHeight, 160) + 'px';
    els.sendBtn.disabled = !els.input.value.trim() || !state.currentId;
  }
  els.input.addEventListener('input', autoResize);
  els.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      els.form.requestSubmit();
    }
  });

  els.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const content = els.input.value.trim();
    if (!content || !state.currentId) return;
    if (!state.name) { openNameModal(); return; }

    const temp = { id: 'tmp-' + Date.now(), author: state.name, client_id: state.clientId,
      content, created_at: Date.now(), _sending: true };
    state.pending.push(temp);
    els.input.value = '';
    autoResize();
    renderMessages(true);

    try {
      const saved = await api('messages', {
        method: 'POST',
        body: JSON.stringify({ channel_id: state.currentId, author: state.name, client_id: state.clientId, content })
      });
      state.pending = state.pending.filter((p) => p !== temp);
      if (saved && saved.channel_id === state.currentId && !state.messages.find((m) => m.id === saved.id)) {
        state.messages.push(saved);
      }
      state.signature = '';
      renderMessages(true);
      setStatus(true);
    } catch (err) {
      state.pending = state.pending.filter((p) => p !== temp);
      renderMessages(false);
      els.input.value = content;
      autoResize();
      setStatus(false);
      toast('送信できませんでした。もう一度「送信」を押してください');
    }
  });

  /* ---------- Mobile menu ---------- */
  els.menuBtn.addEventListener('click', () => els.app.classList.add('menu-open'));
  els.backdrop.addEventListener('click', () => els.app.classList.remove('menu-open'));

  /* ---------- Init ---------- */
  function startPolling() {
    clearInterval(state.pollTimer);
    state.pollTimer = setInterval(() => {
      if (!document.hidden) refreshMessages(false);
    }, POLL_MS);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshMessages(false); });

  async function init() {
    renderMe();
    try {
      await loadChannels();
      setStatus(true);
    } catch (err) {
      setStatus(false);
      els.messages.innerHTML = '<div class="empty"><span class="big">⚠️</span>サーバーに接続できませんでした。<br>ページを再読み込みしてください。</div>';
      return;
    }
    await refreshMessages(true);
    startPolling();
    if (!state.name) openNameModal(); else els.input.focus();
  }
  init();
})();
