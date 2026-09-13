import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AdminApiKeyGuard } from '../auth/admin-api-key.guard';
import { SourcesService } from './sources.service';

@Controller('sources')
export class SourcesController {
  constructor(private readonly sources: SourcesService) {}
  @Get() list() { return this.sources.list(); }
  @Post(':name/collect') @UseGuards(AdminApiKeyGuard) collect(@Param('name') name: string) { return this.sources.collect(name); }
}
