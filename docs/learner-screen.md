# Learner screen and PostgreSQL verification

The French learner screen lets a learner choose a published, authored role, set budget, weekly hours, language and online format, declare skill levels with work examples, and view eligible courses and projected learning plans. Evidence and preferences persist in PostgreSQL. Unknown is a separate choice from an explicit level zero. Self-declarations remain low-confidence evidence and do not replace stronger validated evidence.

## Start with an existing database

Install dependencies and use a migrated Praxis database. Apply migration 051 after 050. Node 24 is verified here; native TypeScript commands below require Node 22.18 or newer.

```powershell
$env:DATABASE_URL = 'postgresql://USER:PASSWORD@HOST:PORT/DATABASE'
npm run migrate
npm run learner
```

Open http://127.0.0.1:4173/. The server binds to loopback. This is a local application preview, not a public deployment. Browser identity uses an anonymous HttpOnly cookie backed by a database session. POSTs require matching origin and CSRF token. Impressions are recorded only for results served to the current learner, once per request, including concurrent retries.

## Repeatable dedicated preview database

Create an empty database with a name ending in `_test`, then:

```powershell
$env:DATABASE_URL = 'postgresql://USER:PASSWORD@127.0.0.1:PORT/praxis_learner_test'
node --experimental-strip-types database/bootstrap-local.mjs
node database/seed-learner-preview.mjs
$env:PRAXIS_LEARNER_EXAMPLE = 'true'
npm run learner
```

The bootstrap applies all 51 migrations. Existing migrations depend on imported taxonomy identities. The bootstrap supplies the small required subset from the user's official ESCO 1.2.0 RDF archive, with its archive checksum and verified labels; it deliberately leaves this partial release inactive. It is not a complete ESCO graph import. The seed adds five clearly marked fictional offers solely to make the screen testable. These have no enrollment links and no real outcome claims. Example impressions are marked accordingly. Both setup scripts reject database names without the `_test` suffix.

## Integration tests

```powershell
$env:PRAXIS_TEST_DATABASE_URL = 'postgresql://USER:PASSWORD@127.0.0.1:PORT/praxis_integration_test'
npm run test:db
$env:PRAXIS_LEARNER_TEST_DATABASE_URL = $env:DATABASE_URL
npm run test:learner
```

The first test requires an empty database and rolls its fixtures back. The second requires the full migrated preview database and fictional seed; it removes only its own test learners. It verifies declarations, superseding old evidence, saved preferences, eligibility filtering, separate learner sessions, replay impressions, and rejected invalid or cross-origin requests.

## Assessment boundary

Set `PRAXIS_ASSESSMENT_URL` to an HTTPS host service to expose launch buttons for eligible assessment banks. The engine rechecks bank availability before launch. The external host owns identity binding, question delivery and scoring. The screen does not invent quiz results or turn CV mentions into demonstrated ability. Without a connected assessment host, learners can declare levels and provide work examples.

The screen does not upload or parse CV PDFs; the separate real-CV pilot measures extraction and linking. Production hosting, authenticated accounts and real verified course ingestion remain separate deployment work.
