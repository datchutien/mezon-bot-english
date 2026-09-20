import { Injectable, Logger } from '@nestjs/common';
import { Tenant } from '@prisma/client';
import {
  CreateTestResponse,
  ResultResponse,
  HistoryResponse,
} from './web-app-client.types';

@Injectable()
export class WebAppClientService {
  private readonly logger = new Logger(WebAppClientService.name);

  /**
   * Call a tenant's web app API.
   * Routes to the correct URL based on tenant.webAppUrl.
   */
  private async callApi<T>(
    tenant: Tenant,
    method: 'GET' | 'POST',
    path: string,
    body?: any,
  ): Promise<T> {
    let baseUrl = (tenant.webAppUrl || '').trim().replace(/\/+$/, '');
    if (baseUrl && !/^https?:\/\//i.test(baseUrl)) {
      baseUrl = `http://${baseUrl}`;
    }
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    const url = `${baseUrl}${cleanPath}`;
    const headers: Record<string, string> = {
      'x-bot-secret': tenant.webAppApiSecret,
      'Content-Type': 'application/json',
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      const res = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const data = await res.json();
      return data as T;
    } catch (err: any) {
      if (err.name === 'AbortError') {
        this.logger.error(`Timeout calling ${method} ${url}`);
      } else {
        this.logger.error(`Error calling ${method} ${url}:`, err.message);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  // ── *thi — Create a new test attempt ──

  async createTest(
    tenant: Tenant,
    mezonId: string,
    username?: string,
  ): Promise<CreateTestResponse> {
    return this.callApi<CreateTestResponse>(
      tenant,
      'POST',
      '/api/bot/create-test',
      { mezon_id: mezonId, username },
    );
  }

  // ── *ketqua — Get latest result ──

  async getLatestResult(
    tenant: Tenant,
    mezonId: string,
  ): Promise<ResultResponse> {
    return this.callApi<ResultResponse>(
      tenant,
      'GET',
      `/api/bot/latest-result?mezon_id=${encodeURIComponent(mezonId)}`,
    );
  }

  // ── *ketqua <id> — Get specific result ──

  async getResultById(
    tenant: Tenant,
    mezonId: string,
    attemptId: string,
  ): Promise<ResultResponse> {
    return this.callApi<ResultResponse>(
      tenant,
      'GET',
      `/api/bot/result/${encodeURIComponent(attemptId)}?mezon_id=${encodeURIComponent(mezonId)}`,
    );
  }

  // ── *lichsu — Get history ──

  async getHistory(
    tenant: Tenant,
    mezonId: string,
    limit = 10,
  ): Promise<HistoryResponse> {
    return this.callApi<HistoryResponse>(
      tenant,
      'GET',
      `/api/bot/history?mezon_id=${encodeURIComponent(mezonId)}&limit=${limit}`,
    );
  }
}
