/**
 * VTU DTOs
 *
 * Data Transfer Objects for VTU (airtime/data) operations.
 */
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsString,
  IsNumber,
  IsInt,
  IsPositive,
  IsEnum,
  IsPhoneNumber,
  Min,
  Max,
  Matches,
  IsOptional,
} from "class-validator";
import { VtuNetwork } from "../schemas/vtu-purchase.schema";
import { PaginationDto } from "../../common/dto/pagination.dto";

// =====================
// Airtime
// =====================

export class PurchaseAirtimeDto {
  @ApiProperty({
    example: "MTN",
    description: "Network provider",
    enum: VtuNetwork,
  })
  @IsEnum(VtuNetwork)
  network: VtuNetwork;

  @ApiProperty({
    example: "08012345678",
    description: "Phone number to recharge",
  })
  @IsString()
  @Matches(/^(0[789][01]\d{8}|234[789][01]\d{8})$/, {
    message: "Invalid Nigerian phone number format",
  })
  phone: string;

  @ApiProperty({
    example: 1000,
    description: "Amount in Naira",
    minimum: 50,
    maximum: 50000,
  })
  @IsNumber()
  @IsInt({ message: 'Amount must be a whole number' })
  @IsPositive()
  @Min(50, { message: "Minimum airtime is ₦50" })
  @Max(50000, { message: "Maximum airtime is ₦50,000" })
  amount: number;
}

// =====================
// Data
// =====================

export class PurchaseDataDto {
  @ApiProperty({
    example: "MTN",
    description: "Network provider",
    enum: VtuNetwork,
  })
  @IsEnum(VtuNetwork)
  network: VtuNetwork;

  @ApiProperty({
    example: "08012345678",
    description: "Phone number to recharge",
  })
  @IsString()
  @Matches(/^(0[789][01]\d{8}|234[789][01]\d{8})$/, {
    message: "Invalid Nigerian phone number format",
  })
  phone: string;

  @ApiProperty({
    example: "mtn_1gb_30days",
    description: "Data plan code",
  })
  @IsString()
  planCode: string;
  @ApiProperty({
    description: "Amount in Naira (price of the plan)",
    example: 500,
  })
  @IsNumber()
  @IsInt({ message: 'Amount must be a whole number' })
  @IsPositive()
  amount: number;
}

// =====================
// Query DTOs
// =====================

export class DataPlansQueryDto {
  @ApiProperty({
    example: "MTN",
    description: "Network provider",
    enum: VtuNetwork,
  })
  @IsEnum(VtuNetwork)
  network: VtuNetwork;
}

export class VtuTransactionsQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    description: "Filter by type",
    enum: ["AIRTIME", "DATA"],
  })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional({
    description: "Filter by status",
    enum: ["PENDING", "SUCCESS", "FAILED", "REFUNDED"],
  })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({
    description: "Filter by network",
    enum: VtuNetwork,
  })
  @IsOptional()
  @IsEnum(VtuNetwork)
  network?: VtuNetwork;
}

// =====================
// Response Types
// =====================

export class NetworkResponse {
  @ApiProperty({ example: "MTN", enum: VtuNetwork })
  code: VtuNetwork;

  @ApiProperty({ example: "MTN Nigeria" })
  name: string;

  @ApiProperty({ example: true })
  airtimeAvailable: boolean;

  @ApiProperty({ example: true })
  dataAvailable: boolean;
}

export class DataPlanResponse {
  @ApiProperty({ example: "mtn_1gb_30days" })
  planCode: string;

  @ApiProperty({ example: "1GB Data" })
  name: string;

  @ApiProperty({ example: "1GB" })
  dataAmount: string;

  @ApiProperty({ example: "30 days" })
  validity: string;

  @ApiProperty({ example: 500 })
  price: number; // In Naira

  @ApiProperty({ example: "MTN" })
  network: VtuNetwork;
}

export class VtuPurchaseResponse {
  @ApiProperty({ example: "507f1f77bcf86cd799439011" })
  id: string;

  @ApiProperty({ example: "AIRTIME" })
  type: string;

  @ApiProperty({ example: "MTN" })
  network: VtuNetwork;

  @ApiProperty({ example: "08012345678" })
  phone: string;

  @ApiProperty({ example: 100000 })
  amount: number;

  @ApiProperty({ example: "VTU_LX1Y2Z_A1B2C3D4" })
  reference: string;

  @ApiProperty({ example: "PENDING" })
  status: string;

  @ApiProperty({ example: "2024-01-15T10:30:00.000Z" })
  createdAt: Date;
}

// =====================
// API Response DTOs
// =====================

export class NetworkResponseDto {
  @ApiProperty({ example: "MTN", enum: VtuNetwork })
  code: VtuNetwork;

  @ApiProperty({ example: "MTN Nigeria" })
  name: string;

  @ApiProperty({ example: true })
  airtimeAvailable: boolean;

  @ApiProperty({ example: true })
  dataAvailable: boolean;
}

export class DataPlanResponseDto {
  @ApiProperty({ example: "mtn_1gb_30days" })
  planCode: string;

  @ApiProperty({ example: "1GB Data" })
  name: string;

  @ApiProperty({ example: "1GB" })
  dataAmount: string;

  @ApiProperty({ example: "30 days" })
  validity: string;

  @ApiProperty({ example: 500 })
  price: number;

  @ApiProperty({ example: "MTN" })
  network: VtuNetwork;
}

class AirtimePurchaseData {
  @ApiProperty({ example: "VTU_A1B2C3D4" })
  reference: string;

  @ApiProperty({ example: "MTN" })
  network: string;

  @ApiProperty({ example: "08012345678" })
  phoneNumber: string;

  @ApiProperty({ example: 1000 })
  amount: number;

  @ApiProperty({ example: "SUCCESS" })
  status: string;

  @ApiProperty({ example: "2024-01-15T10:30:00.000Z" })
  createdAt: Date;
}

export class AirtimePurchaseResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: "Airtime purchase processed" })
  message: string;

  @ApiProperty({ type: AirtimePurchaseData })
  data: AirtimePurchaseData;
}

class DataPurchaseData {
  @ApiProperty({ example: "VTU_D1E2F3G4" })
  reference: string;

  @ApiProperty({ example: "MTN" })
  network: string;

  @ApiProperty({ example: "08012345678" })
  phoneNumber: string;

  @ApiProperty({ example: "mtn_1gb_30days" })
  planCode: string;

  @ApiProperty({ example: "1GB Data - 30 Days" })
  planName: string;

  @ApiProperty({ example: 500 })
  amount: number;

  @ApiProperty({ example: "SUCCESS" })
  status: string;

  @ApiProperty({ example: "2024-01-15T10:30:00.000Z" })
  createdAt: Date;
}

export class DataPurchaseResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: "Data purchase processed" })
  message: string;

  @ApiProperty({ type: DataPurchaseData })
  data: DataPurchaseData;
}
