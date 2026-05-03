/**
 * Uploads Service
 *
 * Handles file uploads to Cloudinary and Cloudflare R2.
 */
import {
  Injectable,
  Logger,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary, UploadApiResponse, UploadApiErrorResponse } from 'cloudinary';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import * as streamifier from 'streamifier';
import { randomUUID } from 'crypto';
import * as path from 'path';

export interface UploadResult {
  url: string;
  publicId: string;
  format: string;
  bytes: number;
}

@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);
  private readonly s3Client: S3Client;
  private readonly r2Bucket: string;
  private readonly r2PublicUrl: string;

  constructor(private readonly configService: ConfigService) {
    // Configure Cloudinary
    cloudinary.config({
      cloud_name: this.configService.get<string>('CLOUDINARY_CLOUD_NAME'),
      api_key: this.configService.get<string>('CLOUDINARY_API_KEY'),
      api_secret: this.configService.get<string>('CLOUDINARY_API_SECRET'),
    });

    // Configure Cloudflare R2 (S3-compatible)
    const accountId = this.configService.get<string>('R2_ACCOUNT_ID', '');
    this.r2Bucket = this.configService.get<string>('R2_BUCKET_NAME', 'peyaa');
    this.r2PublicUrl = this.configService.get<string>('R2_PUBLIC_URL', '');
    this.s3Client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: this.configService.get<string>('R2_ACCESS_KEY_ID', ''),
        secretAccessKey: this.configService.get<string>('R2_SECRET_ACCESS_KEY', ''),
      },
    });
  }

  /**
   * Upload a file to Cloudinary
   */
  async uploadFile(
    file: Express.Multer.File,
    folder: string = 'uploads',
  ): Promise<UploadResult> {
    // Validate file
    if (!file || !file.buffer) {
      throw new BadRequestException('No file provided');
    }

    // Validate file type (images only for gift card proofs)
    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        `Invalid file type. Allowed: ${allowedMimeTypes.join(', ')}`,
      );
    }

    // Validate file size (max 10MB)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      throw new BadRequestException('File size exceeds 10MB limit');
    }

    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder,
          resource_type: 'image',
          transformation: [
            { quality: 'auto:good' }, // Optimize quality
            { fetch_format: 'auto' }, // Auto format
          ],
        },
        (error: UploadApiErrorResponse | undefined, result: UploadApiResponse | undefined) => {
          if (error) {
            this.logger.error('Cloudinary upload error', error);
            reject(new InternalServerErrorException('Failed to upload file'));
            return;
          }

          if (!result) {
            reject(new InternalServerErrorException('Upload returned no result'));
            return;
          }

          this.logger.log(`File uploaded: ${result.public_id}`);

          resolve({
            url: result.secure_url,
            publicId: result.public_id,
            format: result.format,
            bytes: result.bytes,
          });
        },
      );

      // Stream the file buffer to Cloudinary
      streamifier.createReadStream(file.buffer).pipe(uploadStream);
    });
  }

  /**
   * Upload a gift card proof image to Cloudflare R2
   */
  async uploadGiftCardProof(file: Express.Multer.File): Promise<UploadResult> {
    return this.uploadToR2(file, 'giftcard-proofs', 10);
  }

  /**
   * Upload a KYC document (selfie or government ID) to Cloudflare R2.
   * Higher size cap (15 MB) to allow good-quality phone photos.
   */
  async uploadKycPhoto(file: Express.Multer.File): Promise<UploadResult> {
    return this.uploadToR2(file, 'kyc', 15);
  }

  /**
   * Delete a file from Cloudinary
   */
  async deleteFile(publicId: string): Promise<boolean> {
    try {
      const result = await cloudinary.uploader.destroy(publicId);
      this.logger.log(`File deleted: ${publicId}`);
      return result.result === 'ok';
    } catch (error) {
      this.logger.error('Cloudinary delete error', error);
      return false;
    }
  }

  /**
   * Upload a file to Cloudflare R2
   */
  async uploadToR2(
    file: Express.Multer.File,
    folder: string = 'uploads',
    maxSizeMb: number = 5,
  ): Promise<UploadResult> {
    if (!file || !file.buffer) {
      throw new BadRequestException('No file provided');
    }

    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        `Invalid file type. Allowed: ${allowedMimeTypes.join(', ')}`,
      );
    }

    const maxSize = maxSizeMb * 1024 * 1024;
    if (file.size > maxSize) {
      throw new BadRequestException(`File size exceeds ${maxSizeMb}MB limit`);
    }

    const ext = path.extname(file.originalname).toLowerCase() || '.png';
    const key = `${folder}/${randomUUID()}${ext}`;

    try {
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.r2Bucket,
          Key: key,
          Body: file.buffer,
          ContentType: file.mimetype,
        }),
      );

      const url = `${this.r2PublicUrl}/${key}`;
      this.logger.log(`R2 upload success: ${key}`);

      return {
        url,
        publicId: key,
        format: ext.replace('.', ''),
        bytes: file.size,
      };
    } catch (error) {
      this.logger.error('R2 upload error', error);
      throw new InternalServerErrorException('Failed to upload file to R2');
    }
  }

  /**
   * Upload a brand logo to R2
   */
  async uploadBrandLogo(file: Express.Multer.File): Promise<UploadResult> {
    return this.uploadToR2(file, 'brand-logos');
  }

  /**
   * Delete a file from R2
   */
  async deleteFromR2(key: string): Promise<boolean> {
    try {
      await this.s3Client.send(
        new DeleteObjectCommand({
          Bucket: this.r2Bucket,
          Key: key,
        }),
      );
      this.logger.log(`R2 file deleted: ${key}`);
      return true;
    } catch (error) {
      this.logger.error('R2 delete error', error);
      return false;
    }
  }
}
