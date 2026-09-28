# Parcours d’exploration PRAXIS

L’interface locale en français suit cinq étapes : point de départ, possibilités, comparaison, carte des exigences et premier pas. Les pistes viennent du domaine sélectionné, des mobilités ROME, des centres d’intérêt explicitement confirmés et des savoir-faire partagés. Sans domaine, métier ni intérêt confirmé, le profil reste utilisable mais aucune piste n’est inventée. La carte complète est alphabétique; la sélection courte affiche les raisons de son ordre, sans score de transition.

Une confirmation directe d’une exigence avec contexte de pratique sélectionné est une **déclaration personnelle** de faible autorité. « Déjà pratiquée » donne l’état `supported`, « pas encore » donne `development_needed`, et l’absence de réponse reste `unknown`. Des déclarations actives contradictoires restent `conflicting`. ROME ne publie pas de niveau requis : aucun niveau de maîtrise ni score de compatibilité n’est déduit. Les preuves de compétences ESCO/PRAXIS ne sont pas converties en exigences ROME sans correspondance revue.

Dans « Mon point de départ », un questionnaire facultatif précise la motivation, la situation, le temps disponible, l’échéance et la pratique récente. Les questions suivantes dépendent des réponses précédentes : une situation « en poste » peut être déduite d’une évolution demandée par l’employeur, et le contexte de pratique n’est demandé que si une pratique est déclarée. Chaque réponse peut être passée; une question passée reste distincte d’une question sans réponse. Le questionnaire ne demande ni budget de formation, ni format de cours, ni langue de cours, et n’attribue aucun niveau de compétence.

## Saisie par choix uniquement

Le parcours ne contient aucun champ de saisie libre. Le métier se choisit dans les occupations de la base active. Les intérêts, compétences et exigences viennent aussi de la base. La migration 064 ajoute `praxis.learner_choice` pour les vocabulaires de situation, de pratique et de retour utilisateur. Les libellés sont affichés; les codes stables sont enregistrés et validés côté serveur.

La migration 065 enregistre le domaine cible dans `exploration_profile.preferred_domain_code`. Ce domaine est distinct du métier actuel et limite les pistes aux métiers que la source classe dans ce domaine. Le filtrage précède la limitation des candidats; les intérêts affinent le classement à l’intérieur du domaine. Un domaine seul suffit pour explorer. Une piste sans autre lien personnel est explicitement présentée comme une découverte du domaine. Les modifications du profil sont enregistrées avant de passer à l’exploration, pour éviter de montrer des résultats correspondant aux anciens choix.

La carte montre tous les métiers du périmètre par pages de quatre. Jusqu’à trois métiers peuvent être dépliés simultanément pour consulter leurs exigences et leurs compétences partagées. Les liens affichent leurs sources; les compétences permettent de retrouver d’autres métiers du périmètre. Le tableau donne accès aux mêmes données, avec filtres et pagination des exigences. Aucun intérêt non lié ne justifie un métier.

Le questionnaire v3 enregistre `context_survey_answer.option_id` et conserve les libellés présentés dans `context_survey_session.choice_catalog`. Les échéances utilisent des codes relatifs (`months_3`, etc.) et une date de session fixe. Les confirmations d’exigence et les instantanés de contexte enregistrent `practice_context_id`; les retours enregistrent `reason_id`. Les déclarations de compétences conservent le contexte dans leur provenance. Les anciens textes et sessions v2 restent en base; ils ne sont ni convertis automatiquement en catégories ni supprimés. Un nouveau questionnaire utilise v3.

## Démarrer

Installer les dépendances et configurer une base PostgreSQL PRAXIS. La base doit contenir les migrations 001–070, le ROME v61 de base, puis le supplément ROME chargé par `rome:exploration` avec l’archive `RefRomeCsv.zip` qui correspond au manifeste du release :

```powershell
Copy-Item .env.example .env
npm install
npm run migrate
npm run rome:exploration -- --source-zip C:\chemin\vers\RefRomeCsv.zip
npm run learner
```

