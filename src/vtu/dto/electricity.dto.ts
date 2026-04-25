/**
 * src/vtu/dto/electricity.dto.ts
 *
 * DTOs for electricity vending operations
 */
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsNumber,
  IsInt,
  IsPositive,
  IsEmail,
  Min,
  Max,
  IsOptional,
} from "class-validator";

export enum MeterTypeEnum {
  PREPAID = "prepaid",
  POSTPAID = "postpaid",
}

/**
 * DTO for meter lookup request
 */
export class LookupMeterDto {
  @ApiProperty({
    description: "Meter number to lookup",
    example: "45067198783",
  })
  @IsString()
  @IsNotEmpty()
  meterNumber: string;

  @ApiProperty({
    description: "Type of meter (prepaid or postpaid)",
    enum: MeterTypeEnum,
    example: "prepaid",
  })
  @IsEnum(MeterTypeEnum)
  meterType: MeterTypeEnum;

  @ApiProperty({
    description: "Electricity provider code",
    example: "IE",
  })
  @IsString()
  @IsNotEmpty()
  provider: string;
}

/**
 * DTO for electricity purchase request
 */
export class PurchaseElectricityDto {
  @ApiPropertyOptional({
    description: "Reference from meter lookup",
    example: "IE-2505305db8e15f0ab62bb6",
  })
  @IsString()
  @IsOptional()
  providerReference?: string;

  @ApiProperty({
    description: "Amount to purchase in Naira",
    example: 5000,
  })
  @IsNumber()
  @IsInt({ message: 'Amount must be a whole number' })
  @IsPositive()
  @Min(100, { message: 'Minimum electricity purchase is ₦100' })
  @Max(500000, { message: 'Maximum electricity purchase is ₦500,000' })
  amount: number;

  @ApiProperty({
    description: "Customer phone number",
    example: "08031234567",
  })
  @IsString()
  @IsNotEmpty()
  phoneNumber: string;

  @ApiProperty({
    description: "Customer email address",
    example: "customer@example.com",
  })
  @IsEmail()
  email: string;

  @ApiProperty({
    description: "Meter number",
    example: "45067198783",
  })
  @IsString()
  @IsNotEmpty()
  meterNumber: string;

  @ApiProperty({
    description: "Meter type",
    enum: MeterTypeEnum,
    example: "prepaid",
  })
  @IsEnum(MeterTypeEnum)
  meterType: MeterTypeEnum;

  @ApiProperty({
    description: "Provider code",
    example: "IE",
  })
  @IsString()
  @IsNotEmpty()
  provider: string;

  @ApiProperty({
    description: "Customer name from lookup",
    example: "GALADIMA SHEHU MALAMI",
  })
  @IsString()
  @IsNotEmpty()
  customerName: string;

  @ApiPropertyOptional({
    description: "Customer address from lookup",
    example: "9 ADEYEMO STREET MAFOLUKU",
  })
  @IsString()
  @IsOptional()
  customerAddress?: string;
}

/**
 * Query params for fetching electricity purchases
 */
export class GetElectricityPurchasesDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  limit?: number = 20;

  @ApiPropertyOptional({ enum: ["PENDING", "SUCCESS", "FAILED", "REFUNDED"] })
  @IsOptional()
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  provider?: string;

  @ApiPropertyOptional()
  @IsOptional()
  meterNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  endDate?: string;
}
