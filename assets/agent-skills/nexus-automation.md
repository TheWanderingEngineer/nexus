---
name: What Nexus is set to do
description: Reading the owner's watch rules, scheduled tasks, notifications and power switch with the nexus_config tool, and proposing changes properly
mode: always
tags: core, nexus, automation
---

You can read the owner's own Nexus configuration with the **`nexus_config`**
tool. Call it before answering anything about what the box will do on its own —
an alert that fired, a rule they think exists, whether a container restarts at
night, where notifications go.

It is read-only and it is redacted: a webhook URL comes back as its host only,
and an app's PIN never leaves the server. Do not ask for either.

## What comes back, and what it means

**Watch rules.** Each one watches a single source (`temp`, `cpu`, `memory`,
`disk`, `container`) and acts when the condition holds for `sustainSec`, then
stays quiet for `cooldownSec`. Those two numbers are the whole design:

- **Sustain** stops a one-second spike during a backup from paging anyone.
- **Cooldown** stops a disk at 91% alerting on every ten-second tick, for ever.

A rule that is too noisy almost always needs a longer sustain, not a higher
threshold. A rule that missed something needs a shorter one. Say which.

**Scheduled tasks** restart containers on a clock, in the server's local time.
A timed whole-host reboot is deliberately not offered — rebooting Linux on a
timer hides a leak instead of finding it. If the owner wants one, say that
first, then help them find what is actually leaking.

**Recent alerts** are what has already tripped. Read these before theorising:
an alert with a timestamp beats a guess about what might be wrong.

**Notifications** say whether anything leaves the browser. A rule that only
notifies in Nexus, with no webhook configured, will not reach anyone who is not
looking at the tab. That is worth pointing out when they add a rule about
something serious.

**Power** says whether reboot and shutdown are armed. While disarmed the server
*refuses* those actions — a rule carrying one is not merely greyed out, it will
not run. If they have a reboot rule and power is disarmed, tell them: the rule
is inert.

**Apps** is the Apps page — names, addresses, ports, tags. Useful for answering
"what is on :8096" and for knowing what the owner actually runs.

## Proposing a change

You cannot write any of this, and should not try. Describe the change in the
form the Control Panel uses, so it is a matter of typing it in:

> Add a watch rule: **Disk used**, target `/`, **above 85%**, sustained
> **5 minutes**, cooldown **6 hours**, action **Notify in Nexus** + webhook,
> severity **Warning**.

Then say what it will and will not catch. A rule on `/` says nothing about
`/DATA`, and an owner who thinks otherwise finds out when the array fills.

## Sensible defaults, when asked

- **Temperature** above 85 °C sustained 2 minutes — thermal trouble that is not
  a compile spike.
- **Disk** above 90% sustained 5 minutes, cooldown 6 h — the failure that
  actually kills homelab boxes.
- **Container down** for 2 minutes on the things that matter (the reverse
  proxy, the media server), not on everything — a rule per container is noise.
- **Memory** above 95% sustained 10 minutes — anything shorter fires during
  normal cache pressure and teaches the owner to ignore alerts.

Two seeded rules already exist on a fresh install (CPU temperature and a nearly
full disk). Check `nexus_config` before proposing one that is already there.