Le serveur charge maintenant `.env` au démarrage. Ouvrir `http://127.0.0.1:4173/`. Il écoute seulement sur l’interface locale. Le cookie de session anonyme permet de retrouver son exploration dans le même navigateur pendant 30 jours; effacer le cookie fait perdre cet accès. Les requêtes de modification exigent un jeton CSRF et la même origine.

Sur une base fraîche, `npm run migrate` s’arrête volontairement aux migrations dont les références ESCO doivent d’abord être importées. Suivre l’ordre : migrations 001–028, import ESCO, identités PRAXIS nécessaires aux migrations 029/041, migrations restantes, import ROME v61, puis supplément ROME. Les scripts d’ingestion de la principale application PRAXIS peuvent lire ces archives en pointant explicitement `DATABASE_URL` vers cette base autonome. Ne jamais les lancer avec l’URL de `praxis_local` pour cette installation.

Pour une base de test vide dont le nom finit par `_test`, `node database/bootstrap-local.mjs` prépare le sous-ensemble ESCO nécessaire et applique les migrations. Importer ensuite ROME v61 et son supplément. Le bootstrap ESCO est partiel et n’est pas une importation officielle complète. La migration 058 conserve trois directions **éditoriales de démonstration** et leur état de sauvegarde; l’interface apprenant utilise désormais ROME comme source des pistes.

## API locale

Après `GET /api/bootstrap` (création de session et jeton CSRF) :

| Route | Usage |
|---|---|
| `GET /api/profile`, `POST /api/profile` | Lire et modifier le point de départ |
| `GET /api/occupation-choices`, `GET /api/rome/interests` | Charger les métiers, leurs domaines et les centres d’intérêt |
| `GET /api/learner-choices` | Charger les vocabulaires contrôlés de la base |
| `POST /api/rome/confirmations` | Confirmer une exigence avec `practiceContextId` si pratiquée |
| `GET /api/context-survey/latest`, `POST /api/context-survey/start` | Reprendre ou démarrer le questionnaire de contexte |
| `POST /api/context-survey/answer`, `POST /api/context-survey/back`, `POST /api/context-survey/complete` | Répondre, revenir en arrière et enregistrer un instantané de contexte |
| `POST /api/profile/skills` | Déclarer ou corriger un niveau avec un contexte sélectionné |
| `POST /api/explore`, `GET /api/directions/:id` | Explorer les directions et inspecter leurs exigences |
| `POST /api/exploration/graph` | Carte complète paginée, jusqu’à trois métiers dépliés, filtres d’exigences et sources des liens |
| `POST /api/directions/compare` | Comparer deux ou trois directions et leurs exigences communes ou propres |
| `POST /api/agent-gateway/compare` | Obtenir un résumé borné des états d’exigence, du contexte et des sources revues pour deux ou trois pistes de ce profil |
| `POST /api/exploration/saved` | Enregistrer ou retirer une direction |
| `POST /api/development-actions/selected` | Choisir une action sans créer de preuve de compétence |
| `GET /api/activities?codeRome=...` | Exercices versionnés disponibles pour ce métier, le pays choisi et cette session |
| `POST /api/activities/start` | Démarrer un exercice si ses prérequis explicites sont remplis |
| `POST /api/activities/submit` | Enregistrer des réponses par identifiants de choix et recevoir les résultats par critère |
| `GET /api/activities/attempts/:id` | Lire une tentative appartenant à cette session, même si sa version a été retirée |
| `POST /api/feedback` | Donner un retour de compréhension et d’utilité |

Les anciennes routes de recommandation et le catalogue éditorial restent disponibles séparément. Ils ne déterminent jamais les possibilités ROME affichées dans le parcours apprenant. Les actions choisies et les retours sont enregistrés dans des tables propres à ROME; ils ne créent aucune preuve de compétence.

## Passerelle de comparaison

