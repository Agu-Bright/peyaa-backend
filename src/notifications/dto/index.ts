import { IsString, IsEnum, IsNotEmpty, IsOptional, IsBoolean, IsMongoId, ValidateIf, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type, Transform } from 'class-transformer';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { NotificationType } from '../schemas/user-notification.schema';
import {
  NotificationChannel,
  BroadcastRecipientGroup,
  BroadcastStatus,
} from '../schemas/notification-log.schema';

export class RegisterTokenDto {
  @ApiProperty({ example: 'ExponentPushToken[xxxx]' })
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiProperty({ enum: ['ios', 'android'], example: 'ios' })
  @IsEnum(['ios', 'android'])
  platform: string;
}

export class UnregisterTokenDto {
  @ApiProperty({ example: 'ExponentPushToken[xxxx]' })
  @IsString()
  @IsNotEmpty()
  token: string;
}

export class NotificationInboxQueryDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Filter by type', enum: NotificationType })
  @IsOptional()
  @IsEnum(NotificationType)
  type?: NotificationType;

  @ApiPropertyOptional({ description: 'Filter by read status' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  isRead?: boolean;
}

/**
 * Admin: send a broadcast (push or email) to a user group.
 */
export class SendBroadcastDto {
  @ApiProperty({ enum: NotificationChannel, example: NotificationChannel.PUSH })
  @IsEnum(NotificationChannel)
  type: NotificationChannel;

  @ApiProperty({ enum: BroadcastRecipientGroup, example: BroadcastRecipientGroup.ALL })
  @IsEnum(BroadcastRecipientGroup)
  recipients: BroadcastRecipientGroup;

  @ApiProperty({ example: 'New feature: gift card trading' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  subject: string;

  @ApiProperty({ example: 'You can now trade gift cards instantly...' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  body: string;

  @ApiPropertyOptional({ description: 'Required when recipients = individual' })
  @ValidateIf((o) => o.recipients === BroadcastRecipientGroup.INDIVIDUAL)
  @IsMongoId()
  @IsNotEmpty()
  targetUserId?: string;
}

/**
 * Admin: paginated query for notification history.
 */
export class NotificationHistoryQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: NotificationChannel })
  @IsOptional()
  @IsEnum(NotificationChannel)
  type?: NotificationChannel;

  @ApiPropertyOptional({ enum: BroadcastStatus })
  @IsOptional()
  @IsEnum(BroadcastStatus)
  status?: BroadcastStatus;
}
