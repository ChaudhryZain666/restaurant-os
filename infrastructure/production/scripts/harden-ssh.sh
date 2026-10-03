#!/usr/bin/env bash
# GarnishTable SSH hardening (Phase 87) — two deliberate steps, run as root:
#
#   harden-ssh.sh check <user>   read-only: confirms <user> can log in with a key and has sudo
#   harden-ssh.sh apply <user>   key-only logins, no root password login; validates the config
#                                (sshd -t) BEFORE reloading, and keeps your current session open
#
# After "apply": KEEP THIS SESSION OPEN, open a SECOND terminal and log in as <user> with your key.
# Only when that works, close the first session. If it does not, undo from the open session with:
#   rm /etc/ssh/sshd_config.d/10-garnishtable.conf && systemctl reload ssh
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "run as root (sudo)" >&2; exit 1; }
MODE="${1:-}"; USER_NAME="${2:-}"
[ -n "$USER_NAME" ] && [[ "$MODE" =~ ^(check|apply)$ ]] || { echo "usage: harden-ssh.sh check|apply <user>" >&2; exit 1; }
CONF=/etc/ssh/sshd_config.d/10-garnishtable.conf
ok=1
say() { printf '%-6s %s\n' "$1" "$2"; }

home="$(getent passwd "$USER_NAME" | cut -d: -f6)"
if [ -z "$home" ]; then say FAIL "user $USER_NAME does not exist"; ok=0
else
  keys="$home/.ssh/authorized_keys"
  if [ -s "$keys" ] && grep -qE '^(ssh-(ed25519|rsa)|ecdsa-|sk-)' "$keys"; then say PASS "$USER_NAME has $(grep -cE '^(ssh-|ecdsa-|sk-)' "$keys") authorized key(s)"
  else say FAIL "$keys has no public key — install one first (ssh-copy-id $USER_NAME@<server>)"; ok=0; fi
  perms="$(stat -c %a "$home/.ssh" 2> /dev/null || echo missing)"
  [ "$perms" = 700 ] && say PASS "~/.ssh is 700" || { say WARN "~/.ssh is $perms (sshd may ignore the key unless 700, owned by $USER_NAME)"; }
  if id -nG "$USER_NAME" | grep -qwE 'sudo|admin'; then say PASS "$USER_NAME can sudo"; else say FAIL "$USER_NAME is not in the sudo group — you would lose root access"; ok=0; fi
fi
echo "Current effective settings:"
sshd -T 2> /dev/null | grep -E '^(passwordauthentication|kbdinteractiveauthentication|permitrootlogin|pubkeyauthentication|maxauthtries) ' | sed 's/^/  /'

if [ "$MODE" = check ]; then
  [ "$ok" = 1 ] && echo "Ready: run 'harden-ssh.sh apply $USER_NAME'." || echo "NOT ready — fix the FAIL lines first."
  exit $((1 - ok))
fi
[ "$ok" = 1 ] || { echo "Refusing to apply: fix the FAIL lines first, or you could lock yourself out." >&2; exit 1; }

# sshd_config.d files are read in name order and the FIRST value wins, so 10-… beats Ubuntu's
# 50-cloud-init.conf (which often sets PasswordAuthentication yes).
tmp="$(mktemp)"
cat > "$tmp" <<'EOF'
# GarnishTable (infrastructure/production/scripts/harden-ssh.sh)
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
PubkeyAuthentication yes
MaxAuthTries 3
LoginGraceTime 30
X11Forwarding no
EOF
[ -f "$CONF" ] && cp "$CONF" "$CONF.bak.$(date +%s)"
install -m 644 "$tmp" "$CONF"; rm -f "$tmp"
if ! sshd -t; then
  echo "sshd rejected the configuration — removing it, nothing was reloaded." >&2
  rm -f "$CONF"; exit 1
fi
systemctl reload ssh
echo "Applied and reloaded. Effective settings now:"
sshd -T | grep -E '^(passwordauthentication|kbdinteractiveauthentication|permitrootlogin) ' | sed 's/^/  /'
cat <<EOF

DO NOT CLOSE THIS SESSION. In a second terminal run:   ssh $USER_NAME@<server>
If that works, you are done. If not, undo here:        rm $CONF && systemctl reload ssh
EOF
