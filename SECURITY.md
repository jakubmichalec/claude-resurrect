# Security policy

## Supported versions

Only the latest published version receives fixes.

## Reporting a vulnerability

Please do not open a public issue for security problems. Use GitHub's private
vulnerability reporting on this repository ("Security" tab, "Report a
vulnerability"). You will get an acknowledgement within a few days and a fix
or mitigation plan before any public disclosure.

What the extension touches: it appends session metadata (ids, working
directories, transcript paths, timestamps) to a log in your Claude config
directory, reads that log and Claude Code's session registry, reads the
conversation title and last prompt from the tail of a transcript to label a
session, and sends a `claude -r <id>` command to terminals it creates. It
stores nothing from transcripts and never sends anything over the network. Reports about a session id
or a setting value reaching a shell command unvalidated are especially welcome.
