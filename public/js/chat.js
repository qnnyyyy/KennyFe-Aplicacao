// Chat do grupo: mensagens, emojis, figurinhas, GIFs, arquivos, respostas e reações.
import { el, $, icon, avatar, toast, contextMenu, popover, closeMenu, formatTime, sfx, onContext, escapeHtml } from './ui.js';
import { api } from './api.js';
import { emojiPicker, onlyEmoji } from './emoji.js';
import { openStudio } from './creator.js';

const QUICK_REACTIONS = ['❤️', '😂', '😍', '🥺', '🔥', '👍'];

function renderText(text) {
  let h = escapeHtml(text);
  h = h.replace(/```([\s\S]+?)```/g, '<pre>$1</pre>');
  h = h.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  h = h.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
  h = h.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<i>$2</i>');
  h = h.replace(/~~([^~\n]+)~~/g, '<s>$1</s>');
  h = h.replace(/\|\|([^|\n]+)\|\|/g, '<span class="spoiler" onclick="this.classList.add(\'shown\')">$1</span>');
  h = h.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
  return h.replace(/\n/g, '<br>');
}

export class Chat {
  constructor(app) {
    this.app = app;
    this.socket = app.socket;
    this.groupId = null;
    this.messages = new Map(); // id -> msg
    this.list = $('#messages');
    this.input = $('#msg-input');
    this.replyTo = null;
    this.editing = null;
    this.hasMore = false;
    this.loadingOlder = false;
    this.typingUsers = new Map();
    this.lastTypingSent = 0;
    this.stickers = [];

    this.setupComposer();
    this.list.addEventListener('scroll', () => {
      if (this.list.scrollTop < 120 && this.hasMore && !this.loadingOlder) this.loadOlder();
    });

    const s = this.socket;
    s.on('chat:message', (m) => this.onMessage(m));
    s.on('chat:update', (m) => {
      if (m.groupId !== this.groupId) return;
      this.messages.set(m.id, m);
      const node = this.list.querySelector(`[data-mid="${m.id}"]`);
      if (node) node.replaceWith(this.renderMessage(m, node.classList.contains('cont')));
    });
    s.on('chat:delete', ({ id, groupId }) => {
      if (groupId !== this.groupId) return;
      this.messages.delete(id);
      this.list.querySelector(`[data-mid="${id}"]`)?.remove();
    });
    s.on('chat:typing', ({ groupId, userId }) => {
      if (groupId !== this.groupId) return;
      clearTimeout(this.typingUsers.get(userId));
      this.typingUsers.set(userId, setTimeout(() => { this.typingUsers.delete(userId); this.renderTyping(); }, 4000));
      this.renderTyping();
    });
  }

  async open(groupId) {
    this.groupId = groupId;
    this.messages.clear();
    this.list.replaceChildren(el('div', { class: 'loading' }, 'Carregando…'));
    this.cancelReply();
    this.typingUsers.clear();
    this.renderTyping();
    try {
      const { messages, hasMore } = await api.get(`/groups/${groupId}/messages`);
      if (this.groupId !== groupId) return;
      this.hasMore = hasMore;
      this.list.replaceChildren();
      if (!messages.length) this.list.append(this.emptyState());
      this.appendMany(messages);
      this.scrollBottom(true);
    } catch (err) {
      this.list.replaceChildren(el('div', { class: 'loading' }, err.message));
    }
    this.app.markRead(groupId);
  }

  emptyState() {
    const g = this.app.group(this.groupId);
    return el('div', { class: 'chat-empty' }, el('div', { class: 'chat-empty-ic' }, g?.icon || '💬'), el('h3', {}, `Começo de ${g?.name || 'conversa'}`), el('p', {}, 'Mande um oi, uma figurinha ou crie um GIF ✨'));
  }

  async loadOlder() {
    const first = [...this.messages.keys()].sort((a, b) => a - b)[0];
    if (!first) return;
    this.loadingOlder = true;
    const prevHeight = this.list.scrollHeight;
    try {
      const { messages, hasMore } = await api.get(`/groups/${this.groupId}/messages?before=${first}`);
      this.hasMore = hasMore;
      const frag = document.createDocumentFragment();
      let prev = null;
      for (const m of messages) {
        this.messages.set(m.id, m);
        frag.append(this.renderMessage(m, this.isContinuation(prev, m)));
        prev = m;
      }
      this.list.prepend(frag);
      this.list.scrollTop = this.list.scrollHeight - prevHeight;
    } finally {
      this.loadingOlder = false;
    }
  }

