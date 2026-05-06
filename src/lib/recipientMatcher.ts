import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

export interface RecipientCandidate {
  nickname: string;
  relationship?: string | null;
  age?: number | null;
  gender?: string | null;
  occupation?: string | null;
}

export interface ExistingRecipientForMatch {
  id: string;
  nickname: string;
  relationship?: string | null;
  age?: number | null;
  gender?: string | null;
  occupation?: string | null;
  interests?: string[] | null;
}

export interface MatchDecision {
  matchId: string | null;
  confidence: number;
  reasoning: string;
}

const HIGH_CONFIDENCE_THRESHOLD = 0.85;

const matchTool = {
  name: "decide_recipient_match",
  description: "新しく言及された受け手が既存の受け手リストの誰かと同一人物かを判定する",
  parameters: {
    type: Type.OBJECT,
    properties: {
      match_id: {
        type: Type.STRING,
        description: "同一人物と判定した既存受け手のID。該当なしならnull。",
        nullable: true,
      },
      confidence: {
        type: Type.NUMBER,
        description: "0.0〜1.0の確信度。同一人物と判断する根拠の強さ。",
      },
      reasoning: {
        type: Type.STRING,
        description: "判定理由の短い説明（日本語、1〜2文）",
      },
    },
    required: ["match_id", "confidence", "reasoning"],
  },
};

export async function findMatchingRecipient(
  candidate: RecipientCandidate,
  existing: ExistingRecipientForMatch[]
): Promise<MatchDecision> {
  if (existing.length === 0) {
    return { matchId: null, confidence: 0, reasoning: "既存の受け手がいない" };
  }

  const exactMatch = existing.find(
    (r) => r.nickname.trim().toLowerCase() === candidate.nickname.trim().toLowerCase()
  );
  if (exactMatch) {
    return { matchId: exactMatch.id, confidence: 1.0, reasoning: "呼び名が完全一致" };
  }

  const candidateDesc = formatRecipient(candidate);
  const existingList = existing
    .map((r, i) => `${i + 1}. id=${r.id} | ${formatRecipient(r)}`)
    .join("\n");

  const prompt = `日本語で会話されたギフト相談アプリの受け手マッチング判定をします。

【新たに言及された受け手】
${candidateDesc}

【既存の受け手リスト（同じユーザーが過去に登録）】
${existingList}

【判定ルール】
- 「母」「母親」「お母さん」「ママ」のような呼び名違いで明らかに同じ人物を指している場合は同一とみなす
- 関係性・年齢・性別・職業が大きく食い違う場合は別人とみなす
- 関係性が同じ（例: 両方とも「父親」）でも、複数人いうるケース（例: 父と義父）に注意
- 確信度: 0.85以上で「同一人物」、0.5〜0.85は「可能性あり」、0.5未満は「別人」と判断
- 該当なしの場合は match_id を null にし、confidence は0近辺にすること

decide_recipient_match関数を必ず呼び出してJSONで返してください。`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        temperature: 0.1,
        tools: [{ functionDeclarations: [matchTool] }],
      },
    });

    const parts = response.candidates?.[0]?.content?.parts || [];
    const fnCall = parts.find((p) => p.functionCall?.name === "decide_recipient_match");
    if (!fnCall?.functionCall?.args) {
      return { matchId: null, confidence: 0, reasoning: "LLM応答に関数呼び出しなし" };
    }

    const args = fnCall.functionCall.args as {
      match_id?: string | null;
      confidence?: number;
      reasoning?: string;
    };

    const matchId = args.match_id && existing.some((r) => r.id === args.match_id)
      ? args.match_id
      : null;
    const confidence = typeof args.confidence === "number" ? args.confidence : 0;

    return {
      matchId,
      confidence,
      reasoning: args.reasoning || "",
    };
  } catch (err) {
    console.error("[MATCHER] error:", err);
    return { matchId: null, confidence: 0, reasoning: "判定エラー" };
  }
}

export function shouldMerge(decision: MatchDecision): boolean {
  return decision.matchId !== null && decision.confidence >= HIGH_CONFIDENCE_THRESHOLD;
}

