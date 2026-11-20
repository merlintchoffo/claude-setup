# claude-statusline

Statusline légère pour [Claude Code](https://claude.ai/code), en bash. Elle affiche en bas de
Claude Code le dossier, la branche git, le modèle, l'usage du contexte et les limites d'usage,
avec des barres de couleur. Elle n'écrit aucun fichier et ne fait aucun appel réseau : tout vient
des données que Claude Code lui transmet.

```
/claude-setup (main) Opus 4.5 [high] ctx [██████░░░░] 63% · 5h [████░░░░░░] 43% Reset in 3h8m 7d [███░░░░░░░] 35%
```

## Ce qu'elle affiche

| Segment | Contenu | Quand |
|---|---|---|
| `/claude-setup` | nom du dossier courant | toujours |
| `(main)` | branche git, ou identifiant court du commit si la tête est détachée | dans un dépôt git |
| `Opus 4.5 [high]` | modèle, puis niveau d'effort | effort : s'il est transmis |
| `ctx [███░░] 63%` | part du contexte utilisée : bleu jusqu'à 40 %, jaune jusqu'à 70 %, rouge au-delà | toujours (0 % en début de session) |
| `· 5h [███░░] 43% Reset in 3h8m` | limite sur 5 heures : vert jusqu'à 40 %, jaune jusqu'à 70 %, rouge au-delà ; temps avant remise à zéro | si Claude Code transmet cette limite |
| `7d [███░░] 35%` | limite sur 7 jours, mêmes couleurs | seulement à partir de 30 % |

Elle n'affiche ni coût, ni durée de session, ni dépenses, et ne se configure qu'en modifiant le
script. Pour ces fonctions, voir [claude-statusline-ts](../claude-statusline-ts/README.md).

## Installation

**Prérequis :** `bash`, `python3` (lecture du JSON reçu), `curl` (installation) ; `git` pour
afficher la branche. Standard sous Linux et macOS.

```bash
curl -fsSL https://raw.githubusercontent.com/merlintchoffo/claude-setup/main/claude-statusline/install.sh | bash
```

Puis redémarrer Claude Code.

Ce que fait `install.sh` :

1. crée `~/.claude` s'il n'existe pas ;
2. télécharge `statusline-command.sh` dans `~/.claude/` ;
3. sauvegarde `~/.claude/settings.json` (s'il existe) en `settings.json.bak`, puis y écrit le bloc
   `statusLine`, en remplaçant celui qui existait. Si `settings.json` n'est pas un JSON valide, il
   s'arrête sans le modifier (le script, lui, est déjà téléchargé).

> **macOS — Xcode Command Line Tools :** si `git` n'a jamais servi sur la machine, macOS
> interrompt l'installation pour installer ces outils. Accepter, attendre la fin, puis relancer
> la commande `curl`.

## Fonctionnement

À chaque rafraîchissement, Claude Code lance `bash ~/.claude/statusline-command.sh` et lui envoie
l'état de la session en JSON sur l'entrée standard. Le script :

1. lit le JSON avec `python3` : dossier, modèle, niveau d'effort, usage du contexte, limites 5 h
   et 7 jours avec leur date de remise à zéro. Si le pourcentage de contexte manque, il le calcule
   à partir des jetons ;
2. lit la branche avec `git symbolic-ref` (ou l'identifiant court du commit) ;
3. compose les segments et les écrit, séparés par une espace.

Mesure sur ce poste : environ 40 ms par rafraîchissement.

## Désinstaller

Retirer le bloc `statusLine` de `~/.claude/settings.json` (ou restaurer `settings.json.bak`),
puis supprimer `~/.claude/statusline-command.sh`.
