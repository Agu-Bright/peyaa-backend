# Peyaa Backend - NestJS

A production-grade Peyaa mobile app backend built with NestJS, TypeScript, and MongoDB.

## Features

- **Authentication**: Email/password + Social Auth (Google, Apple)
- **Wallet System**: Digital wallet with credits/debits, transaction history
- **Gift Card Trading**: Submit trades, admin review/approval workflow
- **VTU Services**: Airtime and data purchases via SquadCo API
- **Payment Gateway**: Paystack integration for wallet top-ups
- **Admin Panel**: User management, trade reviews, manual adjustments
- **Security**: JWT auth, PIN protection, role-based access control
- **Audit Logging**: Comprehensive action tracking for compliance

## Tech Stack

- **Framework**: NestJS 10.x with TypeScript
- **Database**: MongoDB with Mongoose ODM
- **Authentication**: JWT (access + refresh tokens), Passport.js
- **API Documentation**: Swagger UI (OpenAPI 3.0)
- **Email**: Nodemailer (SMTP)
- **File Uploads**: Cloudinary
- **Payments**: Paystack
- **VTU Provider**: SquadCo API

## Project Structure

```
src/
├── admin/           # Admin management module
├── audit/           # Audit logging module
├── auth/            # Authentication (email, social, PIN)
├── common/          # Shared utilities, guards, filters
├── email/           # Email service (Nodemailer)
├── giftcards/       # Gift card brands, categories, trades
├── otp/             # OTP generation and verification
├── paystack/        # Paystack payment integration
├── uploads/         # File uploads (Cloudinary)
├── users/           # User management
├── vtu/             # Airtime & data purchases (SquadCo)
├── wallet/          # Wallet and transactions
├── webhooks/        # Webhook handlers (Paystack)
├── app.module.ts    # Root module
└── main.ts          # Application entry point
```

## Prerequisites

- Node.js 18+
- MongoDB 6.0+
- npm or yarn

## Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd peyaa-backend
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your actual values
   ```

4. **Start MongoDB** (if running locally)
   ```bash
   mongod --dbpath /path/to/data
   ```

5. **Run the application**
   ```bash
   # Development
   npm run start:dev

   # Production
   npm run build
   npm run start:prod
   ```

6. **Access Swagger UI**
   ```
   http://localhost:3000/docs
   ```

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `MONGO_URI` | MongoDB connection string | `mongodb://localhost:27017/peyaa` |
| `JWT_ACCESS_SECRET` | Secret for access tokens | `your-access-secret-key` |
| `JWT_REFRESH_SECRET` | Secret for refresh tokens | `your-refresh-secret-key` |
| `JWT_ACCESS_EXPIRY` | Access token expiry | `15m` |
| `JWT_REFRESH_EXPIRY` | Refresh token expiry | `7d` |
| `SMTP_HOST` | SMTP server host | `smtp.gmail.com` |
| `SMTP_PORT` | SMTP server port | `587` |
| `SMTP_USER` | SMTP username | `your-email@gmail.com` |
| `SMTP_PASS` | SMTP password | `your-app-password` |
| `SMTP_FROM` | Sender email address | `"Peyaa" <noreply@app.com>` |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary cloud name | `your-cloud-name` |
| `CLOUDINARY_API_KEY` | Cloudinary API key | `123456789` |
| `CLOUDINARY_API_SECRET` | Cloudinary API secret | `your-api-secret` |
| `SQUADCO_BASE_URL` | SquadCo API base URL | `https://api.squadco.com` |
| `SQUADCO_API_KEY` | SquadCo API key | `your-squadco-key` |
| `PAYSTACK_SECRET_KEY` | Paystack secret key | `sk_test_xxx` |
| `PAYSTACK_WEBHOOK_SECRET` | Paystack webhook secret | `your-webhook-secret` |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID | `xxx.apps.googleusercontent.com` |
| `APPLE_CLIENT_ID` | Apple Services ID | `com.your.app` |
| `APP_BASE_URL` | Application base URL | `https://api.yourapp.com` |

## API Documentation

Full API documentation is available at `/docs` when the server is running.

