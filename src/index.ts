import { Pool } from 'pg';
import { StandaloneCareerCompass } from './compass/career-compass.service.js';
import { StandaloneRecommendationRepository } from './engine/recommendation.repository.js';
import { SkillConfirmationRepository } from './confirmation/skill-confirmation.repository.js';
import { AssessmentIrtRepository } from './assessment/irt-posterior.repository.js';
import { AssessmentItemAuthoringRepository } from './assessment/item-drafting.repository.js';
import { LaborMarketRepository } from './labor-market/labor-market.repository.js';
import { TaskNetworkCrosswalkRepository } from './crosswalk/task-network-crosswalk.repository.js';
import { GraphSequentialExperimentRepository } from './experiments/graph-sequential-evaluation.repository.js';

export * from './kernel/index.js';
export * from './evidence/learner-evidence.js';
export * from './assessment/assessment-handoff.js';
export * from './assessment/irt-posterior.js';
export * from './assessment/irt-posterior.repository.js';
export * from './assessment/item-drafting.js';
export * from './assessment/item-drafting.repository.js';
export * from './extraction/esco-skill-linker.js';
export * from './confirmation/learner-skill-confirmation.js';
export * from './confirmation/skill-confirmation.repository.js';
export * from './labor-market/bias-corrected-ingestion.js';
export * from './labor-market/labor-market.repository.js';
export * from './crosswalk/task-network-crosswalk.js';
export * from './crosswalk/task-network-crosswalk.repository.js';
export * from './experiments/graph-sequential-evaluation.js';
export * from './experiments/graph-sequential-evaluation.repository.js';
export * from './engine/recommendation-engine.js';
export * from './engine/recommendation.types.js';
export * from './engine/validation.js';
export * from './engine/learning-path-planner.js';
export * from './engine/recommendation.repository.js';
export * from './compass/career-compass.service.js';
export * from './compass/career-compass.types.js';
export * from './exploration/exploration.types.js';
export * from './exploration/exploration.service.js';
export * from './exploration/exploration.repository.js';
export * from './exploration/skill-gap-analysis.js';
export * from './exploration/development-actions.js';
export * from './ai/profile-intake.js';

export type PraxisEngineConfig = {
  connectionString?: string;
  maxConnections?: number;
  ssl?: boolean;
};

export class PraxisEngine {
  readonly pool: Pool;
  readonly compass: StandaloneCareerCompass;
  readonly ranker: StandaloneRecommendationRepository;
  readonly confirmations: SkillConfirmationRepository;
  readonly assessments: AssessmentIrtRepository;
  readonly itemAuthoring: AssessmentItemAuthoringRepository;
  readonly laborMarket: LaborMarketRepository;
  readonly taskCrosswalks: TaskNetworkCrosswalkRepository;
  readonly recommenderExperiments: GraphSequentialExperimentRepository;
  readonly planner: Pick<StandaloneRecommendationRepository, 'plan'>;

  constructor(config: PraxisEngineConfig = {}) {
    const connectionString =
      config.connectionString ??
      process.env.DATABASE_URL ??
      'postgresql://praxis_local:local_only_change_me@127.0.0.1:5432/praxis_local';

    this.pool = new Pool({
      connectionString,
      max: config.maxConnections ?? 10,
      ssl: config.ssl ? { rejectUnauthorized: true } : undefined,
    });

    this.compass = new StandaloneCareerCompass(this.pool);
    this.ranker = new StandaloneRecommendationRepository(this.pool);
    this.confirmations = new SkillConfirmationRepository(this.pool);
    this.assessments = new AssessmentIrtRepository(this.pool);
    this.itemAuthoring = new AssessmentItemAuthoringRepository(this.pool);
    this.laborMarket = new LaborMarketRepository(this.pool);
    this.taskCrosswalks = new TaskNetworkCrosswalkRepository(this.pool);
    this.recommenderExperiments = new GraphSequentialExperimentRepository(this.pool);
    this.planner = this.ranker;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
