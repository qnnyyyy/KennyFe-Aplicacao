#!/usr/bin/env bash
# Roda DENTRO do servidor (o atualizar-servidor.bat manda este script e o pacote ~/kenfeh-update.tgz pelo SSH):
# acha a pasta do Kenfeh, troca os arquivos pela versão nova (sem mexer em data/ nem no .env)
# e reinicia SÓ o Kenfeh (pm2, systemd ou processo solto), sem derrubar outros sites da máquina.
PKG=~/kenfeh-update.tgz
say() { printf '%s\n' "$*"; }
fail() { say ""; say "  [ERRO] $*"; exit "${2:-1}"; }

SUDO=""
if [ "$(id -u)" -ne 0 ] && sudo -n true 2>/dev/null; then SUDO="sudo -n"; fi
[ -f "$PKG" ] || fail "O pacote nao chegou no servidor."

# ---------- 1. pasta do Kenfeh ----------
is_kenfeh() { [ -f "$1/server/hub.js" ] && grep -q '"name": *"kenfeh"' "$1/package.json" 2>/dev/null; }
DIR=""
for d in "$KENFEH_DIR" /opt/kenfeh /opt/Kenfeh /opt/KennyFe-Aplicacao /opt/kennyfe /srv/kenfeh /var/www/kenfeh ~/KennyFe-Aplicacao ~/kenfeh /root/KennyFe-Aplicacao /root/kenfeh; do
  if [ -n "$d" ] && $SUDO test -d "$d" 2>/dev/null && is_kenfeh "$d"; then DIR="$d"; break; fi
done
if [ -z "$DIR" ]; then
  for f in $($SUDO find /opt /srv /var/www /home /root -maxdepth 4 -path '*/server/hub.js' -not -path '*/node_modules/*' 2>/dev/null); do
    d=$(dirname "$(dirname "$f")")
    if $SUDO grep -q '"name": *"kenfeh"' "$d/package.json" 2>/dev/null; then DIR="$d"; break; fi
  done
fi
if [ -z "$DIR" ]; then
  say ""
  say "  [ERRO] Nao achei o Kenfeh instalado nesse servidor."
  say "  O que tem nele:"
  say "    /opt: $(ls /opt 2>/dev/null | tr '\n' ' ')"
  command -v pm2 >/dev/null && pm2 list 2>/dev/null | sed 's/^/    /'
  [ -n "$SUDO" ] && $SUDO bash -lc 'command -v pm2 >/dev/null && pm2 list' 2>/dev/null | sed 's/^/    /'
  rm -f "$PKG"
  exit 3
fi
say "  Pasta do Kenfeh no servidor: $DIR"
RUN=""
[ -w "$DIR" ] && [ -w "$DIR/server" ] || RUN="$SUDO"

# ---------- 2. trocar os arquivos (data/ e .env do servidor ficam como estão) ----------
OLDPKG=$($RUN cat "$DIR/package.json" 2>/dev/null | md5sum)
$RUN tar -xzf "$PKG" -C "$DIR" --no-same-owner --warning=no-unknown-keyword --exclude='./data' --exclude='./.env' --exclude='./node_modules' 2>/dev/null || fail "Nao consegui extrair o pacote em $DIR."
rm -f "$PKG"
NEWPKG=$($RUN cat "$DIR/package.json" | md5sum)
say "  Arquivos atualizados."
cd "$DIR" || fail "Nao consegui entrar em $DIR"
if [ ! -d node_modules ] || [ "$OLDPKG" != "$NEWPKG" ]; then
  say "  Instalando dependencias..."
  $RUN npm install --omit=dev --no-audit --no-fund >/dev/null 2>&1 || $RUN npm install --omit=dev || fail "npm install falhou."
fi

PORT=$($RUN grep -E '^PORT=' .env 2>/dev/null | tail -1 | cut -d= -f2 | tr -d '[:space:]"')
PORT=${PORT:-3000}