### Authentication Endpoints

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/auth/register` | Register new user | - |
| POST | `/auth/verify-email` | Verify email with OTP | - |
| POST | `/auth/resend-otp` | Resend verification OTP | - |
| POST | `/auth/login` | Login with email/password | - |
| POST | `/auth/refresh` | Refresh access token | - |
| POST | `/auth/set-pin` | Set transaction PIN | JWT |
| POST | `/auth/verify-pin` | Verify transaction PIN | JWT |
| POST | `/auth/reset-pin/request` | Request PIN reset OTP | - |
| POST | `/auth/reset-pin/confirm` | Confirm PIN reset | - |
| POST | `/auth/google` | Sign in with Google | - |
| POST | `/auth/apple` | Sign in with Apple | - |
| POST | `/auth/complete-profile` | Complete social auth profile | JWT |

### Wallet Endpoints

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/wallet/balance` | Get wallet balance | JWT |
| GET | `/wallet/transactions` | Get transaction history | JWT |
| POST | `/wallet/topup/paystack/initialize` | Initialize Paystack topup | JWT + PIN |
| GET | `/wallet/topup/paystack/verify` | Verify Paystack payment | JWT |

### Gift Card Endpoints

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/giftcards/brands` | List all brands | - |
| GET | `/giftcards/categories` | List categories | - |
| GET | `/giftcards/rate` | Calculate exchange rate | - |
| POST | `/giftcards/trades` | Submit new trade | JWT + PIN |
| GET | `/giftcards/trades/my` | Get user's trades | JWT |
| DELETE | `/giftcards/trades/my/:id` | Cancel pending trade | JWT |

### VTU Endpoints

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/vtu/networks` | List available networks | JWT |
| GET | `/vtu/data-plans` | Get data plans for network | JWT |
| POST | `/vtu/airtime` | Purchase airtime | JWT + PIN |
| POST | `/vtu/data` | Purchase data | JWT + PIN |

### Admin Endpoints

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/admin/dashboard/stats` | Get dashboard stats | Admin |
| GET | `/admin/users` | List all users | Admin |
| PATCH | `/admin/users/:id/status` | Update user status | Admin |
| POST | `/admin/wallet/adjustment` | Manual wallet adjustment | Admin |
| POST | `/admin/giftcards/trades/:id/review` | Review/approve trade | Admin |
| POST | `/admin/vtu/transactions/:type/:id/refund` | Manual VTU refund | Admin |

## Testing Flows

### Flow 1: Email Registration → Verification → PIN Setup → Login

```bash
# 1. Register a new user
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "phone": "+2348012345678",
    "password": "SecurePass123!"
  }'
# Response: { "message": "Registration successful. Please verify your email." }

# 2. Verify email with OTP (check email for OTP)
curl -X POST http://localhost:3000/auth/verify-email \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "otp": "123456"
  }'
# Response: { "message": "Email verified successfully" }

# 3. Login
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "SecurePass123!"
  }'
# Response: { "accessToken": "...", "refreshToken": "...", "pinSetupRequired": true }

# 4. Set transaction PIN
curl -X POST http://localhost:3000/auth/set-pin \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <accessToken>" \
  -d '{
    "pin": "1234",
    "confirmPin": "1234"
  }'
# Response: { "message": "Transaction PIN set successfully" }
```

### Flow 2: Google Sign-In

```bash
# Mobile app gets Google ID token, sends to backend
curl -X POST http://localhost:3000/auth/google \
  -H "Content-Type: application/json" \
  -d '{
    "idToken": "<google-id-token-from-mobile-sdk>"
  }'
# Response: { "accessToken": "...", "pinSetupRequired": true, "needsPhone": true }

# If needsPhone is true, complete profile
curl -X POST http://localhost:3000/auth/complete-profile \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <accessToken>" \
  -d '{
    "phone": "+2348012345678"
  }'
```

### Flow 3: Apple Sign-In

```bash
# Mobile app gets Apple identity token
curl -X POST http://localhost:3000/auth/apple \
  -H "Content-Type: application/json" \
  -d '{
    "identityToken": "<apple-identity-token>",
    "fullName": "John Doe"
  }'
# Response: { "accessToken": "...", "needsEmail": false, "pinSetupRequired": true }

# If needsEmail is true (Apple private relay), provide email
curl -X POST http://localhost:3000/auth/complete-profile \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <accessToken>" \
  -d '{
    "email": "user@example.com"
  }'