La carte interactive et le tableau exposent tous les métiers du périmètre, avec une pagination distincte de la sélection courte. Les profils et exigences sont chargés par lots. Les métiers dépliés restent visibles lors d’un changement de page; toutes leurs exigences sont accessibles par pagination et filtrage. Chaque lien est traçable à sa source. La progression par niveau est implémentée avec des référentiels séparés par pays, mais les quatre contenus pilotes restent des brouillons et sont donc masqués. L’orchestration IA reste à implémenter; voir `career-explorer-implementation.md` pour la suite et la décision de couvrir séparément la France et le Maroc.

La passerelle de lecture utilise la session apprenant du serveur. Elle accepte uniquement `{"ids":["rome:...","rome:..."]}` avec deux ou trois identifiants distincts présents dans les pistes calculées pour ce profil. Son enchaînement fixe lit les pistes, les états d’exigence, les sources officielles ou revues, puis le contexte de carrière. Il n’expose ni SQL libre ni outil général appelable depuis le navigateur. Une limite de quatre lectures et de dix secondes s’applique à chaque demande.

La réponse contient des identifiants de source et des états, sans le texte libre du profil ni les exemples de travail. La migration 063 enregistre seulement l’identifiant apprenant, une empreinte des entrées, le résultat et les noms/durées des lectures. Une demande qui dépasse dix secondes est rejetée après la lecture en cours. Cette étape est déterministe : elle ne lance pas encore Gemma ni des spécialistes IA. Les pistes et les états continuent d’être calculés par le moteur existant.

## Assistance IA facultative

Le parcours par choix fonctionne sans fournisseur et n’affiche plus l’aide basée sur du texte libre. Les anciennes routes de proposition restent disponibles pour les intégrations existantes. Leur fournisseur peut être configuré par `PRAXIS_AI_ENDPOINT` et `PRAXIS_AI_TOKEN`; aucun appel à cette aide ne part du parcours apprenant actuel.

Le fournisseur ne fixe aucun niveau. Les propositions sont temporaires, limitées à cinq et liées à la session. Cette aide porte encore sur les compétences du catalogue éditorial PRAXIS; elle ne confirme pas automatiquement une exigence ROME. Les raisons ROME sont des objets structurés qui citent les identifiants des liens source.

## Vérification

```powershell
npm run typecheck
npm test
```

Pour les tests PostgreSQL, définir `PRAXIS_LEARNER_TEST_DATABASE_URL` vers une base migrée et chargée avec ROME, dédiée et finissant par `_test`, puis exécuter `npm run test:learner`. Le test nettoie uniquement les apprenants qu’il crée. Les données fictives de formations ne sont pas requises pour l’exploration.


## Niveaux de carrière

La migration 066 ajoute les choix France/Maroc et les parcours Expertise métier, Pilotage de projets et Management. Ces choix proviennent de la base. Le pays concerne le référentiel de progression ; les fiches métiers du catalogue restent celles de France Travail.

- `POST /api/career/preferences` : `marketCode` (`FR`, `MA` ou `null`) et `trackCode` (code proposé ou `null`).
- `GET /api/career/levels?codeRome=...` : uniquement pour un métier des possibilités de cette session. Renvoie `market_required`, `unavailable` ou `available`, les référentiels revus applicables et un éventuel objectif.
- `POST /api/career/goal` : `codeRome`, `frameworkId`, `trackCode`, `targetLevelCode`, `currentLevelCode` (facultatif via `null`). Les codes doivent appartenir au même référentiel, au pays choisi et au métier. Le niveau actuel reste une déclaration.
- `POST /api/career/goal/clear` : `codeRome`, retire l’objectif de ce métier pour le pays choisi.

Les brouillons et référentiels retirés ne sont jamais des choix apprenants. Une préférence de parcours ne crée pas d’équivalence entre expertise et management. Les objectifs sont conservés par métier et pays et ne créent aucune preuve de compétence. Les niveaux revus affichent un graphe de transitions explicites, un tableau accessible, les responsabilités, exigences, critères d’évaluation et sources. L’évaluation de préparation au niveau reste `not_assessed` ; le calcul des écarts détaillés appartient à l’étape suivante.

