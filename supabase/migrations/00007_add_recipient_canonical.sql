-- ENN: 受け手の表記揺れ対策（ソフト統合）
-- canonical_recipient_id が NULL → そのレコードが「正本」
-- canonical_recipient_id が他レコードのIDを指す → そのレコードは正本に統合済み（一覧では非表示）
-- 物理削除しないことで、誤統合を取り消し可能にする。

alter table public.recipients
  add column if not exists canonical_recipient_id uuid references public.recipients(id) on delete set null;

create index if not exists recipients_canonical_id_idx
  on public.recipients(canonical_recipient_id);

create index if not exists recipients_user_canonical_idx
  on public.recipients(user_id, canonical_recipient_id);
