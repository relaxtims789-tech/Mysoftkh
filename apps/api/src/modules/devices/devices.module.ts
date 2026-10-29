import { Module } from '@nestjs/common';
import { ChallengeService } from './challenge.service';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';

@Module({ controllers: [DevicesController], providers: [DevicesService, ChallengeService], exports: [DevicesService, ChallengeService] })
export class DevicesModule {}