`npm run career:drafts` importe les propositions sans les publier et exporte le [dossier de revue](career-level-framework-review.md). Avec `PRAXIS_LEARNER_TEST_DATABASE_URL` vers une base dédiée migrée et chargée, `npm run test:career-levels` vérifie publication, immutabilité, isolation des pays et objectifs. Les publications fictives des tests sont annulées par rollback.


## Exercices de développement

La migration 067 et `npm run activities:pilots` installent six cas fictifs originaux, liés à cinq métiers pilotes de Banque/Finance. Ils sont proposés en France et au Maroc et clairement marqués « Exercice pilote ». Ils ne constituent ni des règles locales, ni des contenus revus par un spécialiste, ni une évaluation de niveau professionnel. Les référentiels de carrière restent en brouillon.

Dans « Mon point de départ », choisir France ou Maroc. Ouvrir un métier couvert, par exemple Gestionnaire des opérations sur les marchés financiers, puis « Choisir un premier pas ». Les anciennes cartes génériques sont remplacées par les exercices disponibles pour ce métier. Pour un métier non couvert, le parcours affiche l'absence de contenu explicite.

Chaque exercice fournit son cas, ses étapes et ses critères. Le bouton de démarrage et les réponses sont bloqués tant qu’un prérequis est manquant ou inconnu. Les réponses sont uniquement des identifiants d’options issus de la base. Après envoi, le résultat détaille chaque critère et le retour pédagogique. Une réussite sur le cas préalable ouvre la suite nommée, dans le même métier et le même pays.

- Démarrage : `codeRome`, `marketCode`, `activityId`.
- Envoi : mêmes champs, plus `requestKey` (UUID réutilisé lors d’une relance réseau identique) et `answers`, une liste de `{criterionCode, optionCode}`. Ni texte libre, ni résultat fourni par le client, ni identifiant d’un autre apprenant.
- Les états d’entrée sont `ready`, `needs_information`, `blocked`. Les prérequis ont leurs états propres `met`, `unmet`, `unknown`, `unavailable`.
- Les résultats sont `passed` ou `needs_practice`, toujours avec `evidenceKind: exercise_result` et `masteryEstablished: false`.
- Une ancienne réussite du même exercice/version suffit au prérequis. Une nouvelle tentative imparfaite ne l’efface pas. Une version retirée cesse toutefois de remplir une condition d’entrée active.

Les routes historiques de sélection restent compatibles avec les intégrations précédentes. Les nouvelles tentatives sont stockées séparément avec leur version, leur empreinte, l’état des prérequis au moment de l’envoi et les réponses normalisées. La correction ne fait aucun appel IA. Les agents futurs pourront lire ces faits via des outils bornés ; aucune exécution agentique n'est ajoutée dans cette étape.

## Development plan and replayable cases

Step 05, **Mon plan de développement**, now generates a target-specific plan from saved database facts. It shows every requirement, practice declarations, recorded exercise outcomes, available exact-ID assessed evidence, explicit exercise dependencies and missing catalogue coverage. An unknown requirement is not treated as zero, and an exercise pass does not award professional mastery.

Plans are captured in `development_plan_case` (migration 068), with source/version references, normalized input snapshots and input/output hashes. Identical inputs reuse the same case. Learners can inspect their older cases and verify a replay against the saved data. Historical cases are labelled and have no live action controls. An active source catalogue update does not rewrite saved cases.

Career-level requirements appear only for a selected reviewed goal in the chosen country. The real France/Morocco framework proposals are still drafts. The current plan therefore includes occupation requirements and available pilot exercises, with an explicit unavailable message for career levels.

Run `npm run test:development-plan` with `PRAXIS_LEARNER_TEST_DATABASE_URL` set to a dedicated migrated/source-loaded `_test` database. The integration fixtures do not publish real framework drafts.

