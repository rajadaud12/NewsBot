import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Category, Prisma } from '@prisma/client';
import { WatchlistsService } from './watchlists.service';
import { AdminApiKeyGuard } from '../auth/admin-api-key.guard';

@Controller('watchlists')
export class WatchlistsController {
  constructor(private readonly watchlists: WatchlistsService) {}
  @Get() list() { return this.watchlists.list(); }
  @Post() @UseGuards(AdminApiKeyGuard) create(@Body() body: { name: string; description?: string; category?: Category }) { return this.watchlists.create(body); }
  @Post(':id/items') @UseGuards(AdminApiKeyGuard) add(@Param('id') id: string, @Body() body: { value: string; aliases?: string[]; metadata?: Prisma.InputJsonValue }) { return this.watchlists.addItem(id, body); }
  @Delete('items/:id') @UseGuards(AdminApiKeyGuard) remove(@Param('id') id: string) { return this.watchlists.removeItem(id); }
}
