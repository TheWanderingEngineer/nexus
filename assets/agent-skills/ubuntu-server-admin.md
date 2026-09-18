---
name: Ubuntu Server administration
description: apt, systemd, journald, storage, users and firewall on Ubuntu Server 24.04
mode: ondemand
---

Ubuntu Server 24.04 LTS (noble). Headless, systemd, no desktop packages.

## Packages

```bash
apt-get update
apt-get install -y <pkg>                 # DEBIAN_FRONTEND=noninteractive is already set for you
apt list --upgradable
apt-get upgrade -y                       # never `dist-upgrade` without saying so first
/usr/lib/update-notifier/apt-check --human-readable    # what is pending, incl. security
```

24.04 ships **unattended-upgrades** for security updates by default. Before
"fixing" a reboot-required state, check `/var/run/reboot-required` and tell the
owner rather than rebooting their server on your own initiative.

Third-party repos belong in `/etc/apt/sources.list.d/` with a key in
`/etc/apt/keyrings/` — `apt-key` is gone and `.list` files with inline keys are
deprecated. Prefer the `deb [signed-by=...]` form.

## Services

```bash
systemctl status <unit>
systemctl restart <unit>
systemctl enable --now <unit>
systemctl list-units --failed          # the first thing to run when "something is wrong"
systemd-analyze blame                  # slow boot
```

Unit files you write go in `/etc/systemd/system/`. After editing:
`systemctl daemon-reload`. Overrides for a packaged unit go in
`systemctl edit <unit>`, not by editing the vendor file in `/lib/systemd/system`.

## Logs

```bash
journalctl -u <unit> -n 200 --no-pager
journalctl -p err -b --no-pager          # errors this boot
journalctl --since '1 hour ago' -f
journalctl --disk-usage ; journalctl --vacuum-size=200M
```

## Storage

```bash
df -hT                    # usage by filesystem, with type
lsblk -f                  # devices, filesystems, UUIDs, mountpoints
du -xh --max-depth=1 / | sort -h     # where the space went; -x stays on one fs
findmnt
```

Permanent mounts go in `/etc/fstab` **by UUID**, never by `/dev/sdX` — device
letters move between boots. Always `cp /etc/fstab /etc/fstab.bak` first, and
always `mount -a` to test before rebooting: a bad fstab entry can leave the box
unbootable and this machine has no screen attached.

`nofail` on data disks is worth suggesting for exactly that reason.

## Users and permissions

```bash
id <user> ; groups <user>
usermod -aG docker <user>      # this is root-equivalent — say so
ls -ln <path>                  # numeric ids, which is what containers care about
chown -R 1000:1000 <path>
```

## Firewall

```bash
ufw status verbose
ufw allow 8080/tcp
```

**Docker bypasses ufw.** A published port (`-p 8080:80`) is reachable even if ufw
says it is blocked, because Docker writes its own iptables rules. If the owner
wants a container kept off the LAN, bind it to localhost (`127.0.0.1:8080:80`)
and put a reverse proxy in front. Say this plainly — it surprises people.

## Health checks worth running

```bash
uptime ; free -h ; df -h
systemctl list-units --failed
journalctl -p err -b --no-pager | tail -50
sensors 2>/dev/null ; smartctl -H /dev/sdX
last -n 20 ; lastb -n 20        # logins, and failed logins
```
