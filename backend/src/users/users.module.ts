import { Module } from '@nestjs/common';

/** Reserved for identity-provider-backed users. Administrative mutations are
 * currently protected with the optional ADMIN_API_KEY guard. */
@Module({})
export class UsersModule {}
