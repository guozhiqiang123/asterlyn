#!/usr/bin/env bash
set -euo pipefail

if [[ $# -eq 0 ]]; then
  echo "Usage: scripts/with-linux-tauri-env.sh <command> [arguments...]" >&2
  exit 2
fi

user_home="$(getent passwd "$(id -u)" | cut -d: -f6)"
multiarch="$(dpkg-architecture -qDEB_HOST_MULTIARCH)"
sysroot="${ASTERLYN_TAURI_SYSROOT:-${user_home}/.local/asterlyn-tauri-sysroot}"
pc_root="${sysroot}/usr/lib/${multiarch}/pkgconfig"
lib_root="${sysroot}/usr/lib/${multiarch}"

if [[ ! -f "${pc_root}/webkit2gtk-4.1.pc" ]]; then
  echo "The local Tauri sysroot is missing. Run scripts/setup-linux-tauri-local.sh first." >&2
  exit 1
fi

export PKG_CONFIG_PATH="${pc_root}${PKG_CONFIG_PATH:+:${PKG_CONFIG_PATH}}"
export LD_LIBRARY_PATH="${lib_root}${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}"

exec "$@"

