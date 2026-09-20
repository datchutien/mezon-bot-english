/** Response from POST /api/bot/create-test */
export interface CreateTestResponse {
  success: boolean;
  attemptId?: string;
  topic?: { id: string; title: string; category?: string };
  launchUrl?: string;
  error?: string;
}

/** Response from GET /api/bot/latest-result and /api/bot/result/[id] */
export interface ResultResponse {
  success: boolean;
  attempt?: {
    id: string;
    topic_id: string;
    topic_title: string;
    submitted_at: string;
    score_result: ScoreResult | null;
  };
  detailsUrl?: string;
  error?: string;
}

/** IELTS Speaking score breakdown */
export interface ScoreResult {
  overall: number;
  fluency: number;
  lexical: number;
  grammar: number;
  pronunciation: number;
  feedback?: string;
  [key: string]: any;
}

/** Response from GET /api/bot/history */
export interface HistoryResponse {
  success: boolean;
  attempts?: Array<{
    id: string;
    topic_id: string;
    topic_title: string;
    submitted_at: string;
    score_result: ScoreResult | null;
    detailsUrl: string;
  }>;
  error?: string;
}
