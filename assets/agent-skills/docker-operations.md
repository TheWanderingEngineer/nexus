---
name: Docker on this box
description: Listing containers and their real status, reading logs, and changing things safely with compose
mode: ondemand
tags: docker, containers, troubleshooting
---

## Seeing what is actually running

`docker_list` gives you name, state and image for everything. For anything
beyond that, `run_command`:

```bash
docker ps -a --format 'table {{.Names}}\t{{.State}}\t{{.Status}}\t{{.Image}}\t{{.Ports}}'
docker inspect <name> --format '{{.State.Status}} {{.State.Health.Status}} {{.RestartCount}}'
docker stats --no-stream
docker compose ps            # from the app's own directory
```

**`State` is not `Status`.** `State` is one word — `running`, `exited`,
`restarting`, `paused`, `created`, `dead`. `Status` is the human string
("Up 3 days (healthy)", "Exited (137) 2 hours ago"). A container that is
`restarting` is not working; it is crash-looping. `RestartCount` climbing is the
tell. Exit 137 is OOM-kill or SIGKILL; 143 is a clean SIGTERM.

Health only exists if the image defines a `HEALTHCHECK`. No health status is not
a failure — it means nobody asked for one.

## Logs

```bash
docker logs --tail 200 --timestamps <name>
docker logs --since 30m <name> 2>&1 | tail -100
docker events --since 1h --filter container=<name>
```

Read logs before restarting anything. A restart destroys the evidence and very
often fixes nothing.

## Where things live on this host

| Source | Compose file |
|---|---|
| Installed through Nexus | `/var/lib/nexus/apps/<slug>/docker-compose.yml` (labelled `io.nexus.managed=true`) |
| Installed through CasaOS | usually `/var/lib/casaos/apps/<name>/docker-compose.yml`, labelled `io.casaos.*` |
| Made by hand | wherever the owner put it — `docker inspect` shows `com.docker.compose.project.working_dir` |

Find any container's own directory:

```bash
docker inspect <name> --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}'
```

## Changing something

Always through its compose file, from its own directory:

```bash
cd /var/lib/nexus/apps/<slug>
cp docker-compose.yml docker-compose.yml.bak      # before you edit
docker compose config                              # validate; catches YAML slips
docker compose up -d                               # recreates only what changed
```

Never `docker run` a replacement for a composed service — the next
`docker compose up` will not know about it and you will end up with two.

`docker compose down` stops and removes containers and the default network.
**`docker compose down -v` also deletes the named volumes**, which is the app's
data. Never add `-v` unless the owner asked for exactly that, in those words.

## Updating

```bash
cd <app dir>
docker compose pull
docker compose up -d
docker image prune -f        # only after you have confirmed it came back healthy
```

Pin image tags where you can. `:latest` turns "it worked yesterday" into an
unanswerable question.

## When something will not start

1. `docker compose ps` — is it exited or restarting?
2. `docker logs --tail 200 <name>` — the reason is almost always in here.
3. Port clash: `ss -ltnp | grep :<port>`.
4. Permissions on a bind mount: check `PUID`/`PGID` against `ls -ln` of the host
   path. "Permission denied" on a volume is nearly always this.
5. Disk full: `df -h`. A full disk presents as a dozen unrelated failures.
6. Image pull failed: check the tag actually exists.

## Housekeeping

```bash
docker system df                 # what is using the space
docker image prune -a            # images no container references
docker builder prune             # build cache
```

`docker system prune -a --volumes` will delete data for any stopped app. Do not
reach for it. Run the targeted ones and show the owner `docker system df` first.
