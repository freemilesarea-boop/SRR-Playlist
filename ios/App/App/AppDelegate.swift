import UIKit
import Capacitor
import AVFoundation

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        configureAudioSessionForBackgroundPlayback()
        return true
    }

    /// 백그라운드/화면 잠금 상태에서도 매장 음악이 계속 나오게 한다.
    ///
    /// Info.plist 의 `UIBackgroundModes: audio` 만으로는 **부족하다.** 기본 오디오 세션
    /// 카테고리(soloAmbient)는 앱이 백그라운드로 가거나 화면이 잠기면 음소거되고,
    /// 무음 스위치에도 꺼진다. `.playback` 이라야 두 경우 모두에서 계속 재생된다.
    ///
    /// setActive 는 호출하지 않는다 — 카테고리만 지정해두면 WKWebView 가 실제로 재생을
    /// 시작할 때 iOS 가 세션을 활성화한다. 실행하자마자 활성화하면 재생도 하기 전에
    /// 다른 앱의 오디오를 끊게 된다.
    private func configureAudioSessionForBackgroundPlayback() {
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
        } catch {
            // 세션 설정 실패는 재생 자체를 막지 않는다(포그라운드 재생은 그대로 동작).
            print("[audio] AVAudioSession 설정 실패: \(error.localizedDescription)")
        }
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    // MARK: - 푸시 알림 (APNs)
    //
    // @capacitor/push-notifications 는 이 두 콜백이 NotificationCenter 로 결과를 넘겨줘야
    // JS 쪽 'registration' / 'registrationError' 이벤트를 발생시킨다.
    // 이 코드가 없으면 iOS 에서 토큰이 영원히 오지 않는다(= 앱 푸시가 조용히 동작 안 함).

    func application(_ application: UIApplication,
                     didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications,
                                        object: deviceToken)
    }

    func application(_ application: UIApplication,
                     didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications,
                                        object: error)
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}
