# Nexus

Nexus is a self-hosted control surface for one Linux mini PC, used by its owner on a home network. The implemented app uses Node.js, Express, plain JavaScript, CSS, and vendored xterm.js; there is no frontend build step. `docs/HACKING.md` documents its operating constraints. `docs/DESIGN.md` is a historical proposal, not the implemented architecture.

The owner checks live metrics, arranges persistent widgets, manages Docker containers and app libraries, browses and uploads files, opens a terminal, and configures watch rules and schedules. Real server readings, unavailable states, and destructive-action confirmations must survive visual changes. Accounts, server settings, stored layouts, and service controls are outside the theme migration.

Current brief: replace the GUI with a professional, clean, cozy retro workstation aesthetic, three palettes selectable in Settings, cohesive controls and restrained motion. Keep the lightweight runtime and responsive phone/tablet/desktop behavior. Preserve the Server Cat and its real metric-driven moods. Provide a verified GUI backup and a one-command recovery route. Theme selection and display preferences belong to the browser, not server data.
