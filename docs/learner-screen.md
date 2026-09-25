# Parcours d’exploration PRAXIS

L’interface locale en français suit cinq étapes : point de départ, possibilités, comparaison, carte de compétences et premier pas. Une personne peut explorer sans remplir son profil. Les exigences absentes restent **non connues**; un niveau explicitement déclaré plus bas apparaît **à développer**. Une déclaration reste une preuve de faible autorité, même si son niveau répond à l’exigence.

## Démarrer

Installer les dépendances, configurer une base PostgreSQL PRAXIS, puis appliquer la migration additive `058_career_exploration.sql` avec le reste du schéma :

```powershell
Copy-Item .env.example .env
npm install
npm run migrate
npm run learner
```

Le serveur charge maintenant `.env` au démarrage. Ouvrir `http://127.0.0.1:4173/`. Il écoute seulement sur l’interface locale. Le cookie de session anonyme permet de retrouver son exploration dans le même navigateur pendant 30 jours; effacer le cookie fait perdre cet accès. Les requêtes de modification exigent un jeton CSRF et la même origine.

Pour créer une base locale de test dédiée, utiliser une base vide dont le nom finit par `_test`, puis exécuter `node --experimental-strip-types database/bootstrap-local.mjs`. Ce bootstrap demande les fichiers ESCO indiqués dans `database/local-esco-prerequisites.json` et charge seulement le sous-ensemble nécessaire; il ne constitue pas une importation ESCO complète. La migration 058 ajoute trois directions **de démonstration** basées sur les profils de compétences éditoriaux préexistants. Leurs descriptions, responsabilités et niveaux exigent une revue métier avant un usage décisionnel. Aucune formation n’est nécessaire pour les explorer.

## API locale

Après `GET /api/bootstrap` (création de session et jeton CSRF) :

| Route | Usage |
|---|---|
| `GET /api/profile`, `POST /api/profile` | Lire et modifier le point de départ |
| `POST /api/profile/skills` | Déclarer ou corriger un niveau avec exemple concret |
| `POST /api/profile/proposals`, `POST /api/profile/confirmations` | Proposer puis confirmer explicitement des compétences issues du texte |
| `POST /api/explore`, `GET /api/directions/:id` | Explorer les directions et inspecter leurs exigences |
| `POST /api/directions/compare` | Comparer deux ou trois directions |
| `POST /api/exploration/saved` | Enregistrer ou retirer une direction |
| `POST /api/development-actions/selected` | Choisir une action sans créer de preuve de compétence |
| `POST /api/feedback` | Donner un retour de compréhension et d’utilité |

Les anciennes routes de recommandation restent disponibles pour l’usage optionnel du classement de formations. Elles ne déterminent jamais les possibilités d’exploration.

## Assistance IA facultative

Le flux manuel fonctionne sans fournisseur. Pour activer les propositions de compétences, configurer `PRAXIS_AI_ENDPOINT` avec une URL HTTPS et, si nécessaire, `PRAXIS_AI_TOKEN`. Le service doit accepter un `POST` JSON contenant `task`, `instructions`, `untrustedExperience` et `allowedSkills`, et retourner `{"proposals":[{"skillId":"...","supportingText":"extrait exact du texte"}]}`. L’appel est limité à 4,5 secondes. Une erreur, un schéma invalide, une compétence absente du catalogue ou un extrait absent du texte produit une réponse sans proposition; le formulaire manuel reste accessible.

Le fournisseur ne fixe aucun niveau. Les propositions sont temporaires, limitées à cinq et liées à la session. Seule une confirmation explicite avec niveau et exemple crée une preuve `self_declared` de faible autorité. Les explications et actions visibles proviennent des exigences structurées et sont générées de façon déterministe.

## Vérification

```powershell
npm run typecheck
npm test
```

Pour les tests PostgreSQL, définir `PRAXIS_LEARNER_TEST_DATABASE_URL` vers une base migrée dédiée finissant par `_test`, puis exécuter `npm run test:learner`. Le test nettoie uniquement les apprenants qu’il crée. Une vérification de la page dans un navigateur exige cette même base en cours d’exécution. Les données fictives de formations créées par `database/seed-learner-preview.mjs` ne sont utiles qu’aux anciennes routes de classement et ne sont pas requises pour l’exploration.
