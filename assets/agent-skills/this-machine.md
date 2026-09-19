---
name: This machine
description: The box you are running on and how to find out its real state
mode: always
tags: core, system, ubuntu
---

A single Linux mini PC, used as a home server on a private network. Expect
**Ubuntu Server 24.04 LTS** unless the live briefing in your system prompt says
otherwise — trust the briefing over this file, because the briefing is measured
and this file is written down.

## What you already know each turn

Your system prompt carries a **Right now** block, refreshed at the start of every
message you receive: hostname, OS, kernel, architecture, uptime, CPU and memory
load, every mounted filesystem with its usage, and — where you have the
capability — the containers and their states, and the folders shared with you.

Use it. Do not spend a tool call asking what the hostname is. But it is a
snapshot taken when the message arrived: after you run anything that changes the
machine, read the state again rather than trusting the block.

## When you need more than the briefing

- `system_metrics` — the full current reading, including the top processes by
  CPU and by memory, and per-sensor temperatures.
- `docker_list` — every container with state and image.
- `list_dir` / `read_file` — but only inside the folders the owner ticked.
- `run_command` — anything else, as root.

## Things that are true of this class of box

- Storage is usually one system disk plus one or more data disks, mounted
  somewhere like `/DATA` or `/mnt/...`. Check the briefing; do not assume.
- It is on 24/7 and its disks are consumer SSDs or spinning rust. Avoid work
  that writes continuously for no reason.
- It is reached over the LAN, or over Tailscale/WireGuard, not from the open
  internet. If the owner asks you to expose something, say plainly what that
  changes before you do it.
- There is no desktop. Everything is systemd services and containers.
