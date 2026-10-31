# Existing hub navigation integration

The deployed hub is the static site at `C:\Tools\Dev\MTechLabs-Hub\site`, mounted
read-only into the existing `mtechlabs-hub` nginx container. Its host listener is
`127.0.0.1:20800`; the existing Cloudflare Tunnel reaches `http://mtechlabs-hub:80`.
This source was verified through Docker mounts. The `MulattoTech/M-TechLabs`
repository was not assumed to be the deployed website.

`navigation.patch` records exactly two inserted cards: Access Management and
Tacticus Code Watch. `index.html` is the resulting deployed snapshot. Existing
styling, scripts and application links were retained. No container restart was
required because the existing static bind mount serves the updated file.

The original file was backed up on the Windows host before editing:

```text
C:\Tools\Dev\MTechLabs-Hub\backups\index.pre-access-codes-20261031.html
```

To undo only the navigation change, restore that backup to the served
`site\index.html` after reviewing any subsequent site edits. The access Worker,
its dashboard and the Code Watch domain have separate recovery steps in
`docs/operations.md`; removing a navigation card does not revoke access.

Verified deployed index SHA-256:

```text
50b93260c99fc6176615520efbdb49576a8662835657eb697d7c9c78329e309d
```
