// Con-TecT データベース型定義（要件定義書 Section 8 準拠）

export interface Profile {
  id: string;
  email: string;
  name: string | null;
  age: number | null;
  gender: string | null;
  occupation: string | null;
  interests: string[];
  strengths: string[];
  created_at: string;
  updated_at: string;
}

export interface Session {
  id: string;
  user_id: string | null;
  recipient_id: string | null;
  messages: ChatMessage[];
  profile_input: ProfileInput;
  target_input: TargetInput;
  analysis_result: AnalysisResult;
  created_at: string;
}

export interface Recipient {
  id: string;
  user_id: string;
  nickname: string;
  relationship: string | null;
  age: number | null;
  gender: string | null;
  occupation: string | null;
  interests: string[];
  strengths: string[];
  notes: string | null;
  canonical_recipient_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Memory {
  id: string;
  user_id: string;
  content: string;
  source: "ai" | "user";
  created_at: string;
  updated_at: string;
}

export interface Proposal {
  id: string;
  user_id: string;
  session_id: string | null;
  recipient_id: string | null;
  product_name: string;
  product_description: string | null;
  product_url: string | null;
  product_price: string | null;
  maker_name: string | null;
  narrative: string | null;
  occasion: string | null;
  created_at: string;
}

export interface RecipientNote {
  id: string;
  recipient_id: string;
  user_id: string;
  content: string;
  source: "ai" | "user";
  created_at: string;
}

export interface ClickLog {
  id: string;
  user_id: string | null;
  session_id: string;
  product_name: string;
  product_url: string;
  clicked_at: string;
}

// チャット関連
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

// 7ステッププロセスの入力データ
export interface ProfileInput {
  age?: number;
  gender?: string;
  occupation?: string;
  interests?: string[];
  strengths?: string[];
  current_mood?: string;
}

export interface TargetInput {
  age?: number;
  gender?: string;
  occupation?: string;
  interests?: string[];
  strengths?: string[];
  occasion?: string;
}

// Step 4-7 の結果
export interface AnalysisResult {
  step4_analysis?: string;
  step5_narrative?: string;
  step6_proposal?: ProductProposal;
  step7_action?: string;
  related_products?: ProductProposal[];
}

export interface ProductProposal {
  name: string;
  description: string;
  price?: string;
  image_url?: string;
  product_url: string;
  maker_name?: string;
}
