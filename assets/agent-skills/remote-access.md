---
name: Remote access and reverse proxy
description: Nginx Proxy Manager, DuckDNS, certificates, ports and the safe ways in
mode: ondemand
tags: networking, proxy, tls
---

## Nginx Proxy Manager

A web UI over nginx that terminates TLS and routes hostnames to internal
services. Admin UI on **81**, serving on **80** and **443**.

A proxy host needs: domain name, scheme (`http`), forward hostname, forward port.
Use the **container name** as the forward hostname when NPM shares a Docker
network with the target — `jellyfin`, not `localhost`, and not the LAN IP if you
can avoid it.

Worth turning on per host: *Block Common Exploits*, *Websockets Support* (needed
by Jellyfin and most modern UIs), and *Force SSL* + *HTTP/2*.

First login is `admin@example.com` / `changeme`, and it insists you change it.

Certificates: NPM requests Let's Encrypt certs itself. Port 80 must be reachable
from the internet for HTTP-01, **or** use a DNS-01 challenge (DuckDNS is
supported in the provider list) — DNS-01 is the only way to get a certificate
without exposing port 80, and the only way to get a wildcard.

## DuckDNS

Free dynamic DNS: `yourname.duckdns.org` pointed at whatever your home IP
currently is. A small container or a cron job re-posts the current address:

```
https://www.duckdns.org/update?domains=<name>&token=<token>&ip=
```

Leaving `ip=` empty makes DuckDNS use the source address of the request, which
is what you want behind CGNAT-free home broadband. The token is a secret — treat
it like a password and never print it into the chat.

For TLS, DuckDNS works with DNS-01 in NPM (provider: duckdns, credential: the
token). Subdomains work: `jellyfin.yourname.duckdns.org`.

## Ports and exposure

```bash
ss -ltnp                 # what is listening, and which process
ss -ltnp | grep :8096
```

Only two ports should ever be forwarded at the router: **80 and 443**, into NPM.
Everything else stays on the LAN and is reached through the proxy. Forwarding
8096 or 8080 straight to a container puts an unauthenticated admin UI on the
internet.

Bind anything that should not leave the box to localhost in compose:

```yaml
ports:
  - "127.0.0.1:8096:8096"
```

Remember that **Docker publishes past ufw** — a published port is reachable on
the LAN whatever the firewall says.

## The safer option

Tailscale or WireGuard is almost always the better answer for a home server: no
open ports, no certificates to renew, no exposed admin panels. Suggest it when
the owner's actual goal is "reach my server from my phone" rather than "let
other people use it".

Nexus itself must not be published to the internet. It is a root shell with a
login page.

## Diagnosing

- **502 from the proxy** → the target is down, or the forward hostname is wrong,
  or the two containers are not on the same Docker network. `docker network
  inspect <net>` lists who is on it.
- **Certificate will not issue** → port 80 not reachable, or a DNS record that
  has not propagated, or Let's Encrypt rate limits (5 failures/hour, 5 duplicate
  certs/week — wait, do not retry in a loop).
- **Works on LAN, not remotely** → router port-forward, or CGNAT. `curl -s
  ifconfig.me` and compare with what DuckDNS is publishing.
- **Websocket features dead** (live TV, progress bars) → Websockets Support off
  on that proxy host.