function formatRecipient(r: RecipientCandidate | ExistingRecipientForMatch): string {
  const parts: string[] = [`呼び名=${r.nickname}`];
  if (r.relationship) parts.push(`関係性=${r.relationship}`);
  if (r.age != null) parts.push(`${r.age}歳`);
  if (r.gender) parts.push(`性別=${r.gender}`);
  if (r.occupation) parts.push(`職業=${r.occupation}`);
  if ("interests" in r && r.interests && r.interests.length > 0) {
    parts.push(`関心=${r.interests.join(",")}`);
  }
  return parts.join(" / ");
}

export interface ClusterMember {
  id: string;
  reason: string;
}

export interface DedupCluster {
  canonical_id: string;
  members: ClusterMember[];
  confidence: number;
}

const clusterTool = {
  name: "report_clusters",
  description: "同一人物と判定された受け手をクラスタにまとめる。1人だけのクラスタは含めない。",
  parameters: {
    type: Type.OBJECT,
    properties: {
      clusters: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            canonical_id: {
              type: Type.STRING,
              description: "情報量が最も多い、または代表として残すべき受け手のID",
            },
            member_ids: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "正本に統合すべき他のID（canonical_id以外）",
            },
            confidence: {
              type: Type.NUMBER,
              description: "クラスタ全体の確信度 0.0〜1.0",
            },
            reasoning: {
              type: Type.STRING,
              description: "クラスタリング理由（短く）",
            },
          },
          required: ["canonical_id", "member_ids", "confidence", "reasoning"],
        },
      },
    },
    required: ["clusters"],
  },
};

export interface BulkClusterResult {
  canonical_id: string;
  member_ids: string[];
  confidence: number;
  reasoning: string;
}

export async function clusterDuplicates(
  recipients: ExistingRecipientForMatch[]
): Promise<BulkClusterResult[]> {
  if (recipients.length < 2) return [];

  const list = recipients
    .map((r, i) => `${i + 1}. id=${r.id} | ${formatRecipient(r)}`)
    .join("\n");

  const prompt = `日本語のギフト相談アプリで、同一ユーザーが登録した「贈った相手」のリストです。
表記揺れ（例: 母/母親/お母さん）で同じ人物が複数行に分かれている可能性があります。
同一人物と確信できるグループだけをクラスタにまとめてください。
1人しか該当しない場合（重複が無い人物）はクラスタに含めないこと。

【判定ルール】
- 呼び名違いで明らかに同じ人物を指している（母/母親/お母さん等）→ 同一クラスタ
- 関係性・年齢・性別が食い違う場合は別人
- 関係性が同じでも、複数人いうるケース（父と義父、姉と妹など）は安全側に倒して別クラスタ
- canonical_idは、関連情報がより多く埋まっている／呼び名が代表的な行を選ぶこと
- confidenceは0.85以上の高確信のクラスタのみ報告すること

【受け手リスト】
${list}

report_clusters関数で結果を返してください。`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        temperature: 0.1,
        tools: [{ functionDeclarations: [clusterTool] }],
      },
    });

    const parts = response.candidates?.[0]?.content?.parts || [];
    const fnCall = parts.find((p) => p.functionCall?.name === "report_clusters");
    if (!fnCall?.functionCall?.args) return [];

    const args = fnCall.functionCall.args as {
      clusters?: Array<{
        canonical_id?: string;
        member_ids?: string[];
        confidence?: number;
        reasoning?: string;
      }>;
    };

    const validIds = new Set(recipients.map((r) => r.id));
    const result: BulkClusterResult[] = [];
    for (const c of args.clusters || []) {
      if (!c.canonical_id || !validIds.has(c.canonical_id)) continue;
      const members = (c.member_ids || []).filter((id) => validIds.has(id) && id !== c.canonical_id);
      if (members.length === 0) continue;
      result.push({
        canonical_id: c.canonical_id,
        member_ids: members,
        confidence: typeof c.confidence === "number" ? c.confidence : 0,
        reasoning: c.reasoning || "",
      });
    }
    return result;
  } catch (err) {
    console.error("[MATCHER] cluster error:", err);
    return [];
  }
}