## Rapport complet et PDF

L'étape 06, **Mon rapport**, propose tous les métiers du domaine choisi sous forme de cases à cocher issues de la base. L'apprenant choisit de un à trois métiers à analyser en détail. Aucun texte libre ni score n'est transmis par le navigateur. Le rapport conserve la liste complète des autres possibilités dans une annexe, avec leurs exigences et leurs sources.

La migration 069 enregistre un instantané immuable : sélection, contexte, version du catalogue, analyses détaillées, plans rejouables, exercices disponibles, empreinte et provenance. Les vues HTML et PDF utilisent les mêmes blocs validés. La consultation d'un ancien rapport conserve ses faits d'origine. Un rapport identique est réutilisé; un changement des faits crée un nouvel instantané. La suppression de l'apprenant efface ses rapports.

- `POST /api/reports` : `{ "targetCodes": ["C1302"] }`, de un à trois codes du domaine courant.
- `GET /api/reports/history?offset=0` : historique paginé de la session.
- `GET /api/reports/:id` : instantané de la session; `GET /reports/:id` : document HTML imprimable; `GET /api/reports/:id/pdf` : téléchargement PDF.
- `POST /api/reports/verify` : `{ "reportId": "..." }`, vérification des empreintes et du calcul enregistré.

Les quatre référentiels de niveau France/Maroc restent en brouillon et n'apparaissent pas dans les rapports apprenants. Les exercices disponibles sont identifiés comme pilotes; leur réussite n'est pas assimilée à une compétence professionnelle. `npm run test:career-reports` utilise la base de test dédiée définie par `PRAXIS_LEARNER_TEST_DATABASE_URL`.

## Lecture assistée du rapport

Après avoir créé un rapport, l'étape 06 permet de choisir ce dossier et de lancer volontairement une lecture assistée. Le modèle NVIDIA Gemma 4 31B IT peut demander uniquement des vues bornées du rapport enregistré : cibles, exigences, exercices et sources. Il propose un ordre de consultation et un jalon déjà disponible pour chaque cible. Les libellés et explications montrés proviennent du dossier vérifié; aucune prose libre du modèle n'est affichée comme fait.

L'analyse affiche son état, les appels au modèle et les lectures du dossier. L'apprenant peut annuler une analyse en cours. Le maximum est de quatre appels au modèle, trois lectures et 60 secondes. Une erreur ou une annulation ne modifie pas le rapport. Les analyses terminées et leur trace de métadonnées restent consultables pour la session.

- `GET /api/agent-runs/history?offset=0` : historique, disponibilité du fournisseur et limites.
- `POST /api/agent-runs` : `{ "reportId": "..." }`, lance une analyse uniquement sur un rapport de la session.
- `GET /api/agent-runs/:id` : état, résultat structuré et trace de la session.
- `POST /api/agent-runs/cancel` : `{ "runId": "..." }`, annule une analyse encore active.

Définir `NVIDIA_API_KEY` dans `.env` et redémarrer le serveur pour activer le fournisseur. La clé ne va jamais au navigateur. Les routes d'écriture conservent la validation de session, d'origine et de jeton CSRF. `npm run test:career-agent` utilise une base dédiée finissant par `_test` et un fournisseur simulé; il ne consomme aucun appel NVIDIA.

### Évaluation des parcours

`npm run evaluate:career-journeys` vérifie six parcours fictifs France/Maroc avec le vrai catalogue et les cas pilotes dans la base `_test`. La visibilité du métier de départ, les actions concrètes, les dépendances, la séparation des pays et les limites des affirmations sont vérifiées. Le lancement normal ne fait aucun appel NVIDIA. L'option `-- --with-nvidia` ajoute deux comparaisons bornées et prépare des dossiers A/B pour une revue indépendante. Voir [les attentes et le protocole](../evaluation/career-journeys/README.md).
