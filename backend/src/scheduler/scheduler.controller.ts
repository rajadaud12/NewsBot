import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AdminApiKeyGuard } from '../auth/admin-api-key.guard';
import { SchedulerService } from './scheduler.service';

@Controller('jobs')
export class SchedulerController {
  constructor(private readonly scheduler: SchedulerService) {}
  @Get() stats() { return this.scheduler.stats(); }
  @Post(':name') @UseGuards(AdminApiKeyGuard) run(@Param('name') name: string, @Body() body: Record<string, unknown>) { return this.scheduler.run(name, body); }
}
