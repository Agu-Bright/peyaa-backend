/**
 * Peyaa Backend - Main Entry Point
 *
 * Configures the NestJS application with:
 * - CORS
 * - Validation pipes
 * - Swagger documentation at /docs
 * - Global exception filters
 */

// Polyfill global crypto for Node.js < 19 (required by @nestjs/schedule).
// This must run BEFORE any NestJS imports execute.
import { webcrypto } from 'crypto';
if (!(globalThis as any).crypto) {
  (globalThis as any).crypto = webcrypto;
}

import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import * as compression from 'compression';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // Security headers
  app.use(helmet());

  // Gzip compression
  app.use(compression());

  // CORS — whitelist known origins only
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
    : ['http://localhost:3000', 'http://localhost:3001'];
  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      // Allow requests with no origin (mobile apps, curl, server-to-server)
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`Origin ${origin} not allowed by CORS`));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-txn-pin', 'x-idempotency-key'],
  });

  // Global validation pipe with transformation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Global exception filter for consistent error responses
  app.useGlobalFilters(new HttpExceptionFilter());

  // Global response transformation interceptor
  app.useGlobalInterceptors(new TransformInterceptor());

  // Swagger API Documentation Configuration
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Peyaa Backend API')
    .setDescription(
      `
## Peyaa API

### Authentication Flows:
- **Email Registration**: Register → Verify OTP → Set PIN → Login
- **Google Sign-In**: POST /auth/google with idToken
- **Apple Sign-In**: POST /auth/apple with identityToken

### Security:
- All protected routes require **Bearer JWT** token
- Sensitive actions require **x-txn-pin** header (4-digit PIN)

### Workflows:
1. **Wallet Top-up**: Initialize Paystack → Pay → Webhook credits wallet
2. **Gift Card Trades**: Submit trade → Admin approval → Wallet credited
3. **VTU (Airtime/Data)**: Purchase via SquadCo API
      `,
    )
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'Authorization',
        description: 'Enter JWT access token',
        in: 'header',
      },
      'JWT-auth',
    )
    .addApiKey(
      {
        type: 'apiKey',
        name: 'x-txn-pin',
        in: 'header',
        description: '4-digit transaction PIN for sensitive operations',
      },
      'PIN-auth',
    )
    .addTag('Auth', 'Authentication endpoints (email + social)')
    .addTag('Wallet', 'Wallet management and transactions')
    .addTag('Gift Cards', 'Gift card brands, rates, and trades')
    .addTag('VTU', 'Airtime and data purchase')
    .addTag('Uploads', 'File uploads (gift card proofs)')
    .addTag('Webhooks', 'External service webhooks')
    .addTag('Admin', 'Admin-only operations')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
    customSiteTitle: 'Peyaa API Docs',
  });

  const port = process.env.PORT || 3000;
  await app.listen(port);

  logger.log(`🚀 Application running on: http://localhost:${port}`);
  logger.log(`📚 Swagger docs available at: http://localhost:${port}/docs`);
}

bootstrap();