```

### Flow 4: Wallet Top-up via Paystack

```bash
# 1. Initialize top-up (PIN required)
curl -X POST http://localhost:3000/wallet/topup/paystack/initialize \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <accessToken>" \
  -H "x-txn-pin: 1234" \
  -d '{
    "amount": 5000
  }'
# Response: { "authorizationUrl": "https://checkout.paystack.com/...", "reference": "..." }

# 2. User completes payment on Paystack checkout page

# 3. Paystack sends webhook to /webhooks/paystack
# Backend verifies signature, credits wallet automatically

# 4. Verify payment (optional)
curl -X GET "http://localhost:3000/wallet/topup/paystack/verify?reference=<reference>" \
  -H "Authorization: Bearer <accessToken>"
```

### Flow 5: Gift Card Trade Submission → Admin Approval

```bash
# 1. Get available brands
curl -X GET http://localhost:3000/giftcards/brands

# 2. Get categories for a brand
curl -X GET "http://localhost:3000/giftcards/categories?brandId=<brandId>"

# 3. Calculate rate
curl -X GET "http://localhost:3000/giftcards/rate?categoryId=<categoryId>&cardValue=50"

# 4. Upload proof image
curl -X POST http://localhost:3000/uploads/giftcard-proof \
  -H "Authorization: Bearer <accessToken>" \
  -F "file=@/path/to/image.jpg"
# Response: { "url": "https://res.cloudinary.com/..." }

# 5. Submit trade (PIN required)
curl -X POST http://localhost:3000/giftcards/trades \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <accessToken>" \
  -H "x-txn-pin: 1234" \
  -d '{
    "categoryId": "<categoryId>",
    "cardValueUsd": 50,
    "cardCode": "XXXX-XXXX-XXXX",
    "proofImages": ["https://res.cloudinary.com/..."],
    "userNotes": "Amazon US card"
  }'

# 6. Admin reviews and approves (wallet credited automatically)
curl -X POST http://localhost:3000/admin/giftcards/trades/<tradeId>/review \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <adminToken>" \
  -d '{
    "status": "APPROVED",
    "adminNotes": "Card verified successfully"
  }'
```

### Flow 6: VTU Airtime/Data Purchase

```bash
# 1. Get available networks
curl -X GET http://localhost:3000/vtu/networks \
  -H "Authorization: Bearer <accessToken>"

# 2. Get data plans
curl -X GET "http://localhost:3000/vtu/data-plans?network=MTN" \
  -H "Authorization: Bearer <accessToken>"

# 3. Purchase airtime (PIN required, wallet debited)
curl -X POST http://localhost:3000/vtu/airtime \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <accessToken>" \
  -H "x-txn-pin: 1234" \
  -d '{
    "network": "MTN",
    "phone": "08012345678",
    "amount": 500
  }'

# 4. Purchase data (PIN required, wallet debited)
curl -X POST http://localhost:3000/vtu/data \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <accessToken>" \
  -H "x-txn-pin: 1234" \
  -d '{
    "network": "MTN",
    "phone": "08012345678",
    "planCode": "MTN_1GB_30DAYS"
  }'
```

## Security Features

### JWT Authentication
- Access tokens expire in 15 minutes
- Refresh tokens expire in 7 days
- Tokens stored securely, never in localStorage

### Transaction PIN
- 4-digit PIN for sensitive operations
- Hashed with bcrypt (12 rounds)
- Required for: wallet top-up, trades, VTU purchases
- Header: `x-txn-pin: 1234`

### Password Security
- Minimum 8 characters
- Hashed with bcrypt (12 rounds)
- Never logged or exposed

### Role-Based Access
- User roles: `USER`, `ADMIN`
- Admin endpoints protected with `RolesGuard`

### Webhook Security
- Paystack webhooks verified with signature
- HMAC SHA512 validation

## Error Handling

All errors follow a consistent format:

```json
{
  "success": false,
  "statusCode": 400,
  "message": "Validation failed",
  "error": "Bad Request",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "path": "/auth/login"
}
```

## Deployment

### Docker (Recommended)

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist ./dist
EXPOSE 3000
CMD ["node", "dist/main"]
```

### Environment Setup for Production

1. Set `NODE_ENV=production`
2. Use strong, unique secrets for JWT
3. Enable MongoDB authentication
4. Use HTTPS (reverse proxy with nginx)
5. Set up Paystack webhook URL
6. Configure CORS for your domains

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

MIT License
