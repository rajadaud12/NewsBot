import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AdminApiKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}
  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get<string>('adminApiKey', '');
    if (!expected) return true;
    const supplied = context.switchToHttp().getRequest<{ headers: Record<string, string> }>().headers['x-admin-api-key'];
    if (supplied !== expected) throw new UnauthorizedException('A valid X-Admin-Api-Key header is required');
    return true;
  }
}
