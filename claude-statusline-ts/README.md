# claude-statusline-ts

Statusline pour [Claude Code](https://claude.ai/code), écrite en TypeScript et exécutée
directement par Node 24, sans compilation. Elle affiche en bas de Claude Code l'état de la
session : dépôt git, dossier, modèle, coût, durée, contexte, limites d'usage et dépenses du jour.

```
main* ~2 • …/projets/alpha • Opus 4.5 [high] • S: $0.2 63k ⣿⣿⣿⣄⣀⣀⣀⣀⣀⣀ 31% (6m) • L: ⣿⣿⣿⣿⣤⣀⣀⣀⣀⣀ 43% (-5.8%) (3h8m) • D: $0.2
```

Branche (`*` = modifications, `~2` = fichiers indexés) • dossier • modèle [effort] •
**S**ession : coût, jetons, contexte, durée • **L**imite 5 h : utilisation, écart de rythme,
temps avant remise à zéro • **D**épenses du jour. La **W** (semaine) apparaît quand la limite
5 h dépasse 90 % (réglable).

## Laquelle choisir : `claude-statusline` ou `claude-statusline-ts` ?

| | `claude-statusline` (bash) | `claude-statusline-ts` (ce dossier) |
|---|---|---|
| Langage | bash + python3 | TypeScript, exécuté par Node 24 |
| Installation | une commande `curl` | clonage, `npm install`, une ligne dans `settings.json` |
| Branche git | nom seulement | nom, `*` si modifié, fichiers indexés / non indexés, lignes +/- |
| Coût, durée de la session | non | oui |
| Contexte | pourcentage | jetons, pourcentage, barre ; calcul depuis la transcription si besoin |
| Limites 5 h / 7 j | lues dans les données de Claude Code | lues via l'API d'usage (jeton OAuth), avec écart de rythme |
| Dépenses du jour, par projet, par mois | non | oui (base SQLite locale) |
| Personnalisation | modifier le script | configurateur interactif, 3 préréglages |
| Temps par rafraîchissement (mesuré) | ~40 ms | ~130 ms (+ un appel réseau par minute au plus) |
| Tests | aucun | 193 tests, 99,6 % des lignes couvertes |

Choisir la version bash pour une installation en une commande et le minimum d'accès.
Choisir celle-ci pour le détail git, le coût et le suivi des dépenses.

## Prérequis

- **Node.js 24.2 ou plus récent** (`node --version`). Node 24 exécute le TypeScript tel quel et
  fournit SQLite (`node:sqlite`) : aucune autre dépendance système.
- `npm` (livré avec Node) et `git`.
- Linux ou macOS. Windows n'a pas été testé.

## Installation

```bash
# 1. Récupérer le dossier
git clone https://github.com/merlintchoffo/claude-setup.git ~/claude-setup
cd ~/claude-setup/claude-statusline-ts

# 2. Installer les deux dépendances (picocolors, table) et les outils de test
npm install

# 3. Vérifier que tout fonctionne sur cette machine
npm test

# 4. Essayer avec la donnée d'exemple, dans un dossier de données jetable
#    (sinon la session d'exemple entrerait dans votre base des dépenses)
STATUSLINE_DATA_DIR=$(mktemp -d) node src/index.ts < fixtures/test-input.json
```

L'étape 4 lit déjà votre jeton et appelle l'API d'usage : les limites affichées sont les
vôtres (voir « Données et confidentialité »).

5. Déclarer la statusline dans `~/.claude/settings.json`, avec le **chemin absolu** du dossier :

```json
{
  "statusLine": {
    "type": "command",
    "command": "node /home/VOUS/claude-setup/claude-statusline-ts/src/index.ts",
    "padding": 0
  }
}
```

Si une statusline existe déjà (la version bash par exemple), remplacer son bloc `statusLine` :
une seule est active à la fois.

6. Redémarrer Claude Code.

## Personnaliser

```bash
npm run config
```

Ouvre un configurateur dans le terminal, avec un aperçu en direct :

| Touche | Action |
|---|---|
| ← → (ou h l) | changer d'onglet : Presets, Session, Limits, Weekly, Git, Global |
| ↑ ↓ (ou k j) | choisir une option |
| Entrée ou Espace | activer, désactiver ou faire défiler les valeurs |
| `s` | enregistrer sans quitter |
| `r` | revenir aux valeurs par défaut |
| `q` ou Ctrl+C | enregistrer et quitter |

Le résultat est écrit dans `statusline.config.json`, à la racine de ce dossier (non versionné).
Seules les valeurs présentes dans ce fichier remplacent celles de `defaults.json`. Un fichier
absent ou invalide revient aux valeurs par défaut, sans erreur.

## Commandes

| Commande | Ce qu'elle affiche |
|---|---|
| `npm run spend:today` | dépenses du jour, session par session. Une date en argument : `npm run spend:today -- 2026-11-20`, `-- 11-20` |
| `npm run spend:month` | dépenses du mois en cours, par jour |
| `npm run spend:project -- <fin du chemin>` | dépenses d'un projet, par exemple `-- alpha` |
| `npm run limits:weekly` | utilisation hebdomadaire comparée au temps écoulé |
| `npm test` | tous les tests |
| `npm run test:couverture` | tests et couverture, fichier par fichier |
| `npm run typecheck` | vérification des types |

## Comment ça marche

À chaque rafraîchissement, Claude Code lance `node src/index.ts` et lui envoie en JSON l'état de
la session sur l'entrée standard. La statusline :

1. **lit la configuration** : `defaults.json`, complété par `statusline.config.json` ;
2. **lit les limites d'usage** (`src/lib/features/limits/`) : depuis le cache s'il a moins d'une
   minute, sinon en appelant l'API d'usage d'Anthropic avec le jeton OAuth de Claude Code ;
3. **enregistre la session** dans la base locale (`src/lib/features/spend/`) : seul l'écart de
   coût depuis le passage précédent est compté, ce qui évite les doubles comptes après `/clear` ;
4. **interroge git** dans le dossier du projet (`src/lib/git.ts`), sans shell, avec un délai
   maximal de 2 secondes par commande ;
5. **calcule le contexte** : à partir des données de Claude Code, ou à défaut en relisant la
   transcription de la session (`src/lib/context.ts`) ;
6. **compose la ligne** (`src/lib/render-pure.ts`) et l'écrit sur la sortie standard.

En cas d'erreur, elle affiche `Error: …` à la place de la ligne et se termine normalement : Claude
Code n'est jamais bloqué.

**Désactiver une fonction** : supprimer son dossier (`src/lib/features/limits` ou
`src/lib/features/spend`). La statusline continue sans elle (comportement testé).

```
src/
├── index.ts                 point d'entrée (lu par Claude Code)
├── commands/interactive-config.ts   configurateur (npm run config)
└── lib/
    ├── config.ts            chargement et fusion de la configuration
    ├── context.ts           contexte calculé depuis la transcription
    ├── git.ts               état git
    ├── render-pure.ts       composition de la ligne (sans effet de bord)
    ├── formatters.ts        couleurs, barres, durées, chemins
    ├── sqlite.ts            adaptateur node:sqlite
    └── features/
        ├── limits/          limites d'usage (+ commande limits:weekly)
        └── spend/           base des dépenses (+ commandes spend:*)
```

## Données et confidentialité

À lire avant d'installer.

| Quoi | Où | Contenu |
|---|---|---|
| **Jeton OAuth de Claude Code** | lu dans `~/.claude/.credentials.json` (ou le trousseau macOS) | **lu, jamais écrit ni affiché.** Il sert à appeler `https://api.anthropic.com/api/oauth/usage`, au plus une fois par minute. Cette API n'est pas documentée publiquement : elle peut changer sans préavis, et les limites disparaissent alors de la ligne (sans erreur). |
| Base des dépenses | `data/statusline.db` | par session : identifiant, date, coût, durée, lignes ajoutées et supprimées, **chemin du projet**. Ni prompt ni contenu de conversation. |
| Cache des limites | `data/usage-limits-cache.json` | pourcentages d'utilisation et dates de remise à zéro, sans le jeton |
| Configuration | `statusline.config.json` | vos réglages d'affichage |

Rien d'autre n'est écrit. Le dossier `data/` est exclu de git. Pour ne plus lire le jeton,
supprimer `src/lib/features/limits/`.

## Tests

`npm test` lance 193 tests, sans réseau et sans toucher à vos données : chaque test travaille
dans un dossier temporaire (`STATUSLINE_DATA_DIR`, `STATUSLINE_CONFIG`, `HOME` isolés), le
jeton et l'API sont simulés, et git est testé sur de vrais dépôts temporaires. Les commandes
sont lancées comme par l'utilisateur ; le configurateur l'est dans un vrai pseudo-terminal
(commande `script`).

Couverture mesurée : 99,6 % des lignes, 94 % des branches. Les lignes non couvertes sont des
replis défensifs, ou du code testé sur une copie du projet que la mesure ne rattache pas au
fichier d'origine (désactivation d'une fonction par suppression de son dossier).

## Désinstaller

1. Retirer le bloc `statusLine` de `~/.claude/settings.json` (ou remettre celui de la version bash).
2. Supprimer le dossier `claude-statusline-ts` : base des dépenses et cache partent avec lui.

## Origine et licence

Portage de la statusline du projet **AIBlueprint** (`agents-config/scripts/statusline`, licence
MIT, voir [LICENSE-AIBLUEPRINT](LICENSE-AIBLUEPRINT)). Modifications principales :

- Bun remplacé par Node 24 (`node:sqlite`, `node:test`, `child_process`), tests convertis ;
- journal brut des données reçues et copie du dernier envoi supprimés ;
- git exécuté dans le dossier du projet affiché, sans shell, avec délai maximal ;
- niveau d'effort lu dans les données de Claude Code ;
- configurateur : enregistre dans le fichier que lit la statusline ; message clair hors terminal ;
- chemins `/home/...` raccourcis en `~/` dans les rapports (pas seulement `/Users/...`) ;
- configurations personnelles de l'auteur d'origine, code mort et migration de l'ancien format retirés ;
- 144 tests ajoutés aux 49 d'origine.