# ---------- 3. reiniciar só o Kenfeh ----------
restarted=""
# pm2: acha o processo que roda esta pasta (do usuário atual ou do root)
pm2_kenfeh() { # $1 = prefixo (vazio ou sudo)
  $1 bash -lc 'command -v pm2 >/dev/null && pm2 jlist 2>/dev/null' 2>/dev/null | DIR="$DIR" python3 -c '
import sys, json, os
s = sys.stdin.read(); i = s.find("[")
try:
    procs = json.loads(s[i:]) if i >= 0 else []
except Exception:
    procs = []
d = os.environ["DIR"]
def mine(p):
    e = p.get("pm2_env") or {}
    n = str(p.get("name", "")).lower()
    return str(e.get("pm_cwd") or "").startswith(d) or str(e.get("pm_exec_path") or "").startswith(d) or "kenfeh" in n or "kennyfe" in n
print(" ".join(str(p.get("name")) for p in procs if mine(p)))' 2>/dev/null
}
for who in "" "$SUDO"; do
  [ -n "$restarted" ] && break
  [ "$who" = "" ] || [ -n "$SUDO" ] || continue
  names=$(pm2_kenfeh "$who")
  if [ -n "$names" ]; then
    say "  Reiniciando pelo pm2: $names"
    for n in $names; do $who bash -lc "pm2 restart '$n' --update-env" >/dev/null; done
    $who bash -lc 'pm2 save' >/dev/null 2>&1
    restarted="pm2 ($names)"
  fi
done

# serviço do systemd que roda esta pasta
if [ -z "$restarted" ] && command -v systemctl >/dev/null 2>&1; then
  unit=$(grep -l -s -E "$DIR|kenfeh|KennyFe" /etc/systemd/system/*.service /lib/systemd/system/*.service 2>/dev/null | grep -v -i cloudflared | head -1)
  unit=${unit##*/}
  if [ -n "$unit" ]; then
    say "  Reiniciando o servico $unit..."
    $SUDO systemctl restart "$unit" && restarted="systemd ($unit)"
  fi
fi

# processo solto rodando nesta pasta (nohup, screen...)
if [ -z "$restarted" ]; then
  for pid in $(pgrep -f "server/index.js" 2>/dev/null); do
    [ "$($SUDO readlink "/proc/$pid/cwd" 2>/dev/null)" = "$DIR" ] && { say "  Parando o processo antigo ($pid)..."; $SUDO kill "$pid" 2>/dev/null || kill "$pid"; }
  done
  sleep 3
  # liga pelo pm2 (assim ele volta sozinho se o servidor reiniciar); sem pm2, em segundo plano
  PM2WHO=""
  if [ -n "$SUDO" ] && $SUDO bash -lc 'command -v pm2' >/dev/null 2>&1; then PM2WHO="$SUDO"; fi
  if [ -n "$PM2WHO" ] || command -v pm2 >/dev/null 2>&1; then
    say "  Ligando o Kenfeh no pm2..."
    $PM2WHO bash -lc "cd '$DIR' && pm2 start npm --name kenfeh -- start && pm2 save" >/dev/null && restarted="pm2 (kenfeh, novo)"
  fi
  if [ -z "$restarted" ]; then
    # setsid: solta de vez da sessão do SSH (não morre quando a conexão fecha)
    $RUN bash -c "cd '$DIR' && setsid nohup npm start > kenfeh.log 2>&1 < /dev/null &"
    restarted="nohup (log em $DIR/kenfeh.log)"
  fi
fi

# ---------- 4. conferir (a página tem que ser a do Kenfeh, não outro site da máquina) ----------
# porta em que o processo DESTA pasta está ouvindo (não confunde com outro site da máquina)
kenfeh_ports() {
  for pid in $(pgrep -f "server/index.js" 2>/dev/null); do
    [ "$($SUDO readlink "/proc/$pid/cwd" 2>/dev/null)" = "$DIR" ] || continue
    $SUDO ss -ltnpH 2>/dev/null | grep "pid=$pid," | awk '{print $4}' | sed 's/.*://'
  done | sort -u
}
say "  Esperando o Kenfeh subir..."
ok=""
sleep 2
for i in $(seq 1 25); do
  for p in $(kenfeh_ports) $PORT; do
    if curl -s -m 2 "http://localhost:$p/" 2>/dev/null | grep -qi kenfeh; then ok=1; PORT=$p; break 2; fi
  done
  sleep 1
done
say ""
if [ -n "$ok" ]; then
  say "  PRONTO! O Kenfeh esta no ar com a versao nova (porta $PORT, reiniciado via $restarted)."
else
  say "  [ATENCAO] O Kenfeh nao respondeu na porta $PORT depois de reiniciar ($restarted)."
  say "  Se outro site da maquina usa essa porta, coloque PORT=3001 (por exemplo) no .env do Kenfeh no servidor."
  for who in "" "$SUDO"; do $who bash -lc 'command -v pm2 >/dev/null && pm2 logs kenfeh --lines 15 --nostream' 2>/dev/null | tail -n 20 | sed 's/^/    /'; done
  [ -f kenfeh.log ] && tail -n 15 kenfeh.log | sed 's/^/    /'
  exit 2
fi
