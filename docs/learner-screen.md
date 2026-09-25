# Parcours d’exploration PRAXIS

L’interface locale en français suit cinq étapes : point de départ, possibilités, comparaison, carte des exigences et premier pas. Les pistes viennent des mobilités ROME, des centres d’intérêt explicitement confirmés et des savoir-faire partagés. Sans métier ROME ni intérêt confirmé, le profil reste utilisable mais aucune piste n’est inventée. L’ordre des mobilités reste celui de France Travail; les pistes fondées sur les savoir-faire communs sont alphabétiques, sans score de transition.

Une confirmation directe d’une exigence ROME avec exemple de travail est une **déclaration personnelle** de faible autorité. « Déjà pratiquée » donne l’état `supported`, « pas encore » donne `development_needed`, et l’absence de réponse reste `unknown`. Des déclarations actives contradictoires restent `conflicting`. ROME ne publie pas de niveau requis : aucun niveau de maîtrise ni score de compatibilité n’est déduit. Les preuves de compétences ESCO/PRAXIS ne sont pas converties en exigences ROME sans correspondance revue.

Dans « Mon point de départ », un questionnaire facultatif précise la motivation, la situation, le temps disponible, l’échéance et la pratique récente. Les questions suivantes dépendent des réponses précédentes : une situation « en poste » peut être déduite d’une évolution demandée par l’employeur, et l’exemple de travail n’est demandé que si une pratique est déclarée. Chaque réponse peut être passée; une question passée reste distincte d’une question sans réponse. Le questionnaire ne demande ni budget de formation, ni format de cours, ni langue de cours, et n’attribue aucun niveau de compétence. Les anciens champs non demandés sont conservés dans le nouvel instantané de contexte.

## Démarrer

Installer les dépendances et configurer une base PostgreSQL PRAXIS. La base doit contenir les migrations 001–062, le ROME v61 de base, puis le supplément ROME chargé par `rome:exploration` avec l’archive `RefRomeCsv.zip` qui correspond au manifeste du release :

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
| `GET /api/rome/origins?q=`, `GET /api/rome/interests` | Chercher un métier ROME et afficher les centres d’intérêt disponibles |
| `POST /api/rome/confirmations` | Confirmer directement une exigence ROME avec un exemple si pratiquée |
| `GET /api/context-survey/latest`, `POST /api/context-survey/start` | Reprendre ou démarrer le questionnaire de contexte |
| `POST /api/context-survey/answer`, `POST /api/context-survey/back`, `POST /api/context-survey/complete` | Répondre, revenir en arrière et enregistrer un instantané de contexte |
| `POST /api/profile/skills` | Déclarer ou corriger un niveau avec exemple concret |
| `POST /api/profile/proposals`, `POST /api/profile/confirmations` | Proposer puis confirmer explicitement des compétences issues du texte |
| `POST /api/explore`, `GET /api/directions/:id` | Explorer les directions et inspecter leurs exigences |
| `POST /api/directions/compare` | Comparer deux ou trois directions et leurs exigences communes ou propres |
| `POST /api/agent-gateway/compare` | Obtenir un résumé borné des états d’exigence, du contexte et des sources revues pour deux ou trois pistes de ce profil |
| `POST /api/exploration/saved` | Enregistrer ou retirer une direction |
| `POST /api/development-actions/selected` | Choisir une action sans créer de preuve de compétence |
| `POST /api/feedback` | Donner un retour de compréhension et d’utilité |

Les anciennes routes de recommandation et le catalogue éditorial restent disponibles séparément. Ils ne déterminent jamais les possibilités ROME affichées dans le parcours apprenant. Les actions choisies et les retours sont enregistrés dans des tables propres à ROME; ils ne créent aucune preuve de compétence.

## Passerelle de comparaison

La passerelle de lecture utilise la session apprenant du serveur. Elle accepte uniquement `{"ids":["rome:...","rome:..."]}` avec deux ou trois identifiants distincts présents dans les pistes calculées pour ce profil. Son enchaînement fixe lit les pistes, les états d’exigence, les sources officielles ou revues, puis le contexte de carrière. Il n’expose ni SQL libre ni outil général appelable depuis le navigateur. Une limite de quatre lectures et de dix secondes s’applique à chaque demande.

La réponse contient des identifiants de source et des états, sans le texte libre du profil ni les exemples de travail. La migration 063 enregistre seulement l’identifiant apprenant, une empreinte des entrées, le résultat et les noms/durées des lectures. Une demande qui dépasse dix secondes est rejetée après la lecture en cours. Cette étape est déterministe : elle ne lance pas encore Gemma ni des spécialistes IA. Les pistes et les états continuent d’être calculés par le moteur existant.

## Assistance IA facultative

Le flux manuel fonctionne sans fournisseur. Pour activer les propositions de compétences, configurer `PRAXIS_AI_ENDPOINT` avec une URL HTTPS et, si nécessaire, `PRAXIS_AI_TOKEN`. Le service doit accepter un `POST` JSON contenant `task`, `instructions`, `untrustedExperience` et `allowedSkills`, et retourner `{"proposals":[{"skillId":"...","supportingText":"extrait exact du texte"}]}`. L’appel est limité à 4,5 secondes. Une erreur, un schéma invalide, une compétence absente du catalogue ou un extrait absent du texte produit une réponse sans proposition; le formulaire manuel reste accessible.

Le fournisseur ne fixe aucun niveau. Les propositions sont temporaires, limitées à cinq et liées à la session. Cette aide porte encore sur les compétences du catalogue éditorial PRAXIS; elle ne confirme pas automatiquement une exigence ROME. Les raisons ROME sont des objets structurés qui citent les identifiants des liens source.

## Vérification

```powershell
npm run typecheck
npm test
```

Pour les tests PostgreSQL, définir `PRAXIS_LEARNER_TEST_DATABASE_URL` vers une base migrée et chargée avec ROME, dédiée et finissant par `_test`, puis exécuter `npm run test:learner`. Le test nettoie uniquement les apprenants qu’il crée. Les données fictives de formations ne sont pas requises pour l’exploration.
