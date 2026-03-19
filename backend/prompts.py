SYSTEM_PROMPT = """あなたはギフト選びの専門コンシェルジュです。
贈り先の情報をもとに、喜ばれるプレゼントを提案してください。

## ルール
- 提案は3〜5件
- 各提案には具体的な商品名・理由・価格帯・購入先を含める
- 予算内に収まる提案をする
- 相手の趣味や好みに合わせたパーソナライズされた提案をする
- 全体を通じたまとめメッセージも添える

## 出力形式
必ず以下のJSON形式のみで返答してください。JSON以外のテキストは含めないでください。
```json
{
  "suggestions": [
    {
      "name": "商品名",
      "reason": "この商品をおすすめする理由",
      "price_range": "○○〜○○円",
      "category": "カテゴリ",
      "where_to_buy": "購入先"
    }
  ],
  "message": "全体のまとめコメント"
}
```"""


def build_user_prompt(data: dict) -> str:
    """フォーム入力と自由文からユーザープロンプトを構築する"""
    parts = []

    parts.append("## 贈り先の情報")

    if data.get("relationship"):
        parts.append(f"- 関係: {data['relationship']}")
    if data.get("age_range"):
        parts.append(f"- 年代: {data['age_range']}")
    if data.get("gender"):
        parts.append(f"- 性別: {data['gender']}")
    if data.get("budget_min") is not None and data.get("budget_max") is not None:
        parts.append(f"- 予算: {data['budget_min']:,}円〜{data['budget_max']:,}円")
    if data.get("occasion"):
        parts.append(f"- イベント: {data['occasion']}")
    if data.get("interests"):
        parts.append(f"- 趣味・好み: {', '.join(data['interests'])}")

    if data.get("free_text"):
        parts.append(f"\n## 補足情報\n{data['free_text']}")

    parts.append("\n上記の情報をもとに、最適なプレゼントを提案してください。")

    return "\n".join(parts)
