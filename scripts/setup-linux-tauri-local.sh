#!/usr/bin/env bash
set -euo pipefail

if ! command -v apt >/dev/null || ! command -v dpkg-deb >/dev/null; then
  echo "This helper currently supports Debian-family systems with apt and dpkg-deb." >&2
  exit 1
fi

user_home="$(getent passwd "$(id -u)" | cut -d: -f6)"
multiarch="$(dpkg-architecture -qDEB_HOST_MULTIARCH)"
cache_root="${XDG_CACHE_HOME:-${user_home}/.cache}/asterlyn/tauri-debs"
sysroot="${ASTERLYN_TAURI_SYSROOT:-${user_home}/.local/asterlyn-tauri-sysroot}"

mkdir -p "${cache_root}" "${sysroot}"
find "${cache_root}" -maxdepth 1 -type f -name '*.deb' -delete

packages=(
  libwebkit2gtk-4.1-dev
  libjavascriptcoregtk-4.1-dev
  libsoup-3.0-dev
  libnghttp2-dev
  libpsl-dev
  gir1.2-soup-3.0
  gir1.2-javascriptcoregtk-4.1
  gir1.2-webkit2-4.1
  libwebkit2gtk-4.1-0
  libjavascriptcoregtk-4.1-0
  libsoup-3.0-0
  libnghttp2-14
  libpsl5
)

(
  cd "${cache_root}"
  apt download "${packages[@]}"
  for package in ./*.deb; do
    dpkg-deb -x "${package}" "${sysroot}"
  done
)

pc_root="${sysroot}/usr/lib/${multiarch}/pkgconfig"
if [[ ! -d "${pc_root}" ]]; then
  echo "Expected pkg-config metadata was not extracted to ${pc_root}." >&2
  exit 1
fi

while IFS= read -r -d '' pc_file; do
  sed -i \
    -e "s|^prefix=/usr$|prefix=${sysroot}/usr|" \
    -e "s|^libdir=/usr/lib/${multiarch}$|libdir=\${prefix}/lib/${multiarch}|" \
    "${pc_file}"
done < <(
  find "${pc_root}" -maxdepth 1 -type f \
    \( -name 'webkit2gtk*.pc' -o -name 'javascriptcoregtk*.pc' -o -name 'libsoup*.pc' -o -name 'libnghttp2.pc' -o -name 'libpsl.pc' \) \
    -print0
)

PKG_CONFIG_PATH="${pc_root}" pkg-config --modversion \
  javascriptcoregtk-4.1 libsoup-3.0 webkit2gtk-4.1

echo
echo "Local Tauri development sysroot is ready at ${sysroot}."
echo "Run Linux native commands through scripts/with-linux-tauri-env.sh."

