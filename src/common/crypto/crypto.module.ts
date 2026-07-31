import { Global, Module } from '@nestjs/common';
import { TokenCryptoService } from './token-crypto.service';

// Global so any service (platform-connect, tracking) can inject TokenCryptoService
// without per-module wiring — same pattern as PrismaModule.
@Global()
@Module({
  providers: [TokenCryptoService],
  exports: [TokenCryptoService],
})
export class CryptoModule {}
