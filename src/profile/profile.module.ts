import { Module } from '@nestjs/common';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';
import { MediaKitImportService } from './media-kit-import.service';
import { AiAnalysisService } from '../influencers/ai-analysis.service';

@Module({
  controllers: [ProfileController],
  providers: [ProfileService, MediaKitImportService, AiAnalysisService],
})
export class ProfileModule {}