  isContinuation(prev, m) {
    return prev && prev.author?.id === m.author?.id && m.type !== 'system' && prev.type !== 'system' && m.createdAt - prev.createdAt < 300 && !m.reply;
  }

  appendMany(msgs) {
    let prev = [...this.messages.values()].pop() || null;
    for (const m of msgs) {
      this.messages.set(m.id, m);
      this.list.append(this.renderMessage(m, this.isContinuation(prev, m)));
      prev = m;
    }
  }

  onMessage(m) {
    const mine = m.author?.id === this.app.me.id;
    if (m.groupId !== this.groupId || document.hidden) {
      this.app.onUnread(m);
      if (!mine && m.type !== 'system') {
        sfx('message');
        this.app.notify(m);
      }
      if (m.groupId !== this.groupId) return;
    }
    if (this.messages.has(m.id)) return;
    this.list.querySelector('.chat-empty')?.remove();
    const nearBottom = this.list.scrollHeight - this.list.scrollTop - this.list.clientHeight < 200;
    this.appendMany([m]);
    if (m.author) {
      clearTimeout(this.typingUsers.get(m.author.id));
      this.typingUsers.delete(m.author.id);
      this.renderTyping();
    }
    if (nearBottom || mine) this.scrollBottom();
    this.app.markRead(m.groupId);
  }

  scrollBottom(instant) {
    requestAnimationFrame(() => this.list.scrollTo({ top: this.list.scrollHeight, behavior: instant ? 'auto' : 'smooth' }));
  }

  renderTyping() {
    const names = [...this.typingUsers.keys()].map((id) => this.app.userName(id));
    $('#typing').replaceChildren(
      names.length ? el('span', {}, el('span', { class: 'dots' }, el('i'), el('i'), el('i')), ` ${names.join(', ')} ${names.length > 1 ? 'estão' : 'está'} digitando…`) : ''
    );
  }

  renderMedia(m) {
    const url = m.mediaUrl;
    if (m.type === 'sticker') return el('img', { class: 'msg-sticker', src: url, loading: 'lazy', alt: 'figurinha' });
    if (m.type === 'gif') return el('img', { class: 'msg-gif', src: url, loading: 'lazy', alt: 'GIF' });
    if (m.type === 'image') return el('img', { class: 'msg-image', src: url, loading: 'lazy', alt: m.content || 'imagem', onclick: () => this.lightbox(url) });
    if (m.type === 'video') return el('video', { class: 'msg-video', src: url, controls: true, preload: 'metadata' });
    if (m.type === 'audio') return el('audio', { class: 'msg-audio', src: url, controls: true, preload: 'metadata' });
    if (m.type === 'file') return el('a', { class: 'msg-file', href: url, download: m.content || true, target: '_blank' }, icon('download', 18), el('span', {}, m.content || 'arquivo'));
    return null;
  }

