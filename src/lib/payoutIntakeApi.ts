/**
 * payoutIntakeApi.ts — X6.20
 *
 * 정산 정보 등록 (PII 포함) 전용 클라이언트 API.
 *   - 신분증 파일 storage 업로드 (private bucket: id-documents)
 *   - submit_payout_intake_inquiry RPC 호출
 *
 * 보안:
 *   - RRN/계좌번호는 RPC 내부에서 즉시 pgp_sym_encrypt 처리됨
 *   - 신분증은 본인 폴더 (auth.uid()/...) 에만 INSERT 가능
 *   - 본인 + admin 만 SELECT 가능 (RLS)
 */
import { supabase } from '@/lib/supabase';

const ID_DOC_BUCKET = 'id-documents';

export interface PayoutIntakePayload {
  legal_name: string;
  resident_registration_number: string;
  phone: string;
  address: string;
  bank_name: string;
  account_number: string;
  account_holder: string;
  id_document: File;
}

export interface PayoutIntakeResult {
  ok: true;
  inquiry_id: string;
  submission_id: string;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
}

/** 신분증 업로드 → storage path 반환. 본인 폴더 강제. */
async function uploadIdDocument(file: File, userId: string): Promise<string> {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const safe = sanitizeFilename(file.name) || 'idcard';
  const path = `${userId}/${ts}_${safe}`;
  const { error } = await supabase.storage
    .from(ID_DOC_BUCKET)
    .upload(path, file, {
      cacheControl: '0',
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    });
  if (error) throw error;
  return path;
}

export async function submitPayoutIntake(
  input: PayoutIntakePayload,
): Promise<PayoutIntakeResult> {
  // 1) 로그인 사용자 ID 확인
  const { data: sess } = await supabase.auth.getSession();
  const uid = sess.session?.user?.id;
  if (!uid) throw new Error('로그인이 필요합니다.');

  // 2) 신분증 storage 업로드 (private)
  const path = await uploadIdDocument(input.id_document, uid);

  // 3) submit RPC 호출 — RRN/계좌 평문이 RPC 안에서 즉시 암호화됨
  const { data, error } = await supabase.rpc('submit_payout_intake_inquiry', {
    p_legal_name: input.legal_name,
    p_resident_registration_number: input.resident_registration_number,
    p_phone: input.phone,
    p_address: input.address,
    p_bank_name: input.bank_name,
    p_account_number: input.account_number,
    p_account_holder: input.account_holder,
    p_id_document_url: path,
    p_id_document_filename: input.id_document.name,
    p_id_document_size: input.id_document.size,
    p_id_document_mime: input.id_document.type || null,
  });

  if (error) {
    // 친절 메시지
    const m = (error.message ?? '').toLowerCase();
    const friendly =
      m.includes('rrn_format_invalid') ? '주민등록번호 13자리를 정확히 입력해주세요.'
      : m.includes('account_number_format_invalid') ? '계좌번호를 정확히 입력해주세요.'
      : m.includes('legal_name_required') ? '실명을 입력해주세요.'
      : m.includes('phone_required') ? '휴대폰번호를 입력해주세요.'
      : m.includes('address_required') ? '주소를 입력해주세요.'
      : m.includes('id_document_required') ? '신분증 첨부가 필요합니다.'
      : error.message;
    throw new Error(friendly);
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | { inquiry_id: string; submission_id: string }
    | undefined;
  if (!row?.submission_id) throw new Error('제출 실패: 응답 없음');

  // 4) 운영팀 이메일 발송 — 기존 notify-new-inquiry 흐름 활용
  void supabase.functions
    .invoke('notify-new-inquiry', { body: { inquiry_id: row.inquiry_id } })
    .catch((e) => {
      if (import.meta.env.DEV) console.warn('[payout-intake] notify failed', e);
    });

  return { ok: true, inquiry_id: row.inquiry_id, submission_id: row.submission_id };
}

// 본인 제출 이력 (마스킹)
export interface MyPayoutIntakeRow {
  submission_id: string;
  support_inquiry_id: string | null;
  legal_name: string;
  masked_rrn: string | null;
  bank_name: string;
  masked_account_number: string | null;
  account_holder: string;
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn';
  rejected_reason: string | null;
  created_at: string;
  approved_at: string | null;
}

export async function fetchMyPayoutIntakeSubmissions(
  limit = 10,
): Promise<MyPayoutIntakeRow[]> {
  const { data, error } = await supabase.rpc('get_my_payout_intake_submissions', {
    p_limit: limit,
  });
  if (error) return [];
  return (data ?? []) as MyPayoutIntakeRow[];
}
