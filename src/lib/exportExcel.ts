import writeXlsxFile from 'write-excel-file/browser';
import type { Row, SheetData } from 'write-excel-file/browser';

export type XlsxCellValue = string | number | null | undefined;

/**
 * 한글 깨짐 없는 .xlsx 다운로드 헬퍼.
 *
 * 왜 CSV 대신 .xlsx 인가:
 *  - CSV 한글이 윈도우 엑셀에서 깨지는 건 인코딩 자동감지 실패(UTF-8 ↔ CP949) 때문.
 *  - BOM/CP949 트릭은 환경(윈도우 vs 맥, 엑셀 버전)마다 동작이 달라 불안정.
 *  - .xlsx 는 내부적으로 UTF-8 XML 을 zip 으로 담는 표준 포맷이라 인코딩 모호성이 0.
 *    → 윈도우/맥 엑셀, 구글 시트, 넘버스 모두에서 한글이 항상 정상 표시됨.
 *
 * @param fileName 확장자(.xlsx) 포함 파일명
 * @param headers  첫 행(굵게 표시)
 * @param rows     데이터 행 — 숫자는 숫자 셀, 그 외는 문자 셀로 기록
 */
export async function downloadXlsx(
  fileName: string,
  headers: string[],
  rows: XlsxCellValue[][],
): Promise<void> {
  const headerRow: Row = headers.map((h) => ({ value: h, fontWeight: 'bold', type: String }));
  const dataRows: Row[] = rows.map((row) =>
    row.map((cell) =>
      typeof cell === 'number' && Number.isFinite(cell)
        ? { type: Number, value: cell }
        : { type: String, value: cell == null ? '' : String(cell) },
    ),
  );
  const data: SheetData = [headerRow, ...dataRows];
  await writeXlsxFile(data).toFile(fileName);
}
