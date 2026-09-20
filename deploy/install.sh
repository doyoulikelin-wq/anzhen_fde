#!/usr/bin/env bash
# Deploy an already-uploaded source directory. No dependency installation or nginx edits.
set -Eeuo pipefail
umask 077

if [[ ${EUID} -ne 0 ]]; then
  printf '%s\n' 'Run this installer as root.' >&2
  exit 1
fi
if [[ $# -lt 1 || $# -gt 2 ]]; then
  printf '%s\n' 'Usage: bash deploy/install.sh /absolute/uploaded-source-directory [release-id]' >&2
  exit 1
fi
source_dir=$(cd -- "$1" && pwd -P)
release_id=${2:-$(date -u +%Y%m%dT%H%M%SZ)}
[[ "$release_id" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$ ]] || { printf '%s\n' 'Invalid release id.' >&2; exit 1; }
service_name=anzhen-fde.service
install_root=/opt/anzhen-fde
release_dir="$install_root/releases/$release_id"
env_file=/etc/anzhen-fde/app.env
data_dir=/var/lib/anzhen-fde
unit_file="/etc/systemd/system/$service_name"
node_bin=${ANZHEN_NODE_BIN:-/usr/bin/node}

for command_name in systemctl curl ss getent useradd groupadd install cp mv readlink sed grep sort id; do
  command -v "$command_name" >/dev/null || { printf 'Missing prerequisite: %s\n' "$command_name" >&2; exit 1; }
done
[[ "$node_bin" =~ ^/[A-Za-z0-9_./-]+$ && -x "$node_bin" ]] || { printf '%s\n' 'Set ANZHEN_NODE_BIN to an existing absolute Node.js executable path.' >&2; exit 1; }
"$node_bin" -e 'if (Number(process.versions.node.split(".")[0]) < 22) process.exit(1)' || { printf '%s\n' 'Node.js 22 or newer is required.' >&2; exit 1; }
[[ -d /run/systemd/system ]] || { printf '%s\n' 'A running systemd host is required.' >&2; exit 1; }
[[ ! -e "$release_dir" && ! -L "$release_dir" ]] || { printf '%s\n' 'Release id already exists; choose a new one.' >&2; exit 1; }
[[ ! -e "$install_root/current" || -L "$install_root/current" ]] || { printf '%s\n' 'Refusing to replace current: it is not a symbolic link.' >&2; exit 1; }
for protected_dir in "$install_root" "$install_root/releases" /etc/anzhen-fde "$data_dir"; do
  [[ ! -L "$protected_dir" ]] || { printf 'Refusing linked installation directory: %s\n' "$protected_dir" >&2; exit 1; }
done
if [[ -L "$install_root/current" ]]; then
  current_target=$(readlink -f "$install_root/current")
  [[ "$current_target" == "$install_root/releases/"* && -d "$current_target" ]] || { printf '%s\n' 'Existing current must point to a valid managed release.' >&2; exit 1; }
fi
[[ ! -e "$install_root/current.next" && ! -L "$install_root/current.next" && ! -e "$install_root/current.rollback" && ! -L "$install_root/current.rollback" ]] || { printf '%s\n' 'A stale deployment link exists; inspect it before continuing.' >&2; exit 1; }

# Check the exact port before touching the running service. Only an existing
# managed instance may occupy it; other applications are never killed.
port_listeners=$(ss -H -ltnp 'sport = :4173')
if [[ -n "$port_listeners" ]]; then
  managed_pid=$(systemctl show -p MainPID --value "$service_name" 2>/dev/null || true)
  [[ "$managed_pid" =~ ^[1-9][0-9]*$ && "$port_listeners" == *"pid=$managed_pid,"* ]] || {
    printf '%s\n' 'Port 4173 belongs to another process. Resolve that conflict before deployment.' >&2
    exit 1
  }
  # Multiple listener processes on the same port indicate a conflict as well.
  other_pids=$(printf '%s\n' "$port_listeners" | grep -oE 'pid=[0-9]+' | sort -u | grep -vx "pid=$managed_pid" || true)
  [[ -z "$other_pids" ]] || { printf '%s\n' 'Other processes also listen on port 4173; deployment stopped.' >&2; exit 1; }
fi

runtime_files=(package.json index.html styles.css portal.css downward.css guidance.css app.mjs matching.mjs record-store.mjs shared-client.mjs shared-ui.mjs portal.mjs downward.mjs guidance.mjs server.mjs config.mjs llm.mjs care-ai.mjs workspace-store.mjs data/doctors.json)
for relative in "${runtime_files[@]}" deploy/anzhen-fde.service deploy/app.env.example; do
  [[ -f "$source_dir/$relative" && ! -L "$source_dir/$relative" ]] || { printf 'Missing or linked source file: %s\n' "$relative" >&2; exit 1; }
done
[[ -d "$source_dir/assets/doctors" ]] || { printf '%s\n' 'Doctor photographs are missing.' >&2; exit 1; }

install -d -m 0700 /etc/anzhen-fde
if [[ ! -f "$env_file" ]]; then
  install -m 0600 "$source_dir/deploy/app.env.example" "$env_file"
  printf '%s\n' 'Created /etc/anzhen-fde/app.env with an empty API key. Fill it locally on the server, then rerun this command.'
  exit 2
fi
[[ ! -L "$env_file" ]] || { printf '%s\n' 'Refusing a linked environment file.' >&2; exit 1; }
chown root:root "$env_file"
chmod 0600 "$env_file"
"$node_bin" --input-type=module - "$env_file" <<'NODE'
import {readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
const env=parseEnv(readFileSync(process.argv[2], 'utf8'));
if (env.PORT !== '4173') throw new Error('Deployment requires PORT=4173.');
if (!env.PUBLIC_ORIGIN || !/^https?:\/\//.test(env.PUBLIC_ORIGIN)) throw new Error('PUBLIC_ORIGIN must specify the intended public URL.');
NODE

if ! getent group anzhen >/dev/null; then groupadd --system anzhen; fi
if ! getent passwd anzhen >/dev/null; then
  no_login=/usr/sbin/nologin
  [[ -x "$no_login" ]] || no_login=/sbin/nologin
  useradd --system --gid anzhen --home-dir /nonexistent --no-create-home --shell "$no_login" anzhen
fi
account_entry=$(getent passwd anzhen)
[[ $(id -u anzhen) -ne 0 && $(id -gn anzhen) == anzhen && ( "$account_entry" == *:/usr/sbin/nologin || "$account_entry" == *:/sbin/nologin || "$account_entry" == *:/bin/false ) ]] || { printf '%s\n' 'Existing anzhen account is not a dedicated non-login service account.' >&2; exit 1; }
# State is separate from release code: updates and rollbacks never replace it.
[[ ! -L "$data_dir" && ( ! -e "$data_dir" || -d "$data_dir" ) ]] || { printf '%s\n' 'Refusing an invalid shared-data directory.' >&2; exit 1; }
install -d -o anzhen -g anzhen -m 0700 "$data_dir"
install -d -m 0755 "$install_root" "$install_root/releases" "$release_dir" "$release_dir/data" "$release_dir/assets/doctors"
for relative in "${runtime_files[@]}"; do
  install -m 0644 "$source_dir/$relative" "$release_dir/$relative"
done
shopt -s nullglob
photo_files=("$source_dir"/assets/doctors/doctor-*.png "$source_dir"/assets/doctors/doctor-*.jpg)
[[ ${#photo_files[@]} -gt 0 ]] || { printf '%s\n' 'No doctor photographs found.' >&2; exit 1; }
for photo_file in "${photo_files[@]}"; do
  [[ -f "$photo_file" && ! -L "$photo_file" ]] || { printf '%s\n' 'Refusing a linked or invalid doctor photograph.' >&2; exit 1; }
  install -m 0644 "$photo_file" "$release_dir/assets/doctors/"
done
for source_module in "$release_dir"/*.mjs; do "$node_bin" --check "$source_module"; done

previous_release=''
if [[ -L "$install_root/current" ]]; then
  previous_release=$(readlink -f "$install_root/current")
fi
unit_backup="$release_dir/previous-service.unit"
had_unit=false
if [[ -f "$unit_file" ]]; then cp -p "$unit_file" "$unit_backup"; had_unit=true; fi
was_enabled=$(systemctl is-enabled "$service_name" 2>/dev/null || true)
switched=false
rollback() {
  failure_status=$?
  trap - ERR
  set +e
  if [[ "$switched" == true ]]; then
    printf '%s\n' 'Deployment failed; restoring the previous application release.' >&2
    systemctl stop "$service_name"
    if [[ "$was_enabled" != enabled ]]; then systemctl disable "$service_name" >/dev/null 2>&1; fi
    if [[ -n "$previous_release" && -d "$previous_release" ]]; then
      ln -s "$previous_release" "$install_root/current.rollback"
      mv -Tf "$install_root/current.rollback" "$install_root/current"
    else
      rm -f "$install_root/current"
    fi
    if [[ "$had_unit" == true ]]; then cp -p "$unit_backup" "$unit_file"; else rm -f "$unit_file"; fi
    systemctl daemon-reload
    if [[ -n "$previous_release" && "$had_unit" == true ]]; then systemctl start "$service_name"; fi
  fi
  printf 'Inspect logs with: journalctl -u %s -n 60 --no-pager\n' "$service_name" >&2
  exit "$failure_status"
}
trap rollback ERR
switched=true
sed "s|^ExecStart=/usr/bin/node |ExecStart=$node_bin |" "$source_dir/deploy/anzhen-fde.service" > "$unit_file"
chmod 0644 "$unit_file"
ln -s "$release_dir" "$install_root/current.next"
mv -Tf "$install_root/current.next" "$install_root/current"
systemctl daemon-reload
systemctl enable "$service_name" >/dev/null
systemctl restart "$service_name"
healthy=false
for attempt in {1..20}; do
  if curl --fail --silent --max-time 2 http://127.0.0.1:4173/api/health | "$node_bin" -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{try{const j=JSON.parse(s);process.exit(j.status==="ok"&&j.service==="anzhen-referral-workspace"?0:1)}catch{process.exit(1)}})'; then
    healthy=true
    break
  fi
  sleep 1
done
if [[ "$healthy" != true ]]; then
  printf '%s\n' 'The new release did not pass the local health check.' >&2
  false
fi
trap - ERR
printf 'Application deployed: %s\n' "$release_id"
printf 'Previous release: %s\n' "${previous_release:-none}"
printf '%s\n' 'Loopback health check passed. Nginx, public connectivity and AI requests require separate verification.'
printf '%s\n' 'Existing nginx sites and firewall rules were left unchanged.'
printf 'Shared records remain outside releases: %s\n' "$data_dir"
