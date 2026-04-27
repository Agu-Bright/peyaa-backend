/**
 * VTPass Service
 *
 * Pure HTTP client for the VTPass VTU API.
 * Handles airtime, data, electricity, and TV subscription purchases.
 *
 * - purchaseAirtime: Buy airtime for any network
 * - purchaseData: Buy data bundle by variation_code
 * - getDataPlans: List available data bundles for a network
 * - verifyMeter: Lookup electricity meter/customer info
 * - purchaseElectricity: Vend electricity token
 * - getTvBouquets: List TV bouquets/plans for a provider
 * - verifySmartcard: Verify TV smartcard/IUC number
 * - purchaseTvSubscription: Purchase TV subscription
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

export interface VtpassResult {
  success: boolean;
  transactionId: string;
  token?: string;  // electricity only
  units?: string;  // electricity only
  raw: any;
}

@Injectable()
export class VtpassService {
  private readonly logger = new Logger(VtpassService.name);
  private readonly client: AxiosInstance;

  // Airtime serviceID map
  private readonly airtimeServiceId: Record<string, string> = {
    MTN: 'mtn',
    GLO: 'glo',
    AIRTEL: 'airtel',
    ETISALAT: 'etisalat',
  };

  // Data serviceID map
  private readonly dataServiceId: Record<string, string> = {
    MTN: 'mtn-data',
    GLO: 'glo-data',
    AIRTEL: 'airtel-data',
    ETISALAT: 'etisalat-data',
  };

  // TV/Cable serviceID map
  private readonly tvServiceId: Record<string, string> = {
    dstv: 'dstv',
    gotv: 'gotv',
    startimes: 'startimes',
  };

  // Electricity serviceID map
  private readonly elecServiceId: Record<string, string> = {
    IE: 'ikeja-electric',
    EKEDC: 'eko-electric',
    AEDC: 'abuja-electric',
    YEDC: 'yola-electric',
    BEDC: 'benin-electric',
    IBEDC: 'ibadan-electric',
    KEDCO: 'kano-electric',
    KAEDC: 'kaduna-electric',
    PHED: 'phed',
    EEDC: 'enugu-electric',
    JED: 'jos-electric',
  };

  constructor(private readonly configService: ConfigService) {
    const baseURL = this.configService.get<string>('VTPASS_BASE_URL', 'https://vtpass.com/api');
    const apiKey = this.configService.get<string>('VTPASS_API_KEY', '');
    const publicKey = this.configService.get<string>('VTPASS_PUBLIC_KEY', '');
    const secretKey = this.configService.get<string>('VTPASS_SECRET_KEY', '');
    const username = this.configService.get<string>('VTPASS_USERNAME', '');
    const password = this.configService.get<string>('VTPASS_PASSWORD', '');

    this.client = axios.create({
      baseURL,
      timeout: 60000,
      headers: { 'Content-Type': 'application/json' },
    });

    // Request interceptor: VTPass supports both Basic Auth (sandbox) and api-key/secret-key headers (live).
    // - Sandbox endpoint requires Basic Auth (username + password)
    // - Live endpoint uses api-key + (public-key for GET / secret-key for POST)
    // We send all available credentials so either auth scheme works.
    this.client.interceptors.request.use((config) => {
      config.headers = config.headers ?? {} as any;
      if (apiKey) config.headers['api-key'] = apiKey;
      if (config.method?.toLowerCase() === 'get') {
        if (publicKey) config.headers['public-key'] = publicKey;
      } else {
        if (secretKey) config.headers['secret-key'] = secretKey;
      }
      if (username && password) {
        const basic = Buffer.from(`${username}:${password}`).toString('base64');
        config.headers['Authorization'] = `Basic ${basic}`;
      }
      return config;
    });

    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        this.logger.error(
          `VTPass API error: ${error.response?.status} ${JSON.stringify(error.response?.data)}`,
        );
        throw error;
      },
    );
  }

  /**
   * Get data plan variations for a network
   */
  async getDataPlans(network: string): Promise<Array<{
    planCode: string;
    name: string;
    dataAmount: string;
    validity: string;
    price: number;
  }>> {
    const serviceID = this.dataServiceId[network.toUpperCase()];
    if (!serviceID) throw new Error(`Unsupported network: ${network}`);

    this.logger.log(`Fetching VTPass data plans for serviceID: ${serviceID}`);

    const { data } = await this.client.get('/service-variations', {
      params: { serviceID },
    });

    // VTPass returns varations (typo in their API, not a typo here)
    const variations: any[] = data?.content?.varations || [];

    return variations.map((v: any) => ({
      planCode: v.variation_code,
      name: v.name,
      dataAmount: v.name,
      validity: '',
      price: parseFloat(v.variation_amount) || 0,
    }));
  }

  /**
   * Purchase airtime
   */
  async purchaseAirtime(params: {
    network: string;
    phone: string;
    amount: number;
    reference: string;
  }): Promise<VtpassResult> {
    const serviceID = this.airtimeServiceId[params.network.toUpperCase()];
    if (!serviceID) throw new Error(`Unsupported network: ${params.network}`);

    this.logger.log(
      `VTPass airtime: serviceID=${serviceID}, phone=${params.phone}, amount=${params.amount}`,
    );

    const { data } = await this.client.post('/pay', {
      request_id: params.reference,
      serviceID,
      amount: params.amount,
      phone: params.phone,
    });

    return this.parseResult(data);
  }

  /**
   * Purchase data bundle
   */
  async purchaseData(params: {
    network: string;
    phone: string;
    planCode: string;
    amount: number;
    reference: string;
  }): Promise<VtpassResult> {
    const serviceID = this.dataServiceId[params.network.toUpperCase()];
    if (!serviceID) throw new Error(`Unsupported network: ${params.network}`);

    this.logger.log(
      `VTPass data: serviceID=${serviceID}, phone=${params.phone}, plan=${params.planCode}`,
    );

    const { data } = await this.client.post('/pay', {
      request_id: params.reference,
      serviceID,
      billersCode: params.phone,
      variation_code: params.planCode,
      amount: params.amount,
      phone: params.phone,
    });

    return this.parseResult(data);
  }

  /**
   * Lookup electricity meter / customer info
   */
  async verifyMeter(params: {
    provider: string;
    meterNumber: string;
    meterType: 'prepaid' | 'postpaid';
  }): Promise<{ customerName: string; address: string; minimumVend: number }> {
    const serviceID = this.elecServiceId[params.provider];
    if (!serviceID) throw new Error(`Unsupported provider: ${params.provider}`);

    this.logger.log(
      `VTPass meter verify: serviceID=${serviceID}, meter=${params.meterNumber}, type=${params.meterType}`,
    );

    const { data } = await this.client.post('/merchant-verify', {
      billersCode: params.meterNumber,
      serviceID,
      type: params.meterType,
    });

    const content = data?.content || {};
    return {
      customerName: content.Customer_Name || content.name || '',
      address: content.Address || '',
      minimumVend: parseFloat(
        content.Minimum_Purchase_Payable || content.minimumPayable || '0',
      ),
    };
  }

  /**
   * Purchase electricity (vend token)
   */
  async purchaseElectricity(params: {
    provider: string;
    meterNumber: string;
    meterType: 'prepaid' | 'postpaid';
    amount: number;
    phone: string;
    reference: string;
  }): Promise<VtpassResult> {
    const serviceID = this.elecServiceId[params.provider];
    if (!serviceID) throw new Error(`Unsupported provider: ${params.provider}`);

    this.logger.log(
      `VTPass electricity: serviceID=${serviceID}, meter=${params.meterNumber}, amount=${params.amount}`,
    );

    const { data } = await this.client.post('/pay', {
      request_id: params.reference,
      serviceID,
      billersCode: params.meterNumber,
      variation_code: params.meterType,
      amount: params.amount,
      phone: params.phone,
    });

    return this.parseElecResult(data);
  }

  /**
   * Get TV bouquets/plans for a provider
   */
  async getTvBouquets(provider: string): Promise<Array<{
    bouquetCode: string;
    name: string;
    price: number;
  }>> {
    const serviceID = this.tvServiceId[provider.toLowerCase()];
    if (!serviceID) throw new Error(`Unsupported TV provider: ${provider}`);

    this.logger.log(`Fetching VTPass TV bouquets for serviceID: ${serviceID}`);

    const { data } = await this.client.get('/service-variations', {
      params: { serviceID },
    });

    const variations: any[] = data?.content?.varations || [];

    return variations.map((v: any) => ({
      bouquetCode: v.variation_code,
      name: v.name,
      price: parseFloat(v.variation_amount) || 0,
    }));
  }

  /**
   * Verify TV smartcard/IUC number
   */
  async verifySmartcard(params: {
    provider: string;
    smartcardNumber: string;
  }): Promise<{ customerName: string; currentBouquet: string; dueDate: string }> {
    const serviceID = this.tvServiceId[params.provider.toLowerCase()];
    if (!serviceID) throw new Error(`Unsupported TV provider: ${params.provider}`);

    this.logger.log(
      `VTPass smartcard verify: serviceID=${serviceID}, smartcard=${params.smartcardNumber}`,
    );

    const { data } = await this.client.post('/merchant-verify', {
      billersCode: params.smartcardNumber,
      serviceID,
    });

    const content = data?.content || {};
    return {
      customerName: content.Customer_Name || content.name || '',
      currentBouquet: content.Current_Bouquet || content.currentBouquet || '',
      dueDate: content.Due_Date || content.dueDate || '',
    };
  }

  /**
   * Purchase TV subscription
   */
  async purchaseTvSubscription(params: {
    provider: string;
    smartcardNumber: string;
    bouquetCode: string;
    amount: number;
    phone: string;
    reference: string;
    subscriptionType?: string;
  }): Promise<VtpassResult> {
    const serviceID = this.tvServiceId[params.provider.toLowerCase()];
    if (!serviceID) throw new Error(`Unsupported TV provider: ${params.provider}`);

    this.logger.log(
      `VTPass TV subscription: serviceID=${serviceID}, smartcard=${params.smartcardNumber}, bouquet=${params.bouquetCode}`,
    );

    const { data } = await this.client.post('/pay', {
      request_id: params.reference,
      serviceID,
      billersCode: params.smartcardNumber,
      variation_code: params.bouquetCode,
      amount: params.amount,
      phone: params.phone,
      subscription_type: params.subscriptionType || 'renew',
    });

    return this.parseResult(data);
  }

  /**
   * Parse standard VTPass response into VtpassResult
   * code "000" = success, "099" = pending/processing (treat as accepted)
   */
  private parseResult(data: any): VtpassResult {
    const code: string = data?.code || '';
    const txn = data?.content?.transactions || {};
    const success = code === '000' || code === '099';

    this.logger.log(`VTPass response: code=${code}, transactionId=${txn.transactionId || ''}`);

    return {
      success,
      transactionId: txn.transactionId || txn.transaction_id || '',
      raw: data,
    };
  }

  /**
   * Parse electricity VTPass response — also extracts token and units
   */
  private parseElecResult(data: any): VtpassResult {
    const base = this.parseResult(data);
    const txn = data?.content?.transactions || {};
    return {
      ...base,
      token: txn.token || txn.Token || '',
      units: txn.units || txn.Units || '',
    };
  }
}
