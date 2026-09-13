import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    const attempts = Number(process.env.DATABASE_CONNECT_RETRIES ?? 15);
    const delayMs = Number(process.env.DATABASE_CONNECT_RETRY_MS ?? 2_000);
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        await this.$connect();
        if (attempt > 1) this.logger.log(`Connected to PostgreSQL on attempt ${attempt}`);
        return;
      } catch (error) {
        if (attempt === attempts) {
          const detail = error instanceof Error ? error.message : String(error);
          throw new Error(`PostgreSQL is unavailable after ${attempts} attempts. Run "npm run setup" and verify Docker Desktop is running. ${detail}`);
        }
        this.logger.warn(`PostgreSQL is not ready (attempt ${attempt}/${attempts}); retrying in ${delayMs}ms`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  async onModuleDestroy(): Promise<void> { await this.$disconnect(); }
}
