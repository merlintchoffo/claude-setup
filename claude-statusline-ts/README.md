# claude-statusline-ts

Statusline pour [Claude Code](https://claude.ai/code), écrite en TypeScript et exécutée
directement par Node 24, sans compilation. Elle affiche en bas de Claude Code l'état de la
session : dépôt git, dossier, modèle, coût, durée, contexte, limites d'usage et dépenses du jour.

## Ce qui s'affiche

Exemple réel, avec la configuration par défaut :

```
main* ~2 ~1 • …/projets/alpha • Opus 4.5 [high] • S: $1.8 91k ⣿⣿⣿⣿⣶⣀⣀⣀⣀⣀ 46% (47m) • L: ⣿⣿⣿⣿⣿⣿⣄⣀⣀⣀ 62% (+8.0%) (1h29m) • D: $1.8
```

Lecture : dans le dépôt `main`, avec des modifications (2 fichiers indexés, 1 modifié non
indexé), dossier `projets/alpha`, modèle Opus 4.5 en effort `high`. La session a coûté 1,80 USD,
occupe 91 000 jetons, soit 46 % du contexte, et dure depuis 47 minutes. La limite sur 5 heures
est utilisée à 62 % : il reste 8 points de marge sur le rythme régulier, et elle se remet à zéro
dans 1 h 29. Les dépenses du jour s'élèvent à 1,80 USD.

Les parties sont séparées par `•`. De gauche à droite :

### Git

| Affiché | Signification |
|---|---|
| `main` | branche courante ; `detached` si la tête est détachée ; `no-git` hors dépôt |
| `*` (violet), collé à la branche | modifications non commitées (indexées ou non) |
| `~2` (gris) | nombre de fichiers **indexés** (`git add`), prêts à être commités |
| `~1` (jaune) | nombre de fichiers **modifiés non indexés** |
| `+12 -3` (vert / rouge) | lignes ajoutées / supprimées, indexées et non indexées confondues. Masqué par défaut (`showChanges`) |

### Dossier et modèle

| Affiché | Signification |
|---|---|
| `…/projets/alpha` | deux derniers dossiers du chemin ; `~` remplace le dossier personnel. Réglable : chemin complet ou dernier dossier seul |
| `Opus 4.5 [high]` | modèle utilisé, puis niveau d'effort entre crochets. Le nom est masqué quand c'est un Sonnet (`showSonnetModel`) |

### `S:`, la session en cours

| Affiché | Signification |
|---|---|
| `$1.8` | coût de la session depuis son début, en dollars, arrondi au dixième |
| `91k` | jetons occupés dans le contexte (`k` = milliers, `m` = millions) |
| `⣿⣿⣿⣿⣶⣀⣀⣀⣀⣀` | barre de remplissage du contexte (voir « Barres et couleurs ») |
| `46%` | part de la fenêtre de contexte occupée. Claude Code compacte automatiquement la conversation avant 100 % |
| `(47m)` | durée de la session (`1h 5m` au-delà d'une heure) |
| `S: -` | pas encore de données de contexte (session qui démarre) |

### `L:`, la limite d'usage sur 5 heures

| Affiché | Signification |
|---|---|
| `⣿⣿⣿⣿⣿⣿⣄⣀⣀⣀` `62%` | part de la limite 5 h déjà consommée |
| `(+8.0%)` | **écart de rythme** : part du temps écoulé dans la fenêtre, moins part consommée. **Positif = marge** (vous consommez moins vite que le temps ne passe) ; **négatif = vous allez trop vite**, et la limite sera atteinte avant la remise à zéro à ce rythme |
| `(1h29m)` | temps avant la remise à zéro de la fenêtre |

Exemple : à 3 h 30 d'une fenêtre de 5 h (70 % du temps écoulé), avec 62 % consommés, l'écart vaut
70 − 62 = **+8,0**. Couleur de l'écart : vert au-delà de +5, gris entre 0 (exclu) et +5, jaune de 0 à −10,
rouge en dessous de −10.

### `W:`, la limite sur 7 jours

```
… • L: ⣿⣿⣿⣿⣿⣿⣄⣀⣀⣀ 62% (+8.0%) (1h29m) • W: ⣿⣿⣿⣿⣷⣀⣀⣀⣀⣀ 48% (+4.4%) (79h59m) • D: $1.8
```

Même lecture que `L:`, sur la fenêtre hebdomadaire ; le temps restant est en heures. **Par défaut,
`W:` n'apparaît que lorsque la limite 5 h dépasse 90 %** : c'est alors que la limite hebdomadaire
devient utile à surveiller. Réglable sur « toujours » ou « jamais » (`npm run config`, onglet Weekly).

### `D:`, les dépenses du jour

`$1.8` : total du jour, toutes sessions et tous projets confondus, d'après la base locale. Le
coût de chaque session n'est compté qu'une fois : après un `/clear`, la nouvelle session reprend
le coût cumulé de l'ancienne, et seul le dépassement est ajouté. La partie disparaît tant que le
total vaut 0. Pour le détail : `npm run spend:today`.

### Messages particuliers

| Affiché | Signification |
|---|---|
| `Thinking: OFF` (rouge) | la réflexion étendue est désactivée dans `~/.claude/settings.json` (`alwaysThinkingEnabled: false`) |
| `Error: …` puis `Check statusline configuration` | la statusline n'a pas pu se calculer (données reçues illisibles, par exemple). Claude Code continue de fonctionner normalement |
| `L:` absent | limites non disponibles : pas de jeton, API injoignable ou fonction désactivée |

### Barres et couleurs

Chaque barre fait 10 cases. `⣿` est une case pleine et `⣀` une case vide ; les caractères
intermédiaires (`⣄ ⣤ ⣦ ⣶ ⣷`) remplissent une case par sixièmes, pour plus de précision. Couleur
de la barre selon le pourcentage : **gris** sous 50 %, **jaune** de 50 à 69 %, **orange** de 70 à
89 %, **rouge** à partir de 90 %. Le style (`braille`, `filled` `█░`, `rectangle`), la longueur et
les couleurs se règlent avec `npm run config`.

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
| Tests | aucun | 194 tests, 99,6 % des lignes couvertes |

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

`npm test` lance 194 tests, sans réseau et sans toucher à vos données : chaque test travaille
dans un dossier temporaire (`STATUSLINE_DATA_DIR`, `STATUSLINE_CONFIG`, `HOME` isolés), le
jeton et l'API sont simulés, et git est testé sur de vrais dépôts temporaires. Les commandes
sont lancées comme par l'utilisateur ; le configurateur l'est dans un vrai pseudo-terminal
(commande `script`).

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
- configurateur : enregistre dans le fichier que lit la statusline ; message clair hors terminal.
