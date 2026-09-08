#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 || $# -gt 5 ]]; then
  echo "usage: $0 <binary> <repository> [runs=5] [settle-seconds=60] [cpu-window-seconds=10]" >&2
  exit 2
fi

binary=$(realpath "$1")
repository=$(realpath "$2")
runs=${3:-5}
settle_seconds=${4:-60}
cpu_window_seconds=${5:-10}

for value in "$runs" "$settle_seconds" "$cpu_window_seconds"; do
  if [[ ! $value =~ ^[1-9][0-9]*$ ]]; then
    echo "runs and durations must be positive integers" >&2
    exit 2
  fi
done

if [[ ! -x $binary ]]; then
  echo "binary is not executable: $binary" >&2
  exit 2
fi
if [[ ! -d $repository ]]; then
  echo "repository directory does not exist: $repository" >&2
  exit 2
fi

active_pid=""

stop_active_process() {
  if [[ -n $active_pid ]] && kill -0 "$active_pid" 2>/dev/null; then
    kill "$active_pid" 2>/dev/null || true
    wait "$active_pid" 2>/dev/null || true
  fi
  active_pid=""
}

trap stop_active_process EXIT
trap 'stop_active_process; exit 130' INT TERM

collect_process_tree() {
  local root_pid=$1
  local pid
  local -a queue=("$root_pid")
  local -a children=()
  declare -A seen=()

  while ((${#queue[@]})); do
    pid=${queue[0]}
    queue=("${queue[@]:1}")
    if [[ -n ${seen[$pid]+present} || ! -r /proc/$pid/stat ]]; then
      continue
    fi
    seen[$pid]=1
    printf '%s\n' "$pid"
    mapfile -t children < <(pgrep -P "$pid" 2>/dev/null || true)
    queue+=("${children[@]}")
  done
}

sum_memory_kib() {
  local pid
  local pss=0
  local rss=0
  local values

  for pid in "$@"; do
    if [[ ! -r /proc/$pid/smaps_rollup ]]; then
      continue
    fi
    values=$(awk '
      /^Pss:/ { pss = $2 }
      /^Rss:/ { rss = $2 }
      END { print pss + 0, rss + 0 }
    ' "/proc/$pid/smaps_rollup")
    pss=$((pss + ${values%% *}))
    rss=$((rss + ${values##* }))
  done
  printf '%s %s\n' "$pss" "$rss"
}

sum_cpu_ticks() {
  local pid
  local stat_line
  local remainder
  local sum=0
  local -a fields=()

  for pid in "$@"; do
    if [[ ! -r /proc/$pid/stat ]]; then
      continue
    fi
    stat_line=$(<"/proc/$pid/stat")
    remainder=${stat_line##*) }
    read -r -a fields <<<"$remainder"
    sum=$((sum + fields[11] + fields[12]))
  done
  printf '%s\n' "$sum"
}

clock_ticks=$(getconf CLK_TCK)
printf 'run,processes,pss_kib,rss_kib,idle_cpu_percent\n'

for ((run = 1; run <= runs; run++)); do
  "$binary" "$repository" >/dev/null 2>&1 &
  active_pid=$!
  sleep "$settle_seconds"
  if ! kill -0 "$active_pid" 2>/dev/null; then
    echo "Asterlyn exited before measurement run $run" >&2
    exit 1
  fi

  mapfile -t process_ids < <(collect_process_tree "$active_pid")
  read -r pss_kib rss_kib < <(sum_memory_kib "${process_ids[@]}")
  ticks_before=$(sum_cpu_ticks "${process_ids[@]}")
  sleep "$cpu_window_seconds"
  ticks_after=$(sum_cpu_ticks "${process_ids[@]}")
  idle_cpu=$(awk \
    -v delta="$((ticks_after - ticks_before))" \
    -v ticks="$clock_ticks" \
    -v seconds="$cpu_window_seconds" \
    'BEGIN { printf "%.2f", delta / ticks / seconds * 100 }')

  printf '%s,%s,%s,%s,%s\n' \
    "$run" "${#process_ids[@]}" "$pss_kib" "$rss_kib" "$idle_cpu"
  stop_active_process
done
