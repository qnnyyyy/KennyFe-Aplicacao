// Comandos com "/" no chat: lista com autocompletar acima da caixa de mensagem.
import { el, $, toast } from './ui.js';
import { api } from './api.js';
import { can } from './guild.js';

const GROUP_IC = { Música: '🎧', Diversão: '🎲', Chat: '💬', Moderação: '🛡️' };

export class Commands {
  constructor(app) {
    this.app = app;
    this.list = [];
    this.pop = $('#cmd-pop');
    this.input = $('#msg-input');
    this.sel = 0;
    this.matches = [];
    api.get('/commands').then((r) => (this.list = r.commands)).catch(() => {});
    this.input.addEventListener('input', () => this.update());
    this.input.addEventListener('blur', () => setTimeout(() => this.hide(), 150));
  }

  available() {
    const g = this.app.group(this.app.currentGroupId);
    return this.list.filter((c) => !c.perm || can(this.app, g, c.perm));
  }

  find(name) {
    name = name.toLowerCase();
    return this.list.find((c) => c.name === name || c.aliases.includes(name));
  }

  update() {
    const v = this.input.value;
    const m = v.match(/^\/(\S*)(\s?)/);
    if (!m || v.includes('\n')) return this.hide();
    const typed = m[1].toLowerCase();
    if (m[2]) {
      // já escolheu o comando: mostra só a dica dos argumentos
      const c = this.find(typed);
      if (!c) return this.hide();
      this.matches = [c];
      this.hint = true;
    } else {
      this.hint = false;
      const av = this.available();
      this.matches = av.filter((c) => c.name.startsWith(typed)).concat(av.filter((c) => !c.name.startsWith(typed) && c.aliases.some((a) => a.startsWith(typed))));
      if (!typed) this.matches = av;
    }
    if (!this.matches.length) return this.hide();
    this.sel = Math.min(this.sel, this.matches.length - 1);
    this.render();
  }

  render() {
    let lastGroup = null;
    const rows = [];
    this.matches.slice(0, 30).forEach((c, i) => {
      if (!this.hint && c.group !== lastGroup && this.matches.length > 4) {
        lastGroup = c.group;
        rows.push(el('div', { class: 'cmd-group' }, `${GROUP_IC[c.group] || ''} ${c.group}`));
      }
      rows.push(el('button', { class: `cmd-row ${i === this.sel ? 'sel' : ''}`, onmousedown: (e) => { e.preventDefault(); this.sel = i; this.complete(); } },
        el('span', { class: 'cmd-ic' }, GROUP_IC[c.group] || '/'),
        el('div', { class: 'cmd-main' },
          el('div', {}, el('b', {}, '/' + c.name), c.args ? el('span', { class: 'cmd-args' }, ' ' + c.args) : null),
          el('small', {}, c.desc + (c.aliases.length && !this.hint ? ` • também /${c.aliases.slice(0, 2).join(', /')}` : ''))),
        i === this.sel && !this.hint ? el('kbd', {}, 'Tab') : null));
    });
    this.pop.replaceChildren(el('div', { class: 'cmd-head' }, this.hint ? 'Como usar' : 'Comandos — ↑↓ para escolher, Tab para completar'), ...rows);
    this.pop.classList.remove('hidden');
    this.pop.querySelector('.cmd-row.sel')?.scrollIntoView({ block: 'nearest' });
  }

  hide() {
    this.pop.classList.add('hidden');
    this.matches = [];
  }

  complete() {
    const c = this.matches[this.sel];
    if (!c) return;
    this.input.value = `/${c.name} `;
    this.input.focus();
    this.update();
  }

  // teclas na caixa de mensagem; true = tratada aqui
  onKey(e) {
    if (this.pop.classList.contains('hidden') || !this.matches.length) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (this.hint) return false;
      e.preventDefault();
      this.sel = (this.sel + (e.key === 'ArrowDown' ? 1 : -1) + this.matches.length) % this.matches.length;
      this.render();
      return true;
    }
    if (e.key === 'Tab' || (e.key === 'Enter' && !this.hint && !e.shiftKey)) {
      const c = this.matches[this.sel];
      const typed = this.input.value.slice(1).trim().toLowerCase();
      // Enter num comando sem argumentos já completo = executa
      if (e.key === 'Enter' && c && (c.name === typed || c.aliases.includes(typed)) && !c.args?.startsWith('<')) {
        this.hide();
        return false;
      }
      e.preventDefault();
      this.complete();
      return true;
    }
    if (e.key === 'Escape') {
      this.hide();
      return true;
    }
    return false;
  }

  // true = era um comando (não manda como mensagem)
  run(text) {
    const m = text.match(/^\/(\S+)\s*([\s\S]*)$/);
    if (!m) return false;
    this.hide();
    const name = m[1].toLowerCase();
    const args = m[2].trim();
    const chat = this.app.chat;
    const c = this.find(name);
    if (c?.name === 'shrug') {
      chat.send({ type: 'text', content: `${args ? args + ' ' : ''}¯\\_(ツ)_/¯` });
      return true;
    }
    if (c?.name === 'volume') {
      const v = Number(args);
      if (!(v >= 0 && v <= 100)) chat.local(`Volume atual do KenBeat: **${this.app.music.volume}%**. Use /volume 0-100.`, { title: 'KenBeat', icon: '🎧' });
      else {
        this.app.music.setVolume(v);
        chat.local(`🔊 Volume do KenBeat em **${v}%** (só para você).`, { title: 'KenBeat', icon: '🎧' });
      }
      return true;
    }
    const isMusic = c?.group === 'Música';
    const busy = isMusic && c.name === 'botmusic' ? toast('🎧 Procurando no YouTube…', 'info', 2500) : null;
    this.app.socket.emit('command', { groupId: chat.groupId, channelId: chat.channelId, text }, (r) => {
      busy?.remove?.();
      if (r?.error) chat.local('❌ ' + r.error, isMusic ? { title: 'KenBeat', icon: '🎧' } : {});
      else if (r?.ephemeral) chat.local(r.ephemeral, isMusic ? { title: 'KenBeat', icon: '🎧' } : {});
      if (r?.openGames) this.app.games?.setTab('games');
    });
    return true;
  }
}