  renderMessage(m, cont = false) {
    if (m.type === 'system') {
      return el('div', { class: 'msg system', dataset: { mid: m.id } }, el('span', { class: 'sys-ic' }, '✦'), el('b', {}, m.author?.displayName || ''), ' ', m.content, el('time', {}, formatTime(m.createdAt)));
    }
    const mine = m.author?.id === this.app.me.id;
    const body = el('div', { class: 'msg-body' });
    if (m.reply) {
      body.append(el('div', { class: 'msg-reply', onclick: () => this.jumpTo(m.reply.id) }, icon('reply', 12), el('b', {}, m.reply.author), ' ', m.reply.type === 'text' ? m.reply.content.slice(0, 80) : `[${m.reply.type}]`));
    }
    if (m.type === 'text') {
      body.append(el('div', { class: `msg-text ${onlyEmoji(m.content) ? 'jumbo' : ''}`, html: renderText(m.content) + (m.editedAt ? ' <small class="edited">(editado)</small>' : '') }));
    } else {
      body.append(this.renderMedia(m));
      if (m.type === 'image' && m.content && !/\.(png|jpe?g|webp|gif)$/i.test(m.content)) body.append(el('div', { class: 'msg-text' }, m.content));
    }
    if (m.reactions?.length) {
      const groups = new Map();
      m.reactions.forEach((r) => groups.set(r.emoji, [...(groups.get(r.emoji) || []), r.userId]));
      body.append(
        el('div', { class: 'reactions' }, [...groups].map(([e, users]) =>
          el('button', { class: `reaction ${users.includes(this.app.me.id) ? 'mine' : ''}`, title: users.map((u) => this.app.userName(u)).join(', '), onclick: () => this.react(m.id, e) }, e, el('span', {}, users.length))
        ))
      );
    }
    const tools = el('div', { class: 'msg-tools' },
      ...QUICK_REACTIONS.slice(0, 3).map((e) => el('button', { title: 'Reagir', onclick: () => this.react(m.id, e) }, e)),
      el('button', { title: 'Mais reações', onclick: (ev) => this.reactionPicker(ev.currentTarget, m.id) }, icon('smile', 16)),
      el('button', { title: 'Responder', onclick: () => this.startReply(m) }, icon('reply', 16)),
      el('button', { title: 'Mais', onclick: (ev) => { const r = ev.currentTarget.getBoundingClientRect(); this.messageMenu(m, r.left, r.bottom); } }, icon('more', 16))
    );
    const node = el(
      'div',
      { class: `msg ${cont ? 'cont' : ''} ${mine ? 'mine' : ''}`, dataset: { mid: m.id } },
      cont ? el('div', { class: 'msg-gutter' }, el('time', {}, new Date(m.createdAt * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }))) : avatar(m.author, 40),
      el('div', { class: 'msg-main' }, cont ? null : el('div', { class: 'msg-head' }, el('b', { style: { color: m.author?.color } }, m.author?.displayName || '?'), el('time', {}, formatTime(m.createdAt))), body),
      tools
    );
    onContext(node, (x, y) => this.messageMenu(m, x, y));
    return node;
  }

  jumpTo(id) {
    const n = this.list.querySelector(`[data-mid="${id}"]`);
    if (!n) return;
    n.scrollIntoView({ behavior: 'smooth', block: 'center' });
    n.classList.add('flash');
    setTimeout(() => n.classList.remove('flash'), 1500);
  }

  messageMenu(m, x, y) {
    const mine = m.author?.id === this.app.me.id;
    const items = [
      { type: 'custom', node: el('div', { class: 'ctx-reacts' }, QUICK_REACTIONS.map((e) => el('button', { onclick: () => { closeMenu(); this.react(m.id, e); } }, e))) },
      { label: 'Responder', icon: 'reply', onClick: () => this.startReply(m) },
    ];
    if (m.type === 'text') items.push({ label: 'Copiar texto', icon: 'copy', onClick: () => navigator.clipboard.writeText(m.content) });
    if (m.type === 'sticker' || m.type === 'gif' || m.type === 'image') {
      items.push({ label: m.type === 'gif' ? 'Salvar nos meus GIFs' : 'Salvar nas minhas figurinhas', icon: 'sticker', onClick: async () => { await api.post('/stickers', { url: m.mediaUrl, kind: m.type === 'gif' ? 'gif' : 'sticker' }); this.stickers = []; toast('Salvo! 💾', 'success'); } });
      items.push({ label: 'Baixar', icon: 'download', onClick: () => { const a = el('a', { href: m.mediaUrl, download: '' }); a.click(); } });
    }
    if (mine && m.type === 'text') items.push({ label: 'Editar', icon: 'edit', onClick: () => this.startEdit(m) });
    if (mine) items.push({ type: 'sep' }, { label: 'Apagar mensagem', icon: 'trash', danger: true, onClick: () => this.socket.emit('chat:delete', { messageId: m.id }) });
    contextMenu(x, y, items);
  }

  reactionPicker(anchor, messageId) {
    popover(anchor, emojiPicker((e) => { closeMenu(); this.react(messageId, e); }), { className: 'emoji-pop' });
  }

  react(messageId, emoji) {
    this.socket.emit('chat:react', { messageId, emoji });
  }

  startReply(m) {
    this.editing = null;
    this.replyTo = m;
    const bar = $('#reply-bar');
    bar.classList.remove('hidden');
    bar.replaceChildren(icon('reply', 14), el('span', {}, 'Respondendo ', el('b', {}, m.author?.displayName), ': ', m.type === 'text' ? m.content.slice(0, 60) : `[${m.type}]`), el('button', { class: 'icon-btn sm', onclick: () => this.cancelReply() }, icon('x', 14)));
    this.input.focus();
  }

  startEdit(m) {
    this.replyTo = null;
    this.editing = m;
    const bar = $('#reply-bar');
    bar.classList.remove('hidden');
    bar.replaceChildren(icon('edit', 14), el('span', {}, 'Editando mensagem — Esc para cancelar'), el('button', { class: 'icon-btn sm', onclick: () => this.cancelReply() }, icon('x', 14)));
    this.input.value = m.content;
    this.autosize();
    this.input.focus();
  }

  cancelReply() {
    if (this.editing) this.input.value = '';
    this.replyTo = null;
    this.editing = null;
    $('#reply-bar').classList.add('hidden');
    this.autosize();
  }

  async send(payload) {
    if (!this.groupId) return;
    const res = await this.socket.emitWithAck('chat:send', { groupId: this.groupId, replyTo: this.replyTo?.id, ...payload });
    if (res?.error) toast(res.error, 'error');
    this.cancelReply();
  }

  sendText() {
    const text = this.input.value.trim();
    if (!text) return;
    if (this.editing) {
      this.socket.emit('chat:edit', { messageId: this.editing.id, content: text });
      this.input.value = '';
      this.cancelReply();
      return;
    }
    this.input.value = '';
    this.autosize();
    this.send({ type: 'text', content: text });
  }

  async sendFiles(files) {
    for (const file of files) {
      const type = file.type === 'image/gif' ? 'gif' : file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : 'file';
      const t = el('div', { class: 'upload-progress' }, `Enviando ${file.name}… `, el('span', {}, '0%'));
      $('#typing').replaceChildren(t);
      try {
        const up = await api.upload(file, 'file', '', (p) => (t.lastChild.textContent = Math.round(p * 100) + '%'));
        await this.send({ type, mediaUrl: up.url, content: file.name });
      } catch (err) {
        toast(err.message, 'error');
      }
      this.renderTyping();
    }
  }

  autosize() {
    this.input.style.height = 'auto';
    this.input.style.height = Math.min(200, this.input.scrollHeight) + 'px';
  }

  setupComposer() {
    const input = this.input;
    $('#btn-attach').append(icon('paperclip'));
    $('#btn-gif').append(icon('sticker'));
    $('#btn-emoji').append(icon('smile'));
    $('#btn-send').append(icon('send'));

    input.addEventListener('input', () => {
      this.autosize();
      if (Date.now() - this.lastTypingSent > 2500 && input.value.trim()) {
        this.lastTypingSent = Date.now();
        this.socket.emit('chat:typing', { groupId: this.groupId });
      }
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        this.sendText();
      } else if (e.key === 'Escape') this.cancelReply();
      else if (e.key === 'ArrowUp' && !input.value) {
        const mine = [...this.messages.values()].reverse().find((m) => m.author?.id === this.app.me.id && m.type === 'text');
        if (mine) {
          e.preventDefault();
          this.startEdit(mine);
        }
      }
    });
    input.addEventListener('paste', (e) => {
      const files = [...(e.clipboardData?.files || [])];
      if (files.length) {
        e.preventDefault();
        this.sendFiles(files);
      }
    });
    $('#btn-send').addEventListener('click', () => this.sendText());
    $('#btn-attach').addEventListener('click', () => $('#file-input').click());
    $('#file-input').addEventListener('change', (e) => {
      this.sendFiles([...e.target.files]);
      e.target.value = '';
    });
    $('#btn-emoji').addEventListener('click', (e) => {
      popover(e.currentTarget, emojiPicker((emo) => this.insertAtCursor(emo)), { className: 'emoji-pop' });
    });
    $('#btn-gif').addEventListener('click', (e) => this.stickerPanel(e.currentTarget));

    const chat = $('#chat');
    chat.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('Files')) {
        e.preventDefault();
        chat.classList.add('dropping');
      }
    });
    chat.addEventListener('dragleave', (e) => !chat.contains(e.relatedTarget) && chat.classList.remove('dropping'));
    chat.addEventListener('drop', (e) => {
      chat.classList.remove('dropping');
      if (!e.dataTransfer.files.length) return;
      e.preventDefault();
      this.sendFiles([...e.dataTransfer.files]);
    });
  }

  insertAtCursor(text) {
    const i = this.input;
    const s = i.selectionStart ?? i.value.length;
    i.value = i.value.slice(0, s) + text + i.value.slice(i.selectionEnd ?? s);
    i.selectionStart = i.selectionEnd = s + text.length;
    i.focus();
    this.autosize();
  }

  // ---------- Painel de figurinhas / GIFs ----------
  async stickerPanel(anchor) {
    if (!this.stickers.length) {
      try {
        this.stickers = (await api.get('/stickers')).stickers;
      } catch {}
    }
    let tab = this.lastStickerTab || 'sticker';
    const grid = el('div', { class: 'sticker-grid' });
    const tabs = el('div', { class: 'sticker-tabs' });
    const uploadInput = el('input', { type: 'file', accept: 'image/png,image/webp,image/gif,image/jpeg', hidden: true, multiple: true });

    const render = () => {
      this.lastStickerTab = tab;
      tabs.replaceChildren(
        el('button', { class: tab === 'sticker' ? 'active' : '', onclick: () => { tab = 'sticker'; render(); } }, '🌟 Figurinhas'),
        el('button', { class: tab === 'gif' ? 'active' : '', onclick: () => { tab = 'gif'; render(); } }, '🎞️ GIFs')
      );
      const items = this.stickers.filter((s) => s.kind === tab);
      grid.replaceChildren(
        el('button', { class: 'sticker-new', onclick: () => { closeMenu(); openStudio(tab, (st) => this.onCreated(st)); } }, icon('wand', 22), el('span', {}, tab === 'gif' ? 'Criar GIF' : 'Criar figurinha')),
        el('button', { class: 'sticker-new', onclick: () => uploadInput.click() }, icon('plus', 22), el('span', {}, 'Enviar do PC')),
        ...items.map((s) => {
          const b = el('button', { class: 'sticker-item', title: s.name || '', onclick: () => { closeMenu(); this.send({ type: s.kind, mediaUrl: s.url }); } }, el('img', { src: s.url, loading: 'lazy' }));
          onContext(b, (x, y) => contextMenu(x, y, [{ label: 'Remover da coleção', icon: 'trash', danger: true, onClick: async () => { await api.del(`/stickers/${s.id}`); this.stickers = this.stickers.filter((z) => z.id !== s.id); } }]));
          return b;
        })
      );
      if (!items.length) grid.append(el('p', { class: 'muted small sticker-empty' }, tab === 'gif' ? 'Você ainda não tem GIFs. Crie um com a webcam, a tela ou um vídeo!' : 'Nenhuma figurinha ainda. Crie uma com fotos, texto e desenhos!'));
    };
    uploadInput.addEventListener('change', async () => {
      for (const f of uploadInput.files) {
        const kind = f.type === 'image/gif' ? 'gif' : 'sticker';
        try {
          const up = await api.upload(f, kind, f.name);
          if (up.sticker) this.stickers.unshift(up.sticker);
        } catch (err) {
          toast(err.message, 'error');
        }
      }
      render();
    });
    render();
    popover(anchor, el('div', { class: 'sticker-panel' }, tabs, grid, uploadInput), { className: 'sticker-pop' });
  }

  onCreated(sticker) {
    this.stickers.unshift(sticker);
    this.send({ type: sticker.kind, mediaUrl: sticker.url });
  }

  lightbox(url) {
    const box = el('div', { class: 'lightbox', onclick: () => box.remove() }, el('img', { src: url }));
    document.body.append(box);
  }
}
