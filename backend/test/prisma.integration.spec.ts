import { PrismaClient, Severity } from '@prisma/client';

const describeDatabase = process.env.TEST_DATABASE_URL ? describe : describe.skip;

describeDatabase('Prisma database integration', () => {
  const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
  afterAll(async () => prisma.$disconnect());
  it('persists and reads a system log record', async () => {
    const record = await prisma.systemLog.create({ data: { component: 'integration-test', message: 'database round trip', level: Severity.INFO } });
    const found = await prisma.systemLog.findUnique({ where: { id: record.id } });
    expect(found?.message).toBe('database round trip');
    await prisma.systemLog.delete({ where: { id: record.id } });
  });
});
