/**
 * DeletedTracksPanel — '삭제 음원' 화면.
 *
 * AdminPage 는 이 화면을 <ArtistTrackManagementList removedView /> 로 렌더한다.
 * /ops 라우트 매핑(operatorPanels)은 무-props 컴포넌트만 받으므로, 같은 prop 을
 * 고정한 얇은 래퍼를 둔다. 새 기능이 아니라 기존 화면을 그대로 띄우기 위한 바인딩이다.
 */
import ArtistTrackManagementList from './ArtistTrackManagementList';

export default function DeletedTracksPanel() {
  return <ArtistTrackManagementList removedView />;
}
