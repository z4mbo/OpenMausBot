#!/bin/sh
set -eu
umask 077
host_dir='/mnt/c/Users/aless/.codex/worktrees/origin-workspace-delete/Origin/.omb-scratch/wsl-cua-descriptor-034-dTLtwb'
probe_root=$(mktemp -d /tmp/origin-cua-034-XXXXXX)
chmod 700 "$probe_root"
printf '%s\n' "$probe_root" > "$host_dir/linux-owned-root.txt"
printf '%s  %s\n' 'fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6' "$host_dir/node-v24.21.0-linux-x64.tar.xz" | sha256sum -c -
mkdir -m 700 "$probe_root/before" "$probe_root/after"
cp "$host_dir/before/"*.ts "$probe_root/before/"
cp "$host_dir/after/"*.ts "$probe_root/after/"
cp "$host_dir/probe.mjs" "$probe_root/probe.mjs"
tar -xJf "$host_dir/node-v24.21.0-linux-x64.tar.xz" -C "$probe_root"
"$probe_root/node-v24.21.0-linux-x64/bin/node" --experimental-strip-types "$probe_root/probe.mjs" "$probe_root" "$host_dir"
