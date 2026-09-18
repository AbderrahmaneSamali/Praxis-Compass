import { Pool } from 'pg';
import { StandaloneCareerCompass } from './compass/career-compass.service.js';
import { StandaloneRecommendationRepository } from './engine/recommendation.repository.js';

export * from './kernel/index.js';
export * from './evidence/learner-evidence.js';
export * from './assessment/assessment-handoff.js';
export * from './engine/recommendation-engine.js';
export * from './engine/recommendation.types.js';
export * from './engine/validation.js';
export * from './engine/learning-path-planner.js';
export * from './engine/recommendation.repository.js';
export * from './compass/career-compass.service.js';
export * from './compass/career-compass.types.js';

export type PraxisEngineConfig = {
  connectionString?: string;
  maxConnections?: number;
  ssl?: boolean;
};

export class PraxisEngine {
  readonly pool: Pool;
  readonly compass: StandaloneCareerCompass;
  readonly ranker: StandaloneRecommendationRepository;
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
    this.planner = this.ranker;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
