import UIKit
import Capacitor

/// 씬(Scene) 기반 화면 수명주기.
///
/// iOS 27 부터는 UIScene 수명주기를 쓰지 않는 앱을 실행 직후 강제 종료한다
/// (`_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption` — 2026-11-26 App Store 심사 충돌 원인).
/// 그래서 창(window)은 AppDelegate 가 아니라 이 씬 델리게이트가 갖는다.
///
/// - 창과 첫 화면(CAPBridgeViewController)은 Info.plist 의 UISceneStoryboardFile(Main) 로 UIKit 이 만든다.
/// - 씬 방식에서는 딥링크·유니버설 링크가 AppDelegate 가 아니라 여기로 온다.
///   Capacitor 는 ApplicationDelegateProxy 로 받으므로 그대로 넘겨 준다
///   (OAuth 복귀 com.deudda.app://auth/callback 이 이 경로를 탄다 — 빠지면 Google/Apple 로그인이 앱으로 안 돌아온다).
class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard scene is UIWindowScene else { return }

        // 앱이 꺼진 상태에서 링크로 열린 경우 — 첫 연결 때 함께 들어온다.
        if let url = connectionOptions.urlContexts.first?.url {
            _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: url, options: [:])
        }
        if let activity = connectionOptions.userActivities.first {
            _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, continue: activity, restorationHandler: { _ in })
        }
    }

    // 앱이 켜져 있을 때 커스텀 스킴 링크로 돌아온 경우 (OAuth 콜백 등)
    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        for context in URLContexts {
            _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: context.url, options: [:])
        }
    }

    // 유니버설 링크
    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
    }
}
